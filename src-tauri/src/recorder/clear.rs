use super::{
    canvas::{CanvasResult, ClearRegion},
    svg::escape_xml,
    transform::{f, Matrix},
};
use kurbo::{Affine, BezPath, Rect, Shape};

// A clear affects only earlier paints. SVG masks and PostScript clipping
// preserve the original curves and editable paths without rasterizing them.
pub fn svg_mask(region: &ClearRegion, id: usize, data: &CanvasResult) -> String {
    let mut bounds = Rect::new(0.0, 0.0, data.width, data.height);
    for shape in &data.shapes {
        if let Some(path) = transformed_path(&shape.d, shape.transform) {
            bounds = bounds.union(path.bounding_box());
        }
    }
    for stroke in &data.gap_fillers {
        if let Some(path) = transformed_path(&stroke.d, stroke.transform) {
            let m = stroke.transform.0;
            let margin = stroke.width * (m[0].hypot(m[1]) + m[2].hypot(m[3])) * 4.0;
            bounds = bounds.union(path.bounding_box().inflate(margin, margin));
        }
    }
    bounds = bounds.inflate(1.0, 1.0);
    let mut defs = String::new();
    let mut erase = format!(
        "<path d=\"{}\" transform=\"{}\" fill=\"black\"/>",
        escape_xml(&region.d),
        region.transform.svg()
    );
    for (index, clip) in region.clips.iter().enumerate() {
        let clip_id = format!("clear-{id}-clip-{index}");
        defs.push_str(&format!("<clipPath id=\"{clip_id}\" clipPathUnits=\"userSpaceOnUse\"><path d=\"{}\" transform=\"{}\"/></clipPath>\n", escape_xml(&clip.d), clip.transform.svg()));
        erase = format!("<g clip-path=\"url(#{clip_id})\">{erase}</g>");
    }
    defs.push_str(&format!("<mask id=\"clear-{id}\" maskUnits=\"userSpaceOnUse\" maskContentUnits=\"userSpaceOnUse\" x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" style=\"mask-type:luminance\"><rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"white\"/>{erase}</mask>\n",
        f(bounds.x0), f(bounds.y0), f(bounds.width()), f(bounds.height()),
        f(bounds.x0), f(bounds.y0), f(bounds.width()), f(bounds.height())));
    defs
}

pub fn eps_exclusion(region: &ClearRegion) -> Option<String> {
    let mut code = String::from("% clearRect exclusion\ngsave\n");
    for clip in &region.clips {
        let path = transformed_path(&clip.d, clip.transform)?;
        code.push_str("newpath\n");
        code.push_str(&super::eps::path_to_postscript(&path.to_svg())?);
        code.push_str("clip\n");
    }
    let path = transformed_path(&region.d, region.transform)?;
    code.push_str("newpath\n");
    code.push_str(&super::eps::path_to_postscript(&path.to_svg())?);
    code.push_str("clip\nclippath\n");
    // The operand stack survives grestore. Capture the intersection path,
    // restore the original clip, then subtract it using the even-odd rule.
    code.push_str("[ {/moveto load} {/lineto load} {/curveto load} {/closepath load} pathforall ] cvx\ngrestore\nnewpath clippath exec eoclip newpath\n");
    Some(code)
}

fn transformed_path(d: &str, transform: Matrix) -> Option<BezPath> {
    let mut path = BezPath::from_svg(d).ok()?;
    path.apply_affine(Affine::new(transform.0));
    Some(path)
}

#[cfg(test)]
mod tests {
    use crate::recorder::{
        canvas::CanvasState, events::RecorderEvent, validator::MicrostockSettings,
    };
    use serde_json::json;

    #[test]
    fn clear_exports_erase_only_earlier_paints_and_preserve_later_paints() {
        let mut canvas = CanvasState::new("canvas", 100.0, 100.0);
        for value in [
            json!({"type":"fill_rect", "args":[0,0,100,100], "fill_style":"#ff0000"}),
            json!({"type":"clear_rect", "args":[0,0,50,100]}),
            json!({"type":"fill_rect", "args":[10,10,20,20], "fill_style":"#0000ff"}),
        ] {
            let mut event = json!({"session_id":"s", "canvas_id":"canvas", "sequence":1});
            event
                .as_object_mut()
                .unwrap()
                .extend(value.as_object().unwrap().clone());
            canvas.apply(&serde_json::from_value::<RecorderEvent>(event).unwrap());
        }
        let settings = MicrostockSettings {
            transparent_background: true,
            ..Default::default()
        };
        let result = canvas.result();
        let (svg, _) = crate::recorder::svg::build(&result, &settings);
        let doc = roxmltree::Document::parse(&svg).unwrap();
        let red = doc
            .descendants()
            .find(|n| n.attribute("id") == Some("shape-1"))
            .unwrap();
        let blue = doc
            .descendants()
            .find(|n| n.attribute("id") == Some("shape-2"))
            .unwrap();
        assert!(red.ancestors().any(|n| n.attribute("mask").is_some()));
        assert!(!blue.ancestors().any(|n| n.attribute("mask").is_some()));
        let (eps, _) = crate::recorder::eps::build_canvas_eps(&result, &settings, "clear.eps");
        assert_eq!(eps.matches("% clearRect exclusion").count(), 1);
        assert!(eps.find("eoclip").unwrap() < eps.find("1 0 0 setrgbcolor").unwrap());
        assert!(eps.find("1 0 0 setrgbcolor").unwrap() < eps.find("0 0 1 setrgbcolor").unwrap());
    }
}
