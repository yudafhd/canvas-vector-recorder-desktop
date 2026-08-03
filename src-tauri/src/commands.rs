use crate::{
    license,
    recorder::{self, events::RecorderEvent, validator::MicrostockSettings},
    AppError, AppState,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, Serialize)]
pub struct StartRecording {
    pub session_id: String,
    pub target_capability: String,
}

#[tauri::command]
pub fn start_recording(state: State<'_, AppState>) -> Result<StartRecording, AppError> {
    let mut recorder = state.recorder.lock().map_err(|_| AppError::State)?;
    let session_id = recorder.start();
    Ok(StartRecording {
        session_id,
        target_capability: "record_canvas_events".into(),
    })
}

#[tauri::command]
pub fn stop_recording(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window("target") {
        let _ = window.eval("window.__CVR_STOP_RECORDER__ && window.__CVR_STOP_RECORDER__()");
    }
    state.recorder.lock().map_err(|_| AppError::State)?.stop();
    Ok(())
}

#[tauri::command]
pub fn record_canvas_events(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    events: Vec<RecorderEvent>,
) -> Result<(), AppError> {
    let mut recorder = state.recorder.lock().map_err(|_| AppError::State)?;
    recorder.record(&session_id, events)?;
    let canvases = recorder.list();
    drop(recorder);
    let _ = app.emit("canvases-updated", canvases);
    Ok(())
}

#[tauri::command]
pub fn list_canvases(
    state: State<'_, AppState>,
) -> Result<Vec<recorder::CanvasDetection>, AppError> {
    Ok(state.recorder.lock().map_err(|_| AppError::State)?.list())
}

#[tauri::command]
pub fn get_canvas_result(
    state: State<'_, AppState>,
    canvas_id: String,
) -> Result<Option<recorder::canvas::CanvasResult>, AppError> {
    Ok(state
        .recorder
        .lock()
        .map_err(|_| AppError::State)?
        .canvas(&canvas_id))
}

fn canvas_or_error(
    state: &State<'_, AppState>,
    canvas_id: &str,
) -> Result<recorder::canvas::CanvasResult, AppError> {
    state
        .recorder
        .lock()
        .map_err(|_| AppError::State)?
        .canvas(canvas_id)
        .ok_or_else(|| AppError::NotFound(format!("Canvas tidak ditemukan: {canvas_id}")))
}

#[tauri::command]
pub fn generate_svg(
    state: State<'_, AppState>,
    canvas_id: String,
    settings: Option<MicrostockSettings>,
) -> Result<serde_json::Value, AppError> {
    let data = canvas_or_error(&state, &canvas_id)?;
    Ok(recorder::svg::result(&data, &settings.unwrap_or_default()))
}

#[tauri::command]
pub fn export_svg(
    state: State<'_, AppState>,
    canvas_id: String,
    settings: Option<MicrostockSettings>,
) -> Result<String, AppError> {
    let data = canvas_or_error(&state, &canvas_id)?;
    if let Some(raw_svg) = data.raw_svg {
        return Ok(raw_svg);
    }
    let (svg, _) = recorder::svg::build(&data, &settings.unwrap_or_default());
    Ok(svg)
}

#[tauri::command]
pub fn clear_recording(state: State<'_, AppState>) -> Result<(), AppError> {
    state.recorder.lock().map_err(|_| AppError::State)?.clear();
    Ok(())
}

#[tauri::command]
pub fn get_recording_state(state: State<'_, AppState>) -> Result<bool, AppError> {
    Ok(state
        .recorder
        .lock()
        .map_err(|_| AppError::State)?
        .recording_enabled)
}

#[tauri::command]
pub fn set_recording(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), AppError> {
    state
        .recorder
        .lock()
        .map_err(|_| AppError::State)?
        .recording_enabled = enabled;
    if let Some(window) = app.get_webview_window("target") {
        let payload = if enabled { "true" } else { "false" };
        let _ = window.eval(&format!(
            "window.postMessage({{type:'cvr-set-recording', enabled:{payload}}}, '*')"
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn open_target_url(app: AppHandle, session_id: String, url: String) -> Result<(), AppError> {
    let parsed = url::Url::parse(&url).map_err(|_| AppError::InvalidUrl)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::InvalidUrl);
    }
    if let Some(window) = app.get_webview_window("target") {
        window
            .close()
            .map_err(|e| AppError::Window(e.to_string()))?;
    }
    let token =
        serde_json::to_string(&session_id).map_err(|e| AppError::InvalidEvent(e.to_string()))?;
    let bridge = include_str!("../../src/recorder-bridge.js");
    let target_controls = include_str!("../../src/target-controls.js");
    let script = format!("window.__CVR_SESSION_TOKEN__ = {token};\n{bridge}\n{target_controls}");
    WebviewWindowBuilder::new(&app, "target", WebviewUrl::External(parsed))
        .title("Target — Canvas Vector Recorder")
        .initialization_script_for_all_frames(&script)
        .inner_size(1200.0, 800.0)
        .build()
        .map_err(|e| AppError::Window(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn close_target_window(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window("target") {
        let _ = window.eval("window.__CVR_STOP_RECORDER__ && window.__CVR_STOP_RECORDER__()");
        window
            .close()
            .map_err(|e| AppError::Window(e.to_string()))?;
    }
    state.recorder.lock().map_err(|_| AppError::State)?.stop();
    let _ = app.emit("target-closed", ());
    Ok(())
}

#[tauri::command]
pub fn validate_license(
    app: AppHandle,
    email: String,
    license_code: String,
) -> Result<license::LicenseStatus, AppError> {
    let verified = license::validate_code(&email, &license_code)?;
    let _ = app;
    Ok(license::LicenseStatus {
        valid: true,
        email: Some(verified.payload.email),
        license_id: Some(verified.payload.license_id),
        expires_at: Some(verified.payload.expires_at),
        last_validated_at: None,
        offline: false,
        grace_remaining_days: None,
        message: None,
    })
}

#[tauri::command]
pub async fn activate_license(
    app: AppHandle,
    email: String,
    license_code: String,
) -> Result<license::LicenseStatus, AppError> {
    license::activate_license(&app, &email, &license_code).await
}

#[tauri::command]
pub async fn get_license_status(app: AppHandle) -> Result<license::LicenseStatus, AppError> {
    license::refreshed_status(&app).await
}
