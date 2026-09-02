use super::{transform::f, validator::{artboard, MicrostockSettings}};
use serde::{Deserialize, Serialize};

pub const MAX_SVG_BYTES: usize = 2_000_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgAssetInput {
    pub svg_id: String,
    pub width: f64,
    pub height: f64,
    pub shapes: usize,
    pub filename: String,
    pub markup: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SvgAsset {
    pub svg_id: String,
    pub width: f64,
    pub height: f64,
    pub shapes: usize,
    pub filename: String,
    pub markup: String,
    pub revision: usize,
}

impl SvgAssetInput {
    pub fn validate(self) -> Result<Self, &'static str> {
        if self.svg_id.is_empty() || self.svg_id.len() > 256 || self.filename.len() > 255 {
            return Err("invalid SVG id");
        }
        if !self.width.is_finite() || !self.height.is_finite() || self.width <= 0.0 || self.height <= 0.0 {
            return Err("invalid SVG dimensions");
        }
        if self.shapes > 100_000 || self.markup.len() > MAX_SVG_BYTES || !self.markup.trim_start().starts_with("<svg") {
            return Err("invalid SVG payload");
        }
        Ok(self)
    }
}

pub fn build_for_export(asset: &SvgAsset, settings: &MicrostockSettings) -> (String, (u64, u64, String)) {
    const ARTWORK_SAFE_AREA: f64 = 0.90;
    let (width, height, ratio) = artboard(asset.width, asset.height, settings);
    let artwork_scale = if settings.artwork_scale.is_finite() {
        settings.artwork_scale.clamp(0.5, 3.0)
    } else {
        1.0
    };
    let scale = ((width as f64 * ARTWORK_SAFE_AREA) / asset.width)
        .min((height as f64 * ARTWORK_SAFE_AREA) / asset.height)
        * artwork_scale;
    let offset_x = (width as f64 - asset.width * scale) / 2.0;
    let offset_y = (height as f64 - asset.height * scale) / 2.0;
    let background = if settings.transparent_background {
        String::new()
    } else {
        let color = if settings.background_color.trim().is_empty() { "#ffffff" } else { settings.background_color.trim() };
        format!("  <rect id=\"background-color\" width=\"{width}\" height=\"{height}\" fill=\"{}\"/>\n", super::svg::escape_xml(color))
    };
    let svg = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {width} {height}\" color-interpolation=\"sRGB\">\n  <title>Imported SVG artwork</title>\n{background}  <g id=\"artwork-transform\" aria-label=\"Artwork transform\" transform=\"translate({} {}) scale({})\">\n{}\n  </g>\n</svg>",
        f(offset_x), f(offset_y), f(scale), asset.markup.trim()
    );
    (svg, (width, height, ratio))
}

pub fn result(asset: &SvgAsset, settings: &MicrostockSettings) -> serde_json::Value {
    let (svg, (width, height, ratio)) = build_for_export(asset, settings);
    serde_json::json!({
        "svg": svg,
        "filename": asset.filename,
        "stats": {
            "shapes": asset.shapes,
            "gap_fillers": 0,
            "errors": 0,
            "artboard": { "width": width, "height": height, "pixels": width * height, "ratio": ratio },
            "stock_validation": { "valid": true, "unsupported_fills": 0, "unsupported_strokes": 0, "has_strokes": false }
        },
        "error": serde_json::Value::Null
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exported_svg_uses_artboard_background_and_scale_settings() {
        let asset = SvgAsset { svg_id: "s".into(), width: 100.0, height: 50.0, shapes: 1, filename: "source.svg".into(), markup: "<svg><path d=\"M0 0\"/></svg>".into(), revision: 1 };
        let settings = MicrostockSettings { ratio: "1:1".into(), min_pixels: 10_000.0, max_pixels: 10_000.0, background_color: "#123456".into(), transparent_background: false, artwork_scale: 2.0, ..Default::default() };
        let (svg, (width, height, ratio)) = build_for_export(&asset, &settings);
        assert_eq!((width, height, ratio.as_str()), (100, 100, "1:1"));
        assert!(svg.contains("fill=\"#123456\""));
        assert!(svg.contains("scale(1.8)"));
    }
}
