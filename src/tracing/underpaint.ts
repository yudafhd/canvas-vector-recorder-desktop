import type { TraceResult } from './engine';
import { tracingSvgPaths } from './svg-paths';
import { geometricHypot } from './geometry-math';
import { flattenStroke, type StrokeCurve as Curve, type StrokePoint as Point } from './stroke-regularizer';

const xy = (p: Point) => p.map(v => Math.round(v * 1000) / 1000).join(' ');
const distance = (a: Point, b: Point) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const unit = (a: Point, b: Point): Point => { const d = geometricHypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
const reverse = (c: Curve): Curve => ({ from: c.to, to: c.from, controls: c.controls ? [c.controls[1], c.controls[0]] : undefined });
const command = (c: Curve) => c.controls ? `C${xy(c.controls[0])} ${xy(c.controls[1])} ${xy(c.to)}` : `L${xy(c.to)}`;
const data = (loop: Curve[]) => loop.length ? `M${xy(loop[0].from)}${loop.map(command).join('')}Z` : '';
function parse(data: string) {
  const tokens = data.match(/[MLCZ]|-?\d+(?:\.\d+)?/g) ?? [], loops: Curve[][] = [];
  let current: Point = [0, 0], first: Point = current, loop: Curve[] = [];
  for (let i = 0; i < tokens.length;) {
    const op = tokens[i++];
    if (op === 'Z') { if (distance(current, first) > 1e-12) loop.push({ from: current, to: first }); current = first; continue; }
    const values = tokens.slice(i, i + (op === 'C' ? 6 : 2)).map(Number); i += values.length;
    const to: Point = [values[values.length - 2], values[values.length - 1]];
    if (op === 'M') { loop = []; loops.push(loop); first = to; }
    else loop.push({ from: current, to, controls: op === 'C' ? [[values[0], values[1]], [values[2], values[3]]] : undefined });
    current = to;
  }
  return loops;
}
const bounds = (curves: Curve[]) => {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of curves) for (const p of [c.from, c.to, ...(c.controls ?? [])]) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); }
  return b;
};
/** Fill shared color seams inside a clipped domain, excluding later visible ink. */
export function underpaint(result: TraceResult): TraceResult {
  const paths = tracingSvgPaths(result.svg);
  const faces = paths.map(path => {
    const rgb = parseInt(path.color.slice(1), 16), dark = Math.max(rgb >>> 16, (rgb >>> 8) & 255, rgb & 255) < 100, loops = parse(path.data);
    let area = 0;
    for (const loop of loops) {
      const points = flattenStroke(loop);
      for (let i = 0; i + 1 < points.length; i++) area += (points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1]) / 2;
    }
    return { ...path, dark, loops, area: Math.abs(area), bounds: bounds(loops.flat()), reverse: dark ? loops.map(loop => data([...loop].reverse().map(reverse))).join('') : '' };
  });
  if (!faces[0]?.dark || paths.some(p => p.clip)) return result;
  const boundaries = new Map<string, { curve: Curve; faces: Set<number> }>();
  faces.forEach((face, id) => {
    if (face.dark) return;
    for (const c of face.loops.flat()) {
      const curve = c.from[0] < c.to[0] || c.from[0] === c.to[0] && c.from[1] <= c.to[1] ? c : reverse(c);
      const key = `${xy(curve.from)}/${curve.controls ? curve.controls.map(xy).join('/') : 'L'}/${xy(curve.to)}`;
      const entry = boundaries.get(key) ?? { curve, faces: new Set<number>() }; entry.faces.add(id); boundaries.set(key, entry);
    }
  });
  const pairs = new Map<string, Curve[]>();
  for (const boundary of boundaries.values()) if (boundary.faces.size === 2) {
    const [a, b] = [...boundary.faces]; if (faces[a].color === faces[b].color) continue;
    const key = `${a}/${b}`, curves = pairs.get(key) ?? []; curves.push(boundary.curve); pairs.set(key, curves);
  }
  if (!pairs.size) return result;
  const before = new Map<number, string[]>(), defs: string[] = []; let added = 0;
  for (const [key, curves] of pairs) {
    const [a, b] = key.split('/').map(Number), fa = faces[a], fb = faces[b], clip = `seam-domain-${defs.length}`, box = bounds(curves);
    const backdrop = fa.area >= fb.area ? fa.color : fb.color;
    const holes = faces.slice(a + 1).filter(f => f.dark && box[0] - 2 <= f.bounds[2] && box[2] + 2 >= f.bounds[0] && box[1] - 2 <= f.bounds[3] && box[3] + 2 >= f.bounds[1]).map(f => f.reverse).join('');
    defs.push(`<clipPath id="${clip}" clipPathUnits="userSpaceOnUse"><path clip-rule="nonzero" d="${fa.data}${fb.data}${holes}"/></clipPath>`);
    const paint = before.get(a) ?? [];
    for (const c of curves) {
      let t0 = unit(c.from, c.controls?.[0] ?? c.to), t1 = unit(c.controls?.[1] ?? c.from, c.to);
      if (distance(t0, [0, 0]) < .5) t0 = unit(c.from, c.to); if (distance(t1, [0, 0]) < .5) t1 = unit(c.from, c.to);
      const n0: Point = [-t0[1], t0[0]], n1: Point = [-t1[1], t1[0]];
      const offset = (p: Point, n: Point, sign: number): Point => [p[0] + 1.5 * sign * n[0], p[1] + 1.5 * sign * n[1]];
      const top: Curve = { from: offset(c.from, n0, 1), to: offset(c.to, n1, 1), controls: c.controls ? [offset(c.controls[0], n0, 1), offset(c.controls[1], n1, 1)] : undefined };
      const bottom: Curve = { from: offset(c.to, n1, -1), to: offset(c.from, n0, -1), controls: c.controls ? [offset(c.controls[1], n1, -1), offset(c.controls[0], n0, -1)] : undefined };
      paint.push(`<path fill="${backdrop}" fill-rule="evenodd" clip-path="url(#${clip})" d="M${xy(top.from)}${command(top)}L${xy(bottom.from)}${command(bottom)}Z"/>`); added++;
    }
    before.set(a, paint);
  }
  const svg = result.svg.slice(0, result.svg.indexOf('>') + 1) + `<defs>${defs.join('')}</defs>` + faces.map((f, i) => (before.get(i) ?? []).join('') + f.original).join('') + '</svg>';
  return { ...result, svg, paths: result.paths + added, contours: result.contours + added, segments: result.segments + 4 * added,
    diagnostics: { ...result.diagnostics, underpaintPairs: pairs.size, underpaintPaths: added } };
}
