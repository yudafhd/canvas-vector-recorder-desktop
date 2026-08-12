pub mod activation;
pub mod machine;
pub mod storage;
pub mod validator;

use crate::AppError;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseRecord {
    pub email: String,
    pub license_id: String,
    pub activation_token: String,
    pub device_id: String,
    pub expires_at: String,
    pub last_validated_at: String,
    pub max_devices: u32,
    #[serde(default)]
    pub offline: bool,
    #[serde(default)]
    pub perpetual: bool,
}
#[derive(Debug, Clone, Serialize)]
pub struct LicenseStatus {
    pub valid: bool,
    pub email: Option<String>,
    pub license_id: Option<String>,
    pub expires_at: Option<String>,
    pub last_validated_at: Option<String>,
    pub offline: bool,
    pub perpetual: bool,
    pub grace_remaining_days: Option<i64>,
    pub message: Option<String>,
}

fn online_activation_enabled() -> bool {
    std::env::var("LICENSE_OFFLINE_ONLY")
        .map(|value| {
            !matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(false)
}

pub fn status(app: &AppHandle) -> Result<LicenseStatus, AppError> {
    let record: Option<LicenseRecord> = storage::load(app)?;
    let Some(mut record) = record else {
        return Ok(LicenseStatus {
            valid: false,
            email: None,
            license_id: None,
            expires_at: None,
            last_validated_at: None,
            offline: false,
            perpetual: false,
            grace_remaining_days: None,
            message: Some("Belum ada lisensi yang diaktivasi.".into()),
        });
    };
    let current_device = machine::device_id();
    if record.device_id != current_device {
        if record.device_id == machine::legacy_device_id() {
            record.device_id = current_device;
            storage::save(app, &record)?;
        } else {
            return Ok(LicenseStatus {
                valid: false,
                email: None,
                license_id: None,
                expires_at: None,
                last_validated_at: None,
                offline: false,
                perpetual: false,
                grace_remaining_days: None,
                message: Some(
                    "Belum ada lisensi di komputer ini. Masukkan kode lisensi untuk mengaktivasi."
                        .into(),
                ),
            });
        }
    }
    let now = Utc::now();
    let expires = DateTime::parse_from_rfc3339(&record.expires_at)
        .map_err(|e| AppError::License(e.to_string()))?
        .with_timezone(&Utc);
    let validated = DateTime::parse_from_rfc3339(&record.last_validated_at)
        .map_err(|e| AppError::License(e.to_string()))?
        .with_timezone(&Utc);
    let grace_until = validated
        + Duration::days(
            std::env::var("LICENSE_GRACE_PERIOD_DAYS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(7),
        );
    let offline_mode = record.offline
        || record.activation_token.starts_with("offline:")
        || record.activation_token.starts_with("dev-local:");
    let clock_ok = now >= validated;
    let valid = clock_ok
        && if record.perpetual {
            true
        } else {
            now < expires && (offline_mode || now <= grace_until)
        };
    let remaining = if record.perpetual {
        None
    } else if offline_mode {
        Some((expires - now).num_days().max(0))
    } else {
        Some((grace_until - now).num_days().max(0))
    };
    Ok(LicenseStatus {
        valid,
        email: Some(record.email),
        license_id: Some(record.license_id),
        expires_at: if record.perpetual {
            None
        } else {
            Some(record.expires_at)
        },
        last_validated_at: Some(record.last_validated_at),
        offline: offline_mode,
        perpetual: record.perpetual,
        grace_remaining_days: remaining,
        message: if valid {
            None
        } else if record.perpetual {
            Some("Waktu komputer tidak valid atau lisensi perlu diaktivasi ulang.".into())
        } else {
            Some("Lisensi perlu divalidasi ulang atau masa berlakunya sudah habis.".into())
        },
    })
}

pub async fn refreshed_status(app: &AppHandle) -> Result<LicenseStatus, AppError> {
    let record: Option<LicenseRecord> = storage::load(app)?;
    let Some(mut record) = record else {
        return status(app);
    };
    if record.device_id != machine::device_id() {
        return status(app);
    }
    if online_activation_enabled() {
        if let Ok(server) = std::env::var("LICENSE_SERVER_URL") {
            let interval_hours = std::env::var("LICENSE_CHECK_INTERVAL_HOURS")
                .ok()
                .and_then(|v| v.parse::<i64>().ok())
                .unwrap_or(24);
            let last = DateTime::parse_from_rfc3339(&record.last_validated_at)
                .map_err(|e| AppError::License(e.to_string()))?
                .with_timezone(&Utc);
            if Utc::now() - last >= Duration::hours(interval_hours.max(1)) {
                match activation::check(
                    &server,
                    activation::CheckRequest {
                        activation_token: &record.activation_token,
                        device_id: &machine::device_id(),
                        app_version: option_env!("APP_VERSION").unwrap_or("1.1.0"),
                    },
                )
                .await
                {
                    Ok(response) => {
                        record.last_validated_at = Utc::now().to_rfc3339();
                        if let Some(expires_at) = response.expires_at {
                            record.expires_at = expires_at;
                        }
                        storage::save(app, &record)?;
                    }
                    Err(error) => {
                        let local = status(app)?;
                        if local.valid {
                            return Ok(LicenseStatus {
                                offline: true,
                                message: Some(format!(
                                    "Server tidak tersedia; offline grace period aktif. {}",
                                    error
                                )),
                                ..local
                            });
                        }
                        return Err(error);
                    }
                }
            }
        }
    }
    status(app)
}

pub fn validate_code(email: &str, code: &str) -> Result<validator::VerifiedLicense, AppError> {
    validator::validate(code, email, Utc::now()).map_err(AppError::License)
}

pub async fn activate_license(
    app: &AppHandle,
    email: &str,
    code: &str,
) -> Result<LicenseStatus, AppError> {
    let verified = validate_code(email, code)?;
    let device = machine::device_id();
    let version = option_env!("APP_VERSION").unwrap_or("1.1.0");
    let (token, expires, offline) = if online_activation_enabled() {
        if let Ok(server) = std::env::var("LICENSE_SERVER_URL") {
            let response = activation::activate(
                &server,
                activation::ActivateRequest {
                    email: &verified.payload.email,
                    license_code: code,
                    device_id: &device,
                    app_version: version,
                },
            )
            .await?;
            (
                response.activation_token.ok_or_else(|| {
                    AppError::License("Server tidak mengembalikan activation token".into())
                })?,
                response
                    .expires_at
                    .unwrap_or(verified.payload.expires_at.clone()),
                false,
            )
        } else {
            (
                format!("offline:{}:{}", verified.payload.license_id, device),
                verified.payload.expires_at.clone(),
                true,
            )
        }
    } else {
        (
            format!("offline:{}:{}", verified.payload.license_id, device),
            verified.payload.expires_at.clone(),
            true,
        )
    };
    let record = LicenseRecord {
        email: validator::normalize_email(email),
        license_id: verified.payload.license_id,
        activation_token: token,
        device_id: device,
        expires_at: expires,
        last_validated_at: Utc::now().to_rfc3339(),
        max_devices: verified.payload.max_devices,
        offline,
        perpetual: offline,
    };
    storage::save(app, &record)?;
    status(app)
}
