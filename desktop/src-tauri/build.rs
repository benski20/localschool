fn main() {
    // Optional built-in server (desktop/default-server.txt), used when neither the teacher
    // nor IT (MDM) has chosen one: the hosted pilot, so the app opens straight to sign-in.
    println!("cargo:rerun-if-changed=../default-server.txt");
    let default = std::fs::read_to_string("../default-server.txt").unwrap_or_default();
    println!("cargo:rustc-env=LS_DEFAULT_SERVER={}", default.trim());

    stage_call_audio_helper();

    // App commands are opt-in per capability: the bundled connect screen may call the
    // connect/setup ones (capabilities/connect.json); the school server's pages only the
    // call-audio ones (capabilities/school-server.json).
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
            "call_audio_available",
            "call_audio_start",
            "call_audio_stop",
        ]),
    ))
    .expect("failed to run tauri-build");
}

/// tauri-build refuses to build without the `bundle.externalBin` sidecar for this target
/// (bin/td-call-audio-<triple>), even for `cargo test`. On a Mac, build the real one
/// (helpers/build-call-audio.sh); elsewhere, a placeholder that just says it needs a Mac
/// (the app never starts it there: call_audio_available is false).
fn stage_call_audio_helper() {
    let target = std::env::var("TARGET").unwrap();
    let ext = if target.contains("windows") { ".exe" } else { "" };
    let sidecar = std::path::PathBuf::from(format!("bin/td-call-audio-{target}{ext}"));
    if sidecar.exists() {
        return;
    }
    if target.contains("apple-darwin") {
        let built = std::process::Command::new("bash")
            .arg("../helpers/build-call-audio.sh")
            .status()
            .is_ok_and(|s| s.success());
        if !built || !sidecar.exists() {
            panic!("couldn't build the call-audio helper: run desktop/helpers/build-call-audio.sh (needs the Xcode command line tools)");
        }
        return;
    }
    std::fs::create_dir_all("bin").expect("create bin/");
    std::fs::write(&sidecar, "#!/bin/sh\necho \"ERROR Recording the computer's sound needs a Mac.\"\nexit 1\n")
        .expect("write the call-audio placeholder");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&sidecar, std::fs::Permissions::from_mode(0o755));
    }
}
