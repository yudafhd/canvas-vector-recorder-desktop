use super::{events::RecorderEvent, path::PathData, transform::Matrix};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shape {
    pub d: String,
    pub fill: String,
    pub fill_rule: String,
    pub transform: Matrix,
    pub clip_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stroke {
    pub d: String,
    pub stroke: String,
    pub width: f64,
    pub transform: Matrix,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanvasResult {
    pub canvas_id: String,
    pub asset_type: String,
    pub width: f64,
    pub height: f64,
    pub shapes: Vec<Shape>,
    pub gap_fillers: Vec<Stroke>,
    pub errors: u64,
    pub operations: Vec<String>,
    pub raw_svg: Option<String>,
    pub filename: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct CanvasState {
    pub canvas_id: String,
    pub asset_type: String,
    pub width: f64,
    pub height: f64,
    pub paths: HashMap<String, PathData>,
    pub shapes: Vec<Shape>,
    pub gap_fillers: Vec<Stroke>,
    pub errors: u64,
    pub current_clip: Option<String>,
    pub operations: Vec<String>,
    pub raw_svg: Option<String>,
    pub filename: Option<String>,
}

impl CanvasState {
    pub fn new(id: &str, width: f64, height: f64) -> Self {
        Self {
            canvas_id: id.into(),
            asset_type: "canvas".into(),
            width: width.max(1.0),
            height: height.max(1.0),
            ..Default::default()
        }
    }
    pub fn apply(&mut self, event: &RecorderEvent) {
        self.operations.push(event.event_type.clone());
        if let Some(width) = event.width {
            self.width = width.max(1.0);
        }
        if let Some(height) = event.height {
            self.height = height.max(1.0);
        }
        match event.event_type.as_str() {
            "svg_detected" => {
                self.asset_type = "svg".into();
                self.raw_svg = event.svg.clone();
                self.filename = event.filename.clone();
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
            "draw_image" | "context_created" | "save" | "restore" | "set_transform"
            | "reset_transform" | "set_fill_style" | "set_stroke_style" | "set_line_width"
            | "clear_rect" => {}
            "clip" => {
                if let Some(id) = &event.path_id {
                    self.current_clip = Some(id.clone());
                } else {
                    self.errors += 1;
                }
            }
            "fill" => {
                if let Some(shape) = self.shape_from_event(event, true) {
                    self.shapes.push(shape);
                } else {
                    self.errors += 1;
                }
            }
            "stroke" => {
                if let Some(path) = event.path_id.as_ref().and_then(|id| self.paths.get(id)) {
                    if !path.d.is_empty() {
                        self.gap_fillers.push(Stroke {
                            d: path.d.clone(),
                            stroke: event.stroke_style.clone().unwrap_or_else(|| "#000".into()),
                            width: event.line_width.unwrap_or(1.0),
                            transform: Matrix::from_slice(event.transform),
                        });
                    } else {
                        self.errors += 1;
                    }
                } else {
                    self.errors += 1;
                }
            }
            "fill_rect" => {
                if let Some(rect) = rect_shape(event, true) {
                    self.shapes.push(rect);
                } else {
                    self.errors += 1;
                }
            }
            "stroke_rect" => {
                if let Some(rect) = rect_stroke(event) {
                    self.gap_fillers.push(rect);
                } else {
                    self.errors += 1;
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
            clip_path: self
                .current_clip
                .as_ref()
                .and_then(|clip_id| self.paths.get(clip_id))
                .map(|clip| clip.closed_for_fill()),
        })
    }
    pub fn result(&self) -> CanvasResult {
        CanvasResult {
            canvas_id: self.canvas_id.clone(),
            asset_type: self.asset_type.clone(),
            width: self.width,
            height: self.height,
            shapes: self.shapes.clone(),
            gap_fillers: self.gap_fillers.clone(),
            errors: self.errors,
            operations: self.operations.clone(),
            raw_svg: self.raw_svg.clone(),
            filename: self.filename.clone(),
        }
    }
}

fn rect_shape(event: &RecorderEvent, _fill: bool) -> Option<Shape> {
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
        clip_path: None,
    })
}
fn rect_stroke(event: &RecorderEvent) -> Option<Stroke> {
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
    })
}
