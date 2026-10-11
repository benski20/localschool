//! Automatic updates, from the school's own server (no Apple account or update service).
//!
//! The school's server says which Mac app it hands out (`mac_app_version` in /api/health,
//! read from the zip it serves at /install/LocalSchool-macOS.zip). When that's newer than
//! this app, the app downloads it in the background, checks it, and keeps it ready. The
//! swap happens when the teacher quits: a small helper waits for the app to close, puts
//! the new one in its place and removes the old one. The next launch is the new version.
//! Check for updates (the account menu in the window, or Teacher's Desk → Check for
//! Updates… in the menu bar) does the same right away and says what happened. If macOS
//! refuses the swap (App Management), the next launch explains how to allow it.

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use serde::Deserialize;
use tauri::{AppHandle, Manager};

const CHECK_EVERY: Duration = Duration::from_secs(6 * 3600);
/// What a teacher can always run instead (quit the app first), from their school's server.
pub fn terminal_line(app: &AppHandle) -> String {
    let base = crate::server::school(app).map(|s| s.url).unwrap_or_else(|| "https://teachers-desk-xi.vercel.app".into());
    format!("curl -fsSL {}/install/mac.sh | bash", base.trim_end_matches('/'))
}
/// Only one helper may swap the app (Check for Updates… then the exit event).
static HELPER_STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Deserialize, Default)]
struct Health {
    #[serde(default)]
    mac_app_version: String,
}

/// "0.4.10" > "0.4.9": compare numerically, part by part.
pub fn newer(remote: &str, local: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> { v.trim().split('.').map(|p| p.parse().unwrap_or(0)).collect() };
    let (r, l) = (parse(remote), parse(local));
    for i in 0..r.len().max(l.len()) {
        let (a, b) = (r.get(i).copied().unwrap_or(0), l.get(i).copied().unwrap_or(0));
        if a != b {
            return a > b;
        }
    }
    false
}

fn dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("update"))
}

/// The update waiting to be installed, if any: (its .app folder, its version).
pub fn staged(app: &AppHandle) -> Option<(PathBuf, String)> {
    let d = dir(app)?;
    let version = fs::read_to_string(d.join("ready")).ok()?.trim().to_string();
    let bundle = d.join("new/Teacher's Desk.app");
    (bundle.exists() && newer(&version, env!("CARGO_PKG_VERSION"))).then_some((bundle, version))
}

/// This app's own bundle (…/Teacher's Desk.app), when it's running from one.
fn own_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let bundle = exe.parent()?.parent()?.parent()?.to_path_buf(); // MacOS → Contents → .app
    (bundle.extension().is_some_and(|e| e == "app")).then_some(bundle)
}

fn sh(cmd: &str, args: &[&str]) -> bool {
    Command::new(cmd).args(args).status().map(|s| s.success()).unwrap_or(false)
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    /// This app is the newest the school hands out.
    UpToDate,
    /// A newer app is downloaded, checked and waiting (its version).
    Ready(String),
    /// Why it couldn't update, in words for a teacher.
    Failed(String),
    /// Not an installed app (a development build): nothing to do.
    NotInstalled,
}

