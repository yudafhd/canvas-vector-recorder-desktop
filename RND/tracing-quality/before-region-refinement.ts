/** Independent implementation of researched mechanisms plus explicitly marked adapters.
 * Evidence and scope: docs/TRACING-RESEARCH-MAP.md. No target binary is loaded.
 */
export interface TraceOptions { colors: number; tolerance: number; minArea: number; smooth: boolean; removeWhite: boolean }
export interface TraceResult { svg: string; colors: string[]; paths: number; contours: number; segments: number; width: number; height: number; diagnostics: TraceDiagnostics }
export interface TraceDiagnostics { unitFragments: number; merges: number; swaps: number; puncturedCorners: number; tangentRefits: number; rasterSteps: number; rasterEnergyBefore: number; rasterEnergyAfter: number; smallAreaConstraints: number; guardedFits: number; fitDeviationBefore: number; fitDeviationAfter: number }
type Point = [number, number];
type RGB = [number, number, number];
type Curve = { from: Point; to: Point; controls?: [Point, Point] };
type Edge = { a: number; b: number; right: number; left: number; chain: number; forward: boolean };
type Chain = { curves: Curve[] };
type Measurement = { target: Point; normal: Point; weight: number };
type Loop = { data: string; area: number; nodes: Point[]; segments: number };
type Region = { label: number; seed: number; loops: Loop[] };
type RasterField = { width: number; height: number; observed: Uint8ClampedArray; predicted: Float64Array };
type RasterChain = { field: RasterField; difference: number[] };
const distance2 = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0);
const mix = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const unit = (a: Point, b: Point): Point => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const xy = (p: Point) => `${fmt(p[0])} ${fmt(p[1])}`;

// [R4-FIT] Recovered fixed-end solver and branch costs, phase4-findings §2–3.
// Coordinates and sample density are supplied by our contour pipeline.
export function fitFixedEnds(points: Point[]) {
  if (points.length < 2 || points.some(p => !p.every(Number.isFinite))) throw new Error('Invalid fit samples');
  const a = points[0], b = points[points.length - 1], n = points.length - 2;
  const times = [0];
  for (let i = 1; i < points.length; i++) times.push(times[i - 1] + Math.sqrt(distance2(points[i], points[i - 1])));
  const total = times[times.length - 1] || 1;
  for (let i = 1; i < times.length; i++) times[i] /= total;
  let controls: [Point, Point] = n === 0 ? [b, a] : [mix(a, b, 0.25), mix(a, b, 0.75)];
  if (n === 3) {
    let diagonal = 1e-5; const rhs: Point = [0, 0];
    for (let i = 1; i <= n; i++) {
      const t = times[i], u = 1 - t, w = 2 * u * t;
      diagonal += w * w;
      for (let k = 0; k < 2; k++) rhs[k] += w * (points[i][k] - u * u * a[k] - t * t * b[k]);
    }
    const q: Point = [rhs[0] / diagonal, rhs[1] / diagonal];
    controls = [mix(a, q, 2 / 3), mix(b, q, 2 / 3)];
  } else if (n >= 4) {
    // Two independent 2×2 blocks equal the recovered 4×4 normal system.
    // The 1e-5 diagonal regularizes absolute control coordinates, not tangents.
    let aa = 1e-5, ab = 0, bb = 1e-5;
    const r1: Point = [0, 0], r2: Point = [0, 0];
    for (let i = 1; i <= n; i++) {
      const t = times[i], u = 1 - t, w1 = 3 * u * u * t, w2 = 3 * u * t * t;
      aa += w1 * w1; ab += w1 * w2; bb += w2 * w2;
      for (let k = 0; k < 2; k++) {
        const r = points[i][k] - u ** 3 * a[k] - t ** 3 * b[k];
        r1[k] += w1 * r; r2[k] += w2 * r;
      }
    }
    const determinant = aa * bb - ab * ab;
    controls = [[(r1[0] * bb - r2[0] * ab) / determinant, (r1[1] * bb - r2[1] * ab) / determinant],
      [(r2[0] * aa - r1[0] * ab) / determinant, (r2[1] * aa - r1[1] * ab) / determinant]];
  }
  const curve: Curve = { from: a, to: b, controls };
  let cost = 0, maxError = 0;
  for (let i = 1; i <= n; i++) {
    const residual = distance2(bezier(a, controls[0], controls[1], b, times[i]), points[i]);
    maxError = Math.max(maxError, residual);
    if (n >= 3) cost += residual;
  }
  // Recovered quirk: n=1/2 cost uses linear interpolation at sample 0 only.
  // Do not replace it with cubic SSE or add the solver's ridge penalty.
  if (n === 1 || n === 2) cost = distance2(mix(a, b, times[1]), points[1]);
  return { curve, cost, maxError, times, interiorSamples: n };
}

// [R3-MERGE] Strict comparisons and priority recovered from considerMergeAndSwap.
export function chooseFragmentOperation(merge: number, threshold: number, swapMinus: number, swapPlus: number): 'merge' | 'swap-' | 'swap+' | 'keep' {
  if (Number.isFinite(merge) && merge < threshold) return 'merge';
  if (Number.isFinite(swapMinus) && swapMinus < 0) return 'swap-';
  if (Number.isFinite(swapPlus) && swapPlus < 0) return 'swap+';
  return 'keep';
}

// [R4-SLIDER] Advanced complexity mapping. Not the active settings of our fixture.
export function complexityThresholds(complexity: number) {
  if (!Number.isInteger(complexity) || complexity < 1 || complexity > 12) throw new Error('Invalid complexity');
  const d = 12 - complexity;
  return { initial: Math.fround(0.0001 * (d + 1)), final: Math.fround(0.1 * Math.exp(0.4816652151407306 * d)) };
}

// [R3-SCHEDULE] Scan at T, then update, with expf input/output rounding.
export function mergeThresholdSchedule(initial: number, final: number, iterations = 20, fraction = 0.5) {
  if (!(initial > 0 && final > 0 && Number.isFinite(initial) && Number.isFinite(final) && Number.isInteger(iterations) && iterations > 0 && fraction > 0 && fraction <= 1)) throw new Error('Invalid merge schedule');
  const q = Math.fround(Math.exp(Math.fround(Math.log(final / initial) / (iterations * fraction))));
  const thresholds: number[] = []; let t = initial;
  for (let i = 0; i < iterations; i++) { thresholds.push(t); t = i < iterations * fraction ? t * q : final; }
  return thresholds;
}

// [R5-CORNER] Finite-input feature reconstruction and recovered classifier.
export function cornerFeatures(points: Point[]) {
  if (points.length !== 7 || points.some(p => !p.every(Number.isFinite))) throw new Error('Expected seven finite points');
  const directions: Point[] = [], lengths: number[] = [];
  for (let i = 1; i < 7; i++) { lengths.push(Math.sqrt(distance2(points[i - 1], points[i]))); directions.push(unit(points[i - 1], points[i])); }
  const turns = directions.slice(1).map((v, i) => 2 - 2 * dot(directions[i], v));
  const sides = turns[1] > turns[3] ? [...turns].reverse() : turns;
  const neighbors = [turns[0], turns[1], turns[3], turns[4]], three = [sides[0], sides[1], sides[4]];
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  const deviation = (v: number[]) => Math.sqrt(sum(v.map(x => x * x)) / v.length - (sum(v) / v.length) ** 2);
  return [sum(neighbors), turns[1] + turns[3], sum(three), sides[0] + sides[1], ...sides, ...lengths,
    Number(turns[2] === Math.max(...turns)), Math.min(...neighbors), [...neighbors].sort((a, b) => a - b)[1], deviation(neighbors), [...three].sort((a, b) => a - b)[1], deviation(three)];
}
export function probablyPunctured(f: number[]) {
  if (f.length !== 21 || [0, 2, 6, 8, 15, 16].some(i => !Number.isFinite(f[i]))) return false; // independent degenerate-input policy
  const c = f[6];
  if (c < 0.611194) {
    if (c < 0.282594 || f[0] >= 0.322933) return false;
    return c >= 0.483023 || f[0] < 0.0286571 || f[2] < 0.00209524;
  }
  if (f[15] < 0.5) return c >= 1.72002;
  if (f[16] >= 0.097537) return false;
  return c >= 1.42496 || f[2] < 0.122841 || f[0] < 0.445642 || f[8] < 0.0046405;
}

