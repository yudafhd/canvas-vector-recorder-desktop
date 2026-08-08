use crate::{
    commands::{broadcast_target_tabs, is_target_window_label, new_tab_id, target_script},
    AppError, AppState, TargetTab, MAX_TARGET_TABS,
};
use tauri::{webview::PageLoadEvent, AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use url::Url;

const TARGET_WINDOW_LABEL: &str = "target";

// Windows keeps the target in its own native window. The main recorder window
// therefore never hosts a second browser surface that could cover or stack on it.
pub(crate) fn open_target_window(
    app: &AppHandle,
    parsed: Url,
    script: String,
) -> Result<(), AppError> {
    open_target_window_with_label(app, parsed, script, TARGET_WINDOW_LABEL.to_string())
}

fn open_target_window_with_label(
    app: &AppHandle,
    parsed: Url,
    script: String,
    label: String,
) -> Result<(), AppError> {
    if let Some(existing) = app.get_webview_window(&label) {
        existing
            .close()
            .map_err(|error| AppError::Window(error.to_string()))?;
    }
    let offset = app
        .webview_windows()
        .keys()
        .filter(|window_label| is_target_window_label(window_label))
        .count() as f64
        * 32.0;
    let app = app.clone();
    let script_on_load = script.clone();
    std::thread::spawn(move || {
        let result = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
            .title("Target — Canvas Vector Recorder")
            .initialization_script_for_all_frames(script)
            .on_page_load(move |webview, payload| {
                if matches!(payload.event(), PageLoadEvent::Started) {
                    let _ = webview.eval(&script_on_load);
                }
            })
            .position(48.0 + offset, 48.0 + offset)
            .inner_size(900.0, 650.0)
            .build();
        if let Err(error) = result {
            eprintln!("Gagal membuat window target Windows: {error}");
        }
    });
    Ok(())
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
    let (tab_id, session_id, webview_label) = {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        if target.tabs.is_empty() || target.session_id.is_empty() {
            return Err(AppError::Window("Sesi target belum siap.".into()));
        }
        if target.tabs.len() >= MAX_TARGET_TABS {
            return Err(AppError::Window(format!(
                "Maksimal {MAX_TARGET_TABS} overlay target dapat dibuka."
            )));
        }
        let tab_id = new_tab_id();
        let webview_label = format!("target-{tab_id}");
        target.tabs.push(TargetTab {
            id: tab_id.clone(),
            url: parsed.to_string(),
            title: "Memuat…".into(),
            webview_label: webview_label.clone(),
        });
        target.active_id = Some(tab_id.clone());
        (tab_id, target.session_id.clone(), webview_label)
    };
    let token = serde_json::to_string(&session_id)
        .map_err(|error| AppError::InvalidEvent(error.to_string()))?;
    let script = target_script(&token, &tab_id, &state)?;
    if let Err(error) = open_target_window_with_label(&app, parsed, script, webview_label) {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        target.tabs.retain(|tab| tab.id != tab_id);
        target.active_id = target.tabs.last().map(|tab| tab.id.clone());
        return Err(error);
    }
    set_target_view_visible(&app, &state, true)?;
    broadcast_target_tabs(&app, &state)
}

pub(crate) fn switch_target_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
) -> Result<(), AppError> {
    {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        if !target
            .tabs
            .iter()
            .any(|tab| tab.id == tab_id)
        {
            return Err(AppError::NotFound("Tab target tidak ditemukan.".into()));
        }
        target.active_id = Some(tab_id);
    }
    set_target_view_visible(&app, &state, true)?;
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
        let closing_active = target.active_id.as_deref() == Some(tab_id.as_str());
        let next_id = if closing_active {
            let next_index = index.saturating_sub(1).min(target.tabs.len() - 2);
            target.tabs[next_index].id.clone()
        } else {
            target.active_id.clone().ok_or_else(|| AppError::State)?
        };
        (target.tabs[index].webview_label.clone(), next_id)
    };
    if let Some(window) = app.get_webview_window(&webview_label) {
        window
            .close()
            .map_err(|e| AppError::Window(e.to_string()))?;
    }
    {
        let mut target = state.target.lock().map_err(|_| AppError::State)?;
        let was_active = target.active_id.as_deref() == Some(tab_id.as_str());
        target.tabs.retain(|tab| tab.id != tab_id);
        if was_active {
            target.active_id = Some(next_id.clone());
        }
    }
    set_target_view_visible(&app, &state, true)?;
    broadcast_target_tabs(&app, &state)
}

pub(crate) fn set_target_view_visible(
    app: &AppHandle,
    state: &State<'_, AppState>,
    visible: bool,
) -> Result<(), AppError> {
    let active_label = {
        let target = state.target.lock().map_err(|_| AppError::State)?;
        target
            .active_id
            .as_ref()
            .and_then(|id| target.tabs.iter().find(|tab| &tab.id == id))
            .map(|tab| tab.webview_label.clone())
    };
    for (label, window) in app.webview_windows() {
        if !is_target_window_label(&label) {
            continue;
        }
        if visible && active_label.as_deref() == Some(label.as_str()) {
            window
                .show()
                .map_err(|error| AppError::Window(error.to_string()))?;
            let _ = window.set_focus();
        } else {
            window
                .hide()
                .map_err(|error| AppError::Window(error.to_string()))?;
        }
    }
    Ok(())
}

pub(crate) fn restore_target_view(
    app: &AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(TARGET_WINDOW_LABEL) {
        window
            .show()
            .map_err(|error| AppError::Window(error.to_string()))?;
        return Ok(());
    }
    let (url, session_id, tab_id) = {
        let target = state.target.lock().map_err(|_| AppError::State)?;
        let tab = target
            .tabs
            .first()
            .ok_or_else(|| AppError::Window("Sesi target belum siap.".into()))?;
        (tab.url.clone(), target.session_id.clone(), tab.id.clone())
    };
    let parsed = Url::parse(&url).map_err(|_| AppError::InvalidUrl)?;
    let token = serde_json::to_string(&session_id)
        .map_err(|error| AppError::InvalidEvent(error.to_string()))?;
    let script = target_script(&token, &tab_id, &state)?;
    open_target_window(app, parsed, script)
}

pub(crate) fn resize_target_view(
    _app: &AppHandle,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
) -> Result<(), AppError> {
    // The target is a standalone native window on Windows, so it does not
    // need to follow the iframe bounds in the recorder page.
    Ok(())
}
