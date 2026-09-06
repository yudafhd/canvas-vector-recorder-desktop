use super::{
    canvas::CanvasResult,
    transform::{f, Matrix},
    validator::{artboard, validate, MicrostockSettings},
};

#[derive(Debug, Clone, Copy)]
pub(crate) struct Bounds {
    pub(crate) min_x: f64,
    pub(crate) min_y: f64,
    pub(crate) max_x: f64,
    pub(crate) max_y: f64,
}

// Keep a visible breathing room around the artwork in the exported artboard.
// The user scale control can still deliberately enlarge the artwork, but the
// neutral 100% setting must not place it directly against the edge.
pub(crate) const ARTWORK_SAFE_AREA: f64 = 0.90;

impl Bounds {
    fn point(x: f64, y: f64) -> Self {
        Self {
            min_x: x,
            min_y: y,
            max_x: x,
            max_y: y,
        }
    }

    fn include(&mut self, x: f64, y: f64) {
        self.min_x = self.min_x.min(x);
        self.min_y = self.min_y.min(y);
        self.max_x = self.max_x.max(x);
        self.max_y = self.max_y.max(y);
    }

    fn merge(&mut self, other: Self) {
        self.include(other.min_x, other.min_y);
        self.include(other.max_x, other.max_y);
    }

