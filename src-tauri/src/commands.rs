use crate::{
    license,
    recorder::{self, events::RecorderEvent, validator::MicrostockSettings},
    AppError, AppState, TargetState, TargetTab, MAX_TARGET_TABS,
};
use serde::Serialize;
use tauri::{
    AppHandle, Emitter, LogicalPosition, Manager, State, WebviewBuilder, WebviewUrl,
    WebviewWindowBuilder,
};

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
    if let Some(window) = app.get_window("target") {
        for webview in window.webviews() {
            let _ = webview.eval("window.__CVR_STOP_RECORDER__ && window.__CVR_STOP_RECORDER__()");
        }
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
    if let Some(window) = app.get_window("target") {
        let payload = if enabled { "true" } else { "false" };
        for webview in window.webviews() {
            let _ = webview.eval(&format!(
                "window.postMessage({{type:'cvr-set-recording', enabled:{payload}}}, '*')"
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn open_target_url(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    url: String,
) -> Result<(), AppError> {
    let parsed = url::Url::parse(&url).map_err(|_| AppError::InvalidUrl)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::InvalidUrl);
    }
    if let Some(window) = app.get_webview_window("target") {
        window
            .close()
            .map_err(|e| AppError::Window(e.to_string()))?;
    }
    let tab_id = new_tab_id();
    {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        target.session_id = session_id.clone();
        target.tabs = vec![TargetTab {
            id: tab_id.clone(),
            url: parsed.to_string(),
            title: "Memuat…".into(),
            webview_label: "target".into(),
        }];
        target.active_id = Some(tab_id.clone());
    }
    let token =
        serde_json::to_string(&session_id).map_err(|e| AppError::InvalidEvent(e.to_string()))?;
    let script = target_script(&token, &tab_id, &state)?;
    let result = WebviewWindowBuilder::new(&app, "target", WebviewUrl::External(parsed))
        .title("Target — Canvas Vector Recorder")
        .initialization_script_for_all_frames(&script)
        .inner_size(1200.0, 800.0)
        .build();
    if let Err(error) = result {
        *state.target.lock().map_err(|_| AppError::State)? = TargetState::default();
        return Err(AppError::Window(error.to_string()));
    }
    Ok(())
}

#[tauri::command]
pub fn open_target_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<(), AppError> {
    let parsed = url::Url::parse(&url).map_err(|_| AppError::InvalidUrl)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::InvalidUrl);
    }
    let window = app
        .get_window("target")
        .ok_or_else(|| AppError::Window("Target window tidak ditemukan.".into()))?;
    let tab_id = new_tab_id();
    let webview_label = format!("target-{tab_id}");
    let session_id = {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        if target.tabs.is_empty() || target.session_id.is_empty() {
            return Err(AppError::Window("Sesi target belum siap.".into()));
        }
        if target.tabs.len() >= MAX_TARGET_TABS {
            return Err(AppError::Window(format!(
                "Maksimal {MAX_TARGET_TABS} tab dapat dibuka dalam satu window."
            )));
        }
        target.tabs.push(TargetTab {
            id: tab_id.clone(),
            url: parsed.to_string(),
            title: "Memuat…".into(),
            webview_label: webview_label.clone(),
        });
        target.active_id = Some(tab_id.clone());
        target.session_id.clone()
    };
    let token =
        serde_json::to_string(&session_id).map_err(|e| AppError::InvalidEvent(e.to_string()))?;
    let script = target_script(&token, &tab_id, &state)?;
    let size = window
        .inner_size()
        .map_err(|e| AppError::Window(e.to_string()))?;
    let result = window.add_child(
        WebviewBuilder::new(&webview_label, WebviewUrl::External(parsed))
            .initialization_script_for_all_frames(&script),
        LogicalPosition::new(0.0, 0.0),
        size,
    );
    if let Err(error) = result {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        target.tabs.retain(|tab| tab.id != tab_id);
        target.active_id = target.tabs.last().map(|tab| tab.id.clone());
        return Err(AppError::Window(error.to_string()));
    }
    activate_target_webview(&app, &webview_label)?;
    broadcast_target_tabs(&app, &state)?;
    Ok(())
}

#[tauri::command]
pub fn switch_target_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
) -> Result<(), AppError> {
    let webview_label = {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        let webview_label = target
            .tabs
            .iter()
            .find(|tab| tab.id == tab_id)
            .map(|tab| tab.webview_label.clone())
            .ok_or_else(|| AppError::NotFound("Tab target tidak ditemukan.".into()))?;
        target.active_id = Some(tab_id);
        webview_label
    };
    activate_target_webview(&app, &webview_label)?;
    broadcast_target_tabs(&app, &state)
}

