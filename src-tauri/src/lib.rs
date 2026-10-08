mod commands;
mod color_picker;
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
    pub(crate) canvas_emit: Mutex<CanvasEmitState>,
}

pub(crate) struct CanvasEmitState {
    last: std::time::Instant,
    scheduled: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CanvasEmitAction {
    Now,
    After(std::time::Duration),
    Wait,
}

impl Default for CanvasEmitState {
    fn default() -> Self {
        Self {
            last: std::time::Instant::now() - std::time::Duration::from_millis(500),
            scheduled: false,
        }
    }
}

impl CanvasEmitState {
    const INTERVAL: std::time::Duration = std::time::Duration::from_millis(500);

    pub(crate) fn after_record(&mut self, now: std::time::Instant) -> CanvasEmitAction {
        if self.scheduled {
            return CanvasEmitAction::Wait;
        }
        let elapsed = now.saturating_duration_since(self.last);
        if elapsed >= Self::INTERVAL {
            self.last = now;
            CanvasEmitAction::Now
        } else {
            self.scheduled = true;
            CanvasEmitAction::After(Self::INTERVAL - elapsed)
        }
    }

    pub(crate) fn finish_scheduled(&mut self, now: std::time::Instant) {
        self.last = now;
        self.scheduled = false;
    }
}

#[cfg(test)]
mod canvas_emit_tests {
    use super::{CanvasEmitAction, CanvasEmitState};
    use std::time::{Duration, Instant};

    #[test]
    fn final_batch_gets_a_trailing_update() {
        let start = Instant::now();
        let mut throttle = CanvasEmitState {
            last: start - Duration::from_millis(500),
            scheduled: false,
        };
        assert_eq!(throttle.after_record(start), CanvasEmitAction::Now);
        assert_eq!(
            throttle.after_record(start + Duration::from_millis(100)),
            CanvasEmitAction::After(Duration::from_millis(400))
        );
        assert_eq!(
            throttle.after_record(start + Duration::from_millis(250)),
            CanvasEmitAction::Wait
        );
        throttle.finish_scheduled(start + Duration::from_millis(500));
        assert_eq!(
            throttle.after_record(start + Duration::from_millis(550)),
            CanvasEmitAction::After(Duration::from_millis(450))
        );
    }
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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .manage(AppState {
            recorder: Mutex::new(RecorderStore::default()),
            target: Mutex::new(TargetState::default()),
            canvas_emit: Mutex::new(CanvasEmitState::default()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_recording,
            commands::pick_screen_color,
            commands::stop_recording,
            commands::record_canvas_events,
            commands::report_recorder_error,
            commands::record_svg_asset,
            commands::list_canvases,
            commands::list_svg_assets,
            commands::get_svg_asset,
            commands::generate_svg_asset,
            commands::get_canvas_result,
            commands::generate_svg,
            commands::export_svg,
            commands::save_svg,
            commands::save_svg_asset,
            commands::save_eps,
            commands::save_eps_asset,
            commands::clear_surfaces,
            commands::clear_recording,
            commands::open_target_url,
            commands::open_mahes_app,
            commands::get_discover,
            commands::open_discover_link,
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