    fn area(self) -> f64 {
        (self.max_x - self.min_x).max(0.0) * (self.max_y - self.min_y).max(0.0)
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum PathToken {
    Command(char),
    Number(f64),
}

pub(crate) fn tokenize_path(value: &str) -> Option<Vec<PathToken>> {
    let chars: Vec<char> = value.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        let ch = chars[index];
        if ch.is_ascii_whitespace() || ch == ',' {
            index += 1;
        } else if ch.is_ascii_alphabetic() {
            tokens.push(PathToken::Command(ch));
            index += 1;
        } else if ch == '+' || ch == '-' || ch == '.' || ch.is_ascii_digit() {
            let start = index;
            if chars[index] == '+' || chars[index] == '-' {
                index += 1;
            }
            while index < chars.len() && chars[index].is_ascii_digit() {
                index += 1;
            }
            if index < chars.len() && chars[index] == '.' {
                index += 1;
                while index < chars.len() && chars[index].is_ascii_digit() {
                    index += 1;
                }
            }
            if index < chars.len() && (chars[index] == 'e' || chars[index] == 'E') {
                index += 1;
                if index < chars.len() && (chars[index] == '+' || chars[index] == '-') {
                    index += 1;
                }
                let exponent_start = index;
                while index < chars.len() && chars[index].is_ascii_digit() {
                    index += 1;
                }
                if exponent_start == index {
                    return None;
                }
            }
            let number = chars[start..index]
                .iter()
                .collect::<String>()
                .parse()
                .ok()?;
            tokens.push(PathToken::Number(number));
        } else {
            return None;
        }
    }
    Some(tokens)
}

pub(crate) fn next_number(tokens: &[PathToken], index: &mut usize) -> Option<f64> {
    match tokens.get(*index) {
        Some(PathToken::Number(value)) => {
            *index += 1;
            Some(*value)
        }
        _ => None,
    }
}

fn add_point(bounds: &mut Option<Bounds>, matrix: Matrix, x: f64, y: f64) {
    let [a, b, c, d, e, f] = matrix.0;
    let transformed_x = a * x + c * y + e;
    let transformed_y = b * x + d * y + f;
    if !transformed_x.is_finite() || !transformed_y.is_finite() {
        return;
    }
    if let Some(existing) = bounds.as_mut() {
        existing.include(transformed_x, transformed_y);
    } else {
        *bounds = Some(Bounds::point(transformed_x, transformed_y));
    }
}

fn path_bounds(value: &str, matrix: Matrix) -> Option<Bounds> {
    let tokens = tokenize_path(value)?;
    let mut index = 0;
    let mut command = None;
    let mut current = (0.0, 0.0);
    let mut start = (0.0, 0.0);
    let mut bounds = None;
    while index < tokens.len() {
        if let Some(PathToken::Command(next)) = tokens.get(index).copied() {
            command = Some(next);
            index += 1;
        }
        let Some(active) = command else { return None };
        let relative = active.is_ascii_lowercase();
        let kind = active.to_ascii_uppercase();
        match kind {
            'M' | 'L' | 'T' => {
                let x = next_number(&tokens, &mut index)?;
                let y = next_number(&tokens, &mut index)?;
                let point = if relative {
                    (current.0 + x, current.1 + y)
                } else {
                    (x, y)
                };
                current = point;
                if kind == 'M' {
                    start = point;
                    command = Some(if relative { 'l' } else { 'L' });
                }
                add_point(&mut bounds, matrix, point.0, point.1);
            }
            'H' => {
                let x = next_number(&tokens, &mut index)?;
                current.0 = if relative { current.0 + x } else { x };
                add_point(&mut bounds, matrix, current.0, current.1);
            }
            'V' => {
                let y = next_number(&tokens, &mut index)?;
                current.1 = if relative { current.1 + y } else { y };
                add_point(&mut bounds, matrix, current.0, current.1);
            }
            'C' => {
                for point_index in 0..3 {
                    let x = next_number(&tokens, &mut index)?;
                    let y = next_number(&tokens, &mut index)?;
                    let point = if relative {
                        (current.0 + x, current.1 + y)
                    } else {
                        (x, y)
                    };
                    add_point(&mut bounds, matrix, point.0, point.1);
                    if point_index == 2 {
                        current = point;
                    }
                }
            }
            'S' | 'Q' => {
                for point_index in 0..2 {
                    let x = next_number(&tokens, &mut index)?;
                    let y = next_number(&tokens, &mut index)?;
                    let point = if relative {
                        (current.0 + x, current.1 + y)
                    } else {
                        (x, y)
                    };
                    add_point(&mut bounds, matrix, point.0, point.1);
                    if point_index == 1 {
                        current = point;
                    }
                }
            }
            'A' => {
                let _rx = next_number(&tokens, &mut index)?;
                let _ry = next_number(&tokens, &mut index)?;
                let _rotation = next_number(&tokens, &mut index)?;
                let _large_arc = next_number(&tokens, &mut index)?;
                let _sweep = next_number(&tokens, &mut index)?;
                let x = next_number(&tokens, &mut index)?;
                let y = next_number(&tokens, &mut index)?;
                current = if relative {
                    (current.0 + x, current.1 + y)
                } else {
                    (x, y)
                };
                add_point(&mut bounds, matrix, current.0, current.1);
            }
            'Z' => {
                current = start;
                command = None;
            }
            _ => return None,
        }
    }
    bounds
}

fn is_white_fill(value: &str) -> bool {
    let normalized = value
        .trim()
        .to_ascii_lowercase()
        .replace(' ', "")
        .replace('\t', "");
    matches!(
        normalized.as_str(),
        "white" | "#fff" | "#ffffff" | "rgb(255,255,255)" | "rgba(255,255,255,1)"
    )
}

fn is_axis_aligned_rectangle(value: &str) -> bool {
    let Some(tokens) = tokenize_path(value) else {
        return false;
    };
    let mut has_move = false;
    let mut has_close = false;
    let mut segments = 0;
    for token in tokens {
        let PathToken::Command(command) = token else {
            continue;
        };
        match command.to_ascii_uppercase() {
            'M' => has_move = true,
            'H' | 'V' | 'L' => segments += 1,
            'Z' => has_close = true,
            'C' | 'S' | 'Q' | 'T' | 'A' => return false,
            _ => return false,
        }
    }
    has_move && has_close && segments >= 3
}

pub(crate) fn artwork_bounds(data: &CanvasResult, excluded_shape: Option<usize>) -> Option<Bounds> {
    let shape_bounds = data
        .shapes
        .iter()
        .enumerate()
        .filter(|(index, _)| Some(*index) != excluded_shape)
        .map(|(_, shape)| shape)
        .filter_map(|shape| path_bounds(&shape.d, shape.transform))
        .reduce(|mut bounds, next| {
            bounds.merge(next);
            bounds
        });
    if shape_bounds.is_some() {
        return shape_bounds;
    }
    data.gap_fillers
        .iter()
        .filter(|stroke| stroke.clip_path.is_none())
        .filter_map(|stroke| path_bounds(&stroke.d, stroke.transform))
        .reduce(|mut bounds, next| {
            bounds.merge(next);
            bounds
        })
}

pub(crate) fn background_shape_index(data: &CanvasResult) -> Option<usize> {
    let overall = artwork_bounds(data, None)?;
    let candidate = data
        .shapes
        .iter()
        .enumerate()
        .filter(|(_, shape)| is_white_fill(&shape.fill) && is_axis_aligned_rectangle(&shape.d))
        .filter_map(|(index, shape)| {
            path_bounds(&shape.d, shape.transform).map(|bounds| (index, bounds))
        })
        .max_by(|(_, left), (_, right)| left.area().total_cmp(&right.area()))?;
    (candidate.1.area() >= overall.area() * 0.75).then_some(candidate.0)
}

pub fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn build(data: &CanvasResult, settings: &MicrostockSettings) -> (String, (u64, u64, String)) {
    let (width, height, ratio) = artboard(data.width, data.height, settings);
    let background_index = background_shape_index(data);
    // Keep the original canvas coordinate system. Gap-filler strokes can
    // extend beyond the artwork (and are clipped in the source canvas); using
    // their bounds here would make the entire preview appear tiny or shifted.
    let source_width = data.width.max(1.0);
    let source_height = data.height.max(1.0);
    let base_scale = ((width as f64 * ARTWORK_SAFE_AREA) / source_width)
        .min((height as f64 * ARTWORK_SAFE_AREA) / source_height);
    let artwork_scale = if settings.artwork_scale.is_finite() {
        settings.artwork_scale.clamp(0.5, 3.0)
    } else {
        1.0
    };
    let scale = base_scale * artwork_scale;
    let (ox, oy) = artwork_bounds(data, background_index)
        .map(|bounds| {
            (
                width as f64 / 2.0 - ((bounds.min_x + bounds.max_x) / 2.0) * scale,
                height as f64 / 2.0 - ((bounds.min_y + bounds.max_y) / 2.0) * scale,
            )
        })
        .unwrap_or((
            (width as f64 - source_width * scale) / 2.0,
            (height as f64 - source_height * scale) / 2.0,
        ));
    let background_layer = if settings.transparent_background {
        String::new()
    } else {
        let color = if settings.background_color.trim().is_empty() {
            "#ffffff"
        } else {
            settings.background_color.trim()
        };
        format!(
            "  <g id=\"background\" aria-label=\"Background\">\n    <rect id=\"background-color\" width=\"{}\" height=\"{}\" fill=\"{}\"/>\n  </g>\n",
            width,
            height,
            escape_xml(color)
        )
    };
    let render_shape = |i: usize, shape: &super::canvas::Shape| {
        format!(
            "    <path id=\"shape-{}\" d=\"{}\" fill=\"{}\" fill-rule=\"{}\" transform=\"{}\"/>",
            i + 1,
            escape_xml(&shape.d),
            escape_xml(&shape.fill),
            escape_xml(&shape.fill_rule),
            shape.transform.svg()
        )
    };
    let render_stroke = |i: usize, stroke: &super::canvas::Stroke| {
        format!(
            "    <path id=\"gap-filler-{}\" d=\"{}\" fill=\"none\" stroke=\"{}\" stroke-width=\"{}\" transform=\"{}\"/>",
            i + 1,
            escape_xml(&stroke.d),
            escape_xml(&stroke.stroke),
            f(stroke.width),
            stroke.transform.svg()
        )
    };
    let paint_order = if data.operations.is_empty() {
        data.shapes
            .iter()
            .enumerate()
            .filter(|(index, _)| Some(*index) != background_index)
            .map(|(i, shape)| render_shape(i, shape))
            .chain(
                data.gap_fillers
                    .iter()
                    .enumerate()
                    .map(|(i, stroke)| render_stroke(i, stroke)),
            )
            .collect::<Vec<_>>()
    } else {
        data.operations
            .iter()
            .filter_map(|operation| match operation {
                super::canvas::PaintOperation::Shape(index) if Some(*index) != background_index => {
                    data.shapes
                        .get(*index)
                        .map(|shape| render_shape(*index, shape))
                }
                super::canvas::PaintOperation::Stroke(index) => data
                    .gap_fillers
                    .get(*index)
                    .map(|stroke| render_stroke(*index, stroke)),
                _ => None,
            })
            .collect::<Vec<_>>()
    }
    .join("\n");
    let svg = format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\" color-interpolation=\"sRGB\">\n  <title>Editable vector artwork</title>\n{}  <g id=\"artwork-transform\" aria-label=\"Artwork transform\" transform=\"translate({} {}) scale({})\">\n    <g id=\"artwork\" aria-label=\"Artwork\">\n{}\n    </g>\n  </g>\n</svg>", width, height, width, height, background_layer, f(ox), f(oy), f(scale), paint_order);
    (svg, (width, height, ratio))
}

