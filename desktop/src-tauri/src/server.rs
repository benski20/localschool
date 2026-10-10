//! The school server this Mac connects to: validation, persistence, and the current
//! origin used by the navigation policy.

use std::{fs, path::PathBuf, sync::Mutex, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedServer {
    pub url: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerInfo {
    pub url: String,
    pub name: String,
    pub version: String,
}

#[derive(Deserialize)]
struct Health {
    #[serde(default)]
    app: String,
    #[serde(default)]
    school: String,
    #[serde(default)]
    version: String,
}

/// The origin of the connected server (scheme://host:port), shared with the
/// navigation handler so only that origin loads inside the app.
#[derive(Default)]
pub struct CurrentServer(pub Mutex<Option<Url>>);

impl CurrentServer {
    pub fn set(&self, url: Option<Url>) {
        *self.0.lock().unwrap() = url;
    }
    pub fn get(&self) -> Option<Url> {
        self.0.lock().unwrap().clone()
    }
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("server.json"))
}

/// IT-managed default (push this file with Jamf/Mosyle/any MDM so teachers never type
/// an address): {"url": "http://maplegrove.local:8000", "name": "Maple Grove Middle School"}
#[cfg(target_os = "macos")]
const MANAGED_CONFIG: &str = "/Library/Application Support/Local School/server.json";
#[cfg(not(target_os = "macos"))]
const MANAGED_CONFIG: &str = "/etc/localschool/server.json";

fn read(path: &std::path::Path) -> Option<SavedServer> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// The teacher's own choice wins; then the IT-managed default; then the server this
/// build ships with (desktop/default-server.txt), if any.
pub fn load(app: &AppHandle) -> Option<SavedServer> {
    config_path(app)
        .and_then(|p| read(&p))
        .or_else(|| read(std::path::Path::new(MANAGED_CONFIG)))
        .or_else(built_in)
}

fn built_in() -> Option<SavedServer> {
    let url = env!("LS_DEFAULT_SERVER").trim();
    (!url.is_empty()).then(|| SavedServer { url: url.to_string(), name: "your school".into() })
}

pub fn save(app: &AppHandle, server: &SavedServer) -> Result<(), String> {
    let path = config_path(app).ok_or("no config directory")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&path, serde_json::to_vec_pretty(server).unwrap()).map_err(|e| e.to_string())
}

/// Candidate URLs for what a teacher typed: "box.local:8000", "10.0.0.5", "https://x".
pub fn candidates(input: &str) -> Vec<Url> {
    let s = input.trim().trim_end_matches('/');
    if s.is_empty() {
        return vec![];
    }
    let mut out = vec![];
    if s.starts_with("http://") || s.starts_with("https://") {
        out.extend(Url::parse(s).ok());
    } else {
        // LAN boxes are usually plain http on :8000; cloud hosts are https.
        let has_port = s.rsplit(':').next().is_some_and(|p| p.chars().all(|c| c.is_ascii_digit()) && s.contains(':'));
        let local = s.ends_with(".local") || s.split(':').next().is_some_and(|h| h.parse::<std::net::IpAddr>().is_ok() || !h.contains('.'));
        if local {
            if !has_port {
                out.extend(Url::parse(&format!("http://{s}:8000")).ok());
            }
            out.extend(Url::parse(&format!("http://{s}")).ok());
        } else {
            out.extend(Url::parse(&format!("https://{s}")).ok());
            out.extend(Url::parse(&format!("http://{s}")).ok());
        }
    }
    out.into_iter().filter(|u| u.host_str().is_some()).collect()
}

pub fn origin(url: &Url) -> Url {
    let mut o = url.clone();
    o.set_path("/");
    o.set_query(None);
    o.set_fragment(None);
    o
}

/// Find the first candidate that answers like a Local School server.
pub fn check(input: &str) -> Result<ServerInfo, String> {
    let urls = candidates(input);
    if urls.is_empty() {
        return Err("Enter your school server's address, e.g. maplegrove.local:8000".into());
    }
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(3))
        .timeout(Duration::from_secs(6))
        .build();
    let mut last_err = String::new();
    for url in urls {
        let base = origin(&url);
        let health_url = base.join("api/health").unwrap();
        match agent.get(health_url.as_str()).call() {
            Ok(resp) => match resp.into_json::<Health>() {
                Ok(h) if h.app == "localschool" => {
                    return Ok(ServerInfo {
                        url: base.as_str().trim_end_matches('/').to_string(),
                        name: if h.school.is_empty() { "Local School".into() } else { h.school },
                        version: h.version,
                    })
                }
                _ => last_err = format!("{} isn't a Local School server.", base.host_str().unwrap_or("")),
            },
            Err(ureq::Error::Status(code, _)) => {
                last_err = format!("{} answered with an error ({code}).", base.host_str().unwrap_or(""))
            }
            Err(_) => {
                last_err = format!(
                    "Can't reach {}. Check the address and that you're on the school network.",
                    base.host_str().unwrap_or(input)
                )
            }
        }
    }
    Err(last_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strs(v: Vec<Url>) -> Vec<String> {
        v.into_iter().map(|u| u.to_string()).collect()
    }

    #[test]
    fn candidates_cover_common_inputs() {
        assert_eq!(strs(candidates("maplegrove.local")), ["http://maplegrove.local:8000/", "http://maplegrove.local/"]);
        assert_eq!(strs(candidates("10.0.0.5:9000")), ["http://10.0.0.5:9000/"]);
        assert_eq!(strs(candidates("school.example.org")), ["https://school.example.org/", "http://school.example.org/"]);
        assert_eq!(strs(candidates("https://x.modal.run/")), ["https://x.modal.run/"]);
        assert!(candidates("  ").is_empty());
    }

    #[test]
    fn origin_strips_path() {
        let u = Url::parse("http://box.local:8000/chat/3?x=1#y").unwrap();
        assert_eq!(origin(&u).as_str(), "http://box.local:8000/");
    }
}