// [R7-TRACE] Local rule only. Full owner-node/zero-candidate VM cycle is unresolved.
export function chooseBoundaryCandidate(candidates: { direction: number; first: Point }[], context?: Point) {
  if (!candidates.length) return -1;
  const order = candidates.map((_, i) => i).sort((a, b) => candidates[a].direction - candidates[b].direction);
  if (!context) return order[0];
  return order.find(i => candidates[i].first[0] === context[0] && candidates[i].first[1] === context[1]) ?? order[order.length - 1];
}

// [R10-COVERAGE] Signed clipped area implements the recovered coverage × color
// model. Rectangle clipping is our implementation, not VM's breadcrumb state.
export function polygonPixelArea(polygon: Point[], x: number, y: number) {
  let points = polygon.map(p => [p[0] - x, p[1] - y] as Point);
  for (const [axis, bound, sign] of [[0, 0, 1], [0, 1, -1], [1, 0, 1], [1, 1, -1]]) {
    const clipped: Point[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const da = sign * (a[axis] - bound), db = sign * (b[axis] - bound);
      if (da >= 0) clipped.push(a);
      if ((da >= 0) !== (db >= 0)) clipped.push(mix(a, b, da / (da - db)));
    }
    points = clipped;
    if (points.length < 3) return 0;
  }
  return signedArea(points);
}
// Reusable triangle clipper for the hot raster loop. Keep clipping order and
// arithmetic identical to polygonPixelArea; scratch buffers belong to one
// objective, so concurrent workers and separate objectives cannot share state.
function trianglePixelClipper() {
  const first = new Float64Array(16), second = new Float64Array(16);
  return (a: Point, b: Point, c: Point, x: number, y: number) => {
    let input = first, output = second, count = 3;
    input[0] = a[0] - x; input[1] = a[1] - y;
    input[2] = b[0] - x; input[3] = b[1] - y;
    input[4] = c[0] - x; input[5] = c[1] - y;
    for (let plane = 0; plane < 4; plane++) {
      const axis = plane >> 1, bound = plane & 1, sign = bound ? -1 : 1;
      let size = 0;
      for (let i = 0; i < count; i++) {
        const ai = i * 2, bi = ((i + 1) % count) * 2;
        const da = sign * (input[ai + axis] - bound), db = sign * (input[bi + axis] - bound);
        if (da >= 0) { output[size++] = input[ai]; output[size++] = input[ai + 1]; }
        if ((da >= 0) !== (db >= 0)) {
          const t = da / (da - db);
          output[size++] = input[ai] + (input[bi] - input[ai]) * t;
          output[size++] = input[ai + 1] + (input[bi + 1] - input[ai + 1]) * t;
        }
      }
      count = size / 2;
      if (count < 3) return 0;
      const swap = input; input = output; output = swap;
    }
    let twice = 0;
    for (let i = 0; i < count; i++) { const ai = i * 2, bi = ((i + 1) % count) * 2; twice += input[ai] * input[bi + 1] - input[ai + 1] * input[bi]; }
    return twice / 2;
  };
}
export function signedArea(points: Point[]) {
  let twice = 0;
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; twice += a[0] * b[1] - a[1] * b[0]; }
  return twice / 2;
}

// Boundary integral derivative of coverage inside one pixel. At an exact grid
// line we choose the symmetric derivative, split between its two adjacent cells.
export function pixelEdgeGradient(a: Point, b: Point, x: number, y: number) {
  const dx = b[0] - a[0], dy = b[1] - a[1]; let lo = 0, hi = 1, weight = 1;
  if (dx === 0 && dy === 0) return [0, 0, 0, 0];
  for (const [start, delta, minimum] of [[a[0], dx, x], [a[1], dy, y]]) {
    if (delta === 0) {
      if (start < minimum || start > minimum + 1) return [0, 0, 0, 0];
      if (start === minimum || start === minimum + 1) weight *= 0.5;
    } else {
      const t0 = (minimum - start) / delta, t1 = (minimum + 1 - start) / delta;
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
    }
  }
  if (hi <= lo) return [0, 0, 0, 0];
  const wb = weight * (hi * hi - lo * lo) / 2, wa = weight * (hi - lo) - wb;
  return [-dy * wa, dx * wa, -dy * wb, dx * wb];
}

// [R3-ANGULAR] Recovered potential; gradient derived analytically from it.
// h1/h2 count original steps. Collapsed segments use an independent finite guard.
export function angularPrior(a: Point, b: Point, c: Point, h1 = 1, h2 = 1, lengthWeight = 0.25) {
  const u: Point = [b[0] - a[0], b[1] - a[1]], v: Point = [c[0] - b[0], c[1] - b[1]];
  const lu = Math.hypot(...u), lv = Math.hypot(...v);
  if (lu < 1e-8 || lv < 1e-8 || h1 <= 0 || h2 <= 0) return { energy: Infinity, gradient: [[0, 0], [0, 0], [0, 0]] as Point[] };
  const nu: Point = [u[0] / lu, u[1] / lu], nv: Point = [v[0] / lv, v[1] / lv];
  const cosine = Math.max(-1, Math.min(1, dot(nu, nv))), bend = Math.sqrt(2 - 2 * cosine + 0.001), length = lv / h2 - lu / h1;
  const gu = [0, 1].map(k => -(nv[k] - cosine * nu[k]) / (lu * bend) - 2 * lengthWeight * length * nu[k] / h1) as Point;
  const gv = [0, 1].map(k => -(nu[k] - cosine * nv[k]) / (lv * bend) + 2 * lengthWeight * length * nv[k] / h2) as Point;
  return { energy: bend + lengthWeight * length * length,
    gradient: [[-gu[0], -gu[1]], [gu[0] - gv[0], gu[1] - gv[1]], gv] as Point[] };
}

