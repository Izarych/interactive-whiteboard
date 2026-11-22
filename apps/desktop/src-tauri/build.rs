fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_close",
            "desktop_cloud_request",
            "desktop_cloud_upload",
            "desktop_diagnostic",
            "desktop_save_file",
        ]),
    ))
    .expect("failed to build desktop resources");
}
