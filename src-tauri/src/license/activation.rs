use crate::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct ActivateRequest<'a> {
    pub email: &'a str,
    pub license_code: &'a str,
    pub device_id: &'a str,
    pub app_version: &'a str,
}
#[derive(Debug, Deserialize)]
pub struct ActivateResponse {
    pub ok: bool,
    pub activation_token: Option<String>,
    pub expires_at: Option<String>,
    #[serde(rename = "next_check_at")]
    pub _next_check_at: Option<String>,
    pub message: Option<String>,
}
#[derive(Debug, Serialize)]
pub struct CheckRequest<'a> {
    pub activation_token: &'a str,
    pub device_id: &'a str,
    pub app_version: &'a str,
}
#[derive(Debug, Deserialize)]
pub struct CheckResponse {
    pub ok: bool,
    pub expires_at: Option<String>,
    #[serde(rename = "next_check_at")]
    pub _next_check_at: Option<String>,
    pub message: Option<String>,
}

pub async fn activate(
    server: &str,
    request: ActivateRequest<'_>,
) -> Result<ActivateResponse, AppError> {
    let response = reqwest::Client::new()
        .post(format!("{}/v1/activate", server.trim_end_matches('/')))
        .json(&request)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    let status = response.status();
    let body: ActivateResponse = response
        .json()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    if !status.is_success() || !body.ok {
        return Err(AppError::License(
            body.message
                .unwrap_or_else(|| "Aktivasi ditolak oleh license server".into()),
        ));
    }
    Ok(body)
}

pub async fn check(server: &str, request: CheckRequest<'_>) -> Result<CheckResponse, AppError> {
    let response = reqwest::Client::new()
        .post(format!("{}/v1/check", server.trim_end_matches('/')))
        .json(&request)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    let status = response.status();
    let body: CheckResponse = response
        .json()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    if !status.is_success() || !body.ok {
        return Err(AppError::License(
            body.message
                .unwrap_or_else(|| "Activation token ditolak atau dicabut".into()),
        ));
    }
    Ok(body)
}
