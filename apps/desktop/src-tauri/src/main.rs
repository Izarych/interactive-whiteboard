#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod navigation;

use tauri::{
    webview::{DownloadEvent, NewWindowResponse},
    Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

#[tauri::command]
async fn desktop_close(window: WebviewWindow) -> Result<(), String> {
    // destroy() bypasses CloseRequested after the frontend has saved successfully.
    window.destroy().map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![desktop_close])
        .setup(|app| {
            WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .initialization_script(
                    "if (window === window.top && location.origin === 'https://bluviboard.ru') {\
                      Object.defineProperty(window, '__BLUVIBOARD_DESKTOP__', { value: true });\
                    }",
                )
                .on_navigation(|url| {
                    if navigation::is_board(url) || navigation::is_launcher(url) {
                        return true;
                    }
                    navigation::open_external(url);
                    false
                })
                .on_new_window(|url, _| {
                    navigation::open_external(&url);
                    NewWindowResponse::Deny
                })
                .on_download(|_, event| {
                    if let DownloadEvent::Requested { destination, .. } = event {
                        let name = destination
                            .file_name()
                            .map(|name| name.to_string_lossy().into_owned())
                            .unwrap_or_else(|| "BluviBoard.png".into());
                        if let Some(path) = rfd::FileDialog::new().set_file_name(name).save_file() {
                            *destination = path;
                        } else {
                            return false;
                        }
                    }
                    true
                })
                .prevent_overflow()
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if let Some(webview) = window.get_webview_window("main") {
                    if webview.url().is_ok_and(|url| navigation::is_board(&url)) {
                        api.prevent_close();
                        let _ = webview.eval(
                            "if (window.__BLUVIBOARD_PREPARE_CLOSE__) {\
                              void window.__BLUVIBOARD_PREPARE_CLOSE__();\
                            } else {\
                              void window.__TAURI_INTERNALS__.invoke('desktop_close');\
                            }",
                        );
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run BluviBoard");
}
