/** Conservative StrokeRegularizer port. These functions only propose geometry;
 * engine.ts must evaluate the complete SVG before accepting a candidate. */
import { geometricHypot } from './geometry-math';
export type StrokePoint = [number, number];
export type StrokeCurve = { from: StrokePoint; to: StrokePoint; controls?: [StrokePoint, StrokePoint] };
export interface StrokeFit {
  fit: (points: StrokePoint[], tolerance: number, left: StrokePoint, right: StrokePoint) => StrokeCurve[];
  compact: (curves: StrokeCurve[], protectedPoints: StrokePoint[]) => StrokeCurve[];
}
const distance2 = (a: StrokePoint, b: StrokePoint) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const mix = (a: StrokePoint, b: StrokePoint, t: number): StrokePoint => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const unit = (a: StrokePoint, b: StrokePoint): StrokePoint => { const d = geometricHypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
const dot = (a: StrokePoint, b: StrokePoint) => a[0] * b[0] + a[1] * b[1];
const sub = (a: StrokePoint, b: StrokePoint): StrokePoint => [a[0] - b[0], a[1] - b[1]];
const lineDistance2 = (p: StrokePoint, a: StrokePoint, b: StrokePoint) => { const v = sub(b, a), d = dot(v, v); return distance2(p, mix(a, b, d ? Math.max(0, Math.min(1, dot(sub(p, a), v) / d)) : 0)); };

export function flattenStroke(curves: StrokeCurve[]): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (const curve of curves) {
    if (!points.length) points.push(curve.from);
    if (!curve.controls) { points.push(curve.to); continue; }
    const [c, d] = curve.controls, length = Math.sqrt(distance2(curve.from, c)) + Math.sqrt(distance2(c, d)) + Math.sqrt(distance2(d, curve.to));
    const steps = Math.max(16, Math.min(256, Math.ceil(length * 2)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      points.push([u ** 3 * curve.from[0] + 3 * u * u * t * c[0] + 3 * u * t * t * d[0] + t ** 3 * curve.to[0], u ** 3 * curve.from[1] + 3 * u * u * t * c[1] + 3 * u * t * t * d[1] + t ** 3 * curve.to[1]]);
    }
  }
  return points;
}

/** Same dense sampled deviation guard as the fitter, with a local segment grid.
 * Missing support rejects the proposal; it never relaxes the distance limit. */
export function strokeWithin(curves: StrokeCurve[], points: StrokePoint[], limit: number) {
  const grid = new Map<string, number[]>(), cell = 4; let cells = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], x0 = Math.floor((Math.min(a[0], b[0]) - limit) / cell), x1 = Math.floor((Math.max(a[0], b[0]) + limit) / cell), y0 = Math.floor((Math.min(a[1], b[1]) - limit) / cell), y1 = Math.floor((Math.max(a[1], b[1]) + limit) / cell);
    if ((cells += (x1 - x0 + 1) * (y1 - y0 + 1)) > 50000) return false;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const key = `${x},${y}`, edges = grid.get(key) ?? []; edges.push(i); grid.set(key, edges); }
  }
  for (const curve of curves) {
    const controls = curve.controls, length = controls ? Math.sqrt(distance2(curve.from, controls[0])) + Math.sqrt(distance2(controls[0], controls[1])) + Math.sqrt(distance2(controls[1], curve.to)) : Math.sqrt(distance2(curve.from, curve.to));
    const steps = Math.max(4, Math.min(2048, Math.ceil(length * 4)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, u = 1 - t, p: StrokePoint = controls ? [u ** 3 * curve.from[0] + 3 * u * u * t * controls[0][0] + 3 * u * t * t * controls[1][0] + t ** 3 * curve.to[0], u ** 3 * curve.from[1] + 3 * u * u * t * controls[0][1] + 3 * u * t * t * controls[1][1] + t ** 3 * curve.to[1]] : mix(curve.from, curve.to, t);
      if (!(grid.get(`${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`) ?? []).some(j => lineDistance2(p, points[j - 1], points[j]) <= limit * limit)) return false;
    }
  }
  return true;
}

