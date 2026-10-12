use super::canvas::{CanvasResult, CanvasState, ClearRegion, ClipPath, PaintOperation, Shape, Stroke};
use super::transform::Matrix;
use kurbo::{Affine, BezPath, Shape as KurboShape};
use std::collections::{BTreeSet, HashMap, HashSet};

// Some editors rasterize one vector document into several fixed-size canvas
// tiles. Their paint paths are the same document paths, translated by whole
// tile widths/heights. Treat those tiles as one exportable canvas.
pub fn groups(canvases: &HashMap<String, CanvasState>) -> Vec<Vec<&CanvasState>> {
    let mut ordered: Vec<_> = canvases.values().collect();
    ordered.sort_by(|a, b| a.canvas_id.cmp(&b.canvas_id));
    let mut used = std::collections::HashSet::new();
    let mut result = Vec::new();
    for canvas in &ordered {
        if !used.insert(canvas.canvas_id.as_str()) {
            continue;
        }
        let mut group = vec![*canvas];
        for other in &ordered {
            if !used.contains(other.canvas_id.as_str()) && same_document_tile(canvas, other) {
                used.insert(other.canvas_id.as_str());
                group.push(*other);
            }
        }
        result.push(group);
    }
    result
}

fn same_document_tile(a: &CanvasState, b: &CanvasState) -> bool {
    if a.shapes.is_empty()
        || b.shapes.is_empty()
        || a.width != b.width
        || a.height != b.height
        || a.canvas_id.rsplit_once("-canvas-").map(|x| x.0)
            != b.canvas_id.rsplit_once("-canvas-").map(|x| x.0)
    {
        return false;
    }
    let first_a = &a.shapes[0];
    let first_b = &b.shapes[0];
    if first_a.d != first_b.d
        || first_a.fill != first_b.fill
        || first_a.fill_rule != first_b.fill_rule
    {
        return false;
    }
    let ta = first_a.transform.0;
    let tb = first_b.transform.0;
    if (0..4).any(|i| (ta[i] - tb[i]).abs() > 1e-6) {
        return false;
    }
    let dx = (ta[4] - tb[4]) / a.width;
    let dy = (ta[5] - tb[5]) / a.height;
    (dx.abs() > 1e-6 || dy.abs() > 1e-6)
        && (dx - dx.round()).abs() < 1e-6
        && (dy - dy.round()).abs() < 1e-6
        && dx.abs() <= 16.0
        && dy.abs() <= 16.0
}

pub fn representative<'a>(group: &[&'a CanvasState]) -> &'a CanvasState {
    group
        .iter()
        .copied()
        .max_by(|a, b| {
            (a.shapes.len() + a.gap_fillers.len())
                .cmp(&(b.shapes.len() + b.gap_fillers.len()))
                .then_with(|| a.shapes[0].transform.0[4].total_cmp(&b.shapes[0].transform.0[4]))
                .then_with(|| a.shapes[0].transform.0[5].total_cmp(&b.shapes[0].transform.0[5]))
                .then_with(|| a.canvas_id.cmp(&b.canvas_id))
        })
        .expect("tile group is never empty")
}

pub fn merged(group: &[&CanvasState]) -> CanvasResult {
    let anchor = representative(group);
    if group.len() == 1 {
        return anchor.result();
    }
    let reference_x = group
        .iter()
        .map(|c| c.shapes[0].transform.0[4])
        .fold(f64::NEG_INFINITY, f64::max);
    let reference_y = group
        .iter()
        .map(|c| c.shapes[0].transform.0[5])
        .fold(f64::NEG_INFINITY, f64::max);
    let mut orders = vec![normalized_paints(anchor, reference_x, reference_y)];
    for canvas in group {
        if canvas.canvas_id == anchor.canvas_id {
            continue;
        }
        orders.push(normalized_paints(canvas, reference_x, reference_y));
    }
    let mut shapes = Vec::new();
    let mut gap_fillers = Vec::new();
    let mut operations = Vec::new();
    for paint in merge_paint_orders(&orders) {
        match paint {
            TilePaint::Shape(shape) => {
                operations.push(PaintOperation::Shape(shapes.len()));
                shapes.push(shape);
            }
            TilePaint::Stroke(stroke) => {
                operations.push(PaintOperation::Stroke(gap_fillers.len()));
                gap_fillers.push(stroke);
            }
            TilePaint::Clear(region) => operations.push(PaintOperation::Clear(region)),
        }
    }
    let (width, height) = document_size(&shapes).unwrap_or_else(|| {
        let min_x = group
            .iter()
            .map(|c| c.shapes[0].transform.0[4])
            .fold(f64::INFINITY, f64::min);
        let min_y = group
            .iter()
            .map(|c| c.shapes[0].transform.0[5])
            .fold(f64::INFINITY, f64::min);
        (
            (reference_x - min_x + anchor.width).ceil(),
            (reference_y - min_y + anchor.height).ceil(),
        )
    });
    CanvasResult {
        canvas_id: anchor.canvas_id.clone(),
        width,
        height,
        shapes,
        gap_fillers,
        errors: group.iter().map(|canvas| canvas.errors).sum(),
        operations,
    }
}