// [R10-RASTER] Pixel predictions begin at the label raster. Moving a shared edge
// adds its signed swept area × (left-right color) exactly once. Neighboring
// sweeps cancel at shared vertices. No clamp hides negative/overlapping coverage.
// [ADAPTER-RASTER] We use host premultiplied RGBA and optimize chains in sequence;
// VM's channel preprocessing, global doCG and inversion flags remain unresolved.
export function coverageObjective(raw: Point[], field: RasterField, difference: number[]) {
  const closed = distance2(raw[0], raw[raw.length - 1]) === 0, count = raw.length - Number(closed);
  const indices: number[] = [], offsets = new Map<number, number>(), patches: number[][] = [];
  for (let i = 0; i + 1 < raw.length; i++) {
    const patch: number[] = [], a = raw[i], b = raw[i + 1];
    for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1]) - 1)); y < Math.min(field.height, Math.ceil(Math.max(a[1], b[1]) + 1)); y++)
      for (let x = Math.max(0, Math.floor(Math.min(a[0], b[0]) - 1)); x < Math.min(field.width, Math.ceil(Math.max(a[0], b[0]) + 1)); x++) {
        const id = y * field.width + x;
        if (!offsets.has(id)) { offsets.set(id, indices.length); indices.push(id); }
        patch.push(offsets.get(id)!);
      }
    patches.push(patch);
  }
  const base = new Float64Array(indices.length * 4), observed = new Float64Array(base.length);
  indices.forEach((id, i) => {
    const alpha = field.observed[id * 4 + 3] / 255;
    for (let c = 0; c < 4; c++) { base[i * 4 + c] = field.predicted[id * 4 + c]; observed[i * 4 + c] = c === 3 ? alpha : field.observed[id * 4 + c] / 255 * alpha; }
  });
  const clipTriangle = trianglePixelClipper();
  const xs = indices.map(id => id % field.width), ys = indices.map(id => Math.floor(id / field.width));
  const differentiate = (points: Point[], predicted: Float64Array) => {
    const gradient = Array.from({ length: count }, () => [0, 0] as Point);
    for (let i = 0; i < patches.length; i++) {
      const next = (i + 1) % count;
      for (const p of patches[i]) {
        const g = pixelEdgeGradient(points[i], points[next], xs[p], ys[p]);
        let residual = 0;
        for (let c = 0; c < 4; c++) residual += difference[c] * (predicted[p * 4 + c] - observed[p * 4 + c]);
        gradient[i][0] += residual * g[0]; gradient[i][1] += residual * g[1];
        gradient[next][0] += residual * g[2]; gradient[next][1] += residual * g[3];
      }
    }
    return gradient;
  };
  const evaluate = (points: Point[], withGradient = true) => {
    const predicted = new Float64Array(base);
    for (let i = 0; i < patches.length; i++) {
      const a = points[i], b = points[(i + 1) % count], oldA = raw[i], oldB = raw[i + 1];
      if (distance2(a, oldA) + distance2(b, oldB) < 1e-24) continue;
      for (const p of patches[i]) {
        const x = xs[p], y = ys[p];
        const area = clipTriangle(oldA, oldB, b, x, y) + clipTriangle(oldA, b, a, x, y);
        for (let c = 0; c < 4; c++) predicted[p * 4 + c] += area * difference[c];
      }
    }
    let energy = 0;
    for (let i = 0; i < predicted.length; i++) energy += 0.5 * (predicted[i] - observed[i]) ** 2;
    return { energy, gradient: withGradient ? differentiate(points, predicted) : [], predicted };
  };
  return { evaluate, differentiate, commit: (prediction: Float64Array) => indices.forEach((id, i) => field.predicted.set(prediction.subarray(i * 4, i * 4 + 4), id * 4)), indices };
}

// [APPROX-PALETTE] Histogram, seeds and RGB weights are independently chosen.

function quantize(rgba: Uint8ClampedArray, count: number) {
  const bins = new Map<number, { sum: RGB; count: number }>();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const key = (rgba[i] >> 3) * 1024 + (rgba[i + 1] >> 3) * 32 + (rgba[i + 2] >> 3);
    const bin = bins.get(key) ?? { sum: [0, 0, 0] as RGB, count: 0 };
    bin.count++;
    for (let c = 0; c < 3; c++) bin.sum[c] += rgba[i + c];
    bins.set(key, bin);
  }
  const samples = [...bins.entries()].map(([key, bin]) => ({ key, n: bin.count, color: bin.sum.map(v => v / bin.count) as RGB }));
  if (!samples.length) throw new Error('Gambar sepenuhnya transparan. Pilih gambar dengan bidang berwarna.');
  samples.sort((a, b) => b.n - a.n || a.key - b.key);
  const palette: RGB[] = [[...samples[0].color]];
  while (palette.length < Math.min(count, samples.length)) {
    let best = -1, score = 0;
    for (let i = 0; i < samples.length; i++) {
      const d = Math.min(...palette.map(p => distance2(p, samples[i].color)));
      const weighted = d * samples[i].n;
      if (weighted > score) { best = i; score = weighted; }
    }
    if (best < 0 || score < 1) break;
    palette.push([...samples[best].color]);
  }
  const assignments = new Int16Array(32768).fill(-1);
  for (let pass = 0; pass < 12; pass++) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    let changed = false;
    for (const sample of samples) {
      let best = 0, cost = Infinity;
      palette.forEach((p, k) => { const d = distance2(p, sample.color); if (d < cost) { cost = d; best = k; } });
      if (assignments[sample.key] !== best) changed = true;
      assignments[sample.key] = best;
      for (let c = 0; c < 3; c++) sums[best][c] += sample.color[c] * sample.n;
      sums[best][3] += sample.n;
    }
    palette.forEach((p, k) => { if (sums[k][3]) for (let c = 0; c < 3; c++) p[c] = sums[k][c] / sums[k][3]; });
    if (!changed) break;
  }
  // Assign once more to the final centers, rather than the centers from the previous pass.
  for (const sample of samples) {
    let best = 0, cost = Infinity;
    palette.forEach((p, k) => { const d = distance2(p, sample.color); if (d < cost) { cost = d; best = k; } });
    assignments[sample.key] = best;
  }
  const labels = new Int16Array(rgba.length / 4).fill(-1);
  for (let i = 0; i < labels.length; i++) {
    const j = i * 4;
    if (rgba[j + 3] >= 128) labels[i] = assignments[(rgba[j] >> 3) * 1024 + (rgba[j + 1] >> 3) * 32 + (rgba[j + 2] >> 3)];
  }
  return { palette, labels };
}

// Near-identical palette centers and colors found only in narrow transition
// bands fragment otherwise smooth boundaries. Keep real interior colors and
// isolated high-contrast details; the requested count is an upper bound.
// [APPROX-SEGMENTATION] Our palette/interior support heuristic, not PixelSegmenter cost.
function compactPalette(rgba: Uint8ClampedArray, labels: Int16Array, palette: RGB[], width: number, height: number, minArea: number) {
  const populations = new Int32Array(palette.length);
  for (const label of labels) if (label >= 0) populations[label]++;
  const representative = palette.map((_, i) => i);
  const order = palette.map((_, i) => i).sort((a, b) => populations[b] - populations[a]);
  for (let rank = 0; rank < order.length; rank++) {
    const i = order[rank];
    for (const j of order.slice(0, rank)) {
      if (representative[j] !== j) continue;
      if (distance2(palette[i], palette[j]) <= 18 ** 2) { representative[i] = j; break; }
    }
  }
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) labels[i] = representative[labels[i]];
  const interiors = new Int32Array(palette.length);
  for (let y = 1; y + 1 < height; y++) for (let x = 1; x + 1 < width; x++) {
    const label = labels[y * width + x]; if (label < 0) continue;
    let same = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (labels[(y + dy) * width + x + dx] === label) same++;
    if (same >= 8) interiors[label]++;
  }
  const stable = order.filter(i => representative[i] === i && interiors[i] >= Math.max(4, minArea));
  const retained = order.filter(i => representative[i] === i && (stable.includes(i) || !stable.some(j => distance2(palette[i], palette[j]) <= 96 ** 2)));
  if (retained.length < 2 || retained.length === palette.length) return;
  const compact = retained.map(i => palette[i]);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] < 0) continue;
    const offset = i * 4; let best = 0, error = Infinity;
    for (let k = 0; k < compact.length; k++) {
      const color = compact[k], e = (rgba[offset] - color[0]) ** 2 + (rgba[offset + 1] - color[1]) ** 2 + (rgba[offset + 2] - color[2]) ** 2;
      if (e < error) { error = e; best = k; }
    }
    labels[i] = best;
  }
  palette.splice(0, palette.length, ...compact);
}

