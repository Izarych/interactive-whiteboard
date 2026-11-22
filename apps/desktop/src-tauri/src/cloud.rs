use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{header, multipart, Client, Method};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;

const ORIGIN: &str = "https://bluviboard.ru";
const LIMIT: usize = 24 * 1024 * 1024;

pub struct Cloud {
    client: Client,
    token: Mutex<Option<String>>,
    persistent: bool,
    credential_scope: String,
}

#[derive(Serialize)]
pub struct CloudResponse {
    status: u16,
    body: Value,
    warning: Option<String>,
}

fn valid_token(token: &str) -> bool {
    token.len() == 43
        && token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn allowed(method: &str, path: &str) -> bool {
    match (method, path) {
        (
            "GET",
            "/auth/session"
            | "/boards"
            | "/desktop/latest"
            | "/desktop/latest?platform=macos&arch=arm64"
            | "/desktop/latest?platform=macos&arch=x64"
            | "/desktop/sync-capabilities",
        ) => true,
        ("POST", "/auth/login" | "/auth/logout") => true,
        ("GET", path) if path.starts_with("/boards/") => uuid(&path[8..]),
        ("GET", path) if path.starts_with("/assets/") => uuid(&path[8..]),
        ("PUT" | "DELETE", path) if path.starts_with("/desktop/boards/") => uuid(&path[16..]),
        _ => false,
    }
}

#[cfg(any(windows, target_os = "macos"))]
fn credential(scope: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(scope, "cloud-session").map_err(|error| error.to_string())
}

fn load_token(persistent: bool, scope: &str) -> Option<String> {
    #[cfg(any(windows, target_os = "macos"))]
    if persistent {
        return credential(scope)
            .ok()
            .and_then(|entry| entry.get_password().ok())
            .filter(|value| valid_token(value));
    }
    let _ = (persistent, scope);
    None
}

fn remember_token(persistent: bool, scope: &str, token: Option<&str>) -> Option<String> {
    #[cfg(any(windows, target_os = "macos"))]
    if persistent {
        let result = credential(scope).and_then(|entry| match token {
            Some(value) => entry.set_password(value).map_err(|error| error.to_string()),
            None => match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(error.to_string()),
            },
        });
        if result.is_err() {
            return Some("Не удалось обновить системное защищённое хранилище. Сессия действует только до закрытия программы.".into());
        }
    }
    let _ = (persistent, scope, token);
    None
}

