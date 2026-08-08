use crate::{
    commands::{activate_target_webview, broadcast_target_tabs, new_tab_id, target_script},
    AppError, AppState, TargetTab, MAX_TARGET_TABS,
};
use tauri::{
    webview::PageLoadEvent, AppHandle, LogicalPosition, Manager, State, WebviewBuilder, WebviewUrl,
    WebviewWindowBuilder,
};
use url::Url;

pub(crate) fn open_target_window(
    app: &AppHandle,
    parsed: Url,
    script: String,
) -> Result<(), AppError> {
    let script_on_load = script.clone();
    WebviewWindowBuilder::new(app, "target", WebviewUrl::External(parsed))
        .title("Target — Canvas Vector Recorder")
        .initialization_script_for_all_frames(script)
        .on_page_load(move |webview, payload| {
            if matches!(payload.event(), PageLoadEvent::Started) {
                let _ = webview.eval(&script_on_load);
            }
        })
        .inner_size(900.0, 650.0)
        .build()
        .map(|_| ())
        .map_err(|error| AppError::Window(error.to_string()))
}

pub(crate) fn open_target_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<(), AppError> {
    let parsed = Url::parse(&url).map_err(|_| AppError::InvalidUrl)?;
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
    let script_on_load = script.clone();
    let size = window
        .inner_size()
        .map_err(|e| AppError::Window(e.to_string()))?;
    let result = window.add_child(
        WebviewBuilder::new(&webview_label, WebviewUrl::External(parsed))
            .initialization_script_for_all_frames(script)
            .on_page_load(move |webview, payload| {
                if matches!(payload.event(), PageLoadEvent::Started) {
                    let _ = webview.eval(&script_on_load);
                }
            }),
        LogicalPosition::new(0.0, 0.0),
        size,
    );
    if let Err(error) = result {
        rollback_tab(&state, &tab_id)?;
        return Err(AppError::Window(error.to_string()));
    }
    activate_target_webview(&app, &webview_label)?;
    broadcast_target_tabs(&app, &state)
}

pub(crate) fn switch_target_tab(
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

pub(crate) fn close_target_tab(
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

fn rollback_tab(state: &State<'_, AppState>, tab_id: &str) -> Result<(), AppError> {
    let mut target = state.target.lock().map_err(|_| AppError::State)?;
    target.tabs.retain(|tab| tab.id != tab_id);
    target.active_id = target.tabs.last().map(|tab| tab.id.clone());
    Ok(())
}

pub(crate) fn set_target_view_visible(
    _app: &AppHandle,
    _state: State<'_, AppState>,
    _visible: bool,
) -> Result<(), AppError> {
    Ok(())
}

pub(crate) fn restore_target_view(
    _app: &AppHandle,
    _state: State<'_, AppState>,
) -> Result<(), AppError> {
    Ok(())
}

pub(crate) fn resize_target_view(
    _app: &AppHandle,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
) -> Result<(), AppError> {
    Ok(())
}