// JPEG and antialiased edges contain mixtures of the two neighboring colors.
// Global nearest-color assignment can turn that mixture into an unrelated third
// palette color. Only replace locally unsupported transition pixels, never alpha.
function refineTransitions(rgba: Uint8ClampedArray, labels: Int16Array, width: number, height: number, palette: RGB[]) {
  const result = new Int16Array(labels), counts = new Uint8Array(palette.length);
  const paletteDistance = palette.map(a => palette.map(b => distance2(a, b)));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x, current = labels[index];
    if (current < 0) continue;
    let same = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      if (labels[(y + dy) * width + x + dx] === current) same++;
    }
    if (same >= 5) continue;
    counts.fill(0);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      const label = labels[(y + dy) * width + x + dx];
      if (label >= 0) counts[label]++;
    }
    const offset = index * 4, pixel: RGB = [rgba[offset], rgba[offset + 1], rgba[offset + 2]];
    let best = distance2(pixel, palette[current]) + 64, replacement = current;
    for (let a = 0; a < palette.length; a++) {
      if (a === current || counts[a] < 3) continue;
      for (let b = a + 1; b < palette.length; b++) {
        const separation = paletteDistance[a][b];
        if (b === current || counts[b] < 3 || counts[a] + counts[b] <= counts[current] * 2 || separation < 4000) continue;
        const p = palette[a], q = palette[b];
        const t = ((pixel[0] - p[0]) * (q[0] - p[0]) + (pixel[1] - p[1]) * (q[1] - p[1]) + (pixel[2] - p[2]) * (q[2] - p[2])) / separation;
        if (t < 0.1 || t > 0.9) continue;
        const error = distance2(pixel, p.map((v, c) => v + (q[c] - v) * t));
        if (error < best) { best = error; replacement = t < 0.5 ? a : b; }
      }
    }
    result[index] = replacement;
  }
  labels.set(result);
}

// [APPROX-SEGMENTATION] Region-area and shared-border heuristic; VM thresholds unknown.
function cleanRegions(labels: Int16Array, width: number, height: number, minArea: number, palette: RGB[]) {
  if (minArea <= 1) return;
  const visited = new Uint8Array(labels.length);
  const queue = new Int32Array(labels.length);
  for (let seed = 0; seed < labels.length; seed++) {
    if (visited[seed] || labels[seed] < 0) continue;
    const color = labels[seed];
    let head = 0, tail = 1;
    queue[0] = seed; visited[seed] = 1;
    const neighbors = new Map<number, number>();
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      const next = [x > 0 ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y > 0 ? p - width : -1, y + 1 < height ? p + width : -1];
      for (const q of next) {
        if (q < 0) continue;
        if (labels[q] !== color) { neighbors.set(labels[q], (neighbors.get(labels[q]) ?? 0) + 1); continue; }
        if (!visited[q]) { visited[q] = 1; queue[tail++] = q; }
      }
    }
    if (tail >= minArea) continue;
    let replacement = color, best = -Infinity;
    for (const [label, border] of neighbors) {
      if (label < 0) continue;
      const score = border / (1 + Math.sqrt(distance2(palette[color], palette[label])));
      if (score > best) { best = score; replacement = label; }
    }
    if (replacement === color && neighbors.has(-1)) replacement = -1;
    for (let i = 0; i < tail; i++) labels[queue[i]] = replacement;
  }
}

// Region identity allows nested shapes to be painted over their parent instead
// of cutting a hole at every color transition. Transparency components are also
// retained so genuine holes remain empty through all ancestor layers.
// [ADAPTER-REGIONS] Our 4-connectivity policy; VM's complete connectivity is unresolved.
function identifyRegions(labels: Int16Array, width: number, height: number) {
  const ids = new Int32Array(labels.length).fill(-1), queue = new Int32Array(labels.length);
  const regions: Region[] = [];
  for (let seed = 0; seed < labels.length; seed++) {
    if (ids[seed] >= 0) continue;
    const id = regions.length, label = labels[seed];
    regions.push({ label, seed, loops: [] });
    let head = 0, tail = 1; queue[0] = seed; ids[seed] = id;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      for (const q of [x > 0 ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y > 0 ? p - width : -1, y + 1 < height ? p + width : -1]) {
        if (q >= 0 && ids[q] < 0 && labels[q] === label) { ids[q] = id; queue[tail++] = q; }
      }
    }
  }
  return { ids, regions };
}