#[tauri::command]
pub fn close_target_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
) -> Result<(), AppError> {
    let (webview_label, next_id) = {
        let target = state.target.lock().map_err(|_| AppError::State)?;
        if target.tabs.len() <= 1 {
            return Err(AppError::Window("Tab terakhir tidak dapat ditutup.".into()));
        }
        let index = target
            .tabs
            .iter()
            .position(|tab| tab.id == tab_id)
            .ok_or_else(|| AppError::NotFound("Tab target tidak ditemukan.".into()))?;
        let next_id = if target.active_id.as_deref() == Some(tab_id.as_str()) {
            let next_index = index.saturating_sub(1).min(target.tabs.len() - 2);
            target.tabs[next_index].id.clone()
        } else {
            target.active_id.clone().ok_or_else(|| AppError::State)?
        };
        (target.tabs[index].webview_label.clone(), next_id)
    };
    if let Some(webview) = app.get_webview(&webview_label) {
        webview
            .close()
            .map_err(|e| AppError::Window(e.to_string()))?;
    }
    {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        target.tabs.retain(|tab| tab.id != tab_id);
        if target.active_id.as_deref() == Some(tab_id.as_str()) {
            target.active_id = Some(next_id.clone());
        }
    }
    let next_label = state
        .target
        .lock()
        .map_err(|_| AppError::State)?
        .tabs
        .iter()
        .find(|tab| tab.id == next_id)
        .map(|tab| tab.webview_label.clone())
        .ok_or_else(|| AppError::NotFound("Tab target berikutnya tidak ditemukan.".into()))?;
    activate_target_webview(&app, &next_label)?;
    broadcast_target_tabs(&app, &state)
}

#[tauri::command]
pub fn sync_target_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
    url: String,
    title: String,
) -> Result<(), AppError> {
    if url.is_empty() {
        return Ok(());
    }
    {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        if let Some(tab) = target.tabs.iter_mut().find(|tab| tab.id == tab_id) {
            tab.url = url;
            if !title.is_empty() {
                tab.title = title;
            }
        } else {
            return Ok(());
        }
    }
    broadcast_target_tabs(&app, &state)
}

#[tauri::command]
pub fn close_target_window(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    if let Some(window) = app.get_window("target") {
        for webview in window.webviews() {
            let _ = webview.eval("window.__CVR_STOP_RECORDER__ && window.__CVR_STOP_RECORDER__()");
        }
        window
            .close()
            .map_err(|e| AppError::Window(e.to_string()))?;
    }
    *state.target.lock().map_err(|_| AppError::State)? = TargetState::default();
    state.recorder.lock().map_err(|_| AppError::State)?.stop();
    let _ = app.emit("target-closed", ());
    Ok(())
}

fn new_tab_id() -> String {
    format!("tab-{}", uuid::Uuid::new_v4())
}

fn target_payload(state: &TargetState) -> serde_json::Value {
    serde_json::json!({
        "active_id": state.active_id,
        "tabs": state.tabs.iter().map(|tab| serde_json::json!({
            "id": tab.id,
            "url": tab.url,
            "title": tab.title,
        })).collect::<Vec<_>>()
    })
}

fn target_script(
    token: &str,
    tab_id: &str,
    state: &State<'_, AppState>,
) -> Result<String, AppError> {
    let tab_token =
        serde_json::to_string(tab_id).map_err(|e| AppError::InvalidEvent(e.to_string()))?;
    let tabs = {
        let target = state.target.lock().map_err(|_| AppError::State)?;
        serde_json::to_string(&target_payload(&target))
            .map_err(|e| AppError::InvalidEvent(e.to_string()))?
    };
    let bridge = include_str!("../../src/recorder-bridge.js");
    let target_controls = include_str!("../../src/target-controls.js");
    Ok(format!(
        "window.__CVR_SESSION_TOKEN__ = {token}; window.__CVR_TARGET_TAB_ID__ = {tab_token}; window.__CVR_TARGET_TABS__ = {tabs};\n{bridge}\n{target_controls}"
    ))
}

fn activate_target_webview(app: &AppHandle, active_label: &str) -> Result<(), AppError> {
    let window = app
        .get_window("target")
        .ok_or_else(|| AppError::Window("Target window tidak ditemukan.".into()))?;
    for webview in window.webviews() {
        if webview.label() == active_label {
            webview
                .show()
                .and_then(|_| webview.set_focus())
                .map_err(|e| AppError::Window(e.to_string()))?;
        } else {
            webview
                .hide()
                .map_err(|e| AppError::Window(e.to_string()))?;
        }
    }
    Ok(())
}

fn broadcast_target_tabs(app: &AppHandle, state: &State<'_, AppState>) -> Result<(), AppError> {
    let payload = {
        let target = state.target.lock().map_err(|_| AppError::State)?;
        serde_json::to_string(&target_payload(&target))
            .map_err(|e| AppError::InvalidEvent(e.to_string()))?
    };
    if let Some(window) = app.get_window("target") {
        let script = format!("window.__CVR_SET_TABS__ && window.__CVR_SET_TABS__({payload});");
        for webview in window.webviews() {
            let _ = webview.eval(&script);
        }
    }
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
        perpetual: false,
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
