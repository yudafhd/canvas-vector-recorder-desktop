use super::{events::RecorderEvent, path::PathData, transform::Matrix};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shape {
    pub d: String,
    pub fill: String,
    pub fill_rule: String,
    pub transform: Matrix,
    pub clip_path: Option<ClipPath>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipPath {
    pub d: String,
    pub transform: Matrix,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stroke {
    pub d: String,
    pub stroke: String,
    pub width: f64,
    pub transform: Matrix,
    pub clip_path: Option<ClipPath>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PaintOperation {
    Shape(usize),
    Stroke(usize),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanvasResult {
    pub canvas_id: String,
    pub width: f64,
    pub height: f64,
    pub shapes: Vec<Shape>,
    pub gap_fillers: Vec<Stroke>,
    pub errors: u64,
    pub operations: Vec<PaintOperation>,
}

const MAX_CANVAS_SHAPES: usize = 5_000;

#[derive(Debug, Clone, Default)]
pub struct CanvasState {
    pub canvas_id: String,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
    pub paths: HashMap<String, PathData>,
    pub shapes: Vec<Shape>,
    pub gap_fillers: Vec<Stroke>,
    pub errors: u64,
    pub operations: Vec<PaintOperation>,
    pub current_clip: Option<(String, Matrix)>,
    /// `clip()` is part of the drawing state and is restored by `restore()`.
    /// Keep a snapshot for every `save()` so a temporary clip cannot leak into
    /// the rest of the canvas and crop later paint operations.
    pub clip_stack: Vec<Option<(String, Matrix)>>,
    pub revision: usize,
}

impl CanvasState {
    pub fn new(id: &str, width: f64, height: f64) -> Self {
        Self {
            canvas_id: id.into(),
            width: width.max(1.0),
            height: height.max(1.0),
            visible: true,
            ..Default::default()
        }
    }
    pub fn apply(&mut self, event: &RecorderEvent) {
        self.revision += 1;
        if let Some(width) = event.width {
            self.width = width.max(1.0);
        }
        if let Some(height) = event.height {
            self.height = height.max(1.0);
        }
        match event.event_type.as_str() {
            "canvas_visibility" => {
                if let Some(visible) = event.value.as_ref().and_then(|value| value.as_bool()) {
                    self.visible = visible;
                }
            }
            "path_created" => {
                if let Some(id) = &event.path_id {
                    self.paths.entry(id.clone()).or_default();
                }
            }
            "path_command" => {
                if let (Some(id), Some(command)) = (&event.path_id, &event.command) {
                    let path = self.paths.entry(id.clone()).or_default();
                    if path.command(&command.command_type, &command.args).is_err() {
                        self.errors += 1;
                    }
                } else {
                    self.errors += 1;
                }
            }
            "save" => {
                self.clip_stack.push(self.current_clip.clone());
            }
            "restore" => {
                // CanvasRenderingContext2D.restore() is a no-op when the
                // state stack is empty.
                if let Some(previous_clip) = self.clip_stack.pop() {
                    self.current_clip = previous_clip;
                }
            }
            "draw_image" | "context_created" | "set_transform" | "reset_transform"
            | "set_fill_style" | "set_stroke_style" | "set_line_width" | "clear_rect" => {}
            "clip" => {
                if let Some(id) = &event.path_id {
                    self.current_clip = Some((id.clone(), Matrix::from_slice(event.transform)));
                } else {
                    self.errors += 1;
                }
            }
            "fill" => {
                if self.shapes.len() < MAX_CANVAS_SHAPES {
                    if let Some(shape) = self.shape_from_event(event, true) {
                        let index = self.shapes.len();
                        self.shapes.push(shape);
                        self.operations.push(PaintOperation::Shape(index));
                    } else {
                        self.errors += 1;
                    }
                }
            }
            "stroke" => {
                if self.gap_fillers.len() < MAX_CANVAS_SHAPES {
                    if let Some(path) = event.path_id.as_ref().and_then(|id| self.paths.get(id)) {
                        if !path.d.is_empty() {
                            let index = self.gap_fillers.len();
                            self.gap_fillers.push(Stroke {
                                d: path.d.clone(),
                                stroke: event.stroke_style.clone().unwrap_or_else(|| "#000".into()),
                                width: event.line_width.unwrap_or(1.0),
                                transform: Matrix::from_slice(event.transform),
                                clip_path: self.current_clip_path(),
                            });
                            self.operations.push(PaintOperation::Stroke(index));
                        } else {
                            self.errors += 1;
                        }
                    } else {
                        self.errors += 1;
                    }
                }
            }
            "fill_rect" => {
                if self.shapes.len() < MAX_CANVAS_SHAPES {
                    if let Some(rect) = rect_shape(event, self.current_clip_path()) {
                        let index = self.shapes.len();
                        self.shapes.push(rect);
                        self.operations.push(PaintOperation::Shape(index));
                    } else {
                        self.errors += 1;
                    }
                }
            }
            "stroke_rect" => {
                if self.gap_fillers.len() < MAX_CANVAS_SHAPES {
                    if let Some(rect) = rect_stroke(event, self.current_clip_path()) {
                        let index = self.gap_fillers.len();
                        self.gap_fillers.push(rect);
                        self.operations.push(PaintOperation::Stroke(index));
                    } else {
                        self.errors += 1;
                    }
                }
            }
            _ => {}
        }
    }
    fn shape_from_event(&self, event: &RecorderEvent, fill: bool) -> Option<Shape> {
        let id = event.path_id.as_ref()?;
        let path = self.paths.get(id)?;
        if path.d.is_empty() {
            return None;
        }
        Some(Shape {
            d: if fill {
                path.closed_for_fill()
            } else {
                path.d.clone()
            },
            fill: event.fill_style.clone().unwrap_or_else(|| "#000".into()),
            fill_rule: event.fill_rule.clone().unwrap_or_else(|| "nonzero".into()),
            transform: Matrix::from_slice(event.transform),
            clip_path: self.current_clip_path(),
        })
    }
    fn current_clip_path(&self) -> Option<ClipPath> {
        self.current_clip.as_ref().and_then(|(clip_id, transform)| {
            self.paths.get(clip_id).map(|clip| ClipPath {
                d: clip.closed_for_fill(),
                transform: *transform,
            })
        })
    }
    pub fn result(&self) -> CanvasResult {
        CanvasResult {
            canvas_id: self.canvas_id.clone(),
            width: self.width,
            height: self.height,
            shapes: self.shapes.clone(),
            gap_fillers: self.gap_fillers.clone(),
            errors: self.errors,
            operations: self.operations.clone(),
        }
    }
}

fn rect_shape(event: &RecorderEvent, clip_path: Option<ClipPath>) -> Option<Shape> {
    let a = event.args.as_ref()?;
    if a.len() < 4 {
        return None;
    }
    Some(Shape {
        d: format!(
            "M {} {} h {} v {} h {} Z",
            super::transform::f(a[0]),
            super::transform::f(a[1]),
            super::transform::f(a[2]),
            super::transform::f(a[3]),
            super::transform::f(-a[2])
        ),
        fill: event.fill_style.clone().unwrap_or_else(|| "#000".into()),
        fill_rule: "nonzero".into(),
        transform: Matrix::from_slice(event.transform),
        clip_path,
    })
}
fn rect_stroke(event: &RecorderEvent, clip_path: Option<ClipPath>) -> Option<Stroke> {
    let a = event.args.as_ref()?;
    if a.len() < 4 {
        return None;
    }
    Some(Stroke {
        d: format!(
            "M {} {} h {} v {} h {} Z",
            super::transform::f(a[0]),
            super::transform::f(a[1]),
            super::transform::f(a[2]),
            super::transform::f(a[3]),
            super::transform::f(-a[2])
        ),
        stroke: event.stroke_style.clone().unwrap_or_else(|| "#000".into()),
        width: event.line_width.unwrap_or(1.0),
        transform: Matrix::from_slice(event.transform),
        clip_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(event_type: &str) -> RecorderEvent {
        RecorderEvent {
            session_id: "session".into(),
            frame_id: None,
            canvas_id: Some("canvas".into()),
            sequence: 1,
            event_type: event_type.into(),
            width: None,
            height: None,
            path_id: None,
            command: None,
            args: None,
            transform: None,
            fill_style: Some("#000".into()),
            stroke_style: Some("#000".into()),
            line_width: Some(1.0),
            fill_rule: Some("nonzero".into()),
            value: None,
        }
    }

    fn path_event(event_type: &str, path_id: &str) -> RecorderEvent {
        let mut event = event(event_type);
        event.path_id = Some(path_id.into());
        event
    }

    #[test]
    fn temporary_clip_is_restored_after_save_restore() {
        let mut canvas = CanvasState::new("canvas", 100.0, 100.0);

        canvas.apply(&path_event("path_created", "path"));
        let mut command = path_event("path_command", "path");
        command.command = Some(super::super::events::PathCommand {
            command_type: "rect".into(),
            args: vec![0.0, 0.0, 10.0, 10.0],
        });
        canvas.apply(&command);

        canvas.apply(&event("save"));
        canvas.apply(&path_event("clip", "path"));
        let mut clipped = event("fill_rect");
        clipped.args = Some(vec![0.0, 0.0, 10.0, 10.0]);
        canvas.apply(&clipped);
        canvas.apply(&event("restore"));
        let mut un_clipped = event("fill_rect");
        un_clipped.args = Some(vec![0.0, 0.0, 20.0, 20.0]);
        canvas.apply(&un_clipped);

        assert!(canvas.shapes[0].clip_path.is_some());
        assert!(canvas.shapes[1].clip_path.is_none());
    }
}
