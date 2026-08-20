#[cfg(not(target_os = "windows"))]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(not(target_os = "windows"))]
pub(crate) use self::macos::{
    close_target_tab, close_target_views, open_target_tab, open_target_window, resize_target_view,
    restore_target_view, set_target_view_visible, switch_target_tab,
};

#[cfg(target_os = "windows")]
pub(crate) use self::windows::{
    close_target_tab, close_target_views, open_target_tab, open_target_window, resize_target_view,
    restore_target_view, set_target_view_visible, switch_target_tab,
};

use crate::{AppError, AppState};
use tauri::{AppHandle, Manager, State};

pub(crate) fn reload_target_tab(
    app: &AppHandle,
    state: &State<'_, AppState>,
    tab_id: &str,
) -> Result<(), AppError> {
    let webview_label = state
        .target
        .lock()
        .map_err(|_| AppError::State)?
        .tabs
        .iter()
        .find(|tab| tab.id == tab_id)
        .map(|tab| tab.webview_label.clone())
        .ok_or_else(|| AppError::NotFound("Tab target tidak ditemukan.".into()))?;
    let webview = app
        .get_webview(&webview_label)
        .ok_or_else(|| AppError::Window("WebView target tidak ditemukan.".into()))?;
    let _ = webview.eval("window.__CVR_STOP_RECORDER__ && window.__CVR_STOP_RECORDER__()");
    webview
        .reload()
        .map_err(|error| AppError::Window(error.to_string()))
}