/// Check the school's server once; download and stage a newer app. `on_download` is told
/// the version just before a download starts (for "Downloading…").
pub fn check(app: &AppHandle, on_download: &dyn Fn(&str)) -> Outcome {
    if !cfg!(target_os = "macos") || own_bundle().is_none() {
        return Outcome::NotInstalled;
    }
    let Some(school) = crate::server::school(app) else {
        return Outcome::Failed("Teacher's Desk isn't connected to a school yet.".into());
    };
    let base = school.url.trim_end_matches('/').to_string();
    let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(10)).timeout(Duration::from_secs(600)).build();
    let Ok(health) = agent.get(&format!("{base}/api/health")).call().map(|r| r.into_json::<Health>().unwrap_or_default())
    else {
        return Outcome::Failed("Couldn't reach your school's server. Check your internet connection.".into());
    };
    let remote = health.mac_app_version;
    if remote.is_empty() || !newer(&remote, env!("CARGO_PKG_VERSION")) {
        return Outcome::UpToDate;
    }
    if staged(app).is_some_and(|(_, v)| v == remote) {
        return Outcome::Ready(remote);
    }
    let Some(d) = dir(app) else { return Outcome::Failed("No folder to download the update into.".into()) };
    let _ = fs::remove_dir_all(&d);
    if fs::create_dir_all(d.join("new")).is_err() {
        return Outcome::Failed("No folder to download the update into.".into());
    }
    on_download(&remote);
    let zip = d.join("app.zip");
    let ok = agent
        .get(&format!("{base}/install/LocalSchool-macOS.zip"))
        .call()
        .ok()
        .and_then(|r| {
            let mut f = fs::File::create(&zip).ok()?;
            std::io::copy(&mut r.into_reader(), &mut f).ok()
        })
        .is_some();
    let new_app = d.join("new/Teacher's Desk.app");
    let new_s = new_app.to_string_lossy().to_string();
    let outcome = if !ok {
        Outcome::Failed("The download didn't finish. Try again in a moment.".into())
    } else if !(sh("/usr/bin/ditto", &["-x", "-k", &zip.to_string_lossy(), &d.join("new").to_string_lossy()])
        && new_app.exists()
        && sh("/usr/bin/codesign", &["--verify", "--deep", "--strict", &new_s])
        && version_of(&new_app).is_some_and(|v| v == remote))
    {
        Outcome::Failed("The update didn't pass its safety check, so it wasn't installed.".into())
    } else {
        Outcome::Ready(remote.clone())
    };
    let _ = fs::remove_file(&zip);
    match &outcome {
        Outcome::Ready(v) => {
            let _ = fs::write(d.join("ready"), v);
        }
        _ => {
            let _ = fs::remove_dir_all(&d);
        }
    }
    log(&format!("check {base}: {outcome:?}"));
    outcome
}

/// What the teacher sees after choosing Check for updates.
pub fn message(outcome: &Outcome, terminal: &str) -> String {
    match outcome {
        Outcome::UpToDate | Outcome::NotInstalled => {
            format!("You have the latest version of Teacher's Desk ({}).", env!("CARGO_PKG_VERSION"))
        }
        Outcome::Ready(v) => format!("Updating to Teacher's Desk {v}. It will reopen in a moment."),
        Outcome::Failed(why) => format!(
            "Teacher's Desk couldn't update. {why}\n\nYou can also install the newest version from Terminal (quit Teacher's Desk first):\n{terminal}"
        ),
    }
}

/// Check for updates, with a dialog for each step; installs and restarts when one is ready.
pub fn check_now(app: &AppHandle) {
    let outcome = check(app, &|v| notify(&format!("Downloading Teacher's Desk {v}…")));
    dialog(&message(&outcome, &terminal_line(app)), &["OK"]);
    if matches!(outcome, Outcome::Ready(_)) && staged(app).is_some() {
        install_on_exit(app, true);
        app.exit(0);
    }
}

/// A native dialog (no extra dependency). Gives up after a minute so nothing can hang.
/// Returns the button pressed.
pub fn dialog(text: &str, buttons: &[&str]) -> String {
    if !cfg!(target_os = "macos") {
        return String::new();
    }
    let list = buttons.iter().map(|b| format!("\"{}\"", esc(b))).collect::<Vec<_>>().join(", ");
    let script = format!(
        "display dialog \"{}\" with title \"Teacher's Desk\" buttons {{{list}}} default button \"{}\" giving up after 60",
        esc(text),
        esc(buttons.last().copied().unwrap_or("OK"))
    );
    Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .and_then(|out| out.split("button returned:").nth(1).map(|b| b.split(',').next().unwrap_or("").trim().to_string()))
        .unwrap_or_default()
}

fn notify(text: &str) {
    if cfg!(target_os = "macos") {
        let script = format!("display notification \"{}\" with title \"Teacher's Desk\"", esc(text));
        let _ = Command::new("/usr/bin/osascript").args(["-e", &script]).spawn();
    }
}

fn esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn log_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Logs/Teachers Desk/updater.log"))
}

fn log(line: &str) {
    let Some(path) = log_path() else { return };
    if let Some(d) = path.parent() {
        let _ = fs::create_dir_all(d);
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        use std::io::Write;
        let _ = writeln!(f, "{} {line}", env!("CARGO_PKG_VERSION"));
    }
}

