use crate::AppError;
use serde::{de::DeserializeOwned, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const SERVICE: &str = "com.canvasvectorrecorder.desktop";
const ACCOUNT: &str = "license-record";

fn fallback_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    fs::create_dir_all(&dir).map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(dir.join("license.json"))
}
pub fn load<T: DeserializeOwned>(app: &AppHandle) -> Result<Option<T>, AppError> {
    let path = fallback_path(app)?;
    if path.exists() {
        let value = fs::read_to_string(&path).map_err(|e| AppError::Storage(e.to_string()))?;
        if let Ok(parsed) = serde_json::from_str(&value) {
            return Ok(Some(parsed));
        }
    }
    if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
        if let Ok(value) = entry.get_password() {
            if let Ok(parsed) = serde_json::from_str(&value) {
                return Ok(Some(parsed));
            }
        }
    }
    Ok(None)
}
pub fn save<T: Serialize>(app: &AppHandle, value: &T) -> Result<(), AppError> {
    let encoded = serde_json::to_string(value).map_err(|e| AppError::Storage(e.to_string()))?;
    let path = fallback_path(app)?;
    fs::write(&path, &encoded).map_err(|e| AppError::Storage(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
        let _ = entry.set_password(&encoded);
    }
    Ok(())
}
