//! "Keep my data on this Mac": the teacher's own Teacher's Desk server, on 127.0.0.1 only.
//!
//! The teacher only signs in with their school account: email + password
//! (POST /api/auth/device), or Google / Microsoft in their browser, which hands a one-time
//! code back through teachersdesk://desk (POST /api/auth/device/sso). Either way the school
//! answers with their name, the school, its models and a key for this Mac; the local server
//! then uses the school's AI through /api/relay with that key. The password for the
//! teacher's own desk is kept in the Keychain, and the app signs them in to it by itself.
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
const KEYCHAIN_SERVICE: &str = "Teacher's Desk (this Mac)";
pub const SSO_PROVIDERS: [&str; 2] = ["google", "microsoft"];

#[derive(Debug, Deserialize)]
pub struct SetupForm {
    pub email: String,
    pub password: String,
}

/// How the teacher proved who they are to the school.
pub enum Credentials {
    Password(SetupForm),
    /// The one-time code from a Google / Microsoft sign-in (teachersdesk://desk?code=…).
    Code(String),
}

/// What the school's server hands this Mac (app/routes/relay.py `create_device`).
#[derive(Debug, Deserialize)]
struct Device {
    key: String,
    relay_url: String,
    school: String,
    name: String,
    email: String,
    chat_model: String,
    embed_model: String,
}

#[derive(Deserialize)]
struct ApiError {
    #[serde(default)]
    error: String,
}

fn mac_name() -> String {
    Command::new("/usr/sbin/scutil")
        .args(["--get", "ComputerName"])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Mac".into())
}

fn school(app: &AppHandle) -> Result<(String, String), String> {
    let school = crate::server::school(app)
        .ok_or("Connect to your school's Teacher's Desk once first, then try again.")?;
    let name = if school.name == "your school" { "your school".to_string() } else { school.name.clone() };
    Ok((school.url.trim_end_matches('/').to_string(), name))
}

/// Sign in to the school's server and get this Mac's key.
fn sign_in(app: &AppHandle, creds: &Credentials) -> Result<Device, String> {
    let (base, name) = school(app)?;
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build();
    let resp = match creds {
        Credentials::Password(form) => agent.post(&format!("{base}/api/auth/device")).send_json(
            serde_json::json!({ "email": form.email, "password": form.password, "label": mac_name() }),
        ),
        Credentials::Code(code) => agent
            .post(&format!("{base}/api/auth/device/sso"))
            .send_json(serde_json::json!({ "code": code, "label": mac_name() })),
    };
    match resp {
        Ok(r) => r.into_json::<Device>().map_err(|_| format!("{name} answered unexpectedly. Try again later.")),
        Err(ureq::Error::Status(401, _)) if matches!(creds, Credentials::Code(_)) => {
            Err("That sign-in expired. Try again.".into())
        }
        Err(ureq::Error::Status(401, _)) => Err(format!("That email and password didn't work for {name}.")),
        Err(ureq::Error::Status(_, r)) => Err(r
            .into_json::<ApiError>()
            .ok()
            .map(|e| e.error)
            .filter(|e| !e.is_empty())
            .unwrap_or_else(|| format!("{name} couldn't set up this Mac right now. Try again later."))),
        Err(_) => Err(format!("Can't reach {name}. Check your internet connection and try again.")),
    }
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
    /// Google / Microsoft sign-in, when the school turned it on.
    pub sso: Vec<String>,
    /// The hosted demo's teacher sign-in (fictional students only), so testers can try it.
    pub demo: Option<DemoLogin>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DemoLogin {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize, Default)]
struct SchoolHealth {
    #[serde(default)]
    sso: Vec<String>,
    #[serde(default)]
    demo: Option<DemoLogin>,
}

fn school_health(app: &AppHandle) -> SchoolHealth {
    let Ok((base, _)) = school(app) else { return SchoolHealth::default() };
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(4))
        .build()
        .get(&format!("{base}/api/health"))
        .call()
        .ok()
        .and_then(|r| r.into_json::<SchoolHealth>().ok())
        .unwrap_or_default()
}

/// Google / Microsoft for "Keep my data on this Mac": sign in in the teacher's browser;
/// the school's page then opens teachersdesk://desk?code=… (handled in lib.rs).
pub fn sso_start_url(app: &AppHandle, provider: &str) -> Result<String, String> {
    if !SSO_PROVIDERS.contains(&provider) {
        return Err("Unknown sign-in".into());
    }
    let (base, _) = school(app)?;
    Ok(format!("{base}/api/auth/sso/{provider}/start?mode=desk"))
}

// ---------------------------------------------------------------- Keychain
// The teacher's own desk has its own account; its password lives in the login Keychain,
// so the app signs them in without asking (and SSO teachers never need a password).

fn random_password() -> String {
    let mut buf = [0u8; 24];
    if let Ok(mut f) = fs::File::open("/dev/urandom") {
        let _ = std::io::Read::read_exact(&mut f, &mut buf);
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn keychain_save(email: &str, password: &str) {
    let _ = Command::new("/usr/bin/security")
        .args(["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", email, "-w", password])
        .status();
}

fn keychain_get(email: &str) -> Option<String> {
    let out = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", email, "-w"])
        .output()
        .ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[derive(Deserialize)]
struct CodeOut {
    code: String,
}

/// Where to open this Mac's desk already signed in (None: show its sign-in page).
pub fn signed_in_url(app: &AppHandle) -> Option<String> {
    let email = fs::read_to_string(home(app)?.join("account")).ok()?.trim().to_string();
    let password = keychain_get(&email)?;
    let code = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(5))
        .build()
        .post(&format!("{URL}/api/auth/code"))
        .send_json(serde_json::json!({ "email": email, "password": password }))
        .ok()?
        .into_json::<CodeOut>()
        .ok()?
        .code;
    Some(format!("{URL}/api/auth/sso/redeem?code={code}"))
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
        sso: Vec::new(),
        demo: None,
    }
    .with_school(school_health(app))
}

impl Status {
    fn with_school(mut self, h: SchoolHealth) -> Self {
        self.sso = h.sso.into_iter().filter(|p| SSO_PROVIDERS.contains(&p.as_str())).collect();
        self.demo = h.demo;
        self
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
pub fn start(app: &AppHandle, creds: Credentials) -> Result<(), String> {
    let state = app.state::<Setup>();
    {
        let mut p = state.0.lock().unwrap();
        if p.running {
            return Err("Already setting up.".into());
        }
        *p = Progress { running: true, total: 5, text: "Signing in".into(), ..Default::default() };
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<Setup>();
        let result = sign_in(&app, &creds).and_then(|d| {
            let password = match &creds {
                Credentials::Password(form) => form.password.clone(), // the same as at school
                Credentials::Code(_) => random_password(),
            };
            let email = d.email.clone();
            let envs = vec![
                ("TEACHER_NAME", d.name),
                ("TEACHER_EMAIL", d.email),
                ("TEACHER_PASSWORD", password.clone()),
                ("SCHOOL_NAME", d.school),
                ("RUNTIME_KIND", "relay".into()),
                ("RUNTIME_URL", d.relay_url),
                ("RUNTIME_TOKEN", d.key),
                ("CHAT_MODEL", d.chat_model),
                ("EMBED_MODEL", d.embed_model),
            ];
            run_script(&app, envs, Some(state.inner()))?;
            keychain_save(&email, &password);
            if let Some(h) = home(&app) {
                let _ = fs::write(h.join("account"), &email);
            }
            Ok(())
        });
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
