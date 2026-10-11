fn main() {
    // Optional built-in server (desktop/default-server.txt), used when neither the teacher
    // nor IT (MDM) has chosen one: the hosted pilot, so the app opens straight to sign-in.
    println!("cargo:rerun-if-changed=../default-server.txt");
    let default = std::fs::read_to_string("../default-server.txt").unwrap_or_default();
    println!("cargo:rustc-env=LS_DEFAULT_SERVER={}", default.trim());

    // App commands are opt-in per capability: only the bundled connect screen may call
    // them (see capabilities/connect.json). The school server's pages never can.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "current_server",
            "check_server",
            "discover_servers",
            "connect_server",
            "local_status",
            "setup_local",
            "local_progress",
            "open_filevault_settings",
            "setup_local_sso",
        ]),
    ))
    .expect("failed to run tauri-build");
}