pub fn result(data: &CanvasResult, settings: &MicrostockSettings) -> serde_json::Value {
    let (svg, (width, height, ratio)) = build(data, settings);
    let validation = validate(data);
    serde_json::json!({ "svg": svg, "filename": "vectorized-result.svg", "stats": { "shapes": data.shapes.len(), "gap_fillers": data.gap_fillers.len(), "errors": data.errors, "artboard": { "width": width, "height": height, "pixels": width * height, "ratio": ratio }, "stock_validation": validation }, "error": if validation.valid { serde_json::Value::Null } else { serde_json::Value::String("Peringatan: SVG belum memenuhi pemeriksaan microstock.".into()) } })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn xml_is_escaped() {
        assert_eq!(escape_xml("<&\"'>"), "&lt;&amp;&quot;&apos;&gt;");
    }
    #[test]
    fn generated_svg_has_namespace_and_artboard() {
        let data = CanvasResult {
            canvas_id: "c".into(),
            width: 100.0,
            height: 50.0,
            shapes: vec![],
            gap_fillers: vec![],
            errors: 0,
            operations: vec![],
        };
        let (svg, _) = build(&data, &MicrostockSettings::default());
        assert!(svg.contains("xmlns=\"http://www.w3.org/2000/svg\""));
        assert!(svg.contains("viewBox=\"0 0"));
        assert!(svg.contains("<g id=\"background\""));
        assert!(svg.contains("<rect id=\"background-color\" width=\""));
        assert!(svg.contains("fill=\"#ffffff\""));
        assert!(svg.contains("<g id=\"artwork\""));
    }

    #[test]
    fn transparent_background_omits_background_layer() {
        let data = CanvasResult {
            canvas_id: "c".into(),
            width: 100.0,
            height: 50.0,
            shapes: vec![],
            gap_fillers: vec![],
            errors: 0,
            operations: vec![],
        };
        let settings = MicrostockSettings {
            transparent_background: true,
            ..Default::default()
        };
        let (svg, _) = build(&data, &settings);
        assert!(!svg.contains("id=\"background-color\""));
    }

    #[test]
    fn generated_artwork_is_scaled_from_the_source_canvas() {
        let data = CanvasResult {
            canvas_id: "c".into(),
            width: 100.0,
            height: 100.0,
            shapes: vec![super::super::canvas::Shape {
                d: "M 0 0 h 20 v 20 h -20 Z".into(),
                fill: "#000".into(),
                fill_rule: "nonzero".into(),
                transform: Matrix::default(),
                clip_path: None,
            }],
            gap_fillers: vec![],
            errors: 0,
            operations: vec![],
        };
        let (svg, _) = build(&data, &MicrostockSettings::default());
        assert!(svg.contains("translate(1587.93 1587.93) scale(34.857)"));
    }

    #[test]
    fn artwork_scale_multiplies_the_centered_source_scale() {
        let data = CanvasResult {
            canvas_id: "c".into(),
            width: 100.0,
            height: 100.0,
            shapes: vec![],
            gap_fillers: vec![],
            errors: 0,
            operations: vec![],
        };
        let settings = MicrostockSettings {
            artwork_scale: 2.0,
            ..Default::default()
        };
        let (svg, _) = build(&data, &settings);
        assert!(svg.contains("translate(-1549.2 -1549.2) scale(69.714)"));
    }

    #[test]
    fn generated_svg_keeps_canvas_paint_order() {
        let data = CanvasResult {
            canvas_id: "c".into(),
            width: 100.0,
            height: 100.0,
            shapes: vec![super::super::canvas::Shape {
                d: "M 0 0 h 20 v 20 h -20 Z".into(),
                fill: "#f00".into(),
                fill_rule: "nonzero".into(),
                transform: Matrix::default(),
                clip_path: None,
            }],
            gap_fillers: vec![super::super::canvas::Stroke {
                d: "M 0 0 h 20 v 20 h -20 Z".into(),
                stroke: "#000".into(),
                width: 1.0,
                transform: Matrix::default(),
                clip_path: None,
            }],
            errors: 0,
            operations: vec![
                super::super::canvas::PaintOperation::Stroke(0),
                super::super::canvas::PaintOperation::Shape(0),
            ],
        };
        let (svg, _) = build(&data, &MicrostockSettings::default());
        let stroke_position = svg.find("id=\"gap-filler-1\"").unwrap();
        let shape_position = svg.find("id=\"shape-1\"").unwrap();
        assert!(stroke_position < shape_position);
    }

    #[test]
    fn generated_svg_does_not_reintroduce_canvas_clips() {
        let data = CanvasResult {
            canvas_id: "c".into(),
            width: 100.0,
            height: 100.0,
            shapes: vec![],
            gap_fillers: vec![super::super::canvas::Stroke {
                d: "M -20 50 L 120 50".into(),
                stroke: "#000".into(),
                width: 1.0,
                transform: Matrix::default(),
                clip_path: Some(super::super::canvas::ClipPath {
                    d: "M 0 0 h 100 v 100 h -100 Z".into(),
                    transform: Matrix::default(),
                }),
            }],
            errors: 0,
            operations: vec![super::super::canvas::PaintOperation::Stroke(0)],
        };
        let (svg, _) = build(&data, &MicrostockSettings::default());
        assert!(svg.contains("id=\"gap-filler-1\""));
        assert!(!svg.contains("<clipPath"));
        assert!(!svg.contains("clip-path="));
    }

    #[test]
    fn clipped_strokes_do_not_expand_artwork_bounds() {
        let data = CanvasResult {
            canvas_id: "c".into(),
            width: 100.0,
            height: 100.0,
            shapes: vec![super::super::canvas::Shape {
                d: "M 0 0 h 20 v 20 h -20 Z".into(),
                fill: "#f00".into(),
                fill_rule: "nonzero".into(),
                transform: Matrix::default(),
                clip_path: None,
            }],
            gap_fillers: vec![super::super::canvas::Stroke {
                d: "M -1000 -1000 L 1000 1000".into(),
                stroke: "#000".into(),
                width: 1.0,
                transform: Matrix::default(),
                clip_path: Some(super::super::canvas::ClipPath {
                    d: "M 0 0 h 100 v 100 h -100 Z".into(),
                    transform: Matrix::default(),
                }),
            }],
            errors: 0,
            operations: vec![
                super::super::canvas::PaintOperation::Shape(0),
                super::super::canvas::PaintOperation::Stroke(0),
            ],
        };
        let (svg, _) = build(&data, &MicrostockSettings::default());
        assert!(svg.contains("translate(1587.93 1587.93) scale(34.857)"));
        assert!(!svg.contains("clip-path="));
    }
}
