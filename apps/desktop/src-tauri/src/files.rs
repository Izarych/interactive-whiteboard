use base64::{engine::general_purpose::STANDARD, Engine};
use std::io::Write;

#[tauri::command]
pub async fn desktop_save_file(
    diagnostic: tauri::State<'_, crate::diagnostics::Diagnostic>,
    name: String,
    data: String,
) -> Result<bool, String> {
    if !cfg!(target_os = "macos") {
        return Err("Native export is only used on macOS".into());
    }
    let extension = if name.ends_with(".png") {
        "png"
    } else if name.ends_with(".bluviboard") {
        "bluviboard"
    } else {
        return Err("Неверный тип файла".into());
    };
    if name.is_empty()
        || name.len() > 500
        || name.contains('/')
        || name.contains('\\')
        || name.chars().any(char::is_control)
        || data.len() > 280 * 1024 * 1024
    {
        return Err("Неверное имя или слишком большой файл".into());
    }
    let bytes = STANDARD.decode(data).map_err(|_| "Неверный файл")?;
    if bytes.len() > 200 * 1024 * 1024 {
        return Err("Файл превышает 200 МБ".into());
    }
    if extension == "png" && !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Неверный PNG".into());
    }
    if extension == "bluviboard" {
        let project: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| "Неверный файл доски")?;
        if project["format"] != "BluviBoard" || project["version"] != 1 {
            return Err("Неверный файл доски".into());
        }
    }
    let destination = if let Some(profile) = &diagnostic.profile {
        profile.join("downloads").join(&name)
    } else {
        let file = rfd::AsyncFileDialog::new()
            .set_file_name(&name)
            .add_filter("BluviBoard", &[extension])
            .save_file()
            .await;
        let Some(file) = file else {
            return Ok(false);
        };
        file.path().to_owned()
    };
    let directory = destination.parent().ok_or("Неверная папка")?;
    let temporary = directory.join(format!(
        ".bluviboard-export-{}-{}.tmp",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    ));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, &destination)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|error| format!("Не удалось сохранить файл: {error}"))?;
    Ok(true)
}
