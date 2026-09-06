use super::{
    canvas::CanvasResult,
    svg::{
        artwork_bounds, background_shape_index, next_number, tokenize_path, PathToken,
        ARTWORK_SAFE_AREA,
    },
    svg_asset::SvgAsset,
    transform::{f, Matrix},
    validator::{artboard, MicrostockSettings},
};

pub fn parse_color_rgb(value: &str) -> Option<(f64, f64, f64)> {
    let trimmed = value.trim().to_ascii_lowercase();
    if trimmed.is_empty() || trimmed == "none" || trimmed == "transparent" {
        return None;
    }

    if trimmed.starts_with('#') {
        let hex = &trimmed[1..];
        match hex.len() {
            3 => {
                let r = u8::from_str_radix(&hex[0..1].repeat(2), 16).ok()? as f64 / 255.0;
                let g = u8::from_str_radix(&hex[1..2].repeat(2), 16).ok()? as f64 / 255.0;
                let b = u8::from_str_radix(&hex[2..3].repeat(2), 16).ok()? as f64 / 255.0;
                return Some((r, g, b));
            }
            4 => {
                let r = u8::from_str_radix(&hex[0..1].repeat(2), 16).ok()? as f64 / 255.0;
                let g = u8::from_str_radix(&hex[1..2].repeat(2), 16).ok()? as f64 / 255.0;
                let b = u8::from_str_radix(&hex[2..3].repeat(2), 16).ok()? as f64 / 255.0;
                return Some((r, g, b));
            }
            6 => {
                let r = u8::from_str_radix(&hex[0..2], 16).ok()? as f64 / 255.0;
                let g = u8::from_str_radix(&hex[2..4], 16).ok()? as f64 / 255.0;
                let b = u8::from_str_radix(&hex[4..6], 16).ok()? as f64 / 255.0;
                return Some((r, g, b));
            }
            8 => {
                let r = u8::from_str_radix(&hex[0..2], 16).ok()? as f64 / 255.0;
                let g = u8::from_str_radix(&hex[2..4], 16).ok()? as f64 / 255.0;
                let b = u8::from_str_radix(&hex[4..6], 16).ok()? as f64 / 255.0;
                return Some((r, g, b));
            }
            _ => return None,
        }
    }

    if trimmed.starts_with("rgb") {
        let inside = trimmed
            .trim_start_matches("rgba")
            .trim_start_matches("rgb")
            .trim_start_matches('(')
            .trim_end_matches(')');
        let parts: Vec<&str> = inside.split(',').map(|s| s.trim()).collect();
        if parts.len() >= 3 {
            let parse_comp = |s: &str| -> Option<f64> {
                if s.ends_with('%') {
                    let pct = s.trim_end_matches('%').parse::<f64>().ok()?;
                    Some((pct / 100.0).clamp(0.0, 1.0))
                } else {
                    let val = s.parse::<f64>().ok()?;
                    Some((val / 255.0).clamp(0.0, 1.0))
                }
            };
            let r = parse_comp(parts[0])?;
            let g = parse_comp(parts[1])?;
            let b = parse_comp(parts[2])?;
            return Some((r, g, b));
        }
    }

    match trimmed.as_str() {
        "black" => Some((0.0, 0.0, 0.0)),
        "white" => Some((1.0, 1.0, 1.0)),
        "red" => Some((1.0, 0.0, 0.0)),
        "lime" | "green" => Some((0.0, 1.0, 0.0)),
        "blue" => Some((0.0, 0.0, 1.0)),
        "yellow" => Some((1.0, 1.0, 0.0)),
        "cyan" | "aqua" => Some((0.0, 1.0, 1.0)),
        "magenta" | "fuchsia" => Some((1.0, 0.0, 1.0)),
        "gray" | "grey" => Some((0.5, 0.5, 0.5)),
        "silver" => Some((0.75, 0.75, 0.75)),
        "maroon" => Some((0.5, 0.0, 0.0)),
        "navy" => Some((0.0, 0.0, 0.5)),
        "purple" => Some((0.5, 0.0, 0.5)),
        "teal" => Some((0.0, 0.5, 0.5)),
        "olive" => Some((0.5, 0.5, 0.0)),
        "orange" => Some((1.0, 0.647, 0.0)),
        _ => Some((0.0, 0.0, 0.0)),
    }
}