function containsPoint(nodes: Point[], p: Point) {
  let inside = false;
  for (let i = 0, j = nodes.length - 1; i < nodes.length; j = i++) {
    const a = nodes[i], b = nodes[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function lineDistance2(p: Point, a: Point, b: Point) {
  const v: Point = [b[0] - a[0], b[1] - a[1]], length = dot(v, v);
  const t = length ? Math.max(0, Math.min(1, dot([p[0] - a[0], p[1] - a[1]], v) / length)) : 0;
  return distance2(p, mix(a, b, t));
}

// Indices of a polyline simplified within a pixel-distance budget. Used for sharp
// corners only; individual turns of the pixel staircase must not become corners.
function simplify(points: Point[], tolerance: number): number[] {
  const keep = new Set([0, points.length - 1]), stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let error = tolerance * tolerance, split = -1;
    for (let i = a + 1; i < b; i++) {
      const e = lineDistance2(points[i], points[a], points[b]);
      if (e > error) { error = e; split = i; }
    }
    if (split >= 0) { keep.add(split); stack.push([a, split], [split, b]); }
  }
  return [...keep].sort((a, b) => a - b);
}

function bezier(a: Point, c: Point, d: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return [0, 1].map(k => u ** 3 * a[k] + 3 * u * u * t * c[k] + 3 * u * t * t * d[k] + t ** 3 * b[k]) as Point;
}

// [ADAPTER-FIT-GUARD] Inspect between fitted samples too. This sampled
// curve-to-polyline distance is our export diagnostic, not the VM fitting cost
// or a certified Hausdorff bound. Source-raster quality is tested separately.
export function curveDeviation(curves: Curve[], points: Point[]) {
  let maximum = 0;
  for (const curve of curves) {
    const controls = curve.controls;
    const length = controls ? Math.sqrt(distance2(curve.from, controls[0])) + Math.sqrt(distance2(controls[0], controls[1])) + Math.sqrt(distance2(controls[1], curve.to)) : Math.sqrt(distance2(curve.from, curve.to));
    const steps = Math.max(4, Math.min(2048, Math.ceil(length * 4)));
    for (let i = 0; i <= steps; i++) {
      const p = controls ? bezier(curve.from, controls[0], controls[1], curve.to, i / steps) : mix(curve.from, curve.to, i / steps);
      let nearest = Infinity;
      for (let j = 1; j < points.length; j++) nearest = Math.min(nearest, lineDistance2(p, points[j - 1], points[j]));
      maximum = Math.max(maximum, nearest);
    }
  }
  return Math.sqrt(maximum);
}

// [ADAPTER-TANGENTS] Independent export guard: retain shared tangents and a
// maximum sample error. This reparameterizing fit is not the recovered VM solver.
function fitWithSharedTangents(points: Point[], tolerance: number, left: Point, right: Point, depth = 0): Curve[] {
  const a = points[0], b = points[points.length - 1], chord = Math.sqrt(distance2(a, b));
  const along = unit(a, b), back: Point = [-along[0], -along[1]];
  let lineError = 0;
  for (const p of points) lineError = Math.max(lineError, lineDistance2(p, a, b));
  // A line may replace a cubic only when it also preserves the endpoint tangents.
  if (lineError <= tolerance ** 2 && dot(left, along) > 0.9995 && dot(right, back) > 0.9995) return [{ from: a, to: b }];
  const times = [0];
  for (let i = 1; i < points.length; i++) times.push(times[i - 1] + Math.sqrt(distance2(points[i], points[i - 1])));
  const length = times[times.length - 1] || 1;
  for (let i = 1; i < times.length; i++) times[i] /= length;
  let split = Math.floor(points.length / 2);
  for (let pass = 0; pass < 5; pass++) {
    let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
    for (let i = 0; i < points.length; i++) {
      const t = times[i], u = 1 - t, w1 = 3 * u * u * t, w2 = 3 * u * t * t;
      const r: Point = [points[i][0] - a[0] * (u ** 3 + w1) - b[0] * (w2 + t ** 3), points[i][1] - a[1] * (u ** 3 + w1) - b[1] * (w2 + t ** 3)];
      c00 += w1 * w1; c01 += w1 * w2 * dot(left, right); c11 += w2 * w2;
      x0 += w1 * dot(left, r); x1 += w2 * dot(right, r);
    }
    const det = c00 * c11 - c01 * c01;
    let alpha = (x0 * c11 - x1 * c01) / det, beta = (x1 * c00 - x0 * c01) / det;
    if (!(alpha > chord * 1e-4 && beta > chord * 1e-4 && alpha < length && beta < length)) alpha = beta = chord / 3;
    const c: Point = [a[0] + left[0] * alpha, a[1] + left[1] * alpha];
    const d: Point = [b[0] + right[0] * beta, b[1] + right[1] * beta];
    let error = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const e = distance2(bezier(a, c, d, b, times[i]), points[i]);
      if (e > error) { error = e; split = i; }
    }
    if (error <= tolerance ** 2) return [{ from: a, to: b, controls: [c, d] }];
    if (error > tolerance ** 2 * 16 || pass === 4) break;
    // Project samples onto the curve. Preserve ordering so the fit cannot hide
    // a reversal by mapping several contour samples to the same parameter.
    const next = [...times];
    for (let i = 1; i < points.length - 1; i++) {
      const t = times[i], u = 1 - t, p = bezier(a, c, d, b, t);
      const v = [0, 1].map(k => 3 * (u * u * (c[k] - a[k]) + 2 * u * t * (d[k] - c[k]) + t * t * (b[k] - d[k]))) as Point;
      const acc = [0, 1].map(k => 6 * (u * (d[k] - 2 * c[k] + a[k]) + t * (b[k] - 2 * d[k] + c[k]))) as Point;
      const delta: Point = [p[0] - points[i][0], p[1] - points[i][1]], denominator = dot(v, v) + dot(delta, acc);
      if (denominator > 1e-9) next[i] = Math.max((times[i - 1] + t) / 2, Math.min((times[i + 1] + t) / 2, t - dot(delta, v) / denominator));
    }
    for (let i = 1; i < times.length - 1; i++) times[i] = next[i];
  }
  if (depth >= 20) split = Math.floor(points.length / 2);
  const radius = Math.min(3, split, points.length - 1 - split);
  const tangent = unit(points[split - radius], points[split + radius]);
  return [...fitWithSharedTangents(points.slice(0, split + 1), tolerance, left, [-tangent[0], -tangent[1]], depth + 1), ...fitWithSharedTangents(points.slice(split), tolerance, tangent, right, depth + 1)];
}

// [R5-FRAGMENTS, R3-MERGE] Unit fragments, cost cache and terminal record.
// [ADAPTER-FRAGMENTS] Range partition, UI-detail mapping and max-error veto are
// ours; the original node state machine/sample density is not reconstructed.
function selectFragments(points: Point[], tolerance: number, diagnostics: TraceDiagnostics) {
  type Fragment = { start: number; end: number; next?: Fragment; fit?: ReturnType<typeof fitFixedEnds> };
  const records: Fragment[] = points.map((_, start) => ({ start, end: Math.min(start + 1, points.length - 1) }));
  records.forEach((record, i) => { record.next = records[i + 1]; });
  diagnostics.unitFragments += records.length - 1;
  const fitted = (f: Fragment) => f.fit ??= fitFixedEnds(points.slice(f.start, f.end + 1));
  const candidate = (start: number, end: number) => fitFixedEnds(points.slice(start, end + 1));
  const allowed = (f: ReturnType<typeof fitFixedEnds>) => Number.isFinite(f.cost) && f.maxError <= tolerance ** 2;
  const complexity = Math.max(1, Math.min(12, Math.round(6 - 4 * Math.log2(tolerance / 0.8))));
  const settings = complexityThresholds(complexity);
  for (const threshold of mergeThresholdSchedule(settings.initial, settings.final)) {
    for (let a: Fragment | undefined = records[0]; a?.next?.next; a = a.next) {
      const b: Fragment = a.next, oldCost = fitted(a).cost + fitted(b).cost;
      const merged = candidate(a.start, b.end), merge = allowed(merged) ? merged.cost - oldCost : Infinity;
      if (chooseFragmentOperation(merge, threshold, Infinity, Infinity) === 'merge') {
        a.end = b.end; a.next = b.next; a.fit = merged; diagnostics.merges++; continue;
      }
      // Shift the shared boundary by one sample, -1 before +1. Invalid ranges
      // are rejected before fitting; each side must retain at least one step.
      for (const delta of [-1, 1]) {
        const boundary = a.end + delta;
        if (boundary <= a.start || boundary >= b.end) continue;
        const left = candidate(a.start, boundary), right = candidate(boundary, b.end);
        const change = allowed(left) && allowed(right) ? left.cost + right.cost - oldCost : Infinity;
        if (chooseFragmentOperation(Infinity, threshold, delta < 0 ? change : Infinity, delta > 0 ? change : Infinity) === 'keep') continue;
        a.end = b.start = boundary; a.fit = left; b.fit = right; diagnostics.swaps++; break;
      }
    }
  }
  const result: { start: number; end: number; fit: ReturnType<typeof fitFixedEnds> }[] = [];
  for (let f: Fragment | undefined = records[0]; f?.next; f = f.next) result.push({ start: f.start, end: f.end, fit: fitted(f) });
  return result;
}

// Minimize color-boundary residuals plus contour bending. Each measurement is
// on an edge midpoint, avoiding a bias toward the corners of the pixel grid.
// [APPROX-SMOOTHER] Own optimizer and weights, not VM's full objective/doCG.
// Its bending term is recovered Q for the special case h1=h2=1 (phase3 §4).
function optimizeContour(raw: Point[], initial: Point[], measurements: (Measurement | undefined)[], corners: Set<number>, width: number, height: number): Point[] {
  const closed = distance2(raw[0], raw[raw.length - 1]) === 0, count = raw.length - (closed ? 1 : 0);
  if (count < 12) return initial;
  const points = initial.slice(0, count).map(p => [...p] as Point);
  const fixed = raw.slice(0, count).map((p, i) => corners.has(i) || (!closed && (i === 0 || i === count - 1)) || p[0] === 0 || p[1] === 0 || p[0] === width || p[1] === height);
  const anchor = 0.12, bending = 0.6, step = 0.8 / (2 * anchor + 2 + 32 * bending);
  const gradients = points.map(() => [0, 0] as Point);
  for (let iteration = 0; iteration < 60; iteration++) {
    for (let i = 0; i < count; i++) for (let axis = 0; axis < 2; axis++) gradients[i][axis] = 2 * anchor * (points[i][axis] - initial[i][axis]);
    for (let i = 0; i < measurements.length; i++) {
      const m = measurements[i]; if (!m) continue;
      const next = (i + 1) % count, midpoint = mix(points[i], points[next], 0.5);
      const residual = dot([midpoint[0] - m.target[0], midpoint[1] - m.target[1]], m.normal);
      for (let axis = 0; axis < 2; axis++) {
        const gradient = m.weight * residual * m.normal[axis];
        gradients[i][axis] += gradient; gradients[next][axis] += gradient;
      }
    }
    for (let i = closed ? 0 : 1; i < count - (closed ? 0 : 1); i++) {
      if (corners.has(i)) continue;
      const before = (i - 1 + count) % count, after = (i + 1) % count;
      for (let axis = 0; axis < 2; axis++) {
        const gradient = 2 * bending * (points[before][axis] - 2 * points[i][axis] + points[after][axis]);
        gradients[before][axis] += gradient; gradients[i][axis] -= 2 * gradient; gradients[after][axis] += gradient;
      }
    }
    for (let i = 0; i < count; i++) {
      if (fixed[i]) continue;
      const next: Point = [points[i][0] - step * gradients[i][0], points[i][1] - step * gradients[i][1]];
      const displacement = Math.sqrt(distance2(next, raw[i]));
      points[i] = displacement > 0.85 ? mix(raw[i], next, 0.85 / displacement) : next;
    }
  }
  return closed ? [...points, points[0]] : points;
}

// [ADAPTER-OPTIMIZER] Sequential projected descent, not VM's global conjugate
// gradient schedule. Angular weight .3 and step limits are our calibration.
function refineCoverage(raw: Point[], initial: Point[], corners: Set<number>, raster: RasterChain, diagnostics: TraceDiagnostics): Point[] {
  const closed = distance2(raw[0], raw[raw.length - 1]) === 0, count = raw.length - Number(closed);
  const targetArea = signedArea(raw), small = closed && Math.abs(targetArea) <= 7;
  const objective = coverageObjective(raw, raster.field, raster.difference);
  let points = (small ? raw : initial).slice(0, count).map(p => [...p] as Point);
  const fixed = raw.slice(0, count).map((p, i) => corners.has(i) || (!closed && (i === 0 || i === count - 1)) || p[0] === 0 || p[1] === 0 || p[0] === raster.field.width || p[1] === raster.field.height);
  const prior = (p: Point[], gradient?: Point[]) => {
    let energy = 0;
    for (let i = closed ? 0 : 1; i < count - Number(!closed); i++) {
      if (corners.has(i)) continue;
      const ids = [(i + count - 1) % count, i, (i + 1) % count];
      const term = angularPrior(p[ids[0]], p[i], p[ids[2]]);
      energy += 0.3 * term.energy;
      if (gradient) ids.forEach((id, j) => { for (let k = 0; k < 2; k++) gradient[id][k] += 0.3 * term.gradient[j][k]; });
    }
    // [ADAPTER-AREA] Closed-loop grid area is our reference, not VM's region
    // flags/counts. This only constrains loops enclosing at most seven pixels.
    if (small) {
      const delta = signedArea(p) - targetArea; energy += 5 * delta * delta;
      if (gradient) for (let i = 0; i < count; i++) {
        const a = p[(i + count - 1) % count], b = p[(i + 1) % count];
        gradient[i][0] += 5 * delta * (b[1] - a[1]); gradient[i][1] += 5 * delta * (a[0] - b[0]);
      }
    }
    return energy;
  };
  let state = objective.evaluate(points);
  diagnostics.rasterEnergyBefore += state.energy;
  if (small) diagnostics.smallAreaConstraints++;
  for (let iteration = 0; iteration < 12; iteration++) {
    const total = state.energy + prior(points, state.gradient);
    let accepted = false;
    for (let step = 0.2; step >= 0.003125; step /= 2) {
      const trial = points.map((p, i): Point => {
        if (fixed[i]) return p;
        const q: Point = [p[0] - step * state.gradient[i][0], p[1] - step * state.gradient[i][1]];
        const length = Math.sqrt(distance2(q, raw[i]));
        return length > 0.85 ? mix(raw[i], q, 0.85 / length) : q;
      });
      if (trial.some((p, i) => i + 1 < raw.length && dot([trial[(i + 1) % count][0] - p[0], trial[(i + 1) % count][1] - p[1]], [raw[i + 1][0] - raw[i][0], raw[i + 1][1] - raw[i][1]]) <= 1e-5)) continue;
      const candidate = objective.evaluate(trial, false);
      if (candidate.energy <= state.energy + 1e-10 && candidate.energy + prior(trial) < total - 1e-9) {
        points = trial; state = { ...candidate, gradient: objective.differentiate(points, candidate.predicted) }; diagnostics.rasterSteps++; accepted = true; break;
      }
    }
    if (!accepted) break;
  }
  diagnostics.rasterEnergyAfter += state.energy;
  objective.commit(state.predicted);
  return closed ? [...points, points[0]] : points;
}

function fitChain(raw: Point[], width: number, height: number, options: TraceOptions, diagnostics: TraceDiagnostics, measurements: (Measurement | undefined)[] = [], raster?: RasterChain): Curve[] {
  if (!options.smooth) {
    const cuts = simplify(raw, options.tolerance);
    return cuts.slice(1).map((to, i) => ({ from: raw[cuts[i]], to: raw[to] }));
  }
  const closed = distance2(raw[0], raw[raw.length - 1]) === 0;
  const count = raw.length - (closed ? 1 : 0);
  const corners = new Set<number>();
  // [ADAPTER-CORNERS] Protect obvious raster tips before our smoothing pass.
  // These guards are not the VM puncture classifier; they remain a superset.
  const polygon = simplify(raw, 0.8);
  if (closed) polygon.pop();
  for (let k = closed ? 0 : 1; k < polygon.length - (closed ? 0 : 1); k++) {
    const i = polygon[k], p = raw[i];
    const before = raw[polygon[(k - 1 + polygon.length) % polygon.length]], after = raw[polygon[(k + 1) % polygon.length]];
    const radius = Math.min(6, closed ? Math.floor(count / 4) : Math.min(i, count - 1 - i));
    const stableTurn = radius > 0 && dot(unit(raw[(i - radius + count) % count], p), unit(p, raw[(i + radius) % count])) < 0.65;
    if (stableTurn && distance2(before, p) >= 4 && distance2(after, p) >= 4 && dot(unit(before, p), unit(p, after)) < 0.45) corners.add(i);
  }
  if (!closed) { corners.add(0); corners.add(raw.length - 1); }
  const weights = [1, 6, 15, 20, 15, 6, 1];
  const initial = raw.map((p, i): Point => {
    const index = i % count;
    if (corners.has(index) || p[0] === 0 || p[1] === 0 || p[0] === width || p[1] === height) return p;
    const sum: Point = [0, 0]; let weight = 0;
    for (let j = -3; j <= 3; j++) {
      // Do not smooth across a deliberately retained corner or chain endpoint.
      let sample = index;
      for (let step = 0; step < Math.abs(j); step++) {
        if (corners.has(sample)) break;
        sample = closed ? (sample + Math.sign(j) + count) % count : Math.max(0, Math.min(count - 1, sample + Math.sign(j)));
      }
      const w = weights[j + 3]; sum[0] += raw[sample][0] * w; sum[1] += raw[sample][1] * w; weight += w;
    }
    const smoothed: Point = [sum[0] / weight, sum[1] / weight];
    const displacement = Math.sqrt(distance2(p, smoothed));
    return displacement > 0.75 ? mix(p, smoothed, 0.75 / displacement) : smoothed;
  });
  const warm = optimizeContour(raw, initial, measurements, corners, width, height);
  const points = raster ? refineCoverage(raw, warm, corners, raster, diagnostics) : warm;
  // [R5-CORNER] Classify after smoothing, as in punctureCorners. Our single
  // constrained pass replaces VM's three-phase schedule (still an approximation).
  if (count >= 7) for (let i = closed ? 0 : 3; i < count - (closed ? 0 : 3); i++) {
    const window = Array.from({ length: 7 }, (_, j) => points[(i + j - 3 + count) % count]);
    if (probablyPunctured(cornerFeatures(window)) && !corners.has(i)) { corners.add(i); diagnostics.puncturedCorners++; }
  }
  const cuts = new Set([0, raw.length - 1, ...corners]);
  if (closed) {
    let far = 1;
    for (let i = 2; i < count; i++) if (distance2(points[i], points[0]) > distance2(points[far], points[0])) far = i;
    cuts.add(far);
  }
  const sorted = [...cuts].sort((a, b) => a - b), curves: Curve[] = [];
  const tangent = (i: number): Point => {
    const r = Math.min(3, Math.floor((count - 1) / 2));
    return unit(points[(i - r + count) % count], points[(i + r) % count]);
  };
  for (let i = 1; i < sorted.length; i++) {
    const rangeStart = sorted[i - 1], rangeEnd = sorted[i];
    const fragments = selectFragments(points.slice(rangeStart, rangeEnd + 1), options.tolerance, diagnostics);
    for (const fragment of fragments) {
      const start = rangeStart + fragment.start, end = rangeStart + fragment.end, radius = Math.min(3, end - start);
      const left = corners.has(start % count) ? unit(points[start], points[start + radius]) : tangent(start % count);
      const t = corners.has(end % count) ? unit(points[end - radius], points[end]) : tangent(end % count);
      const curve = fragment.fit.curve, controls = curve.controls!;
      let fitted: Curve[];
      if (fragment.fit.maxError <= options.tolerance ** 2 && dot(unit(curve.from, controls[0]), left) > 0.9995 && dot(unit(controls[1], curve.to), t) > 0.9995) fitted = [curve];
      else {
        diagnostics.tangentRefits++;
        fitted = fitWithSharedTangents(points.slice(start, end + 1), options.tolerance, left, [-t[0], -t[1]]);
      }
      const samples = points.slice(start, end + 1), before = curveDeviation(fitted, samples);
      let after = before;
      const budget = Math.min(options.tolerance, 0.35);
      if (before > budget) {
        const candidate = fitWithSharedTangents(samples, budget * 0.75, left, [-t[0], -t[1]]);
        const deviation = curveDeviation(candidate, samples);
        if (deviation < before && candidate.length <= fitted.length * 2 + 2) {
          fitted = candidate; after = deviation; diagnostics.guardedFits++;
        }
      }
      diagnostics.fitDeviationBefore = Math.max(diagnostics.fitDeviationBefore, before);
      diagnostics.fitDeviationAfter = Math.max(diagnostics.fitDeviationAfter, after);
      curves.push(...fitted);
    }
  }
  return curves;
}

export function traceRaster(rgba: Uint8ClampedArray, width: number, height: number, options: TraceOptions, progress: (value: number, label: string) => void = () => {}): TraceResult {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1024 * 1024 || rgba.length !== width * height * 4) throw new Error('Ukuran raster tidak valid (maksimum 1024 × 1024 piksel).');
  if (!Number.isInteger(options.colors) || options.colors < 2 || options.colors > 16 || !Number.isFinite(options.tolerance) || options.tolerance < 0.1 || options.tolerance > 4 || !Number.isFinite(options.minArea) || options.minArea < 0 || options.minArea > 100) throw new Error('Pengaturan tracing tidak valid.');
  progress(10, 'Mencari palet warna…');
  const diagnostics: TraceDiagnostics = { unitFragments: 0, merges: 0, swaps: 0, puncturedCorners: 0, tangentRefits: 0, rasterSteps: 0, rasterEnergyBefore: 0, rasterEnergyAfter: 0, smallAreaConstraints: 0, guardedFits: 0, fitDeviationBefore: 0, fitDeviationAfter: 0 };
  const { labels, palette } = quantize(rgba, options.colors);
  progress(30, 'Merapikan region…');
  if (options.minArea > 0) compactPalette(rgba, labels, palette, width, height, options.minArea);
  if (options.minArea > 0) refineTransitions(rgba, labels, width, height, palette);
  cleanRegions(labels, width, height, options.minArea, palette);
  if (options.removeWhite) for (let i = 0; i < labels.length; i++) if (labels[i] >= 0 && palette[labels[i]].every(v => v >= 242)) labels[i] = -1;
  const { ids: regionIds, regions } = identifyRegions(labels, width, height);
  progress(45, 'Menelusuri batas warna…');
  const stride = width + 1, edges: Edge[] = [], adjacency = new Map<number, number[]>();
  // [R5-GRID] Different neighbor labels create grid boundary nodes/edges.
  const add = (a: number, b: number, right: number, left: number) => {
    if (right === left) return;
    if (edges.length >= 250000) throw new Error('Gambar terlalu kompleks. Kurangi jumlah warna atau pilih resolusi 512 px.');
    const id = edges.length;
    edges.push({ a, b, right, left, chain: -1, forward: true });
    for (const p of [a, b]) { const list = adjacency.get(p); if (list) list.push(id); else adjacency.set(p, [id]); }
  };
  for (let y = 0; y <= height; y++) for (let x = 0; x < width; x++) add(y * stride + x, y * stride + x + 1, y < height ? labels[y * width + x] : -1, y > 0 ? labels[(y - 1) * width + x] : -1);
  for (let x = 0; x <= width; x++) for (let y = 0; y < height; y++) add(y * stride + x, (y + 1) * stride + x, x > 0 ? labels[y * width + x - 1] : -1, x < width ? labels[y * width + x] : -1);
  const pair = (e: Edge) => `${Math.min(e.left, e.right)},${Math.max(e.left, e.right)}`;
  const junction = (p: number) => { const list = adjacency.get(p)!; return list.length !== 2 || pair(edges[list[0]]) !== pair(edges[list[1]]); };
  // [APPROX-MEASUREMENT] Two-pixel RGB mixture; not GenerativeModel RGBA rasterization.
  const measureEdge = (edge: Edge): Measurement | undefined => {
    if (!options.smooth || edge.right < 0 || edge.left < 0) return;
    const x = edge.a % stride, y = Math.floor(edge.a / stride), horizontal = edge.b === edge.a + 1;
    const rightPixel = horizontal ? y * width + x : y * width + x - 1;
    const leftPixel = horizontal ? (y - 1) * width + x : y * width + x;
    const a = palette[edge.right], b = palette[edge.left], contrast = distance2(a, b);
    if (contrast < 1024) return;
    const fraction = (index: number) => {
      const offset = index * 4;
      const t = ((rgba[offset] - a[0]) * (b[0] - a[0]) + (rgba[offset + 1] - a[1]) * (b[1] - a[1]) + (rgba[offset + 2] - a[2]) * (b[2] - a[2])) / contrast;
      let residual = 0;
      for (let c = 0; c < 3; c++) residual += (rgba[offset + c] - a[c] - t * (b[c] - a[c])) ** 2;
      return { t: Math.max(0, Math.min(1, t)), residual };
    };
    const right = fraction(rightPixel), left = fraction(leftPixel);
    if (left.t - right.t < 0.1 || right.t > 0.55 || left.t < 0.45 || right.residual + left.residual > contrast * 0.04 + 32) return;
    const shift = Math.max(-0.5, Math.min(0.5, (0.5 - right.t) / (left.t - right.t) - 0.5));
    const normal: Point = horizontal ? [0, -1] : [1, 0];
    const midpoint: Point = horizontal ? [x + 0.5, y] : [x, y + 0.5];
    return { normal, target: [midpoint[0] + shift * normal[0], midpoint[1] + shift * normal[1]], weight: 1 / (1 + (right.residual + left.residual) / 128) };
  };
  const color = (label: number) => label < 0 ? [0, 0, 0, 0] : [...palette[label].map(v => v / 255), 1];
  const field: RasterField = { width, height, observed: rgba, predicted: new Float64Array(rgba.length) };
  if (options.smooth) labels.forEach((label, i) => field.predicted.set(color(label), i * 4));
  const chains: Chain[] = [];
  const walkChain = (edgeId: number, start: number) => {
    const seed = edges[edgeId], forward = seed.a === start;
    const left = color(forward ? seed.left : seed.right), right = color(forward ? seed.right : seed.left);
    const raster = options.smooth && !options.removeWhite ? { field, difference: left.map((v, i) => v - right[i]) } : undefined;
    const nodes: Point[] = [[start % stride, Math.floor(start / stride)]];
    const measurements: (Measurement | undefined)[] = [];
    let current = start;
    while (true) {
      const edge = edges[edgeId];
      if (edge.chain >= 0) break;
      edge.chain = chains.length; edge.forward = edge.a === current;
      measurements.push(measureEdge(edge));
      current = edge.forward ? edge.b : edge.a;
      nodes.push([current % stride, Math.floor(current / stride)]);
      if (current === start || junction(current)) break;
      edgeId = adjacency.get(current)!.find(id => id !== edgeId)!;
    }
    chains.push({ curves: fitChain(nodes, width, height, options, diagnostics, measurements, raster) });
  };
  progress(60, 'Menyederhanakan kontur…');
  edges.forEach((e, id) => { if (e.chain < 0 && (junction(e.a) || junction(e.b))) walkChain(id, junction(e.a) ? e.a : e.b); });
  edges.forEach((e, id) => { if (e.chain < 0) walkChain(id, e.a); });
  const used = new Uint8Array(edges.length);
  const direction = (a: number, b: number) => b === a + 1 ? 0 : b === a + stride ? 1 : b === a - 1 ? 2 : 3;
  progress(85, 'Membangun SVG…');
  for (let seed = 0; seed < edges.length; seed++) for (const forward of [true, false]) {
    const label = forward ? edges[seed].right : edges[seed].left;
    const mask = forward ? 1 : 2;
    if (label < 0 || (used[seed] & mask)) continue;
    let id = seed, dir = forward;
    const loop: { chain: number; forward: boolean }[] = [];
    const nodes: Point[] = [];
    let area = 0;
    for (let guard = 0; guard <= edges.length; guard++) {
      const edge = edges[id];
      const bit = dir ? 1 : 2;
      if (used[id] & bit) { if (id === seed && dir === forward) break; throw new Error('Kontur tidak dapat ditutup. Coba resolusi yang lebih kecil.'); }
      used[id] |= bit;
      loop.push({ chain: edge.chain, forward: dir === edge.forward });
      const a = dir ? edge.a : edge.b, b = dir ? edge.b : edge.a;
      const pa: Point = [a % stride, Math.floor(a / stride)], pb: Point = [b % stride, Math.floor(b / stride)];
      nodes.push(pa); area += pa[0] * pb[1] - pb[0] * pa[1];
      // [R7-TRACE] West/south/east/north priority and first-cell context.
      // [ADAPTER-TRACE] Directed-edge visits/loop closure replace unresolved VM
      // owner-region node state and zero-candidate branch; no equivalence claim.
      const firstCell = (e: Edge, f: boolean): Point => {
        const x = e.a % stride, y = Math.floor(e.a / stride), horizontal = e.b === e.a + 1;
        return f ? (horizontal ? [x, y] : [x - 1, y]) : (horizontal ? [x, y - 1] : [x, y]);
      };
      const candidates: { id: number; forward: boolean; direction: number; first: Point }[] = [];
      for (const candidate of adjacency.get(b)!) {
        const e = edges[candidate], f = e.a === b;
        if ((f ? e.right : e.left) !== label) continue;
        candidates.push({ id: candidate, forward: f, direction: [2, 1, 0, 3][direction(b, f ? e.b : e.a)], first: firstCell(e, f) });
      }
      const next = chooseBoundaryCandidate(candidates, firstCell(edge, dir));
      if (next < 0) throw new Error('Batas region terputus.');
      id = candidates[next].id; dir = candidates[next].forward;
      if (guard === edges.length) throw new Error('Batas region terlalu panjang.');
    }
    // Begin at a chain boundary so each shared curve is emitted whole, in either direction.
    let start = loop.findIndex((ref, i) => ref.chain !== loop[(i + loop.length - 1) % loop.length].chain);
    if (start < 0) start = 0;
    const refs: typeof loop = [];
    for (let i = 0; i < loop.length; i++) {
      const ref = loop[(start + i) % loop.length];
      if (refs[refs.length - 1]?.chain !== ref.chain) refs.push(ref);
    }
    let data = '', segments = 0;
    for (const ref of refs) {
      const curves = ref.forward ? chains[ref.chain].curves : [...chains[ref.chain].curves].reverse().map(c => ({ from: c.to, to: c.from, controls: c.controls ? [c.controls[1], c.controls[0]] as [Point, Point] : undefined }));
      for (const curve of curves) {
        if (!data) data = `M${xy(curve.from)}`;
        data += curve.controls ? `C${xy(curve.controls[0])} ${xy(curve.controls[1])} ${xy(curve.to)}` : `L${xy(curve.to)}`;
        segments++;
      }
    }
    const edge = edges[seed], x = edge.a % stride, y = Math.floor(edge.a / stride);
    const horizontal = edge.b === edge.a + 1;
    const pixel = forward ? (horizontal ? y * width + x : y * width + x - 1) : (horizontal ? (y - 1) * width + x : y * width + x);
    regions[regionIds[pixel]].loops.push({ data: data + 'Z', area: area / 2, nodes, segments });
  }
  const colors = palette.map(p => '#' + p.map(v => Math.round(v).toString(16).padStart(2, '0')).join(''));
  const transparentSeeds = regions.filter(r => r.label < 0).map(r => [r.seed % width + 0.5, Math.floor(r.seed / width) + 0.5] as Point);
  // [ADAPTER-SVG] Our area-sorted underpainting/transparent-hole export policy.
  const layers = regions.filter(r => r.label >= 0).map(region => {
    const outer = region.loops.filter(loop => loop.area > 0);
    // Filling a colored hole provides underpaint for its child shapes. Keep the
    // hole whenever it contains transparency, including transparency in a child.
    const holes = region.loops.filter(loop => {
      if (loop.area >= 0 || !transparentSeeds.length) return false;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of loop.nodes) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }
      return transparentSeeds.some(p => p[0] > minX && p[0] < maxX && p[1] > minY && p[1] < maxY && containsPoint(loop.nodes, p));
    });
    return { color: colors[region.label], area: outer.reduce((sum, loop) => sum + loop.area, 0), loops: [...outer, ...holes] };
  }).filter(layer => layer.loops.length).sort((a, b) => b.area - a.area);
  if (!layers.length) throw new Error('Tidak ada bidang tersisa. Nonaktifkan hapus putih atau kurangi pembersihan bintik.');
  const visibleColors = [...new Set(layers.map(layer => layer.color))];
  const contours = layers.reduce((sum, layer) => sum + layer.loops.length, 0);
  const segments = layers.reduce((sum, layer) => sum + layer.loops.reduce((n, loop) => n + loop.segments, 0), 0);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${layers.map(layer => `<path fill="${layer.color}" fill-rule="evenodd" d="${layer.loops.map(loop => loop.data).join('')}"/>`).join('')}</svg>`;
  progress(100, 'Tracing selesai');
  return { svg, colors: visibleColors, paths: layers.length, contours, segments, width, height, diagnostics };
}
