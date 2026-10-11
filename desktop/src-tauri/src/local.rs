//! "Keep my data on this Mac": the teacher's own Teacher's Desk server, on 127.0.0.1 only.
//!
//! The app bundles the server (Contents/Resources/server, staged by desktop/stage-server.sh)
//! and its setup script (scripts/setup-local-mac.sh), which installs it into the app's data
//! folder and keeps it running with launchd. Documents, students, chats, drafts and
//! recordings live in that folder; only the AI models run elsewhere (the school's model
//! server). This module runs the script, reports its progress to the connect screen, and
//! restarts or updates the server when the app opens.

use std::{
    fs,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub const URL: &str = "http://127.0.0.1:8765";
const LABEL: &str = "org.localschool.desk";

#[derive(Debug, Deserialize)]
pub struct SetupForm {
    pub name: String,
    pub email: String,
    pub password: String,
    pub school: String,
    pub runtime_url: String,
    pub runtime_token: String,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct Progress {
    pub running: bool,
    pub step: u32,
    pub total: u32,
    pub text: String,
    pub error: Option<String>,
    pub ready: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub filevault: bool,
    pub installed: bool,
    pub bundled: bool,
}

#[derive(Default)]
pub struct Setup(pub Mutex<Progress>);

fn home(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("local"))
}

fn script(app: &AppHandle) -> Option<PathBuf> {
    let p = app.path().resource_dir().ok()?.join("server/scripts/setup-local-mac.sh");
    p.exists().then_some(p)
}

fn setup_log() -> Stdio {
    let path = std::env::var_os("HOME")
        .map(|h| PathBuf::from(h).join("Library/Logs/Teachers Desk"))
        .and_then(|d| fs::create_dir_all(&d).ok().map(|_| d.join("setup.log")));
    path.and_then(|p| fs::OpenOptions::new().create(true).append(true).open(p).ok())
        .map(Stdio::from)
        .unwrap_or_else(Stdio::null)
}

pub fn is_local(address: &str) -> bool {
    address.trim().trim_end_matches('/') == URL
}

pub fn filevault_on() -> bool {
    if !cfg!(target_os = "macos") {
        return true;
    }
    Command::new("/usr/bin/fdesetup")
        .arg("status")
        .output()
        .map(|o| {
            let s = String::from_utf8_lossy(&o.stdout);
            s.contains("is On") || s.contains("in progress")
        })
        .unwrap_or(false)
}

pub fn status(app: &AppHandle) -> Status {
    Status {
        filevault: filevault_on(),
        installed: home(app).is_some_and(|h| h.join("server.env").exists()),
        bundled: script(app).is_some(),
    }
}

/// Parse one line of the script's output into the shared progress.
pub fn apply_line(p: &mut Progress, line: &str) {
    if let Some(rest) = line.strip_prefix("STEP ") {
        if let Some((frac, text)) = rest.split_once(' ') {
            if let Some((n, total)) = frac.split_once('/') {
                p.step = n.parse().unwrap_or(p.step);
                p.total = total.parse().unwrap_or(p.total);
                p.text = text.to_string();
            }
        }
    } else if let Some(msg) = line.strip_prefix("ERROR ") {
        p.error = Some(msg.to_string());
    } else if line.starts_with("READY ") {
        p.ready = true;
    }
}

/// Run the setup script to completion, updating `progress` as it goes.
fn run_script(app: &AppHandle, envs: Vec<(&str, String)>, progress: Option<&Setup>) -> Result<(), String> {
    let script = script(app).ok_or("This copy of Teacher's Desk can't keep data on this Mac. Install the latest version.")?;
    let home = home(app).ok_or("No app folder")?;
    let mut child = Command::new("/bin/bash")
        .arg(&script)
        .env("LOCAL_HOME", &home)
        .envs(envs)
        .stdout(Stdio::piped())
        .stderr(setup_log())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut last = Progress::default();
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            apply_line(&mut last, &line);
            if let Some(s) = progress {
                let mut p = s.0.lock().unwrap();
                apply_line(&mut p, &line);
            }
        }
    }
    let ok = child.wait().map(|s| s.success()).unwrap_or(false);
    match (ok && last.ready, last.error) {
        (true, _) => Ok(()),
        (false, Some(e)) => Err(e),
        (false, None) => Err("Setup stopped unexpectedly. Details are in ~/Library/Logs/Teachers Desk/setup.log".into()),
    }
}

/// Start setting up in the background; the connect screen polls `progress`.
pub fn start(app: &AppHandle, form: SetupForm) -> Result<(), String> {
    let state = app.state::<Setup>();
    {
        let mut p = state.0.lock().unwrap();
        if p.running {
            return Err("Already setting up.".into());
        }
        *p = Progress { running: true, total: 5, text: "Starting".into(), ..Default::default() };
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let envs = vec![
            ("TEACHER_NAME", form.name),
            ("TEACHER_EMAIL", form.email),
            ("TEACHER_PASSWORD", form.password),
            ("SCHOOL_NAME", form.school),
            ("RUNTIME_URL", form.runtime_url),
            ("RUNTIME_TOKEN", form.runtime_token),
        ];
        let state = app.state::<Setup>();
        let result = run_script(&app, envs, Some(state.inner()));
        let mut p = state.0.lock().unwrap();
        p.running = false;
        match result {
            Ok(()) => p.ready = true,
            Err(e) => {
                p.ready = false;
                p.error = Some(e);
            }
        }
    });
    Ok(())
}

pub fn progress(app: &AppHandle) -> Progress {
    app.state::<Setup>().0.lock().unwrap().clone()
}

fn healthy() -> bool {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(2))
        .build()
        .get(&format!("{URL}/api/health"))
        .call()
        .is_ok()
}

/// Before connecting to this Mac's server: update it if the app is newer, and make sure
/// it's running (launchd normally keeps it up; after a crash loop or a logout it may not be).
pub fn prepare(app: &AppHandle) -> Result<(), String> {
    let Some(home) = home(app) else { return Ok(()) };
    if !home.join("server.env").exists() {
        return Ok(());
    }
    let installed = fs::read_to_string(home.join("server/VERSION")).unwrap_or_default();
    if installed.trim() != env!("CARGO_PKG_VERSION") && script(app).is_some() {
        run_script(app, vec![("LS_UPDATE", "1".into())], None)?;
    }
    if healthy() {
        return Ok(());
    }
    if let Ok(out) = Command::new("/usr/bin/id").arg("-u").output() {
        let uid = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let _ = Command::new("/bin/launchctl").args(["kickstart", &format!("gui/{uid}/{LABEL}")]).status();
    }
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(30) {
        if healthy() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Ok(()) // the health check that follows reports it as unreachable
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_script_progress() {
        let mut p = Progress::default();
        apply_line(&mut p, "STEP 2/5 Getting Python ready");
        assert_eq!((p.step, p.total, p.text.as_str()), (2, 5, "Getting Python ready"));
        apply_line(&mut p, "some other output");
        apply_line(&mut p, "ERROR Turn on FileVault first");
        assert_eq!(p.error.as_deref(), Some("Turn on FileVault first"));
        apply_line(&mut p, "READY http://127.0.0.1:8765");
        assert!(p.ready);
    }

    #[test]
    fn recognizes_this_macs_server() {
        assert!(is_local("http://127.0.0.1:8765/"));
        assert!(!is_local("https://teachers-desk-xi.vercel.app"));
    }
}
