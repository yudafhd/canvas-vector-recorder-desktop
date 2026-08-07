use super::canvas::CanvasResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrostockSettings {
    pub profile: Option<String>,
    pub min_pixels: f64,
    pub max_pixels: f64,
    pub ratio: String,
    #[serde(default = "default_background_color")]
    pub background_color: String,
    #[serde(default)]
    pub transparent_background: bool,
}

fn default_background_color() -> String {
    "#ffffff".into()
}

impl Default for MicrostockSettings {
    fn default() -> Self {
        Self {
            profile: Some("adobe-stock".into()),
            min_pixels: 15_000_000.0,
            max_pixels: 65_000_000.0,
            ratio: "source".into(),
            background_color: default_background_color(),
            transparent_background: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockValidation {
    pub valid: bool,
    pub unsupported_fills: usize,
    pub unsupported_strokes: usize,
    pub has_strokes: bool,
}

pub fn portable_paint(value: &str) -> bool {
    let p = value.trim();
    !p.is_empty() && !p.contains("[object Canvas") && !p.to_ascii_lowercase().contains("url(")
}
pub fn validate(data: &CanvasResult) -> StockValidation {
    let unsupported_fills = data
        .shapes
        .iter()
        .filter(|shape| !portable_paint(&shape.fill))
        .count();
    let unsupported_strokes = data
        .gap_fillers
        .iter()
        .filter(|stroke| {
            !portable_paint(&stroke.stroke) || stroke.width <= 0.0 || !stroke.width.is_finite()
        })
        .count();
    StockValidation {
        valid: !data.shapes.is_empty()
            && data.errors == 0
            && unsupported_fills == 0
            && unsupported_strokes == 0,
        unsupported_fills,
        unsupported_strokes,
        has_strokes: !data.gap_fillers.is_empty(),
    }
}

pub fn artboard(width: f64, height: f64, settings: &MicrostockSettings) -> (u64, u64, String) {
    let source_width = width.max(1.0);
    let source_height = height.max(1.0);
    let (ratio, ratio_name) = match settings.ratio.as_str() {
        "1:1" => (1.0, "1:1"),
        "4:5" => (0.8, "4:5"),
        "4:3" => (4.0 / 3.0, "4:3"),
        "3:2" => (1.5, "3:2"),
        "2:3" => (2.0 / 3.0, "2:3"),
        "16:9" => (16.0 / 9.0, "16:9"),
        _ => (source_width / source_height, "source"),
    };
    let min = if settings.min_pixels.is_finite() && settings.min_pixels > 0.0 {
        settings.min_pixels
    } else {
        15_000_000.0
    };
    let max = if settings.max_pixels > min {
        settings.max_pixels
    } else {
        65_000_000.0
    };
    let target = (source_width * source_height).clamp(min, (max - 1.0).max(min));
    let h = (target / ratio).sqrt();
    let output_width = ((h * ratio).ceil() as u64).max(1);
    let output_height = (h.ceil() as u64).max(1);
    (output_width, output_height, ratio_name.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn four_by_three_artboard_uses_requested_ratio() {
        let settings = MicrostockSettings {
            ratio: "4:3".into(),
            min_pixels: 12_000_000.0,
            max_pixels: 65_000_000.0,
            profile: Some("custom".into()),
            background_color: default_background_color(),
            transparent_background: false,
        };
        let (width, height, ratio) = artboard(1024.0, 1024.0, &settings);
        assert_eq!(ratio, "4:3");
        assert_eq!(width as f64 / height as f64, 4.0 / 3.0);
    }
}
