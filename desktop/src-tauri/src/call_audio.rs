//! Call audio: while a teacher records a meeting, also record the Mac's own sound (the other
//! side of a Zoom / Meet / Teams call), so the transcript can tell "You" from "Others".
//!
//! The recording is done by a small Swift helper (helpers/CallAudio.swift, ScreenCaptureKit,
//! macOS 13+), bundled next to the app's binary as Contents/MacOS/td-call-audio. It writes an
//! .m4a to a temp file and talks over stdout: READY, then SAVED, or ERROR <message>. Closing
//! its stdin stops it.
//!
//! The school server's meeting page calls the three commands below (they're in the
//! "school-server" capability), but only from the main window and only from the connected
//! school's origin.

use std::{
    fs,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant},
};

use tauri::{ipc::Response, AppHandle, Manager, Url, Webview};

use crate::server::CurrentServer;

/// The helper's name in the bundle (tauri.conf.json `bundle.externalBin`: "bin/td-call-audio").
const HELPER: &str = "td-call-audio";
/// The helper gives up by itself after 10 s; this is the backstop.
const START_TIMEOUT: Duration = Duration::from_secs(12);
const STOP_TIMEOUT: Duration = Duration::from_secs(10);
const NO_SOUND: &str = "No sound from the computer was recorded.";

/// The call recording in progress, if any.
#[derive(Default)]
pub struct CallAudio(Mutex<Option<Recording>>);

// ---------------------------------------------------------------- commands

/// True on macOS 13+ with the helper in place, for the school's own pages.
#[tauri::command]
pub fn call_audio_available(webview: Webview) -> bool {
    require_school_page(&webview).is_ok() && available()
}

