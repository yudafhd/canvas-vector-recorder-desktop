use crate::AppError;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
pub use guardian_core::LicenseStatus;
use guardian_core::{storage::JsonFileStore, LicenseConfig, LicenseError, LicenseManager};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration as StdDuration, Instant};
use tauri::{AppHandle, Manager};

const LICENSE_FILENAME: &str = "guardian-license.json";
const TIME_NOW_URL: &str = "https://time.now/developer/api/timezone/Asia/Jakarta";
const TIME_NOW_TIMEZONE: &str = "Asia/Jakarta";
const TIME_NOW_REFRESH: StdDuration = StdDuration::from_secs(5 * 60);
const TIME_NOW_TIMEOUT: StdDuration = StdDuration::from_secs(3);

#[derive(Debug, Deserialize)]
struct TimeNowResponse {
    timezone: String,
    utc_datetime: String,
}

#[derive(Clone, Copy)]
struct ClockSnapshot {
    utc: DateTime<Utc>,
    captured_at: Instant,
    checked_at: Instant,
}

static TIME_NOW_CACHE: OnceLock<Mutex<Option<ClockSnapshot>>> = OnceLock::new();

fn time_now_cache() -> &'static Mutex<Option<ClockSnapshot>> {
    TIME_NOW_CACHE.get_or_init(|| Mutex::new(None))
}

fn add_elapsed(utc: DateTime<Utc>, elapsed: StdDuration) -> DateTime<Utc> {
    let milliseconds = i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX);
    utc + ChronoDuration::milliseconds(milliseconds)
}

fn time_now() -> Result<DateTime<Utc>, String> {
    let client = Client::builder()
        .timeout(TIME_NOW_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(TIME_NOW_URL)
        .header("Accept", "application/json")
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("time.now HTTP {}", response.status()));
    }
    let payload = response
        .json::<TimeNowResponse>()
        .map_err(|error| error.to_string())?;
    if payload.timezone != TIME_NOW_TIMEZONE {
        return Err("time.now returned an unexpected timezone".into());
    }
    DateTime::parse_from_rfc3339(&payload.utc_datetime)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| error.to_string())
}

fn trusted_now() -> DateTime<Utc> {
    let cached = time_now_cache().lock().ok().and_then(|cache| *cache);
    if let Some(snapshot) = cached {
        if snapshot.checked_at.elapsed() < TIME_NOW_REFRESH {
            return add_elapsed(snapshot.utc, snapshot.captured_at.elapsed());
        }
    }

    if let Ok(utc) = time_now() {
        let captured_at = Instant::now();
        if let Ok(mut cache) = time_now_cache().lock() {
            *cache = Some(ClockSnapshot {
                utc,
                captured_at,
                checked_at: captured_at,
            });
        }
        return utc;
    }

    if let Some(snapshot) = cached {
        return add_elapsed(snapshot.utc, snapshot.captured_at.elapsed());
    }

    let utc = Utc::now();
    let captured_at = Instant::now();
    if let Ok(mut cache) = time_now_cache().lock() {
        *cache = Some(ClockSnapshot {
            utc,
            captured_at,
            checked_at: captured_at,
        });
    }
    utc
}

fn config() -> LicenseConfig {
    let product = option_env!("LICENSE_PRODUCT_CODE").unwrap_or("");
    LicenseConfig::new(
        product,
        format!("{product}/v1"),
        option_env!("LICENSE_PUBLIC_KEY").unwrap_or_default(),
    )
}

fn manager(app: &AppHandle) -> Result<LicenseManager<JsonFileStore>, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Storage(error.to_string()))?;
    Ok(LicenseManager::new(
        config(),
        JsonFileStore::new(app_data.join(LICENSE_FILENAME)),
    ))
}

fn map_error(error: LicenseError) -> AppError {
    AppError::License(error.to_string())
}

pub fn validate_code(app: &AppHandle, email: &str, code: &str) -> Result<LicenseStatus, AppError> {
    manager(app)?
        .preview(code, email, trusted_now())
        .map_err(map_error)
}

pub fn activate_license(
    app: &AppHandle,
    email: &str,
    code: &str,
) -> Result<LicenseStatus, AppError> {
    manager(app)?
        .activate(code, email, trusted_now())
        .map_err(map_error)
}

pub fn status(app: &AppHandle) -> Result<LicenseStatus, AppError> {
    manager(app)?.status(trusted_now()).map_err(map_error)
}

pub fn require_valid(app: &AppHandle) -> Result<LicenseStatus, AppError> {
    manager(app)?.require_valid(trusted_now()).map_err(map_error)
}