#[derive(Clone, PartialEq)]
enum TilePaint {
    Shape(Shape),
    Stroke(Stroke),
    Clear(ClearRegion),
}

fn merge_paint_orders(orders: &[Vec<TilePaint>]) -> Vec<TilePaint> {
    let mut paints = Vec::new();
    let mut edges: Vec<HashSet<usize>> = Vec::new();
    let mut incoming = Vec::new();
    // Tile-local sequences constrain the document's paint order. Collect all
    // constraints before sorting: inserting one tile at a time can place a
    // shared layer incorrectly when a later tile supplies the missing order.
    for order in orders {
        let mut used = HashSet::new();
        let mut previous: Option<usize> = None;
        for paint in order {
            let index = paints
                .iter()
                .enumerate()
                .find_map(|(index, existing)| {
                    (!used.contains(&index) && existing == paint).then_some(index)
                })
                .unwrap_or_else(|| {
                    paints.push(paint.clone());
                    edges.push(HashSet::new());
                    incoming.push(0);
                    paints.len() - 1
                });
            // Repeated operations within a tile remain separate nodes.
            used.insert(index);
            if let Some(previous) = previous {
                if edges[previous].insert(index) {
                    incoming[index] += 1;
                }
            }
            previous = Some(index);
        }
    }
    let mut ready: BTreeSet<_> = incoming
        .iter()
        .enumerate()
        .filter_map(|(index, count)| (*count == 0).then_some(index))
        .collect();
    let mut sorted = Vec::new();
    while let Some(index) = ready.pop_first() {
        sorted.push(paints[index].clone());
        for &next in &edges[index] {
            incoming[next] -= 1;
            if incoming[next] == 0 {
                ready.insert(next);
            }
        }
    }
    if sorted.len() == paints.len() {
        return sorted;
    }
    // Conflicting tile sequences cannot share one order. Preserve every
    // source sequence, including repeated paints, instead of dropping layers.
    let mut paints = orders.first().cloned().unwrap_or_default();
    for order in orders.iter().skip(1) {
        let mut cursor = 0;
        for (index, paint) in order.iter().enumerate() {
            if let Some(position) = paints[cursor..]
                .iter()
                .position(|existing| existing == paint)
            {
                cursor += position + 1;
                continue;
            }
            let before = order[index + 1..].iter().find_map(|next| {
                paints[cursor..]
                    .iter()
                    .position(|existing| existing == next)
            });
            let position = before.map_or(paints.len(), |position| cursor + position);
            paints.insert(position, paint.clone());
            cursor = position + 1;
        }
    }
    paints
}

fn normalized_paints(canvas: &CanvasState, reference_x: f64, reference_y: f64) -> Vec<TilePaint> {
    let source = canvas.shapes[0].transform.0;
    let x = reference_x - source[4];
    let y = reference_y - source[5];
    let operations = if canvas.operations.is_empty() {
        (0..canvas.shapes.len())
            .map(PaintOperation::Shape)
            .chain((0..canvas.gap_fillers.len()).map(PaintOperation::Stroke))
            .collect()
    } else {
        canvas.operations.clone()
    };
    operations
        .iter()
        .filter_map(|operation| match operation {
            PaintOperation::Shape(index) => canvas.shapes.get(*index).cloned().map(|mut shape| {
                shift_paint(&mut shape.transform, &mut shape.clip_path, x, y);
                TilePaint::Shape(shape)
            }),
            PaintOperation::Stroke(index) => {
                canvas.gap_fillers.get(*index).cloned().map(|mut stroke| {
                    shift_paint(&mut stroke.transform, &mut stroke.clip_path, x, y);
                    TilePaint::Stroke(stroke)
                })
            }
            PaintOperation::Clear(region) => {
                let mut region = region.clone();
                region.transform.0[4] += x;
                region.transform.0[5] += y;
                for clip in &mut region.clips {
                    clip.transform.0[4] += x;
                    clip.transform.0[5] += y;
                }
                Some(TilePaint::Clear(region))
            }
        })
        .collect()
}

