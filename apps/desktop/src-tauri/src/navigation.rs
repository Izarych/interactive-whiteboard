use tauri::Url;

pub fn is_board(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("bluviboard.ru")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
}

pub fn is_launcher(url: &Url) -> bool {
    ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "https" && url.host_str() == Some("tauri.localhost")))
        && url.username().is_empty()
        && url.password().is_none()
}

pub fn open_external(url: &Url) {
    if matches!(url.scheme(), "https" | "http")
        && url.username().is_empty()
        && url.password().is_none()
        && !is_launcher(url)
    {
        let _ = open::that(url.as_str());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_production_origin_is_a_board() {
        for value in ["https://bluviboard.ru/", "https://bluviboard.ru:443/admin"] {
            assert!(is_board(&Url::parse(value).unwrap()));
        }
        for value in [
            "http://bluviboard.ru/",
            "https://bluviboard.ru:8443/",
            "https://bluviboard.ru.example.org/",
            "https://other.bluviboard.ru/",
            "https://bluviboard.ru@other.example/",
            "https://user@bluviboard.ru/",
            "file:///C:/Windows/system.ini",
        ] {
            assert!(!is_board(&Url::parse(value).unwrap()), "{value}");
        }
    }

    #[test]
    fn launcher_requires_an_internal_origin() {
        for value in ["tauri://localhost/index.html", "https://tauri.localhost/"] {
            assert!(is_launcher(&Url::parse(value).unwrap()));
        }
        for value in [
            "http://localhost/",
            "http://tauri.localhost/",
            "tauri://other/",
        ] {
            assert!(!is_launcher(&Url::parse(value).unwrap()), "{value}");
        }
    }
}
