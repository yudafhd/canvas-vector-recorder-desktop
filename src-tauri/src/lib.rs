mod commands;
mod license;
mod recorder;
mod target_platform;

use recorder::RecorderStore;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use thiserror::Error;

pub const MAX_TARGET_TABS: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TargetTab {
    pub id: String,
    pub url: String,
    pub title: String,
    #[serde(skip)]
    pub webview_label: String,
}

#[derive(Debug, Default)]
pub struct TargetState {
    pub session_id: String,
    pub tabs: Vec<TargetTab>,
    pub active_id: Option<String>,
}

pub struct AppState {
    pub recorder: Mutex<RecorderStore>,
    pub target: Mutex<TargetState>,
    pub last_emit: Mutex<std::time::Instant>,
}

#[derive(Debug, Error, Serialize)]
pub enum AppError {
    #[error("Invalid session token")]
    InvalidSession,
    #[error("Invalid event sequence")]
    InvalidSequence,
    #[error("Recorder payload is too large")]
    PayloadTooLarge,
    #[error("Recorder event limit reached")]
    EventLimit,
    #[error("Invalid event: {0}")]
    InvalidEvent(String),
    #[error("License error: {0}")]
    License(String),
    #[error("Storage error: {0}")]
    Storage(String),
    #[error("Network error: {0}")]
    Network(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Window error: {0}")]
    Window(String),
    #[error("Invalid URL")]
    InvalidUrl,
    #[error("Application state unavailable")]
    State,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            recorder: Mutex::new(RecorderStore {
                recording_enabled: true,
                ..Default::default()
            }),
            target: Mutex::new(TargetState::default()),
            last_emit: Mutex::new(std::time::Instant::now()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_recording,
            commands::stop_recording,
            commands::record_canvas_events,
            commands::list_canvases,
            commands::get_canvas_result,
            commands::generate_svg,
            commands::export_svg,
            commands::save_svg,
            commands::clear_surfaces,
            commands::clear_recording,
            commands::get_recording_state,
            commands::set_recording,
            commands::open_target_url,
            commands::open_target_tab,
            commands::switch_target_tab,
            commands::close_target_tab,
            commands::reload_target_tab,
            commands::set_target_view_visible,
            commands::restore_target_view,
            commands::resize_target_view,
            commands::sync_target_tab,
            commands::close_target_window,
            commands::validate_license,
            commands::activate_license,
            commands::get_license_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running Canvas Vector Recorder");
}
