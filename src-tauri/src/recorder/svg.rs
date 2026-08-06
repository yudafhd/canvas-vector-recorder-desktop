use super::{
    canvas::CanvasResult,
    transform::{f, Matrix},
    validator::{artboard, validate, MicrostockSettings},
};

#[derive(Debug, Clone, Copy)]
struct Bounds {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

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

    fn center(self) -> (f64, f64) {
        (
            (self.min_x + self.max_x) / 2.0,
            (self.min_y + self.max_y) / 2.0,
        )
    }

    fn area(self) -> f64 {
        (self.max_x - self.min_x).max(0.0) * (self.max_y - self.min_y).max(0.0)
    }
}

#[derive(Debug, Clone, Copy)]
enum PathToken {
    Command(char),
    Number(f64),
}

fn tokenize_path(value: &str) -> Option<Vec<PathToken>> {
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

fn next_number(tokens: &[PathToken], index: &mut usize) -> Option<f64> {
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

fn artwork_bounds(data: &CanvasResult, excluded_shape: Option<usize>) -> Option<Bounds> {
    data.shapes
        .iter()
        .enumerate()
        .filter(|(index, _)| Some(*index) != excluded_shape)
        .map(|(_, shape)| shape)
        .filter_map(|shape| path_bounds(&shape.d, shape.transform))
        .chain(
            data.gap_fillers
                .iter()
                .filter_map(|stroke| path_bounds(&stroke.d, stroke.transform)),
        )
        .reduce(|mut bounds, next| {
            bounds.merge(next);
            bounds
        })
}

fn background_shape_index(data: &CanvasResult) -> Option<usize> {
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
    let bounds = artwork_bounds(data, background_index);
    // Fit the visible artwork to the requested artboard instead of scaling
    // against the full source canvas, which can leave large empty borders.
    let scale = bounds
        .map(|bounds| {
            let artwork_width = (bounds.max_x - bounds.min_x).max(1.0);
            let artwork_height = (bounds.max_y - bounds.min_y).max(1.0);
            let fit = (width as f64 / artwork_width).min(height as f64 / artwork_height);
            fit * 0.94
        })
        .unwrap_or_else(|| {
            (width as f64 / data.width.max(1.0)).min(height as f64 / data.height.max(1.0))
        });
    let (ox, oy) = bounds
        .map(|bounds| {
            let (center_x, center_y) = bounds.center();
            (
                width as f64 / 2.0 - center_x * scale,
                height as f64 / 2.0 - center_y * scale,
            )
        })
        .unwrap_or((
            (width as f64 - data.width * scale) / 2.0,
            (height as f64 - data.height * scale) / 2.0,
        ));
    let clip_defs = data
        .shapes
        .iter()
        .enumerate()
        .filter_map(|(i, shape)| {
            shape.clip_path.as_ref().map(|path| {
                format!(
                    "    <clipPath id=\"clip-{}\"><path d=\"{}\"/></clipPath>",
                    i + 1,
                    escape_xml(path)
                )
            })
        })
        .collect::<Vec<_>>()
        .join("\n");
    let strokes = data.gap_fillers.iter().enumerate().map(|(i, stroke)| format!("    <path id=\"gap-filler-{}\" d=\"{}\" fill=\"none\" stroke=\"{}\" stroke-width=\"{}\" transform=\"{}\"/>", i + 1, escape_xml(&stroke.d), escape_xml(&stroke.stroke), f(stroke.width), stroke.transform.svg())).collect::<Vec<_>>().join("\n");
    let defs = if clip_defs.is_empty() {
        String::new()
    } else {
        format!("\n  <defs>\n{}\n  </defs>", clip_defs)
    };
    let gap_layer = if strokes.is_empty() {
        String::new()
    } else {
        format!(
            "\n    <g id=\"gap-fillers\" aria-label=\"Gap fillers (outline strokes before submission)\">\n{}\n    </g>",
            strokes
        )
    };
    let shapes = data
        .shapes
        .iter()
        .enumerate()
        .filter(|(index, _)| Some(*index) != background_index)
        .map(|(i, shape)| {
            let clip = if shape.clip_path.is_some() {
                format!(" clip-path=\"url(#clip-{})\"", i + 1)
            } else {
                String::new()
            };
            format!(
                "    <path id=\"shape-{}\" d=\"{}\" fill=\"{}\" fill-rule=\"{}\" transform=\"{}\"{}/>",
                i + 1,
                escape_xml(&shape.d),
                escape_xml(&shape.fill),
                escape_xml(&shape.fill_rule),
                shape.transform.svg(),
                clip
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let svg = format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\" color-interpolation=\"sRGB\">{}\n  <title>Editable vector artwork</title>\n  <g id=\"background\" aria-label=\"White background\">\n    <rect id=\"background-white\" width=\"{}\" height=\"{}\" fill=\"#ffffff\"/>\n  </g>\n  <g id=\"artwork-transform\" aria-label=\"Artwork transform\" transform=\"translate({} {}) scale({})\">\n    <g id=\"artwork\" aria-label=\"Artwork\">\n{}\n    </g>{}\n  </g>\n</svg>", width, height, width, height, defs, width, height, f(ox), f(oy), f(scale), shapes, gap_layer);
    (svg, (width, height, ratio))
}

pub fn result(data: &CanvasResult, settings: &MicrostockSettings) -> serde_json::Value {
    if let Some(raw_svg) = &data.raw_svg {
        let (width, height, ratio) = artboard(data.width, data.height, settings);
        let validation = validate(data);
        return serde_json::json!({
            "svg": raw_svg,
            "filename": data.filename.clone().unwrap_or_else(|| "detected.svg".into()),
            "stats": {
                "shapes": data.shapes.len(),
                "gap_fillers": data.gap_fillers.len(),
                "errors": data.errors,
                "asset_type": "svg",
                "artboard": { "width": width, "height": height, "pixels": width * height, "ratio": ratio },
                "stock_validation": validation
            },
            "error": serde_json::Value::Null
        });
    }
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
            asset_type: "canvas".into(),
            width: 100.0,
            height: 50.0,
            shapes: vec![],
            gap_fillers: vec![],
            errors: 0,
            operations: vec![],
            raw_svg: None,
            filename: None,
        };
        let (svg, _) = build(&data, &MicrostockSettings::default());
        assert!(svg.contains("xmlns=\"http://www.w3.org/2000/svg\""));
        assert!(svg.contains("viewBox=\"0 0"));
        assert!(svg.contains("<g id=\"background\""));
        assert!(svg.contains("<rect id=\"background-white\""));
        assert!(svg.contains("<g id=\"artwork\""));
    }

    #[test]
    fn generated_artwork_is_centered_from_its_actual_bounds() {
        let data = CanvasResult {
            canvas_id: "c".into(),
            asset_type: "canvas".into(),
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
            raw_svg: None,
            filename: None,
        };
        let (svg, _) = build(&data, &MicrostockSettings::default());
        assert!(svg.contains("translate(116.19 116.19)"));
        assert!(svg.contains("scale(182.031)"));
    }
}