export function strokeSelfIntersects(curves: StrokeCurve[]) {
  const points = flattenStroke(curves), grid = new Map<string, number[]>(), closed = points.length > 1 && distance2(points[0], points[points.length - 1]) < 1e-12; let cells = 0;
  const cross = (a: StrokePoint, b: StrokePoint, c: StrokePoint) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], x0 = Math.floor(Math.min(a[0], b[0]) / 8), x1 = Math.floor(Math.max(a[0], b[0]) / 8), y0 = Math.floor(Math.min(a[1], b[1]) / 8), y1 = Math.floor(Math.max(a[1], b[1]) / 8);
    if ((cells += (x1 - x0 + 1) * (y1 - y0 + 1)) > 50000) return true;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const key = `${x},${y}`, edges = grid.get(key) ?? [];
      for (const j of edges) { if (j === i - 1 || closed && j === 1 && i === points.length - 1) continue; const c = points[j - 1], d = points[j]; if (cross(a, b, c) * cross(a, b, d) < -1e-10 && cross(c, d, a) * cross(c, d, b) < -1e-10) return true; }
      edges.push(i); grid.set(key, edges);
    }
  }
  return false;
}

export function strokeCurvature(curve: StrokeCurve, end: boolean) {
  if (!curve.controls) return 0;
  const a = end ? curve.to : curve.from, b = curve.controls[end ? 1 : 0], c = curve.controls[end ? 0 : 1];
  const dx = 3 * (b[0] - a[0]), dy = 3 * (b[1] - a[1]), ddx = 6 * (a[0] - 2 * b[0] + c[0]), ddy = 6 * (a[1] - 2 * b[1] + c[1]), length = Math.hypot(dx, dy);
  return length < 1e-6 ? 0 : (end ? -1 : 1) * (dx * ddy - dy * ddx) / length ** 3;
}

export function strokeRoughness(curves: StrokeCurve[]) {
  let total = 0;
  for (let i = 0; i < curves.length; i++) {
    const a = curves[i], b = curves[(i + 1) % curves.length];
    if (!a.controls || !b.controls || distance2(a.to, b.from) > 1e-12 || dot(unit(a.controls[1], a.to), unit(b.from, b.controls[0])) < .98) continue;
    total += Math.min(4, Math.abs(strokeCurvature(a, true) - strokeCurvature(b, false)));
  }
  return total;
}

/** Move handles along existing C1 tangents, at most .24px, with fixed endpoints. */
export function fairStrokeCurvature(input: StrokeCurve[]) {
  const n = input.length; if (n < 5 || n > 256) return input;
  const eligible = input.map((a, i) => {
    const b = input[(i + 1) % n];
    if (!a.controls || !b.controls || distance2(a.to, b.from) > 1e-12 || dot(unit(a.controls[1], a.to), unit(b.from, b.controls[0])) < .9995 || distance2(a.to, a.controls[1]) < .25 || distance2(b.from, b.controls[0]) < .25) return false;
    const ka = strokeCurvature(a, true), kb = strokeCurvature(b, false);
    return Number.isFinite(ka + kb) && ka * kb > 0 && Math.abs(ka - kb) >= 1e-5;
  });
  if (!eligible.some(Boolean)) return input;
  const out: StrokeCurve[] = input.map(c => ({ ...c, controls: c.controls ? [[...c.controls[0]], [...c.controls[1]]] : undefined }));
  const energy = (index: number) => {
    let sum = 0;
    for (const join of [(index + n - 1) % n, index]) if (eligible[join]) sum += (strokeCurvature(out[join], true) - strokeCurvature(out[(join + 1) % n], false)) ** 2;
    for (let handle = 0; handle < 2; handle++) sum += .002 * distance2(out[index].controls![handle], input[index].controls![handle]);
    return sum;
  };
  let changed = false;
  for (let pass = 0; pass < 8; pass++) for (let join = 0; join < n; join++) if (eligible[join]) for (let side = 0; side < 2; side++) {
    const index = side === 0 ? join : (join + 1) % n, handle = side === 0 ? 1 : 0, curve = out[index], original = input[index];
    const anchor = handle === 0 ? curve.from : curve.to, direction = unit(anchor, original.controls![handle]), old = curve.controls![handle], length = Math.sqrt(distance2(anchor, old));
    let winner = old, best = energy(index);
    for (const step of [-.04, .04]) {
      const candidate: StrokePoint = [old[0] + step * direction[0], old[1] + step * direction[1]];
      if (length + step < .5 || distance2(candidate, original.controls![handle]) > .24 ** 2 + 1e-12) continue;
      curve.controls![handle] = candidate; const trial = energy(index);
      if (trial < best - 1e-10) { best = trial; winner = candidate; }
    }
    curve.controls![handle] = winner; if (winner !== old) changed = true;
  }
  return !changed || strokeRoughness(out) >= strokeRoughness(input) * .98 || strokeSelfIntersects(out) ? input : out;
}

