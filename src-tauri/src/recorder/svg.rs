use super::{
    canvas::CanvasResult,
    transform::f,
    validator::{artboard, validate, MicrostockSettings},
};

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
    let scale = (width as f64 / data.width.max(1.0)).min(height as f64 / data.height.max(1.0));
    let ox = (width as f64 - data.width * scale) / 2.0;
    let oy = (height as f64 - data.height * scale) / 2.0;
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
    let shapes = data.shapes.iter().enumerate().map(|(i, shape)| { let clip = if shape.clip_path.is_some() { format!(" clip-path=\"url(#clip-{})\"", i + 1) } else { String::new() }; format!("    <path id=\"shape-{}\" d=\"{}\" fill=\"{}\" fill-rule=\"{}\" transform=\"{}\"{}/>", i + 1, escape_xml(&shape.d), escape_xml(&shape.fill), escape_xml(&shape.fill_rule), shape.transform.svg(), clip) }).collect::<Vec<_>>().join("\n");
    let strokes = data.gap_fillers.iter().enumerate().map(|(i, stroke)| format!("    <path id=\"gap-filler-{}\" d=\"{}\" fill=\"none\" stroke=\"{}\" stroke-width=\"{}\" transform=\"{}\"/>", i + 1, escape_xml(&stroke.d), escape_xml(&stroke.stroke), f(stroke.width), stroke.transform.svg())).collect::<Vec<_>>().join("\n");
    let defs = if clip_defs.is_empty() {
        String::new()
    } else {
        format!("\n  <defs>\n{}\n  </defs>", clip_defs)
    };
    let svg = format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\" color-interpolation=\"sRGB\">{}\n  <title>Editable vector artwork</title>\n  <g transform=\"translate({} {}) scale({})\">\n    <g id=\"artwork\" aria-label=\"Artwork\">{}\n    </g>{}\n  </g>\n</svg>", width, height, width, height, defs, f(ox), f(oy), f(scale), shapes, if strokes.is_empty() { String::new() } else { format!("\n    <g id=\"gap-fillers\" aria-label=\"Gap fillers (outline strokes before submission)\">\n{}\n    </g>", strokes) });
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
    }
}
