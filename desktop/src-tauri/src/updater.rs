//! Automatic updates, from the school's own server (no Apple account or update service).
//!
//! The school's server says which Mac app it hands out (`mac_app_version` in /api/health,
//! read from the zip it serves at /install/LocalSchool-macOS.zip). When that's newer than
//! this app, the app downloads it in the background, checks it, and keeps it ready. The
//! swap happens when the teacher quits: a small helper waits for the app to close, puts
//! the new one in its place and removes the old one. The next launch is the new version.
//! Teacher's Desk → Check for Updates… installs a ready update right away (and restarts).

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

/// Check the school's server once; download and stage a newer app. Quiet on any failure.
pub fn check(app: &AppHandle) {
    if !cfg!(target_os = "macos") || own_bundle().is_none() {
        return; // a development build, not an installed app
    }
    let Some(school) = crate::server::school(app) else { return };
    let base = school.url.trim_end_matches('/').to_string();
    let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(10)).timeout(Duration::from_secs(600)).build();
    let Ok(health) = agent.get(&format!("{base}/api/health")).call().map(|r| r.into_json::<Health>().unwrap_or_default())
    else {
        return;
    };
    let remote = health.mac_app_version;
    if remote.is_empty() || !newer(&remote, env!("CARGO_PKG_VERSION")) {
        return;
    }
    if staged(app).is_some_and(|(_, v)| v == remote) {
        return;
    }
    let Some(d) = dir(app) else { return };
    let _ = fs::remove_dir_all(&d);
    if fs::create_dir_all(d.join("new")).is_err() {
        return;
    }
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
    let valid = ok
        && sh("/usr/bin/ditto", &["-x", "-k", &zip.to_string_lossy(), &d.join("new").to_string_lossy()])
        && new_app.exists()
        && sh("/usr/bin/codesign", &["--verify", "--deep", "--strict", &new_s])
        && version_of(&new_app).is_some_and(|v| v == remote);
    let _ = fs::remove_file(&zip);
    if valid {
        let _ = fs::write(d.join("ready"), &remote);
    } else {
        let _ = fs::remove_dir_all(&d);
    }
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
        loop {
            check(&app);
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
if mv "$APP" "$OLD" 2>/dev/null; then
  if mv "$NEW" "$APP"; then rm -rf "$OLD" "$DIR"; xattr -dr com.apple.quarantine "$APP" 2>/dev/null
  else mv "$OLD" "$APP"; fi
fi
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
        .spawn();
}

#[cfg(test)]
mod tests {
    use super::newer;

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