impl Cloud {
    pub fn new(credential_scope: String) -> Result<Self, reqwest::Error> {
        // Diagnostic profiles must never read or overwrite the user's credential.
        let persistent = std::env::var_os("BLUVIBOARD_DESKTOP_TEST_DATA_DIR").is_none();
        Ok(Self {
            client: Client::builder()
                .timeout(Duration::from_secs(45))
                .connect_timeout(Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            token: Mutex::new(load_token(persistent, &credential_scope)),
            persistent,
            credential_scope,
        })
    }

    fn token(&self) -> Result<Option<String>, String> {
        self.token
            .lock()
            .map(|value| value.clone())
            .map_err(|_| "Хранилище сессии недоступно".into())
    }

    async fn send(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        upload: Option<(Vec<u8>, String)>,
    ) -> Result<CloudResponse, String> {
        if cfg!(target_os = "macos")
            && std::env::var("BLUVIBOARD_DESKTOP_SMOKE").as_deref() == Ok("1")
        {
            return Err("Облако отключено для нативной оффлайн-проверки".into());
        }
        let token = self.token()?;
        let mut warning = None;
        if path == "/auth/logout" {
            *self
                .token
                .lock()
                .map_err(|_| "Хранилище сессии недоступно")? = None;
            warning = remember_token(self.persistent, &self.credential_scope, None);
        }
        let mut request = self
            .client
            .request(method, format!("{ORIGIN}/api{path}"))
            .header(header::ORIGIN, ORIGIN)
            .header(header::USER_AGENT, "BluviBoard-Desktop");
        if let Some(token) = token {
            request = request.header(header::COOKIE, format!("bb_session={token}"));
        }
        if let Some((bytes, mime)) = upload {
            let part = multipart::Part::bytes(bytes)
                .file_name("image")
                .mime_str(&mime)
                .map_err(|_| "Неверный тип изображения")?;
            request = request.multipart(multipart::Form::new().part("file", part));
        } else if let Some(body) = body {
            request = request.json(&body);
        }
        let mut response = match request.send().await {
            Ok(response) => response,
            Err(_) => {
                return Ok(CloudResponse {
                    status: 503,
                    body: json!({ "message": "Нет связи с облаком. Локальные доски доступны без интернета." }),
                    warning,
                });
            }
        };
        let status = response.status().as_u16();
        let mime = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .to_owned();
        let new_token = response
            .headers()
            .get_all(header::SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .filter_map(|value| value.split(';').next()?.strip_prefix("bb_session="))
            .find(|value| valid_token(value))
            .map(str::to_owned);
        if response
            .content_length()
            .is_some_and(|value| value > LIMIT as u64)
        {
            return Err("Облачный ответ слишком большой".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Ответ облака прервался")?
        {
            if bytes.len() + chunk.len() > LIMIT {
                return Err("Облачный ответ слишком большой".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let body = if path.starts_with("/assets/") && status == 200 {
            if !matches!(mime.as_str(), "image/png" | "image/jpeg" | "image/webp") {
                return Err("Неверный тип облачного изображения".into());
            }
            json!({ "data": STANDARD.encode(bytes), "mime": mime })
        } else if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or_else(
                |_| json!({ "message": "Сервер временно недоступен. Локальные доски сохранены." }),
            )
        };
        if path == "/auth/login" && status == 200 && body["kind"] == "user" {
            let new_token = new_token.ok_or("Сервер не подтвердил сессию")?;
            warning = remember_token(self.persistent, &self.credential_scope, Some(&new_token));
            *self
                .token
                .lock()
                .map_err(|_| "Хранилище сессии недоступно")? = Some(new_token);
        }
        Ok(CloudResponse {
            status: if (300..400).contains(&status) {
                503
            } else {
                status
            },
            body,
            warning,
        })
    }
}

#[tauri::command]
pub async fn desktop_cloud_request(
    cloud: tauri::State<'_, Cloud>,
    path: String,
    method: String,
    body: Value,
) -> Result<CloudResponse, String> {
    if !allowed(&method, &path) || body.to_string().len() > 12 * 1024 * 1024 {
        return Err("Запрос не разрешён".into());
    }
    let method = Method::from_bytes(method.as_bytes()).map_err(|_| "Неверный метод запроса")?;
    cloud
        .send(method, &path, (!body.is_null()).then_some(body), None)
        .await
}

#[tauri::command]
pub async fn desktop_cloud_upload(
    cloud: tauri::State<'_, Cloud>,
    data: String,
    mime: String,
) -> Result<CloudResponse, String> {
    if data.len() > 14 * 1024 * 1024
        || !matches!(mime.as_str(), "image/png" | "image/jpeg" | "image/webp")
    {
        return Err("Выберите PNG, JPEG или WebP до 10 МБ".into());
    }
    let bytes = STANDARD.decode(data).map_err(|_| "Неверное изображение")?;
    if bytes.len() > 10 * 1024 * 1024 {
        return Err("Изображение превышает 10 МБ".into());
    }
    cloud
        .send(Method::POST, "/assets", None, Some((bytes, mime)))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bridge_has_no_arbitrary_network_or_admin_access() {
        let id = "4cb38919-e9ce-4466-b057-2ed20c187cad";
        assert!(allowed("PUT", &format!("/desktop/boards/{id}")));
        assert!(allowed("GET", &format!("/assets/{id}")));
        assert!(allowed("GET", "/desktop/latest?platform=macos&arch=arm64"));
        assert!(!allowed(
            "GET",
            "/desktop/latest?platform=macos&arch=arm64&url=https://evil.example"
        ));
        for path in [
            "https://evil.example/",
            "//evil.example/",
            "/admin/users",
            "/auth/session?redirect=https://evil.example",
            "/assets/../../secret",
            "/desktop/boards/not-a-uuid",
        ] {
            assert!(!allowed("GET", path));
            assert!(!allowed("PUT", path));
        }
        assert!(!allowed("DELETE", "/boards"));
    }
    #[test]
    fn credentials_cannot_inject_headers() {
        assert!(valid_token(&"x".repeat(43)));
        assert!(!valid_token("token\r\nX-Evil: yes"));
        assert!(!valid_token(&"x".repeat(44)));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_keychain_round_trip_uses_a_separate_diagnostic_entry() {
        let scope = format!(
            "ru.bluviboard.ci.{}.{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let entry = credential(&scope).unwrap();
        entry.set_password("diagnostic-not-a-real-session").unwrap();
        let loaded = entry.get_password();
        let removed = entry.delete_credential();
        assert_eq!(loaded.unwrap(), "diagnostic-not-a-real-session");
        removed.unwrap();
    }
}
