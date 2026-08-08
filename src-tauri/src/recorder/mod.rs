pub mod canvas;
pub mod events;
pub mod path;
pub mod svg;
pub mod transform;
pub mod validator;

use crate::AppError;
use canvas::{CanvasResult, CanvasState};
use events::RecorderEvent;
use path::PathData;
use serde::Serialize;
use std::collections::HashMap;
use uuid::Uuid;

const MAX_EVENTS: usize = 250_000;
const MAX_BATCH_BYTES: usize = 2_000_000;

#[derive(Debug, Clone, Serialize)]
pub struct CanvasDetection {
    pub canvas_id: String,
    pub width: f64,
    pub height: f64,
    pub revision: usize,
    pub shapes: usize,
    pub gap_fillers: usize,
    pub errors: u64,
    pub state: String,
}

#[derive(Debug, Default)]
pub struct RecorderStore {
    pub active_session: Option<String>,
    pub sessions: HashMap<String, SessionState>,
    pub recording_enabled: bool,
}
#[derive(Debug)]
pub struct SessionState {
    pub id: String,
    pub last_sequences: HashMap<String, u64>,
    pub event_count: usize,
    pub canvases: HashMap<String, CanvasState>,
    pub paths: HashMap<String, PathData>,
    pub ended: bool,
}

impl RecorderStore {
    pub fn start(&mut self) -> String {
        let id = format!("cvr-{}", Uuid::new_v4());
        self.sessions.insert(
            id.clone(),
            SessionState {
                id: id.clone(),
                last_sequences: HashMap::new(),
                event_count: 0,
                canvases: HashMap::new(),
                paths: HashMap::new(),
                ended: false,
            },
        );
        self.active_session = Some(id.clone());
        self.recording_enabled = true;
        id
    }
    pub fn stop(&mut self) {
        if let Some(id) = &self.active_session {
            if let Some(session) = self.sessions.get_mut(id) {
                session.ended = true;
            }
        }
        self.active_session = None;
    }
    pub fn clear(&mut self) {
        self.active_session = None;
        self.sessions.clear();
    }
    pub fn clear_surfaces(&mut self) {
        let Some(session_id) = self.active_session.clone() else {
            self.clear();
            return;
        };
        if let Some(session) = self.sessions.get_mut(&session_id) {
            session.canvases.clear();
            session.paths.clear();
            session.event_count = 0;
            session.ended = false;
        } else {
            self.clear();
        }
    }
    pub fn record(&mut self, session_id: &str, events: Vec<RecorderEvent>) -> Result<(), AppError> {
        if events.is_empty() {
            return Ok(());
        }
        if events.len() > 100
            || serde_json::to_vec(&events)
                .map_err(|e| AppError::InvalidEvent(e.to_string()))?
                .len()
                > MAX_BATCH_BYTES
        {
            return Err(AppError::PayloadTooLarge);
        }
        if self.active_session.as_deref() != Some(session_id) {
            return Err(AppError::InvalidSession);
        }
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or(AppError::InvalidSession)?;
        if session.event_count + events.len() > MAX_EVENTS {
            return Err(AppError::EventLimit);
        }
        for event in events {
            if event.session_id != session_id {
                return Err(AppError::InvalidSequence);
            }
            let frame_id = event.frame_id.as_deref().unwrap_or("main").to_string();
            let last_sequence = session.last_sequences.get(&frame_id).copied().unwrap_or(0);
            if event.sequence != last_sequence + 1 {
                return Err(AppError::InvalidSequence);
            }
            session.last_sequences.insert(frame_id, event.sequence);
            session.event_count += 1;
            if event.event_type == "session_end" {
                session.ended = true;
                continue;
            }
            if event.event_type == "path_created" {
                if let Some(id) = &event.path_id {
                    session.paths.entry(id.clone()).or_default();
                }
            }
            if event.event_type == "path_command" {
                if let (Some(id), Some(command)) = (&event.path_id, &event.command) {
                    let path = session.paths.entry(id.clone()).or_default();
                    if path.command(&command.command_type, &command.args).is_err() {
                        return Err(AppError::InvalidEvent("invalid path command".into()));
                    }
                }
            }
            let key = event.canvas_key().to_string();
            if event.event_type == "canvas_created" {
                session.canvases.entry(key.clone()).or_insert_with(|| {
                    CanvasState::new(
                        &key,
                        event.width.unwrap_or(1.0),
                        event.height.unwrap_or(1.0),
                    )
                });
            }
            if let Some(canvas) = session.canvases.get_mut(&key) {
                if event.event_type != "path_command" {
                    if let Some(path_id) = &event.path_id {
                        if !canvas.paths.contains_key(path_id) {
                            if let Some(path) = session.paths.get(path_id) {
                                canvas.paths.insert(path_id.clone(), path.clone());
                            }
                        }
                    }
                }
                canvas.apply(&event);
            }
        }
        Ok(())
    }
    pub fn list(&self) -> Vec<CanvasDetection> {
        self.sessions
            .values()
            .flat_map(|session| {
                session.canvases.values().map(|canvas| CanvasDetection {
                    canvas_id: canvas.canvas_id.clone(),
                    width: canvas.width,
                    height: canvas.height,
                    revision: canvas.revision,
                    shapes: canvas.shapes.len(),
                    gap_fillers: canvas.gap_fillers.len(),
                    errors: canvas.errors,
                    state: if session.ended {
                        "ENDED".into()
                    } else {
                        "RECORDING".into()
                    },
                })
            })
            .collect()
    }
    pub fn canvas(&self, id: &str) -> Option<CanvasResult> {
        self.sessions
            .values()
            .find_map(|s| s.canvases.get(id).map(CanvasState::result))
    }
    pub fn active(&self) -> Option<&SessionState> {
        self.active_session
            .as_ref()
            .and_then(|id| self.sessions.get(id))
    }
}

