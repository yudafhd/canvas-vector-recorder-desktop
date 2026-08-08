use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecorderEvent {
    pub session_id: String,
    pub frame_id: Option<String>,
    pub canvas_id: Option<String>,
    pub sequence: u64,
    #[serde(rename = "type")]
    pub event_type: String,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub path_id: Option<String>,
    pub command: Option<PathCommand>,
    pub args: Option<Vec<f64>>,
    pub transform: Option<[f64; 6]>,
    pub fill_style: Option<String>,
    pub stroke_style: Option<String>,
    pub line_width: Option<f64>,
    pub fill_rule: Option<String>,
    pub value: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathCommand {
    #[serde(rename = "type")]
    pub command_type: String,
    #[serde(default)]
    pub args: Vec<f64>,
}

impl RecorderEvent {
    pub fn canvas_key(&self) -> &str {
        self.canvas_id.as_deref().unwrap_or("canvas-unknown")
    }
}