fn shift_paint(transform: &mut Matrix, clip: &mut Option<ClipPath>, x: f64, y: f64) {
    transform.0[4] += x;
    transform.0[5] += y;
    if let Some(clip) = clip.as_mut() {
        clip.transform.0[4] += x;
        clip.transform.0[5] += y;
    }
}

fn document_size(shapes: &[Shape]) -> Option<(f64, f64)> {
    let mut max_x: f64 = 0.0;
    let mut max_y: f64 = 0.0;
    for shape in shapes {
        let mut path = BezPath::from_svg(&shape.d).ok()?;
        path.apply_affine(Affine::new(shape.transform.0));
        let bounds = path.bounding_box();
        max_x = max_x.max(bounds.x1);
        max_y = max_y.max(bounds.y1);
    }
    if max_x.is_finite() && max_y.is_finite() && max_x > 0.0 && max_y > 0.0 {
        Some((max_x.ceil(), max_y.ceil()))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recorder::transform::Matrix;

    fn shape(d: &str, color: &str, x: f64) -> Shape {
        Shape {
            d: d.into(),
            fill: color.into(),
            fill_rule: "nonzero".into(),
            transform: Matrix([0.75, 0.0, 0.0, 0.75, x, 0.0]),
            clip_path: None,
        }
    }

    fn stroke(color: &str, x: f64) -> Stroke {
        Stroke {
            d: "M 500 100 L 1400 100".into(),
            stroke: color.into(),
            width: 2.0,
            transform: Matrix([0.75, 0.0, 0.0, 0.75, x, 0.0]),
            clip_path: Some(ClipPath {
                d: "M 0 0 h 1500 v 1500 h -1500 Z".into(),
                transform: Matrix([0.75, 0.0, 0.0, 0.75, x, 0.0]),
            }),
        }
    }

    #[test]
    fn merges_gap_fillers_in_their_original_paint_order() {
        let background = "M 0 0 L 1500 0 L 1500 1500 L 0 1500 Z";
        let body = "M 200 200 L 800 200 L 800 800 Z";
        let mut left = CanvasState::new("frame-a-canvas-1", 1024.0, 1024.0);
        left.shapes = vec![shape(background, "#fff", 0.0), shape(body, "#000", 0.0)];
        left.gap_fillers = vec![stroke("#abc770", 0.0), stroke("#1fa39d", 0.0)];
        left.operations = vec![
            PaintOperation::Shape(0),
            PaintOperation::Stroke(0),
            PaintOperation::Shape(1),
            PaintOperation::Stroke(1),
        ];
        let mut right = CanvasState::new("frame-a-canvas-2", 1024.0, 1024.0);
        right.shapes = vec![
            shape(background, "#fff", -1024.0),
            shape(body, "#000", -1024.0),
        ];
        right.gap_fillers = vec![stroke("#abc770", -1024.0), stroke("#97efe5", -1024.0)];
        right.operations = left.operations.clone();
        let canvases = HashMap::from([
            (left.canvas_id.clone(), left),
            (right.canvas_id.clone(), right),
        ]);
        let grouped = groups(&canvases);
        assert_eq!(grouped.len(), 1);
        let result = merged(&grouped[0]);
        assert_eq!(result.shapes.len(), 2);
        assert_eq!(result.gap_fillers.len(), 3);
        assert_eq!(
            serde_json::to_value(&result.operations).unwrap(),
            serde_json::json!([
                {"Shape":0}, {"Stroke":0}, {"Shape":1}, {"Stroke":1}, {"Stroke":2}
            ])
        );
        for stroke in &result.gap_fillers {
            assert_eq!(stroke.transform.0[4], 0.0);
            assert_eq!(stroke.clip_path.as_ref().unwrap().transform.0[4], 0.0);
            assert_eq!(stroke.width, 2.0);
        }
        let (svg, _) = super::super::svg::build(
            &result,
            &super::super::validator::MicrostockSettings::default(),
        );
        let first_stroke = svg.find("id=\"gap-filler-1\"").unwrap();
        assert!(svg.find("id=\"shape-1\"").unwrap() < first_stroke);
        assert!(first_stroke < svg.find("id=\"shape-2\"").unwrap());
    }

    #[test]
    fn merges_six_tiles_when_only_some_have_strokes() {
        let background = "M 0 0 L 2052 0 L 2052 1532 L 0 1532 Z";
        let mut canvases = HashMap::new();
        for index in 0..6 {
            let mut canvas =
                CanvasState::new(&format!("frame-a-canvas-{}", index + 1), 1024.0, 1024.0);
            let x = -(index % 3) as f64 * 1024.0;
            let y = -(index / 3) as f64 * 1024.0;
            let mut background = shape(background, "#fff", x);
            background.transform.0 = [1.1161879895561355, 0.0, 0.0, 1.1161879895561355, x, y];
            canvas.shapes.push(background);
            canvas.operations.push(PaintOperation::Shape(0));
            if index % 3 != 2 {
                let mut stroke = stroke("#1fa39d", x);
                stroke.transform.0[5] = y;
                stroke.clip_path.as_mut().unwrap().transform.0[5] = y;
                canvas.gap_fillers.push(stroke);
                canvas.operations.push(PaintOperation::Stroke(0));
            }
            canvases.insert(canvas.canvas_id.clone(), canvas);
        }
        let grouped = groups(&canvases);
        assert_eq!(grouped.len(), 1);
        let result = merged(&grouped[0]);
        assert_eq!((result.width, result.height), (2291.0, 1710.0));
        assert_eq!(result.shapes.len(), 1);
        assert_eq!(result.gap_fillers.len(), 1);
        assert_eq!(result.gap_fillers[0].transform.0[4..], [0.0, 0.0]);
    }

    #[test]
    fn later_tiles_can_resolve_layer_order_without_duplicating_shapes() {
        let paint = |color| TilePaint::Shape(shape("M 0 0 L 10 0 L 10 10 Z", color, 0.0));
        let a = paint("#fff");
        let b = paint("#f00");
        let c = paint("#0f0");
        let d = paint("#000");
        let result = merge_paint_orders(&[
            vec![a.clone(), b.clone(), d.clone()],
            vec![a.clone(), c.clone(), d.clone()],
            vec![a.clone(), c.clone(), b.clone(), d.clone()],
        ]);
        assert!(result == vec![a.clone(), c, b.clone(), d.clone()]);
        // An intentional repeated paint must survive across matching tiles.
        let repeated = vec![a, b.clone(), b, d];
        assert!(merge_paint_orders(&[repeated.clone(), repeated.clone()]) == repeated);
    }

    #[test]
    fn merges_adjacent_document_tiles_without_losing_overflow_shapes() {
        let background = "M 0 0 L 1500 0 L 1500 1500 L 0 1500 Z";
        let body = "M 200 200 L 800 200 L 800 800 Z";
        let leaf = "M 1200 100 L 1450 100 L 1450 300 Z";
        let mut left = CanvasState::new("frame-a-canvas-1", 1024.0, 1024.0);
        left.shapes = vec![shape(background, "#fff", 0.0), shape(body, "#000", 0.0)];
        let mut right = CanvasState::new("frame-a-canvas-2", 1024.0, 1024.0);
        right.shapes = vec![
            shape(background, "#fff", -1024.0),
            shape(leaf, "#0a0", -1024.0),
        ];
        let canvases = HashMap::from([
            (left.canvas_id.clone(), left),
            (right.canvas_id.clone(), right),
        ]);
        let groups = groups(&canvases);
        assert_eq!(groups.len(), 1);
        let result = merged(&groups[0]);
        assert_eq!((result.width, result.height), (1125.0, 1125.0));
        assert_eq!(result.shapes.len(), 3);
        assert!(result
            .shapes
            .iter()
            .any(|shape| shape.d == leaf && shape.transform.0[4] == 0.0));
    }

    #[test]
    fn keeps_unrelated_canvases_separate() {
        let mut a = CanvasState::new("frame-a-canvas-1", 1024.0, 1024.0);
        a.shapes.push(shape("M 0 0 L 10 0 L 10 10 Z", "#fff", 0.0));
        let mut b = CanvasState::new("frame-a-canvas-2", 1024.0, 1024.0);
        b.shapes
            .push(shape("M 0 0 L 20 0 L 20 20 Z", "#fff", -1024.0));
        let canvases = HashMap::from([(a.canvas_id.clone(), a), (b.canvas_id.clone(), b)]);
        assert_eq!(groups(&canvases).len(), 2);
    }
}