fn arc_to_cubics(
    current: (f64, f64),
    rx: f64,
    ry: f64,
    x_axis_rotation_deg: f64,
    large_arc: bool,
    sweep: bool,
    end: (f64, f64),
) -> Vec<((f64, f64), (f64, f64), (f64, f64))> {
    let mut rx = rx.abs();
    let mut ry = ry.abs();
    if rx < 1e-6 || ry < 1e-6 {
        return vec![(current, end, end)];
    }

    let phi = x_axis_rotation_deg.to_radians();
    let cos_phi = phi.cos();
    let sin_phi = phi.sin();

    let dx = (current.0 - end.0) / 2.0;
    let dy = (current.1 - end.1) / 2.0;
    let x1_prime = cos_phi * dx + sin_phi * dy;
    let y1_prime = -sin_phi * dx + cos_phi * dy;

    let lambda = (x1_prime * x1_prime) / (rx * rx) + (y1_prime * y1_prime) / (ry * ry);
    if lambda > 1.0 {
        let sqrt_lambda = lambda.sqrt();
        rx *= sqrt_lambda;
        ry *= sqrt_lambda;
    }

    let rx_sq = rx * rx;
    let ry_sq = ry * ry;
    let x1_prime_sq = x1_prime * x1_prime;
    let y1_prime_sq = y1_prime * y1_prime;

    let num = (rx_sq * ry_sq - rx_sq * y1_prime_sq - ry_sq * x1_prime_sq).max(0.0);
    let den = rx_sq * y1_prime_sq + ry_sq * x1_prime_sq;
    let mut sq = if den > 1e-9 { (num / den).sqrt() } else { 0.0 };
    if large_arc == sweep {
        sq = -sq;
    }

    let cx_prime = sq * (rx * y1_prime / ry);
    let cy_prime = -sq * (ry * x1_prime / rx);

    let cx = cos_phi * cx_prime - sin_phi * cy_prime + (current.0 + end.0) / 2.0;
    let cy = sin_phi * cx_prime + cos_phi * cy_prime + (current.1 + end.1) / 2.0;

    let ux = (x1_prime - cx_prime) / rx;
    let uy = (y1_prime - cy_prime) / ry;
    let vx = (-x1_prime - cx_prime) / rx;
    let vy = (-y1_prime - cy_prime) / ry;

    let angle = |u: (f64, f64), v: (f64, f64)| -> f64 {
        let dot = (u.0 * v.0 + u.1 * v.1).clamp(-1.0, 1.0);
        let sign = if u.0 * v.1 - u.1 * v.0 < 0.0 { -1.0 } else { 1.0 };
        sign * dot.acos()
    };

    let theta1 = angle((1.0, 0.0), (ux, uy));
    let mut delta_theta = angle((ux, uy), (vx, vy));

    let pi2 = std::f64::consts::TAU;
    if !sweep && delta_theta > 0.0 {
        delta_theta -= pi2;
    } else if sweep && delta_theta < 0.0 {
        delta_theta += pi2;
    }

    let segments = (delta_theta.abs() / (std::f64::consts::FRAC_PI_2)).ceil() as usize;
    let segments = segments.max(1);
    let delta_segment = delta_theta / segments as f64;

    let mut result = Vec::with_capacity(segments);
    let mut current_theta = theta1;

    for _ in 0..segments {
        let next_theta = current_theta + delta_segment;
        let alpha = (delta_segment / 4.0).tan() * 4.0 / 3.0;

        let cos_t1 = current_theta.cos();
        let sin_t1 = current_theta.sin();
        let cos_t2 = next_theta.cos();
        let sin_t2 = next_theta.sin();

        let p1x = cos_t1 - alpha * sin_t1;
        let p1y = sin_t1 + alpha * cos_t1;
        let p2x = cos_t2 + alpha * sin_t2;
        let p2y = sin_t2 - alpha * cos_t2;

        let transform_pt = |px: f64, py: f64| -> (f64, f64) {
            let sx = px * rx;
            let sy = py * ry;
            (
                cos_phi * sx - sin_phi * sy + cx,
                sin_phi * sx + cos_phi * sy + cy,
            )
        };

        let cp1 = transform_pt(p1x, p1y);
        let cp2 = transform_pt(p2x, p2y);
        let pt_end = transform_pt(cos_t2, sin_t2);

        result.push((cp1, cp2, pt_end));
        current_theta = next_theta;
    }

    result
}

