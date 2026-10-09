fn main() {
    // App commands are opt-in per capability: only the bundled connect screen may call
    // them (see capabilities/connect.json). The school server's pages never can.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "current_server",
            "check_server",
            "discover_servers",
            "connect_server",
        ]),
    ))
    .expect("failed to run tauri-build");
}