export function balanceStrokeCurvature(input: StrokeCurve[], strength: number): StrokeCurve[] {
  if (input.length < 5 || input.length > 256) return input;
  const out = input.map(c => ({ ...c, controls: c.controls ? c.controls.map(p => [...p]) as [StrokePoint, StrokePoint] : undefined })); let changed = false;
  for (let i = 0; i < out.length; i++) {
    const a = out[i], b = out[(i + 1) % out.length];
    if (!a.controls || !b.controls || distance2(a.to, b.from) > 1e-12 || dot(unit(a.controls[1], a.to), unit(b.from, b.controls[0])) < .9995) continue;
    const ka = strokeCurvature(a, true), kb = strokeCurvature(b, false); if (ka * kb <= 0 || Math.abs(ka - kb) < 1e-4) continue;
    const target = (Math.abs(ka) + Math.abs(kb)) * .5;
    for (let side = 0; side < 2; side++) {
      const curve = side ? b : a, control = side ? 0 : 1, end = side ? b.from : a.to, handle = curve.controls![control], length = Math.sqrt(distance2(end, handle)); if (length < .1) continue;
      let factor = 1 + strength * (Math.sqrt(Math.abs(side ? kb : ka) / target) - 1), delta = Math.min(.15, .1 / length);
      factor = Math.max(1 - delta, Math.min(1 + delta, factor)); curve.controls![control] = mix(end, handle, factor); changed = true;
    }
  }
  return !changed || strokeRoughness(out) >= strokeRoughness(input) || strokeSelfIntersects(out) ? input : out;
}

const tangent = (points: StrokePoint[], i: number, n: number, closed: boolean) => unit(points[closed ? (i - 2 + n) % n : Math.max(0, i - 2)], points[closed ? (i + 2) % n : Math.min(n - 1, i + 2)]);
export function oppositeStrokeSides(points: StrokePoint[], closed: boolean, corners: Set<number>) {
  const n = points.length, pairs = new Int32Array(n).fill(-1), grid = new Map<string, number[]>(), normals = points.map((p, i): StrokePoint => { const t = tangent(points, i, n, closed), key = `${Math.floor(p[0] / 12)},${Math.floor(p[1] / 12)}`; const entries = grid.get(key) ?? []; entries.push(i); grid.set(key, entries); return [-t[1], t[0]]; });
  for (let i = 0; i < n; i++) {
    if (corners.has(i)) continue; const a = points[i], x = Math.floor(a[0] / 12), y = Math.floor(a[1] / 12); let best = 144;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of grid.get(`${x + dx},${y + dy}`) ?? []) {
      let separation = Math.abs(i - j); if (closed) separation = Math.min(separation, n - separation);
      if (separation < 8 || corners.has(j) || dot(normals[i], normals[j]) > -.85) continue;
      const d = distance2(a, points[j]); if (d < .75 ** 2 || d >= best || separation < 2 * Math.sqrt(d) || Math.abs(dot(unit(a, points[j]), normals[i])) < .95) continue;
      best = d; pairs[i] = j;
    }
  }
  return pairs;
}