pub fn path_to_postscript(path_d: &str) -> Option<String> {
    let tokens = tokenize_path(path_d)?;
    let mut index = 0;
    let mut command = None;
    let mut current = (0.0, 0.0);
    let mut start = (0.0, 0.0);
    let mut last_cubic_cp: Option<(f64, f64)> = None;
    let mut last_quad_cp: Option<(f64, f64)> = None;
    let mut ps = String::new();

    while index < tokens.len() {
        if let Some(PathToken::Command(next)) = tokens.get(index).copied() {
            command = Some(next);
            index += 1;
        }
        let Some(active) = command else { return None };
        let relative = active.is_ascii_lowercase();
        let kind = active.to_ascii_uppercase();

        match kind {
            'M' => {
                let x = next_number(&tokens, &mut index)?;
                let y = next_number(&tokens, &mut index)?;
                let pt = if relative {
                    (current.0 + x, current.1 + y)
                } else {
                    (x, y)
                };
                current = pt;
                start = pt;
                last_cubic_cp = None;
                last_quad_cp = None;
                ps.push_str(&format!("{} {} moveto\n", f(pt.0), f(pt.1)));
                command = Some(if relative { 'l' } else { 'L' });
            }
            'L' => {
                let x = next_number(&tokens, &mut index)?;
                let y = next_number(&tokens, &mut index)?;
                let pt = if relative {
                    (current.0 + x, current.1 + y)
                } else {
                    (x, y)
                };
                current = pt;
                last_cubic_cp = None;
                last_quad_cp = None;
                ps.push_str(&format!("{} {} lineto\n", f(pt.0), f(pt.1)));
            }
            'H' => {
                let x = next_number(&tokens, &mut index)?;
                let pt = (if relative { current.0 + x } else { x }, current.1);
                current = pt;
                last_cubic_cp = None;
                last_quad_cp = None;
                ps.push_str(&format!("{} {} lineto\n", f(pt.0), f(pt.1)));
            }
            'V' => {
                let y = next_number(&tokens, &mut index)?;
                let pt = (current.0, if relative { current.1 + y } else { y });
                current = pt;
                last_cubic_cp = None;
                last_quad_cp = None;
                ps.push_str(&format!("{} {} lineto\n", f(pt.0), f(pt.1)));
            }
            'C' => {
                let x1 = next_number(&tokens, &mut index)?;
                let y1 = next_number(&tokens, &mut index)?;
                let x2 = next_number(&tokens, &mut index)?;
                let y2 = next_number(&tokens, &mut index)?;
                let x = next_number(&tokens, &mut index)?;
                let y = next_number(&tokens, &mut index)?;
                let (cp1, cp2, pt) = if relative {
                    (
                        (current.0 + x1, current.1 + y1),
                        (current.0 + x2, current.1 + y2),
                        (current.0 + x, current.1 + y),
                    )
                } else {
                    ((x1, y1), (x2, y2), (x, y))
                };
                ps.push_str(&format!(
                    "{} {} {} {} {} {} curveto\n",
                    f(cp1.0),
                    f(cp1.1),
                    f(cp2.0),
                    f(cp2.1),
                    f(pt.0),
                    f(pt.1)
                ));
                last_cubic_cp = Some(cp2);
                last_quad_cp = None;
                current = pt;
            }
            'S' => {
                let x2 = next_number(&tokens, &mut index)?;
                let y2 = next_number(&tokens, &mut index)?;
                let x = next_number(&tokens, &mut index)?;
                let y = next_number(&tokens, &mut index)?;
                let (cp2, pt) = if relative {
                    (
                        (current.0 + x2, current.1 + y2),
                        (current.0 + x, current.1 + y),
                    )
                } else {
                    ((x2, y2), (x, y))
                };
                let cp1 = match last_cubic_cp {
                    Some(last) => (2.0 * current.0 - last.0, 2.0 * current.1 - last.1),
                    None => current,
                };
                ps.push_str(&format!(
                    "{} {} {} {} {} {} curveto\n",
                    f(cp1.0),
                    f(cp1.1),
                    f(cp2.0),
                    f(cp2.1),
                    f(pt.0),
                    f(pt.1)
                ));
                last_cubic_cp = Some(cp2);
                last_quad_cp = None;
                current = pt;
            }
            'Q' => {
                let x1 = next_number(&tokens, &mut index)?;
                let y1 = next_number(&tokens, &mut index)?;
                let x = next_number(&tokens, &mut index)?;
                let y = next_number(&tokens, &mut index)?;
                let (qp, pt) = if relative {
                    (
                        (current.0 + x1, current.1 + y1),
                        (current.0 + x, current.1 + y),
                    )
                } else {
                    ((x1, y1), (x, y))
                };
                // Convert quadratic to cubic bezier:
                let cp1 = (
                    current.0 + 2.0 / 3.0 * (qp.0 - current.0),
                    current.1 + 2.0 / 3.0 * (qp.1 - current.1),
                );
                let cp2 = (
                    pt.0 + 2.0 / 3.0 * (qp.0 - pt.0),
                    pt.1 + 2.0 / 3.0 * (qp.1 - pt.1),
                );
                ps.push_str(&format!(
                    "{} {} {} {} {} {} curveto\n",
                    f(cp1.0),
                    f(cp1.1),
                    f(cp2.0),
                    f(cp2.1),
                    f(pt.0),
                    f(pt.1)
                ));
                last_quad_cp = Some(qp);
                last_cubic_cp = None;
                current = pt;
            }
            'T' => {
                let x = next_number(&tokens, &mut index)?;
                let y = next_number(&tokens, &mut index)?;
                let pt = if relative {
                    (current.0 + x, current.1 + y)
                } else {
                    (x, y)
                };
                let qp = match last_quad_cp {
                    Some(last) => (2.0 * current.0 - last.0, 2.0 * current.1 - last.1),
                    None => current,
                };
                let cp1 = (
                    current.0 + 2.0 / 3.0 * (qp.0 - current.0),
                    current.1 + 2.0 / 3.0 * (qp.1 - current.1),
                );
                let cp2 = (
                    pt.0 + 2.0 / 3.0 * (qp.0 - pt.0),
                    pt.1 + 2.0 / 3.0 * (qp.1 - pt.1),
                );
                ps.push_str(&format!(
                    "{} {} {} {} {} {} curveto\n",
                    f(cp1.0),
                    f(cp1.1),
                    f(cp2.0),
                    f(cp2.1),
                    f(pt.0),
                    f(pt.1)
                ));
                last_quad_cp = Some(qp);
                last_cubic_cp = None;
                current = pt;
            }
            'A' => {
                let rx = next_number(&tokens, &mut index)?;
                let ry = next_number(&tokens, &mut index)?;
                let rotation = next_number(&tokens, &mut index)?;
                let large_arc = next_number(&tokens, &mut index)? != 0.0;
                let sweep = next_number(&tokens, &mut index)? != 0.0;
                let x = next_number(&tokens, &mut index)?;
                let y = next_number(&tokens, &mut index)?;
                let pt = if relative {
                    (current.0 + x, current.1 + y)
                } else {
                    (x, y)
                };
                let cubics = arc_to_cubics(current, rx, ry, rotation, large_arc, sweep, pt);
                for (cp1, cp2, pt_end) in cubics {
                    ps.push_str(&format!(
                        "{} {} {} {} {} {} curveto\n",
                        f(cp1.0),
                        f(cp1.1),
                        f(cp2.0),
                        f(cp2.1),
                        f(pt_end.0),
                        f(pt_end.1)
                    ));
                }
                current = pt;
                last_cubic_cp = None;
                last_quad_cp = None;
            }
            'Z' => {
                ps.push_str("closepath\n");
                current = start;
                last_cubic_cp = None;
                last_quad_cp = None;
                command = None;
            }
            _ => return None,
        }
    }

    Some(ps)
}

