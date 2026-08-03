mod commands;
mod license;
mod recorder;

use recorder::RecorderStore;
use serde::Serialize;
use std::sync::Mutex;
use thiserror::Error;

pub struct AppState {
    pub recorder: Mutex<RecorderStore>,
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
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_recording,
            commands::stop_recording,
            commands::record_canvas_events,
            commands::list_canvases,
            commands::get_canvas_result,
            commands::generate_svg,
            commands::export_svg,
            commands::clear_recording,
            commands::get_recording_state,
            commands::set_recording,
            commands::open_target_url,
            commands::close_target_window,
            commands::validate_license,
            commands::activate_license,
            commands::get_license_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running Canvas Vector Recorder");
}
