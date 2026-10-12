pub mod canvas;
mod clear;
pub mod eps;
pub mod events;
pub mod path;
pub mod svg;
pub mod svg_asset;
pub mod transform;
mod tiles;
pub mod validator;

use crate::AppError;
use canvas::{CanvasResult, CanvasState};
use events::RecorderEvent;
use path::PathData;
use svg_asset::{SvgAsset, SvgAssetInput};
use serde::Serialize;
use std::collections::HashMap;
use uuid::Uuid;

const MAX_EVENTS: usize = 250_000;
const MAX_BATCH_BYTES: usize = 2_000_000;
/// Canvases smaller than this are typically tracking or temporary surfaces,
/// not exportable artwork.
const MIN_LISTED_CANVAS_EDGE: f64 = 16.0;

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
}
#[derive(Debug)]
pub struct SessionState {
    pub id: String,
    pub last_sequences: HashMap<String, u64>,
    pub event_count: usize,
    pub canvases: HashMap<String, CanvasState>,
    pub svgs: HashMap<String, SvgAsset>,
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
                svgs: HashMap::new(),
                paths: HashMap::new(),
                ended: false,
            },
        );
        self.active_session = Some(id.clone());
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
            session.svgs.clear();
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
        // Validate the whole batch before applying it. A lost response can
        // resend an accepted batch; old sequence numbers are acknowledgments,
        // while a gap must still be rejected.
        let mut sequences = session.last_sequences.clone();
        let mut new_events = 0;
        for event in &events {
            if event.session_id != session_id || event.sequence == 0 {
                return Err(AppError::InvalidSequence);
            }
            let frame = event.frame_id.as_deref().unwrap_or("main");
            let last = sequences.get(frame).copied().unwrap_or(0);
            if event.sequence <= last { continue; }
            if event.sequence != last + 1 { return Err(AppError::InvalidSequence); }
            if event.event_type == "path_command" {
                let command = event.command.as_ref().filter(|_| event.path_id.is_some())
                    .ok_or_else(|| AppError::InvalidEvent("missing path command".into()))?;
                PathData::default().command(&command.command_type, &command.args)
                    .map_err(AppError::InvalidEvent)?;
            }
            sequences.insert(frame.to_string(), event.sequence);
            new_events += 1;
        }
        if session.event_count + new_events > MAX_EVENTS {
            return Err(AppError::EventLimit);
        }
        for event in events {
            if event.session_id != session_id {
                return Err(AppError::InvalidSequence);
            }
            let frame_id = event.frame_id.as_deref().unwrap_or("main").to_string();
            let last_sequence = session.last_sequences.get(&frame_id).copied().unwrap_or(0);
            if event.sequence <= last_sequence { continue; }
            session.last_sequences.insert(frame_id, event.sequence);
            session.event_count += 1;
            if event.event_type == "session_end" {
                session.ended = true;
                continue;
            }
            if event.event_type == "path_created" {
                if let Some(id) = &event.path_id {
                    let seed = match event.value.as_ref() {
                        Some(serde_json::Value::String(d)) if d.len() <= 500_000 => PathData {
                            d: d.clone(),
                            current: None,
                        },
                        Some(serde_json::Value::Object(value)) => value
                            .get("source_path_id")
                            .and_then(|source| source.as_str())
                            .and_then(|source| session.paths.get(source))
                            .cloned()
                            .unwrap_or_default(),
                        _ => PathData::default(),
                    };
                    session.paths.entry(id.clone()).or_insert(seed);
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
            if event.event_type == "path_append" {
                if let (Some(id), Some(source)) = (
                    event.path_id.as_ref(),
                    event.value.as_ref().and_then(|value| value.get("source_path_id")).and_then(|value| value.as_str()),
                ) {
                    if let Some(source_path) = session.paths.get(source).cloned() {
                        if !source_path.d.is_empty() {
                            let transform = event.transform.unwrap_or([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
                            let appended = if transform == [1.0, 0.0, 0.0, 1.0, 0.0, 0.0] {
                                Some(source_path.d)
                            } else {
                                kurbo::BezPath::from_svg(&source_path.d).ok().map(|mut path| {
                                    path.apply_affine(kurbo::Affine::new(transform));
                                    path.to_svg()
                                })
                            };
                            if let Some(d) = appended {
                                session.paths.entry(id.clone()).or_default().push(&d);
                            }
                        }
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
                        if let Some(path) = session.paths.get(path_id) {
                            canvas.paths.insert(path_id.clone(), path.clone());
                        }
                    }
                }
                canvas.apply(&event);
            }
        }
        Ok(())
    }
    pub fn list(&self) -> Vec<CanvasDetection> {
        let mut canvases = self
            .sessions
            .values()
            .flat_map(|session| {
                tiles::groups(&session.canvases)
                    .into_iter()
                    .filter(|group| group.iter().any(|canvas| canvas.visible)
                        && group.iter().all(|canvas| canvas.width >= MIN_LISTED_CANVAS_EDGE
                            && canvas.height >= MIN_LISTED_CANVAS_EDGE))
                    .map(|group| {
                        let result = tiles::merged(&group);
                        CanvasDetection {
                            canvas_id: result.canvas_id,
                            width: result.width,
                            height: result.height,
                            revision: group.iter().map(|canvas| canvas.revision).sum(),
                            shapes: result.shapes.len(),
                            gap_fillers: result.gap_fillers.len(),
                            errors: result.errors,
                            state: if session.ended { "ENDED".into() } else { "RECORDING".into() },
                        }
                    })
            })
            .collect::<Vec<_>>();
        canvases.sort_by(|left, right| {
            (right.width * right.height)
                .total_cmp(&(left.width * left.height))
                .then_with(|| (right.shapes + right.gap_fillers).cmp(&(left.shapes + left.gap_fillers)))
                .then_with(|| left.canvas_id.cmp(&right.canvas_id))
        });
        canvases
    }
    pub fn record_svg(&mut self, session_id: &str, input: SvgAssetInput) -> Result<bool, AppError> {
        if self.active_session.as_deref() != Some(session_id) {
            return Err(AppError::InvalidSession);
        }
        let input = input.validate().map_err(|message| AppError::InvalidEvent(message.into()))?;
        let session = self.sessions.get_mut(session_id).ok_or(AppError::InvalidSession)?;
        if session.ended {
            return Err(AppError::InvalidSession);
        }
        let next_revision = session.svgs.get(&input.svg_id).map_or(1, |asset| asset.revision + 1);
        if let Some(existing) = session.svgs.get(&input.svg_id) {
            if existing.markup == input.markup && existing.width == input.width && existing.height == input.height && existing.filename == input.filename {
                return Ok(false);
            }
        }
        session.svgs.insert(input.svg_id.clone(), SvgAsset {
            svg_id: input.svg_id,
            width: input.width,
            height: input.height,
            shapes: input.shapes,
            filename: input.filename,
            markup: input.markup,
            revision: next_revision,
        });
        Ok(true)
    }
    pub fn list_svgs(&self) -> Vec<SvgAsset> {
        let mut assets = self.sessions.values().flat_map(|session| session.svgs.values().cloned()).collect::<Vec<_>>();
        assets.sort_by(|a, b| a.svg_id.cmp(&b.svg_id));
        assets
    }
    pub fn svg(&self, id: &str) -> Option<SvgAsset> {
        self.sessions.values().find_map(|session| session.svgs.get(id).cloned())
    }
    pub fn canvas(&self, id: &str) -> Option<CanvasResult> {
        self.sessions
            .values()
            .find_map(|session| tiles::groups(&session.canvases).into_iter()
                .find(|group| group.iter().any(|canvas| canvas.canvas_id == id))
                .map(|group| tiles::merged(&group)))
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
    use serde_json::json;
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
        assert!(store.record(&id, vec![event(&id, 1, "session_start")]).is_ok());
        assert_eq!(store.active().unwrap().event_count, 1);
        assert!(matches!(store.record(&id, vec![event(&id, 3, "session_start")]), Err(AppError::InvalidSequence)));
        assert!(matches!(
            store.record("other", vec![event("other", 1, "session_start")]),
            Err(AppError::InvalidSession)
        ));
    }

    #[test]
    fn retried_batches_do_not_duplicate_paints_and_invalid_batches_are_atomic() {
        let mut store = RecorderStore::default();
        let id = store.start();
        let mut fill = event(&id, 2, "fill_rect");
        fill.args = Some(vec![0.0, 0.0, 10.0, 10.0]);
        let batch = vec![event(&id, 1, "canvas_created"), fill.clone()];
        store.record(&id, batch.clone()).unwrap();
        store.record(&id, batch).unwrap();
        assert_eq!(store.canvas("canvas-1").unwrap().shapes.len(), 1);
        assert_eq!(store.active().unwrap().event_count, 2);
        fill.sequence = 3;
        let invalid = event(&id, 5, "fill_rect");
        assert!(store.record(&id, vec![fill.clone(), invalid]).is_err());
        assert_eq!(store.active().unwrap().event_count, 2);
        store.record(&id, vec![fill]).unwrap();
        assert_eq!(store.canvas("canvas-1").unwrap().shapes.len(), 2);
    }

    #[test]
    fn mutable_path2d_refreshes_future_paints_without_changing_earlier_paints() {
        let mut store = RecorderStore::default();
        let id = store.start();
        let mut path = event(&id, 2, "path_created");
        path.canvas_id = None;
        path.path_id = Some("mutable".into());
        path.value = Some(json!("M 0 0 L 10 0 L 10 10"));
        let mut fill = event(&id, 3, "fill");
        fill.path_id = path.path_id.clone();
        let mut change = event(&id, 4, "path_command");
        change.canvas_id = None;
        change.path_id = path.path_id.clone();
        change.command = Some(events::PathCommand { command_type: "line_to".into(), args: vec![0.0, 20.0] });
        let mut second_fill = fill.clone();
        second_fill.sequence = 5;
        store.record(&id, vec![event(&id, 1, "canvas_created"), path, fill, change, second_fill]).unwrap();
        let result = store.canvas("canvas-1").unwrap();
        assert_eq!(result.shapes[0].d, "M 0 0 L 10 0 L 10 10 Z");
        assert_eq!(result.shapes[1].d, "M 0 0 L 10 0 L 10 10 L 0 20 Z");
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
    fn svg_path2d_constructor_and_copy_are_recorded() {
        let mut store = RecorderStore::default();
        let id = store.start();
        let d = "M 10 10 L 90 10 L 90 90 Z";
        let mut original = event(&id, 2, "path_created");
        original.canvas_id = None;
        original.path_id = Some("original".into());
        original.value = Some(json!(d));
        let mut copy = event(&id, 3, "path_created");
        copy.canvas_id = None;
        copy.path_id = Some("copy".into());
        copy.value = Some(json!({ "source_path_id": "original" }));
        let mut combined = event(&id, 4, "path_created");
        combined.canvas_id = None;
        combined.path_id = Some("combined".into());
        let mut append = event(&id, 5, "path_append");
        append.canvas_id = None;
        append.path_id = Some("combined".into());
        append.value = Some(json!({ "source_path_id": "copy" }));
        let mut fill = event(&id, 6, "fill");
        fill.path_id = Some("combined".into());
        store
            .record(&id, vec![event(&id, 1, "canvas_created"), original, copy, combined, append, fill])
            .unwrap();
        let result = store.canvas("canvas-1").unwrap();
        assert_eq!(result.errors, 0);
        assert_eq!(result.shapes.len(), 1);
        assert_eq!(result.shapes[0].d, d);
    }

    #[test]
    fn transformed_path2d_append_keeps_shifted_geometry() {
        let mut store = RecorderStore::default();
        let id = store.start();
        let mut source = event(&id, 2, "path_created");
        source.canvas_id = None;
        source.path_id = Some("leaf".into());
        source.value = Some(json!("M0 0 L10 0 L0 10 Z"));
        let mut target = event(&id, 3, "path_created");
        target.canvas_id = None;
        target.path_id = Some("branch".into());
        let mut append = event(&id, 4, "path_append");
        append.canvas_id = None;
        append.path_id = Some("branch".into());
        append.value = Some(json!({ "source_path_id": "leaf" }));
        append.transform = Some([0.0, 1.0, -1.0, 0.0, 100.0, 200.0]);
        let mut fill = event(&id, 5, "fill");
        fill.path_id = Some("branch".into());
        store.record(&id, vec![event(&id, 1, "canvas_created"), source, target, append, fill]).unwrap();
        let result = store.canvas("canvas-1").unwrap();
        assert_eq!(result.errors, 0);
        let path = kurbo::BezPath::from_svg(&result.shapes[0].d).unwrap();
        assert!(matches!(path.elements()[0], kurbo::PathEl::MoveTo(point) if point.x == 100.0 && point.y == 200.0));
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

    #[test]
    fn listed_canvases_skip_tiny_surfaces_and_prioritize_larger_artwork() {
        let mut store = RecorderStore::default();
        let id = store.start();
        let mut tiny = event(&id, 1, "canvas_created");
        tiny.canvas_id = Some("tiny".into());
        tiny.width = Some(1.0);
        tiny.height = Some(1.0);
        let mut square = event(&id, 2, "canvas_created");
        square.canvas_id = Some("square".into());
        square.width = Some(1024.0);
        square.height = Some(1024.0);
        let mut wide = event(&id, 3, "canvas_created");
        wide.canvas_id = Some("wide".into());
        wide.width = Some(2784.0);
        wide.height = Some(1416.0);
        store.record(&id, vec![tiny, square, wide]).unwrap();

        let listed = store.list();
        assert_eq!(listed.iter().map(|item| item.canvas_id.as_str()).collect::<Vec<_>>(), ["wide", "square"]);
    }

    #[test]
    fn listed_canvases_skip_hidden_surfaces() {
        let mut store = RecorderStore::default();
        let id = store.start();
        let mut hidden = event(&id, 1, "canvas_created");
        hidden.canvas_id = Some("hidden".into());
        let mut visibility = event(&id, 2, "canvas_visibility");
        visibility.canvas_id = Some("hidden".into());
        visibility.value = Some(json!(false));
        store.record(&id, vec![hidden, visibility]).unwrap();

        assert!(store.list().is_empty());
    }

    #[test]
    fn svg_assets_are_stored_updated_and_cleared() {
        let mut store = RecorderStore::default();
        let id = store.start();
        let asset = SvgAssetInput {
            svg_id: "svg-1".into(),
            width: 320.0,
            height: 240.0,
            shapes: 1,
            filename: "result.svg".into(),
            markup: r#"<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>"#.into(),
        };
        assert!(store.record_svg(&id, asset.clone()).unwrap());
        assert!(!store.record_svg(&id, asset.clone()).unwrap());
        let mut updated = asset;
        updated.shapes = 2;
        updated.markup = r#"<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/><path d="M1 1"/></svg>"#.into();
        assert!(store.record_svg(&id, updated).unwrap());
        assert_eq!(store.svg("svg-1").unwrap().revision, 2);
        store.clear_surfaces();
        assert!(store.list_svgs().is_empty());
    }
}
