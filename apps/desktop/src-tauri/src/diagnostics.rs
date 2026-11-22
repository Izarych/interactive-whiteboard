use serde_json::Value;
use std::path::PathBuf;
use tauri::{Manager, WebviewWindow};

#[derive(Default)]
pub struct Diagnostic {
    pub profile: Option<PathBuf>,
    pub script: Option<String>,
    pub store_id: Option<[u8; 16]>,
    phase: String,
}

impl Diagnostic {
    pub fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        if !cfg!(target_os = "macos")
            || std::env::var("BLUVIBOARD_DESKTOP_SMOKE").as_deref() != Ok("1")
        {
            return Ok(Self::default());
        }
        let profile = PathBuf::from(std::env::var("BLUVIBOARD_DESKTOP_TEST_DATA_DIR")?);
        let script = PathBuf::from(std::env::var("BLUVIBOARD_DESKTOP_SMOKE_SCRIPT")?);
        let phase = std::env::var("BLUVIBOARD_DESKTOP_SMOKE_PHASE")?;
        let id = std::env::var("BLUVIBOARD_DESKTOP_TEST_STORE_ID")?;
        if !profile.is_absolute()
            || !script.is_absolute()
            || !["first", "restart", "recovery"].contains(&phase.as_str())
            || id.len() != 32
            || !id.bytes().all(|b| b.is_ascii_hexdigit())
            || std::fs::metadata(&script)?.len() > 512 * 1024
        {
            return Err("Invalid native diagnostic configuration".into());
        }
        let mut store_id = [0; 16];
        for (index, byte) in store_id.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&id[index * 2..index * 2 + 2], 16)?;
        }
        std::fs::create_dir_all(profile.join("downloads"))?;
        let source = format!(
            "Object.defineProperty(window, '__BLUVIBOARD_SMOKE_PHASE__', {{ value: {} }});\n{}",
            serde_json::to_string(&phase)?,
            std::fs::read_to_string(script)?
        );
        Ok(Self {
            profile: Some(profile),
            script: Some(source),
            store_id: Some(store_id),
            phase,
        })
    }
}

// This command is inert in normal runs. Diagnostic paths and scripts come only
// from the launching process environment, never from a webview request.
#[tauri::command]
pub async fn desktop_diagnostic(
    window: WebviewWindow,
    diagnostic: tauri::State<'_, Diagnostic>,
    action: String,
    result: Value,
) -> Result<Value, String> {
    let profile = diagnostic
        .profile
        .as_ref()
        .ok_or("Native diagnostics are disabled")?;
    match action.as_str() {
        "report" | "failure" => {
            let data = serde_json::to_vec_pretty(&result).map_err(|e| e.to_string())?;
            if data.len() > 64 * 1024 {
                return Err("Diagnostic report too large".into());
            }
            std::fs::write(profile.join(format!("{}.json", diagnostic.phase)), data)
                .map_err(|e| e.to_string())?;
            if action == "failure" {
                window.app_handle().exit(1);
            }
            Ok(Value::Null)
        }
        "exports" => {
            let mut files = std::fs::read_dir(profile.join("downloads"))
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .filter(|entry| entry.path().is_file())
                .filter_map(|entry| entry.file_name().into_string().ok())
                .filter(|name| name.ends_with(".png") || name.ends_with(".bluviboard"))
                .collect::<Vec<_>>();
            files.sort();
            Ok(
                serde_json::json!({ "files": files, "cloudRequests": crate::cloud::DIAGNOSTIC_NETWORK_ATTEMPTS.load(std::sync::atomic::Ordering::Relaxed) }),
            )
        }
        "close" => window
            .close()
            .map(|_| Value::Null)
            .map_err(|e| e.to_string()),
        _ => Err("Unknown diagnostic action".into()),
    }
}