/// After a launch: if the last swap was refused (the helper left `failed`) and this app is
/// still the old one, say how to allow it, once.
pub fn report_failed_swap(app: &AppHandle) {
    let Some(d) = dir(app) else { return };
    let marker = d.join("failed");
    let Ok(why) = fs::read_to_string(&marker) else { return };
    let _ = fs::remove_file(&marker);
    if !swap_still_needed(&d) {
        return;
    }
    log(&format!("swap failed: {}", why.trim()));
    let text = format!(
        "macOS didn't let Teacher's Desk update itself.\n\nAllow Teacher's Desk under System Settings → Privacy & Security → App Management, then choose Check for updates again.\n\nOr install the newest version from Terminal (quit Teacher's Desk first):\n{}",
        terminal_line(app)
    );
    if dialog(&text, &["OK", "Open Settings"]) == "Open Settings" {
        let _ = Command::new("/usr/bin/open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles")
            .status();
    }
}

/// The staged update is still newer than this app (so the swap really didn't happen).
fn swap_still_needed(update_dir: &Path) -> bool {
    fs::read_to_string(update_dir.join("ready")).is_ok_and(|v| newer(v.trim(), env!("CARGO_PKG_VERSION")))
}

fn version_of(bundle: &Path) -> Option<String> {
    let out = Command::new("/usr/bin/defaults")
        .args(["read", &bundle.join("Contents/Info.plist").to_string_lossy(), "CFBundleShortVersionString"])
        .output()
        .ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Check now and then every few hours, in the background.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(20)); // let the window come up first
        report_failed_swap(&app);
        loop {
            check(&app, &|_| {});
            std::thread::sleep(CHECK_EVERY);
        }
    });
}

/// When the app quits: if an update is ready, a helper swaps it in once we've exited.
/// `relaunch` opens the new version afterwards ("Restart to update").
pub fn install_on_exit(app: &AppHandle, relaunch: bool) {
    let (Some((new_app, _)), Some(bundle)) = (staged(app), own_bundle()) else { return };
    let Some(d) = dir(app) else { return };
    if HELPER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let script = r#"
while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done
OLD="$APP.old-$$"
mkdir -p "$(dirname "$LOG")"
if ERR=$(mv "$APP" "$OLD" 2>&1); then
  if ERR=$(mv "$NEW" "$APP" 2>&1); then rm -rf "$OLD" "$DIR"; xattr -dr com.apple.quarantine "$APP" 2>/dev/null
    echo "updated $APP" >> "$LOG"
  else mv "$OLD" "$APP"; echo "$ERR" > "$DIR/failed"; echo "swap failed: $ERR" >> "$LOG"; fi
else echo "$ERR" > "$DIR/failed"; echo "swap failed: $ERR" >> "$LOG"; fi
[ "$RELAUNCH" = 1 ] && open "$APP"
exit 0
"#;
    let _ = Command::new("/bin/bash")
        .args(["-c", script])
        .env("PID", std::process::id().to_string())
        .env("APP", &bundle)
        .env("NEW", &new_app)
        .env("DIR", &d)
        .env("RELAUNCH", if relaunch { "1" } else { "0" })
        .env("LOG", log_path().unwrap_or_else(|| d.join("updater.log")))
        .spawn();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_what_happened() {
        let t = "curl -fsSL https://school.example/install/mac.sh | bash";
        assert!(message(&Outcome::UpToDate, t).contains(env!("CARGO_PKG_VERSION")));
        assert!(message(&Outcome::Ready("9.9.9".into()), t).contains("Updating to Teacher's Desk 9.9.9"));
        let failed = message(&Outcome::Failed("The download didn't finish.".into()), t);
        assert!(failed.contains("couldn't update") && failed.contains(t));
        assert_eq!(esc(r#"say "hi" \ now"#), r#"say \"hi\" \\ now"#);
    }

    #[test]
    fn a_failed_swap_is_only_reported_while_the_update_is_still_newer() {
        let d = std::env::temp_dir().join(format!("td-upd-{}", std::process::id()));
        let _ = fs::create_dir_all(&d);
        fs::write(d.join("ready"), "99.0.0").unwrap();
        assert!(swap_still_needed(&d));
        fs::write(d.join("ready"), env!("CARGO_PKG_VERSION")).unwrap();
        assert!(!swap_still_needed(&d)); // it did go in after all
        fs::remove_file(d.join("ready")).unwrap();
        assert!(!swap_still_needed(&d));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn compares_versions_numerically() {
        assert!(newer("0.4.10", "0.4.9"));
        assert!(newer("1.0.0", "0.9.9"));
        assert!(newer("0.4.1", "0.4"));
        assert!(!newer("0.4.0", "0.4.0"));
        assert!(!newer("0.3.9", "0.4.0"));
        assert!(!newer("", "0.4.0"));
    }
}