/// Start recording the computer's sound. A recording already running is thrown away.
#[tauri::command]
pub async fn call_audio_start(webview: Webview, app: AppHandle) -> Result<(), String> {
    require_school_page(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CallAudio>();
        let old = state.0.lock().unwrap().take();
        if let Some(old) = old {
            old.discard();
        }
        if !available() {
            return Err("Recording the computer's sound needs macOS 13 or later.".to_string());
        }
        let mut cmd = Command::new(helper_path().ok_or("Call audio isn't available.")?);
        let recording = Recording::spawn(&mut cmd, temp_file(), START_TIMEOUT)?;
        let raced = state.0.lock().unwrap().replace(recording);
        if let Some(other) = raced {
            other.discard();
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop recording and return the .m4a's bytes (an ArrayBuffer in JS). The file is deleted.
#[tauri::command]
pub async fn call_audio_stop(webview: Webview, app: AppHandle) -> Result<Response, String> {
    require_school_page(&webview)?;
    let recording = app.state::<CallAudio>().0.lock().unwrap().take();
    let recording = recording.ok_or("Call audio isn't recording.")?;
    tauri::async_runtime::spawn_blocking(move || recording.stop(STOP_TIMEOUT))
        .await
        .map_err(|e| e.to_string())?
        .map(Response::new)
}

/// The app is quitting: nothing keeps recording.
pub fn shutdown(app: &AppHandle) {
    let recording = app.state::<CallAudio>().0.lock().unwrap().take();
    if let Some(r) = recording {
        r.discard();
    }
}

// ---------------------------------------------------------------- who may call

/// Defense in depth on top of the capability: the main window, showing the connected server.
fn require_school_page(webview: &Webview) -> Result<(), String> {
    let server = webview.app_handle().state::<CurrentServer>().get();
    let page = webview.url().map_err(|e| e.to_string())?;
    if webview.label() == crate::MAIN && is_school_page(&page, server.as_ref()) {
        Ok(())
    } else {
        Err("not allowed".into())
    }
}

fn is_school_page(page: &Url, server: Option<&Url>) -> bool {
    matches!(page.scheme(), "http" | "https") && server.is_some_and(|s| s.origin() == page.origin())
}

// ---------------------------------------------------------------- platform

/// Contents/MacOS/td-call-audio (in development, target/<profile>/td-call-audio).
fn helper_path() -> Option<PathBuf> {
    let path = std::env::current_exe().ok()?.parent()?.join(HELPER);
    path.is_file().then_some(path)
}

#[cfg(target_os = "macos")]
fn available() -> bool {
    use std::sync::OnceLock;
    static MACOS_13: OnceLock<bool> = OnceLock::new();
    let new_enough = *MACOS_13.get_or_init(|| {
        Command::new("/usr/bin/sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .is_some_and(|o| major_at_least(&String::from_utf8_lossy(&o.stdout), 13))
    });
    new_enough && helper_path().is_some()
}

#[cfg(not(target_os = "macos"))]
fn available() -> bool {
    false
}

#[cfg(any(target_os = "macos", test))]
fn major_at_least(version: &str, major: u64) -> bool {
    version.trim().split('.').next().and_then(|m| m.parse::<u64>().ok()).is_some_and(|m| m >= major)
}

fn temp_file() -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    std::env::temp_dir().join(format!("teachers-desk-call-{}-{nanos}.m4a", std::process::id()))
}

// ---------------------------------------------------------------- the helper process

pub struct Recording {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: mpsc::Receiver<String>,
    path: PathBuf,
}

#[derive(Debug, PartialEq)]
enum Line {
    Ready,
    Saved,
    Error(String),
}

fn parse_line(line: &str) -> Option<Line> {
    let line = line.trim();
    match line {
        "READY" => Some(Line::Ready),
        "SAVED" => Some(Line::Saved),
        _ => line.strip_prefix("ERROR").map(|m| Line::Error(m.trim().to_string())),
    }
}

enum Waited {
    Line(Line),
    /// The helper closed stdout (it exited).
    Eof,
    Timeout,
}

impl Recording {
    /// Run `cmd <path>` and wait for READY (or ERROR).
    fn spawn(cmd: &mut Command, path: PathBuf, timeout: Duration) -> Result<Self, String> {
        let _ = fs::remove_file(&path);
        let mut child = cmd
            .arg(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Couldn't start recording the computer's sound ({e})."))?;
        let stdout = child.stdout.take().expect("piped stdout");
        let (tx, lines) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        let recording = Recording { stdin: child.stdin.take(), child, lines, path };
        match recording.wait(timeout) {
            Waited::Line(Line::Ready) => Ok(recording),
            Waited::Line(Line::Error(m)) if !m.is_empty() => {
                recording.discard();
                Err(m)
            }
            _ => {
                recording.discard();
                Err("Couldn't start recording the computer's sound.".into())
            }
        }
    }

    /// The next protocol line (other output is skipped), the end of output, or a timeout.
    fn wait(&self, timeout: Duration) -> Waited {
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match self.lines.recv_timeout(left) {
                Ok(line) => {
                    if let Some(l) = parse_line(&line) {
                        return Waited::Line(l);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => return Waited::Timeout,
                Err(mpsc::RecvTimeoutError::Disconnected) => return Waited::Eof,
            }
        }
    }

    /// Close stdin, wait for SAVED, and return the file's bytes (deleting the file).
    fn stop(mut self, timeout: Duration) -> Result<Vec<u8>, String> {
        drop(self.stdin.take());
        let mut outcome = self.wait_done(timeout);
        if matches!(outcome, Waited::Timeout) {
            // Not listening to stdin: ask it to finish the file another way.
            self.terminate();
            outcome = self.wait_done(Duration::from_secs(5));
        }
        self.reap(Duration::from_secs(2));
        let bytes = fs::read(&self.path).unwrap_or_default();
        let _ = fs::remove_file(&self.path);
        match outcome {
            Waited::Line(Line::Error(m)) if bytes.is_empty() && !m.is_empty() => Err(m),
            _ if bytes.is_empty() => Err(NO_SOUND.into()),
            _ => Ok(bytes),
        }
    }

    /// SAVED, ERROR, end of output, or a timeout (READY lines are skipped).
    fn wait_done(&self, timeout: Duration) -> Waited {
        let deadline = Instant::now() + timeout;
        loop {
            match self.wait(deadline.saturating_duration_since(Instant::now())) {
                Waited::Line(Line::Ready) => continue,
                other => return other,
            }
        }
    }

    /// Stop and throw the recording away.
    fn discard(mut self) {
        drop(self.stdin.take());
        self.reap(Duration::from_secs(3));
        let _ = fs::remove_file(&self.path);
    }

    /// Wait for the helper to exit, then make sure it has.
    fn reap(&mut self, grace: Duration) {
        let deadline = Instant::now() + grace;
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }

    fn terminate(&self) {
        #[cfg(unix)]
        let _ = Command::new("kill").args(["-TERM", &self.child.id().to_string()]).status();
    }
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("td-call-audio-test-{name}-{}.m4a", std::process::id()))
    }

    /// A stand-in helper: `sh -c <script> helper <path>`, so $1 is the output file.
    #[cfg(unix)]
    fn fake(script: &str) -> Command {
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c").arg(script).arg("td-call-audio");
        cmd
    }

    #[test]
    fn reads_helper_lines() {
        assert_eq!(parse_line("READY\n"), Some(Line::Ready));
        assert_eq!(parse_line("SAVED"), Some(Line::Saved));
        assert_eq!(parse_line("ERROR Allow Teacher's Desk…"), Some(Line::Error("Allow Teacher's Desk…".into())));
        assert_eq!(parse_line("capture stopped"), None);
    }

    #[test]
    fn macos_version_check() {
        assert!(major_at_least("13.0\n", 13));
        assert!(major_at_least("15.4.1", 13));
        assert!(!major_at_least("12.7.6", 13));
        assert!(!major_at_least("", 13));
    }

    #[test]
    fn only_the_connected_school_may_ask() {
        let school = Url::parse("https://school.example.org/").unwrap();
        let page = |u: &str| Url::parse(u).unwrap();
        assert!(is_school_page(&page("https://school.example.org/tools/meeting"), Some(&school)));
        assert!(!is_school_page(&page("https://evil.example.com/"), Some(&school)));
        assert!(!is_school_page(&page("http://school.example.org/"), Some(&school)));
        assert!(!is_school_page(&page("https://school.example.org/"), None));
        assert!(!is_school_page(&page("tauri://localhost/index.html"), Some(&school)));
    }

    #[cfg(unix)]
    #[test]
    fn records_until_stopped_and_cleans_up() {
        let path = tmp("ok");
        let script = r#"echo READY; cat >/dev/null; printf 'm4a-bytes' > "$1"; echo SAVED"#;
        let rec = Recording::spawn(&mut fake(script), path.clone(), Duration::from_secs(5)).unwrap();
        assert_eq!(rec.stop(Duration::from_secs(5)).unwrap(), b"m4a-bytes");
        assert!(!path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn reports_the_helpers_error() {
        let script = r#"echo "ERROR Allow Teacher's Desk under System Settings"; exit 1"#;
        let err = Recording::spawn(&mut fake(script), tmp("err"), Duration::from_secs(5)).err().unwrap();
        assert_eq!(err, "Allow Teacher's Desk under System Settings");
    }

    #[cfg(unix)]
    #[test]
    fn gives_up_on_a_silent_helper() {
        let started = Instant::now();
        let err = Recording::spawn(&mut fake("sleep 30"), tmp("silent"), Duration::from_millis(300)).err().unwrap();
        assert!(err.starts_with("Couldn't start"));
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[cfg(unix)]
    #[test]
    fn terminates_a_helper_that_ignores_stdin() {
        let path = tmp("term");
        let script = r#"trap 'printf late > "$1"; echo SAVED; exit 0' TERM; echo READY; while :; do sleep 0.1; done"#;
        let rec = Recording::spawn(&mut fake(script), path.clone(), Duration::from_secs(5)).unwrap();
        assert_eq!(rec.stop(Duration::from_millis(300)).unwrap(), b"late");
        assert!(!path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn no_sound_is_an_error() {
        let script = r#"echo READY; cat >/dev/null; echo SAVED"#;
        let rec = Recording::spawn(&mut fake(script), tmp("empty"), Duration::from_secs(5)).unwrap();
        assert_eq!(rec.stop(Duration::from_secs(5)).err().unwrap(), NO_SOUND);
    }
}