export function regularizeStroke(input: StrokeCurve[], adapter: StrokeFit): StrokeCurve[] {
  if (input.length < 5 || input.length > 256) return input;
  const closed = distance2(input[0].from, input[input.length - 1].to) < 1e-12, points: StrokePoint[] = [], corners = new Set<number>();
  for (let k = 0; k < input.length; k++) {
    const curve = input[k]; if (!k) points.push(curve.from);
    const dense = flattenStroke([curve]); let length = 0;
    for (let i = 1; i < dense.length; i++) length += Math.sqrt(distance2(dense[i - 1], dense[i]));
    if (length > 2000 || points.length + length > 4000) return input;
    const steps = Math.max(1, Math.ceil(length)); let travelled = 0, edge = 1;
    for (let step = 1; step < steps; step++) {
      const target = length * step / steps;
      while (edge < dense.length - 1 && travelled + Math.sqrt(distance2(dense[edge - 1], dense[edge])) < target) { travelled += Math.sqrt(distance2(dense[edge - 1], dense[edge])); edge++; }
      const part = Math.sqrt(distance2(dense[edge - 1], dense[edge])); points.push(mix(dense[edge - 1], dense[edge], part < 1e-9 ? 0 : (target - travelled) / part));
    }
    points.push(curve.to);
    if (k + 1 < input.length || closed) {
      const next = input[(k + 1) % input.length], a = curve.controls ? unit(curve.controls[1], curve.to) : unit(curve.from, curve.to), b = next.controls ? unit(next.from, next.controls[0]) : unit(next.from, next.to);
      if (dot(a, b) < .98) corners.add(points.length - 1);
    }
  }
  const n = points.length - Number(closed); if (n < 8) return input;
  if (corners.delete(n)) corners.add(0); if (!closed) { corners.add(0); corners.add(n - 1); }
  const original = points.slice(0, n), pairs = oppositeStrokeSides(original, closed, corners); let fair = original.map(p => [...p] as StrokePoint);
  for (let pass = 0; pass < 4; pass++) {
    const next = fair.map(p => [...p] as StrokePoint);
    for (let i = 0; i < n; i++) {
      if (corners.has(i)) continue; const prev = (i + n - 1) % n, after = (i + 1) % n, a = Math.sqrt(distance2(fair[i], fair[prev])), b = Math.sqrt(distance2(fair[i], fair[after])), target = mix(fair[prev], fair[after], a / Math.max(1e-9, a + b)), value = mix(fair[i], target, .45), d = Math.sqrt(distance2(value, original[i]));
      next[i] = d > .22 ? mix(original[i], value, .22 / d) : value;
    }
    for (let i = 0; i < n; i++) {
      const j = pairs[i]; if (j <= i || pairs[j] !== i || corners.has(i) || corners.has(j)) continue;
      const normal = unit(original[i], original[j]), di = dot(sub(next[i], original[i]), normal), dj = dot(sub(next[j], original[j]), normal), correction = (dj - di) / 2;
      next[i] = [next[i][0] + correction * normal[0], next[i][1] + correction * normal[1]]; next[j] = [next[j][0] - correction * normal[0], next[j][1] - correction * normal[1]];
    }
    fair = next;
  }
  if (closed) fair.push(fair[0]);
  const cuts = new Set([0, fair.length - 1, ...corners]); if (closed) { let far = 1; for (let i = 2; i < n; i++) if (distance2(fair[i], fair[0]) > distance2(fair[far], fair[0])) far = i; cuts.add(far); }
  const boundaries = [...cuts].sort((a, b) => a - b); let result: StrokeCurve[] = [];
  for (let k = 1; k < boundaries.length; k++) {
    const a = boundaries[k - 1], b = boundaries[k], left = corners.has(a % n) ? unit(fair[a], fair[a + 1]) : tangent(fair, a % n, n, closed), right = corners.has(b % n) ? unit(fair[b - 1], fair[b]) : tangent(fair, b % n, n, closed);
    result.push(...adapter.fit(fair.slice(a, b + 1), .12, left, [-right[0], -right[1]]));
  }
  result = adapter.compact(result, [...corners].map(i => fair[i]));
  if (result.length > input.length * 1.25 || strokeRoughness(result) >= strokeRoughness(input) * .98 && result.length >= input.length || strokeSelfIntersects(result) || !strokeWithin(input, flattenStroke(result), .3) || !strokeWithin(result, points, .3)) return input;
  return result;
}