#[allow(dead_code)]
pub fn parse_events(value: &str) -> Result<Vec<RecorderEvent>, AppError> {
    serde_json::from_str(value).map_err(|e| AppError::InvalidEvent(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event(session: &str, sequence: u64, event_type: &str) -> RecorderEvent {
        RecorderEvent {
            session_id: session.into(),
            frame_id: None,
            canvas_id: Some("canvas-1".into()),
            sequence,
            event_type: event_type.into(),
            width: Some(100.0),
            height: Some(100.0),
            path_id: None,
            command: None,
            args: None,
            transform: None,
            fill_style: None,
            stroke_style: None,
            line_width: None,
            fill_rule: None,
            value: None,
        }
    }
    #[test]
    fn event_json_is_parsed() {
        let parsed = parse_events(
            r#"[{"session_id":"s","canvas_id":"c","sequence":1,"type":"session_start"}]"#,
        )
        .unwrap();
        assert_eq!(parsed[0].event_type, "session_start");
    }
    #[test]
    fn sequence_and_session_token_are_enforced() {
        let mut store = RecorderStore::default();
        let id = store.start();
        assert!(store
            .record(&id, vec![event(&id, 1, "session_start")])
            .is_ok());
        assert!(matches!(
            store.record(&id, vec![event(&id, 1, "session_start")]),
            Err(AppError::InvalidSequence)
        ));
        assert!(matches!(
            store.record("other", vec![event("other", 1, "session_start")]),
            Err(AppError::InvalidSession)
        ));
    }
    #[test]
    fn paths_are_reconstructed_into_canvas_results() {
        let mut store = RecorderStore::default();
        let id = store.start();
        let created = event(&id, 1, "canvas_created");
        store.record(&id, vec![created]).unwrap();
        let mut path = event(&id, 2, "path_created");
        path.canvas_id = None;
        path.path_id = Some("p1".into());
        store.record(&id, vec![path]).unwrap();
        let mut command = event(&id, 3, "path_command");
        command.canvas_id = None;
        command.path_id = Some("p1".into());
        command.command = Some(events::PathCommand {
            command_type: "move_to".into(),
            args: vec![1.0, 2.0],
        });
        store.record(&id, vec![command]).unwrap();
        let mut fill = event(&id, 4, "fill");
        fill.path_id = Some("p1".into());
        fill.fill_style = Some("#fff".into());
        store.record(&id, vec![fill]).unwrap();
        assert_eq!(store.canvas("canvas-1").unwrap().shapes.len(), 1);
    }

    #[test]
    fn clear_surfaces_keeps_active_session_recording() {
        let mut store = RecorderStore::default();
        let id = store.start();
        store
            .record(&id, vec![event(&id, 1, "canvas_created")])
            .unwrap();
        store.clear_surfaces();
        assert!(store.list().is_empty());
        store
            .record(&id, vec![event(&id, 2, "canvas_created")])
            .unwrap();
        assert_eq!(store.list().len(), 1);
    }
}