fn is_identity_matrix(m: &Matrix) -> bool {
    (m.0[0] - 1.0).abs() < 1e-6
        && m.0[1].abs() < 1e-6
        && m.0[2].abs() < 1e-6
        && (m.0[3] - 1.0).abs() < 1e-6
        && m.0[4].abs() < 1e-6
        && m.0[5].abs() < 1e-6
}

pub fn build_canvas_eps(
    data: &CanvasResult,
    settings: &MicrostockSettings,
    title: &str,
) -> (String, (u64, u64, String)) {
    let (width, height, ratio) = artboard(data.width, data.height, settings);
    let background_index = background_shape_index(data);

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

    let mut eps = String::with_capacity(16_384);
    eps.push_str("%!PS-Adobe-3.0 EPSF-3.0\n");
    eps.push_str(&format!("%%Creator: Canvas Vector Recorder Desktop\n"));
    eps.push_str(&format!("%%Title: {}\n", title));
    eps.push_str("%%Pages: 1\n");
    eps.push_str(&format!("%%BoundingBox: 0 0 {} {}\n", width, height));
    eps.push_str(&format!(
        "%%HiResBoundingBox: 0.0000 0.0000 {:.4} {:.4}\n",
        width as f64, height as f64
    ));
    eps.push_str("%%LanguageLevel: 3\n");
    eps.push_str("%%EndComments\n");
    eps.push_str("%%Page: 1 1\n");
    eps.push_str("save\n");

    // Establish top-left origin coordinate system matching SVG/Canvas:
    eps.push_str(&format!("0 {} translate\n", height));
    eps.push_str("1 -1 scale\n\n");

    // Background layer
    if !settings.transparent_background {
        let bg_color = if settings.background_color.trim().is_empty() {
            "#ffffff"
        } else {
            settings.background_color.trim()
        };
        let (r, g, b) = parse_color_rgb(bg_color).unwrap_or((1.0, 1.0, 1.0));
        eps.push_str("% Background\n");
        eps.push_str("gsave\n");
        eps.push_str(&format!("{} {} {} setrgbcolor\n", f(r), f(g), f(b)));
        eps.push_str(&format!(
            "newpath 0 0 moveto {} 0 lineto {} {} lineto 0 {} lineto closepath fill\n",
            width, width, height, height
        ));
        eps.push_str("grestore\n\n");
    }

    // Artwork transform
    eps.push_str("% Artwork\n");
    eps.push_str("gsave\n");
    eps.push_str(&format!("{} {} translate\n", f(ox), f(oy)));
    eps.push_str(&format!("{} {} scale\n", f(scale), f(scale)));

    let render_shape = |shape: &super::canvas::Shape| -> Option<String> {
        let (r, g, b) = parse_color_rgb(&shape.fill)?;
        let path_ps = path_to_postscript(&shape.d)?;
        let mut block = String::new();
        block.push_str("gsave\n");
        if !is_identity_matrix(&shape.transform) {
            let [a, b_val, c, d, e_val, f_val] = shape.transform.0;
            block.push_str(&format!(
                "[{} {} {} {} {} {}] concat\n",
                f(a),
                f(b_val),
                f(c),
                f(d),
                f(e_val),
                f(f_val)
            ));
        }
        block.push_str(&format!("{} {} {} setrgbcolor\n", f(r), f(g), f(b)));
        block.push_str("newpath\n");
        block.push_str(&path_ps);
        if shape.fill_rule == "evenodd" {
            block.push_str("eofill\n");
        } else {
            block.push_str("fill\n");
        }
        block.push_str("grestore\n");
        Some(block)
    };

    let render_stroke = |stroke: &super::canvas::Stroke| -> Option<String> {
        let (r, g, b) = parse_color_rgb(&stroke.stroke)?;
        let path_ps = path_to_postscript(&stroke.d)?;
        let mut block = String::new();
        block.push_str("gsave\n");
        if !is_identity_matrix(&stroke.transform) {
            let [a, b_val, c, d, e_val, f_val] = stroke.transform.0;
            block.push_str(&format!(
                "[{} {} {} {} {} {}] concat\n",
                f(a),
                f(b_val),
                f(c),
                f(d),
                f(e_val),
                f(f_val)
            ));
        }
        block.push_str(&format!("{} {} {} setrgbcolor\n", f(r), f(g), f(b)));
        block.push_str(&format!("{} setlinewidth\n", f(stroke.width)));
        block.push_str("newpath\n");
        block.push_str(&path_ps);
        block.push_str("stroke\n");
        block.push_str("grestore\n");
        Some(block)
    };

    if data.operations.is_empty() {
        for (i, shape) in data.shapes.iter().enumerate() {
            if Some(i) == background_index {
                continue;
            }
            if let Some(code) = render_shape(shape) {
                eps.push_str(&code);
            }
        }
        for stroke in &data.gap_fillers {
            if let Some(code) = render_stroke(stroke) {
                eps.push_str(&code);
            }
        }
    } else {
        for operation in &data.operations {
            match operation {
                super::canvas::PaintOperation::Shape(index) if Some(*index) != background_index => {
                    if let Some(shape) = data.shapes.get(*index) {
                        if let Some(code) = render_shape(shape) {
                            eps.push_str(&code);
                        }
                    }
                }
                super::canvas::PaintOperation::Stroke(index) => {
                    if let Some(stroke) = data.gap_fillers.get(*index) {
                        if let Some(code) = render_stroke(stroke) {
                            eps.push_str(&code);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    eps.push_str("grestore\n"); // restore artwork transform
    eps.push_str("restore\n");  // restore save
    eps.push_str("showpage\n");
    eps.push_str("%%EOF\n");

    (eps, (width, height, ratio))
}

pub fn build_svg_asset_eps(
    asset: &SvgAsset,
    settings: &MicrostockSettings,
    title: &str,
) -> (String, (u64, u64, String)) {
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

    let mut eps = String::with_capacity(16_384);
    eps.push_str("%!PS-Adobe-3.0 EPSF-3.0\n");
    eps.push_str(&format!("%%Creator: Canvas Vector Recorder Desktop\n"));
    eps.push_str(&format!("%%Title: {}\n", title));
    eps.push_str("%%Pages: 1\n");
    eps.push_str(&format!("%%BoundingBox: 0 0 {} {}\n", width, height));
    eps.push_str(&format!(
        "%%HiResBoundingBox: 0.0000 0.0000 {:.4} {:.4}\n",
        width as f64, height as f64
    ));
    eps.push_str("%%LanguageLevel: 3\n");
    eps.push_str("%%EndComments\n");
    eps.push_str("%%Page: 1 1\n");
    eps.push_str("save\n");

    // Establish top-left origin coordinate system matching SVG/Canvas:
    eps.push_str(&format!("0 {} translate\n", height));
    eps.push_str("1 -1 scale\n\n");

    // Background layer
    if !settings.transparent_background {
        let bg_color = if settings.background_color.trim().is_empty() {
            "#ffffff"
        } else {
            settings.background_color.trim()
        };
        let (r, g, b) = parse_color_rgb(bg_color).unwrap_or((1.0, 1.0, 1.0));
        eps.push_str("% Background\n");
        eps.push_str("gsave\n");
        eps.push_str(&format!("{} {} {} setrgbcolor\n", f(r), f(g), f(b)));
        eps.push_str(&format!(
            "newpath 0 0 moveto {} 0 lineto {} {} lineto 0 {} lineto closepath fill\n",
            width, width, height, height
        ));
        eps.push_str("grestore\n\n");
    }

    // Artwork transform
    eps.push_str("% Artwork\n");
    eps.push_str("gsave\n");
    eps.push_str(&format!("{} {} translate\n", f(offset_x), f(offset_y)));
    eps.push_str(&format!("{} {} scale\n", f(scale), f(scale)));

    // Parse path elements from asset markup
    for segment in asset.markup.split('<') {
        let tag = segment.trim();
        if tag.starts_with("path") {
            let get_attr = |name: &str| -> Option<String> {
                let pattern = format!("{}=\"", name);
                let start = tag.find(&pattern)? + pattern.len();
                let end = tag[start..].find('"')? + start;
                Some(tag[start..end].to_string())
            };
            if let Some(d) = get_attr("d") {
                if let Some(path_ps) = path_to_postscript(&d) {
                    let fill = get_attr("fill").unwrap_or_else(|| "#000000".into());
                    let stroke = get_attr("stroke");
                    let fill_rule = get_attr("fill-rule").unwrap_or_else(|| "nonzero".into());

                    eps.push_str("gsave\n");
                    if let Some(transform) = get_attr("transform") {
                        if transform.starts_with("matrix(") && transform.ends_with(')') {
                            let values = &transform[7..transform.len() - 1];
                            let nums: Vec<f64> = values
                                .split(|c: char| c.is_whitespace() || c == ',')
                                .filter_map(|s| s.trim().parse::<f64>().ok())
                                .collect();
                            if nums.len() == 6 {
                                eps.push_str(&format!(
                                    "[{} {} {} {} {} {}] concat\n",
                                    f(nums[0]),
                                    f(nums[1]),
                                    f(nums[2]),
                                    f(nums[3]),
                                    f(nums[4]),
                                    f(nums[5])
                                ));
                            }
                        }
                    }

                    if let Some((r, g, b)) = parse_color_rgb(&fill) {
                        eps.push_str(&format!("{} {} {} setrgbcolor\n", f(r), f(g), f(b)));
                        eps.push_str("newpath\n");
                        eps.push_str(&path_ps);
                        if stroke.is_some() {
                            eps.push_str("gsave\n");
                        }
                        if fill_rule == "evenodd" {
                            eps.push_str("eofill\n");
                        } else {
                            eps.push_str("fill\n");
                        }
                        if stroke.is_some() {
                            eps.push_str("grestore\n");
                        }
                    }

                    if let Some(stroke_color) = stroke {
                        if let Some((r, g, b)) = parse_color_rgb(&stroke_color) {
                            let stroke_width = get_attr("stroke-width")
                                .and_then(|w| w.parse::<f64>().ok())
                                .unwrap_or(1.0);
                            eps.push_str(&format!("{} {} {} setrgbcolor\n", f(r), f(g), f(b)));
                            eps.push_str(&format!("{} setlinewidth\n", f(stroke_width)));
                            eps.push_str("newpath\n");
                            eps.push_str(&path_ps);
                            eps.push_str("stroke\n");
                        }
                    }
                    eps.push_str("grestore\n");
                }
            }
        }
    }

    eps.push_str("grestore\n"); // restore artwork transform
    eps.push_str("restore\n");  // restore save
    eps.push_str("showpage\n");
    eps.push_str("%%EOF\n");

    (eps, (width, height, ratio))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recorder::canvas::Shape;

    #[test]
    fn color_parser_handles_hex_rgb_and_names() {
        assert_eq!(parse_color_rgb("#ffffff"), Some((1.0, 1.0, 1.0)));
        assert_eq!(parse_color_rgb("#000"), Some((0.0, 0.0, 0.0)));
        assert_eq!(parse_color_rgb("#ff0000"), Some((1.0, 0.0, 0.0)));
        assert_eq!(parse_color_rgb("rgb(255, 0, 0)"), Some((1.0, 0.0, 0.0)));
        assert_eq!(parse_color_rgb("white"), Some((1.0, 1.0, 1.0)));
        assert_eq!(parse_color_rgb("none"), None);
        assert_eq!(parse_color_rgb("transparent"), None);
    }

    #[test]
    fn path_to_postscript_converts_svg_commands() {
        let d = "M 10 20 L 30 40 C 35 45 40 50 50 60 Q 60 70 70 80 Z";
        let ps = path_to_postscript(d).expect("path should convert");
        assert!(ps.contains("10 20 moveto"));
        assert!(ps.contains("30 40 lineto"));
        assert!(ps.contains("35 45 40 50 50 60 curveto"));
        assert!(ps.contains("curveto")); // from Q conversion
        assert!(ps.contains("closepath"));
    }

    #[test]
    fn generated_eps_has_standard_dsc_header_and_dimensions() {
        let data = CanvasResult {
            canvas_id: "test".into(),
            width: 200.0,
            height: 100.0,
            shapes: vec![Shape {
                d: "M 0 0 L 100 0 L 100 100 Z".into(),
                fill: "#ff0000".into(),
                fill_rule: "nonzero".into(),
                transform: Matrix::default(),
                clip_path: None,
            }],
            gap_fillers: vec![],
            errors: 0,
            operations: vec![],
        };
        let settings = MicrostockSettings {
            ratio: "1:1".into(),
            min_pixels: 40_000.0,
            max_pixels: 40_000.0,
            background_color: "#ffffff".into(),
            transparent_background: false,
            artwork_scale: 1.0,
            ..Default::default()
        };
        let (eps, (w, h, ratio)) = build_canvas_eps(&data, &settings, "test.eps");
        assert_eq!(ratio, "1:1");
        assert_eq!(w, 200);
        assert_eq!(h, 200);
        assert!(eps.starts_with("%!PS-Adobe-3.0 EPSF-3.0\n"));
        assert!(eps.contains("%%BoundingBox: 0 0 200 200\n"));
        assert!(eps.contains("%%LanguageLevel: 3\n"));
        assert!(eps.contains("0 200 translate\n1 -1 scale\n"));
        assert!(eps.contains("1 0 0 setrgbcolor\n")); // #ff0000
        assert!(eps.contains("fill\n"));
        assert!(eps.contains("showpage\n%%EOF\n"));
    }
}
