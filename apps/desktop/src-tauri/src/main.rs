#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cloud;
mod diagnostics;
mod files;
mod navigation;

use tauri::{
    webview::{DownloadEvent, NewWindowResponse},
    Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

#[tauri::command]
async fn desktop_close(window: WebviewWindow) -> Result<(), String> {
    // destroy() bypasses CloseRequested after the frontend has saved successfully.
    window.destroy().map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    window.app_handle().exit(0);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![desktop_close, cloud::desktop_cloud_request, cloud::desktop_cloud_upload, diagnostics::desktop_diagnostic, files::desktop_save_file])
        .setup(|app| {
            app.manage(cloud::Cloud::new(app.config().identifier.clone())?);
            let diagnostic = diagnostics::Diagnostic::from_env()?;
            let diagnostic_downloads = std::env::var("BLUVIBOARD_DESKTOP_DEBUG_PORT")
                .ok().and_then(|value| value.parse::<u16>().ok()).filter(|port| *port != 0)
                .and_then(|_| std::env::var_os("BLUVIBOARD_DESKTOP_TEST_DATA_DIR"))
                .map(std::path::PathBuf::from).filter(|path| path.is_absolute())
                .map(|path| path.join("downloads"))
                .or_else(|| diagnostic.profile.as_ref().map(|path| path.join("downloads")));
            if let Some(path) = &diagnostic_downloads { std::fs::create_dir_all(path)?; }
            let mut window = WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .initialization_script(
                    format!("if (window === window.top && (['https://bluviboard.ru', 'https://tauri.localhost'].includes(location.origin) || (location.protocol === 'tauri:' && location.hostname === 'localhost'))) {{\
                      Object.defineProperty(window, '__BLUVIBOARD_DESKTOP__', {{ value: true }});\
                      Object.defineProperty(window, '__BLUVIBOARD_DESKTOP_VERSION__', {{ value: '{}' }});\
                      if (location.origin !== 'https://bluviboard.ru') Object.defineProperty(window, '__BLUVIBOARD_OFFLINE__', {{ value: true }});\
                      Object.defineProperty(window, '__BLUVIBOARD_PREVIEW__', {{ value: {} }});\
                      Object.defineProperty(window, '__BLUVIBOARD_DESKTOP_OS__', {{ value: '{}' }});\
                      Object.defineProperty(window, '__BLUVIBOARD_DESKTOP_ARCH__', {{ value: '{}' }});\
                    }}", env!("CARGO_PKG_VERSION"), app.config().identifier.ends_with(".preview"), std::env::consts::OS, std::env::consts::ARCH),
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
                .on_download(move |_, event| {
                    if let DownloadEvent::Requested { destination, .. } = event {
                        let name = destination
                            .file_name()
                            .map(|name| name.to_string_lossy().into_owned())
                            .unwrap_or_else(|| "BluviBoard.png".into());
                        if let Some(path) = &diagnostic_downloads {
                            *destination = path.join(name);
                        } else if let Some(path) = rfd::FileDialog::new().set_file_name(name).save_file() {
                            *destination = path;
                        } else {
                            return false;
                        }
                    }
                    true
                });
            if let Some(script) = &diagnostic.script { window = window.initialization_script(script); }
            #[cfg(target_os = "macos")]
            if let Some(id) = diagnostic.store_id { window = window.data_store_identifier(id); }
            app.manage(diagnostic);
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
                let quit = MenuItem::with_id(app, "safe-quit", "Завершить BluviBoard", true, Some("CmdOrCtrl+Q"))?;
                let app_menu = Submenu::with_items(app, "BluviBoard", true, &[
                    &PredefinedMenuItem::about(app, None, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ])?;
                let edit = Submenu::with_items(app, "Правка", true, &[
                    &PredefinedMenuItem::undo(app, None)?, &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?, &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?, &PredefinedMenuItem::select_all(app, None)?,
                ])?;
                app.set_menu(Menu::with_items(app, &[&app_menu, &edit])?)?;
                app.on_menu_event(|app, event| {
                    if event.id().as_ref() == "safe-quit" {
                        if let Some(window) = app.get_webview_window("main") { let _ = window.close(); }
                    }
                });
            }
            // WebView2 150+ ignores its environment arguments for elevated hosts.
            // Pass our explicitly requested diagnostics through the WebView2 API.
            if let Some(port) = std::env::var("BLUVIBOARD_DESKTOP_DEBUG_PORT")
                .ok()
                .and_then(|value| value.parse::<u16>().ok())
                .filter(|port| *port != 0)
            {
                window = window.additional_browser_args(&format!(
                    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
                     --remote-debugging-address=127.0.0.1 --remote-debugging-port={port}"
                ));
                if let Some(directory) = std::env::var_os("BLUVIBOARD_DESKTOP_TEST_DATA_DIR") {
                    let directory = std::path::PathBuf::from(directory);
                    if directory.is_absolute() {
                        window = window.data_directory(directory);
                    }
                }
            }
            window.prevent_overflow().build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if let Some(webview) = window.get_webview_window("main") {
                    if webview.url().is_ok_and(|url| navigation::is_board(&url) || navigation::is_launcher(&url)) {
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
        .build(tauri::generate_context!())
        .expect("failed to build BluviBoard")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    api.prevent_exit();
                    let _ = window.close();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
