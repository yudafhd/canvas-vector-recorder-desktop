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
    #[serde(default = "default_artwork_scale")]
    pub artwork_scale: f64,
}

fn default_background_color() -> String {
    "#ffffff".into()
}

fn default_artwork_scale() -> f64 {
    1.0
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
            artwork_scale: default_artwork_scale(),
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
    let (ratio_width, ratio_height, ratio_name) =
        ratio_spec(source_width, source_height, &settings.ratio);
    let min = if settings.min_pixels.is_finite() && settings.min_pixels > 0.0 {
        settings.min_pixels
    } else {
        15_000_000.0
    };
    let max = if settings.max_pixels.is_finite() && settings.max_pixels > min {
        settings.max_pixels
    } else {
        65_000_000.0_f64.max(min)
    };
    let target = (source_width * source_height).clamp(min, max);
    let unit_pixels = ratio_width as f64 * ratio_height as f64;
    let raw_multiplier = (target / unit_pixels).sqrt().max(1.0);
    let max_multiplier = (u64::MAX / ratio_width.max(ratio_height)).max(1);
    let floor_multiplier = raw_multiplier.floor().clamp(1.0, max_multiplier as f64) as u64;
    let ceil_multiplier = raw_multiplier.ceil().clamp(1.0, max_multiplier as f64) as u64;
    let candidates = [floor_multiplier, ceil_multiplier];
    let distance_from_target =
        |multiplier: &u64| (area_for(*multiplier, ratio_width, ratio_height) - target).abs();
    let multiplier = candidates
        .iter()
        .copied()
        .filter(|multiplier| {
            let area = area_for(*multiplier, ratio_width, ratio_height);
            area >= min && area <= max
        })
        .min_by(|left, right| {
            let left_distance = distance_from_target(left);
            let right_distance = distance_from_target(right);
            left_distance.total_cmp(&right_distance)
        })
        .or_else(|| {
            candidates.into_iter().min_by(|left, right| {
                distance_from_target(left).total_cmp(&distance_from_target(right))
            })
        })
        .unwrap_or(1);
    let output_width = ratio_width.saturating_mul(multiplier).max(1);
    let output_height = ratio_height.saturating_mul(multiplier).max(1);
    (output_width, output_height, ratio_name)
}

fn area_for(multiplier: u64, ratio_width: u64, ratio_height: u64) -> f64 {
    ratio_width as f64 * ratio_height as f64 * (multiplier as f64).powi(2)
}

fn gcd(mut left: u64, mut right: u64) -> u64 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left.max(1)
}

fn normalized_ratio(width: u64, height: u64, name: String) -> (u64, u64, String) {
    let divisor = gcd(width, height);
    (width / divisor, height / divisor, name)
}

fn custom_ratio(value: &str) -> Option<(u64, u64)> {
    let mut parts = value.split(':');
    let width = parts.next()?.trim().parse::<u64>().ok()?;
    let height = parts.next()?.trim().parse::<u64>().ok()?;
    if parts.next().is_some() || width == 0 || height == 0 || width > 10_000 || height > 10_000 {
        return None;
    }
    Some((width, height))
}

fn ratio_spec(source_width: f64, source_height: f64, value: &str) -> (u64, u64, String) {
    match value {
        "1:1" => (1, 1, "1:1".into()),
        "4:5" => (4, 5, "4:5".into()),
        "4:3" => (4, 3, "4:3".into()),
        "3:2" => (3, 2, "3:2".into()),
        "2:3" => (2, 3, "2:3".into()),
        "16:9" => (16, 9, "16:9".into()),
        "source" => normalized_ratio(
            source_width.round().max(1.0) as u64,
            source_height.round().max(1.0) as u64,
            "source".into(),
        ),
        custom => custom_ratio(custom).map_or_else(
            || {
                normalized_ratio(
                    source_width.round().max(1.0) as u64,
                    source_height.round().max(1.0) as u64,
                    "source".into(),
                )
            },
            |(width, height)| {
                let divisor = gcd(width, height);
                (
                    width / divisor,
                    height / divisor,
                    format!("{}:{}", width / divisor, height / divisor),
                )
            },
        ),
    }
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
            artwork_scale: default_artwork_scale(),
        };
        let (width, height, ratio) = artboard(1024.0, 1024.0, &settings);
        assert_eq!(ratio, "4:3");
        assert_eq!(width as f64 / height as f64, 4.0 / 3.0);
    }

    #[test]
    fn custom_ratio_is_normalized_and_kept_exact() {
        let settings = MicrostockSettings {
            ratio: "14:10".into(),
            min_pixels: 15_000_000.0,
            max_pixels: 65_000_000.0,
            profile: Some("custom".into()),
            background_color: default_background_color(),
            transparent_background: false,
            artwork_scale: default_artwork_scale(),
        };
        let (width, height, ratio) = artboard(1024.0, 768.0, &settings);
        assert_eq!(ratio, "7:5");
        assert_eq!(width * 5, height * 7);
        assert!((15_000_000..=65_000_000).contains(&(width * height)));
    }

    #[test]
    fn artboard_does_not_overshoot_max_pixels_when_ratio_multiplier_is_rounded() {
        let settings = MicrostockSettings {
            ratio: "7:5".into(),
            min_pixels: 15_000_000.0,
            max_pixels: 65_000_000.0,
            profile: Some("custom".into()),
            background_color: default_background_color(),
            transparent_background: false,
            artwork_scale: default_artwork_scale(),
        };
        let (width, height, _) = artboard(100_000.0, 100_000.0, &settings);
        assert_eq!(width * 5, height * 7);
        assert!((15_000_000..=65_000_000).contains(&(width * height)));
    }
}
