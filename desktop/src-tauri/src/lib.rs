//! Teacher's Desk for Mac.
//!
//! A thin native shell around the school server's web app. No models run here: the
//! window shows the server's UI, and this crate adds what a browser tab can't —
//! Bonjour discovery, a remembered server, native menus and shortcuts, a global
//! "Ask" hotkey, downloads to ~/Downloads, and Mac window behavior.
//!
//! "Keep my data on this Mac" (local.rs) runs the server on this Mac instead, for one
//! teacher, with the models still remote.
//!
//! Security model: the bundled connect screen (tauri://localhost) may call the app
//! commands below; pages from the school server may only drag the window and use call
//! audio (call_audio.rs: record the computer's sound during a meeting), and only from the
//! connected school's origin.

mod call_audio;
mod discovery;
mod local;
mod server;
mod updater;

use std::time::Duration;

use server::{CurrentServer, SavedServer, ServerInfo};
use tauri::{
    menu::{AboutMetadataBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    webview::DownloadEvent,
    AppHandle, Manager, Url, Webview, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri::RunEvent;
#[cfg(target_os = "macos")]
use tauri::WindowEvent;

const MAIN: &str = "main";
/// Lets the web app adapt to the native shell (title-bar spacing, no service worker).
const USER_AGENT: &str = concat!(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) LocalSchoolDesktop/",
    env!("CARGO_PKG_VERSION")
);

// ---------------------------------------------------------------- commands
// Each command refuses callers other than the bundled connect screen (defense in depth
// on top of the capability files).

fn require_local(webview: &Webview) -> Result<(), String> {
    let url = webview.url().map_err(|e| e.to_string())?;
    if is_local_page(&url) {
        Ok(())
    } else {
        Err("not allowed".into())
    }
}

fn is_local_page(url: &Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

#[tauri::command]
fn current_server(webview: Webview, app: AppHandle) -> Result<Option<SavedServer>, String> {
    require_local(&webview)?;
    Ok(server::load(&app))
}

#[tauri::command]
async fn check_server(webview: Webview, app: AppHandle, address: String) -> Result<ServerInfo, String> {
    require_local(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        if local::is_local(&address) {
            local::prepare(&app)?;
        }
        server::check(&address)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn local_status(webview: Webview, app: AppHandle) -> Result<local::Status, String> {
    require_local(&webview)?;
    Ok(local::status(&app))
}

#[tauri::command]
fn setup_local(webview: Webview, app: AppHandle, form: local::SetupForm) -> Result<(), String> {
    require_local(&webview)?;
    local::start(&app, local::Credentials::Password(form))
}

/// "Keep my data on this Mac" with Google / Microsoft: sign in in the teacher's browser.
#[tauri::command]
fn setup_local_sso(webview: Webview, app: AppHandle, provider: String) -> Result<(), String> {
    require_local(&webview)?;
    let url = local::sso_start_url(&app, &provider)?;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn local_progress(webview: Webview, app: AppHandle) -> Result<local::Progress, String> {
    require_local(&webview)?;
    Ok(local::progress(&app))
}

#[tauri::command]
fn open_filevault_settings(webview: Webview, app: AppHandle) -> Result<(), String> {
    require_local(&webview)?;
    app.opener()
        .open_url("x-apple.systempreferences:com.apple.preference.security?FileVault", None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn discover_servers(webview: Webview) -> Result<Vec<discovery::Found>, String> {
    require_local(&webview)?;
    tauri::async_runtime::spawn_blocking(|| discovery::browse(Duration::from_millis(2500)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn connect_server(webview: Webview, app: AppHandle, url: String, name: String) -> Result<(), String> {
    require_local(&webview)?;
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    server::save(&app, &SavedServer { url: url.clone(), name })?;
    app.state::<CurrentServer>().set(Some(server::origin(&parsed)));
    // This Mac's own desk: open it already signed in (its password is in the Keychain).
    let signed_in = local::is_local(&url).then(|| local::signed_in_url(&app)).flatten();
    let target = match signed_in {
        Some(u) => Url::parse(&u).map_err(|e| e.to_string())?,
        None => server::origin(&parsed).join("chat").map_err(|e| e.to_string())?,
    };
    webview.navigate(target).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- teachersdesk:// links
// The school's sign-in page (Google / Microsoft, in the teacher's browser) hands back a
// one-time code: teachersdesk://signin?code=… signs this window in to the school;
// teachersdesk://desk?code=… sets up "Keep my data on this Mac".

fn on_deep_link(app: &AppHandle, url: &Url) {
    if url.scheme() != "teachersdesk" {
        return;
    }
    if url.host_str() == Some("check-updates") {
        return check_updates(app);
    }
    let Some(code) = url.query_pairs().find(|(k, _)| k == "code").map(|(_, v)| v.to_string()) else { return };
    if code.is_empty() || code.len() > 200 || !code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return;
    }
    show_main(app);
    match url.host_str() {
        Some("signin") => {
            let origin = app.state::<CurrentServer>().get();
            if let (Some(origin), Some(w)) = (origin.filter(|o| !local::is_local(o.as_str())), main_window(app)) {
                if let Ok(target) = origin.join(&format!("api/auth/sso/redeem?code={code}")) {
                    let _ = w.navigate(target);
                }
            }
        }
        Some("desk") => {
            if local::start(app, local::Credentials::Code(code)).is_ok() {
                // Show the progress, unless the connect screen is already waiting for it.
                let on_connect_screen = main_window(app).and_then(|w| w.url().ok()).is_some_and(|u| is_local_page(&u));
                if !on_connect_screen {
                    app.state::<CurrentServer>().set(None);
                    if let Some(w) = main_window(app) {
                        let _ = w.navigate(connect_screen_url("?setup=1"));
                    }
                }
            }
        }
        _ => {}
    }
}

/// Check for updates (menu bar, or the account menu in the window), saying what happened.
fn check_updates(app: &AppHandle) {
    static CHECKING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if CHECKING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return; // one at a time
    }
    let app = app.clone();
    std::thread::spawn(move || {
        updater::check_now(&app);
        CHECKING.store(false, std::sync::atomic::Ordering::SeqCst);
    });
}

/// The connect screen's "Keep my data on this Mac" (menu, or the account menu in the window).
fn open_keep_on_mac(app: &AppHandle) {
    app.state::<CurrentServer>().set(None);
    if let Some(w) = main_window(app) {
        let _ = w.navigate(connect_screen_url("?local=1"));
    }
    show_main(app);
}

// ---------------------------------------------------------------- navigation helpers

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

fn show_main(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn connect_screen_url(query: &str) -> Url {
    #[cfg(windows)]
    let base = "http://tauri.localhost/index.html";
    #[cfg(not(windows))]
    let base = "tauri://localhost/index.html";
    Url::parse(&format!("{base}{query}")).unwrap()
}

/// Route inside the server's single-page app without a reload (React Router listens
/// to popstate). Falls back to nothing on the connect screen.
fn go(app: &AppHandle, path: &str, focus_ask: bool) {
    let Some(w) = main_window(app) else { return };
    let path = serde_json::to_string(path).unwrap();
    let js = format!(
        r#"(function(p, focus) {{
  if (!/^https?:/.test(location.protocol)) return;
  if (location.pathname !== p) {{ history.pushState({{}}, "", p); dispatchEvent(new PopStateEvent("popstate")); }}
  if (focus) setTimeout(function () {{ var el = document.getElementById("ask"); if (el) el.focus(); }}, 60);
}})({path}, {focus_ask});"#
    );
    let _ = w.eval(&js);
}

// ---------------------------------------------------------------- menu

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let about = AboutMetadataBuilder::new()
        .name(Some("Teacher's Desk"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .comments(Some("Private AI for your school. No AI models run on this Mac."))
        .build();

    let app_menu = SubmenuBuilder::new(app, "Teacher's Desk")
        .item(&PredefinedMenuItem::about(app, Some("About Teacher's Desk"), Some(about))?)
        .separator()
        .item(&MenuItemBuilder::with_id("check_updates", "Check for Updates…").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("switch_server", "Switch School Server…").build(app)?)
        .item(&MenuItemBuilder::with_id("keep_on_mac", "Keep My Data on This Mac…").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::with_id("new_question", "New Question").accelerator("CmdOrCtrl+N").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    // Without these, ⌘C/⌘V don't work in a Mac webview.
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&MenuItemBuilder::with_id("reload", "Reload").accelerator("CmdOrCtrl+R").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let go_menu = SubmenuBuilder::new(app, "Go")
        .item(&MenuItemBuilder::with_id("go_chat", "Ask").accelerator("CmdOrCtrl+1").build(app)?)
        .item(&MenuItemBuilder::with_id("go_library", "Library").accelerator("CmdOrCtrl+2").build(app)?)
        .item(&MenuItemBuilder::with_id("go_roster", "Roster").accelerator("CmdOrCtrl+3").build(app)?)
        .item(&MenuItemBuilder::with_id("go_admin", "Admin").accelerator("CmdOrCtrl+4").build(app)?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .separator()
        .item(&MenuItemBuilder::with_id("show_main", "Teacher's Desk").accelerator("Alt+Space").build(app)?)
        .build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("open_browser", "Open in Browser").build(app)?)
        .build()?;

    MenuBuilder::new(app).items(&[&app_menu, &file, &edit, &view, &go_menu, &window, &help]).build()
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "new_question" => {
            show_main(app);
            go(app, "/chat", true);
        }
        "go_chat" => go(app, "/chat", true),
        "go_library" => go(app, "/library", false),
        "go_roster" => go(app, "/roster", false),
        "go_admin" => go(app, "/admin", false),
        "reload" => {
            if let Some(w) = main_window(app) {
                let _ = w.eval("location.reload()");
            }
        }
        "show_main" => show_main(app),
        "keep_on_mac" => open_keep_on_mac(app),
        "check_updates" => check_updates(app),
        "switch_server" => {
            app.state::<CurrentServer>().set(None);
            if let Some(w) = main_window(app) {
                let _ = w.navigate(connect_screen_url("?switch=1"));
            }
            show_main(app);
        }
        "open_browser" => {
            if let Some(origin) = app.state::<CurrentServer>().get() {
                let current = main_window(app).and_then(|w| w.url().ok()).filter(|u| !is_local_page(u));
                let target = current.unwrap_or(origin);
                let _ = app.opener().open_url(target.as_str(), None::<&str>);
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------- window

fn create_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let nav_app = app.clone();
    let dl_app = app.clone();
    let builder = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("Teacher's Desk")
        .inner_size(1280.0, 840.0)
        .min_inner_size(960.0, 620.0)
        .user_agent(USER_AGENT)
        // Only the connect screen and the connected school server load in the window;
        // every other link opens in the teacher's default browser.
        .on_navigation(move |url| {
            if is_local_page(url) || url.scheme() == "about" {
                return true;
            }
            // The school's pages may ask for app screens through teachersdesk:// links
            // (the account menu's "Keep my data on this Mac…"); nothing else gets through.
            if url.scheme() == "teachersdesk" {
                let app = nav_app.clone();
                match url.host_str() {
                    Some("keep-on-mac") => {
                        tauri::async_runtime::spawn(async move { open_keep_on_mac(&app) });
                    }
                    Some("check-updates") => check_updates(&app),
                    _ => {}
                }
                return false;
            }
            let allowed = nav_app
                .state::<CurrentServer>()
                .get()
                .is_some_and(|o| o.origin() == url.origin());
            if !allowed && matches!(url.scheme(), "http" | "https" | "mailto") {
                let _ = nav_app.opener().open_url(url.as_str(), None::<&str>);
            }
            allowed
        })
        // Files (original documents, roster template) save to ~/Downloads and are revealed.
        .on_download(move |_webview, event| match event {
            DownloadEvent::Requested { url, destination } => {
                let dir = dl_app
                    .path()
                    .download_dir()
                    .or_else(|_| dl_app.path().home_dir().map(|h| h.join("Downloads")));
                if let Ok(dir) = dir {
                    let _ = std::fs::create_dir_all(&dir);
                    let name = destination
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .filter(|n| !n.is_empty())
                        .or_else(|| url.path_segments().and_then(|mut s| s.next_back().map(str::to_string)))
                        .unwrap_or_else(|| "download".into());
                    *destination = unique_path(dir.join(name));
                }
                true
            }
            DownloadEvent::Finished { path: Some(path), success: true, .. } => {
                let _ = dl_app.opener().reveal_item_in_dir(path);
                true
            }
            _ => true,
        });

    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);

    builder.build()
}

fn unique_path(path: std::path::PathBuf) -> std::path::PathBuf {
    if !path.exists() {
        return path;
    }
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let dir = path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    (2..1000)
        .map(|i| dir.join(format!("{stem} ({i}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or(path)
}

// ---------------------------------------------------------------- entry

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ask_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &ask_shortcut && event.state() == ShortcutState::Pressed {
                        // ⌥Space from anywhere: bring Teacher's Desk forward, ready to ask.
                        show_main(app);
                        go(app, "/chat", true);
                    }
                })
                .build(),
        )
        .manage(CurrentServer::default())
        .manage(local::Setup::default())
        .manage(call_audio::CallAudio::default())
        .menu(build_menu)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![
            current_server,
            check_server,
            discover_servers,
            connect_server,
            local_status,
            setup_local,
            local_progress,
            open_filevault_settings,
            setup_local_sso,
            call_audio::call_audio_available,
            call_audio::call_audio_start,
            call_audio::call_audio_stop
        ])
        .setup(move |app| {
            create_main_window(app.handle())?;
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        on_deep_link(&handle, &url);
                    }
                });
            }
            updater::start(app.handle());
            if let Err(e) = app.global_shortcut().register(ask_shortcut) {
                eprintln!("global shortcut unavailable: {e}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Mac convention: closing the window keeps the app running (⌘Q quits).
            #[cfg(target_os = "macos")]
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .build(tauri::generate_context!())
        .expect("error while building Teacher's Desk");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            show_main(app); // clicking the Dock icon brings the window back
        }
        if let RunEvent::Exit = event {
            call_audio::shutdown(app); // nothing keeps recording after quitting
            #[cfg(target_os = "macos")]
            updater::install_on_exit(app, false); // a downloaded update goes in as we quit
        }
    });
}
