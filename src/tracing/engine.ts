import { underpaint } from './underpaint';
import { geometricHypot } from './geometry-math';
/** Independent implementation of researched mechanisms plus explicitly marked adapters.
 * Evidence and scope: docs/TRACING-RESEARCH-MAP.md. No target binary is loaded.
 */
import { cleanTransitionMixtures, mergeSmallEdgeRegions, transitionDefaults, type TransitionDiagnostics } from './transition-mixtures';
import { evaluateSvgScene, sceneAllows } from './scene-quality';
import { balanceStrokeCurvature, regularizeStroke, fairStrokeCurvature, strokeRoughness, flattenStroke } from './stroke-regularizer';
export interface TraceOptions { colors: number; tolerance: number; minArea: number; smooth: boolean; removeWhite: boolean; whiteMode?: 'none' | 'background' | 'all' }
export interface TraceResult { svg: string; colors: string[]; paths: number; contours: number; segments: number; width: number; height: number; diagnostics: TraceDiagnostics }
export interface TraceDiagnostics extends TransitionDiagnostics { underpaintPairs: number; underpaintPaths: number; sharedFairingCandidates: number; sharedFairingAccepted: number; sharedFairingRoughnessBefore: number; sharedFairingRoughnessAfter: number; unitFragments: number; merges: number; swaps: number; puncturedCorners: number; tangentRefits: number; rasterSteps: number; rasterEnergyBefore: number; rasterEnergyAfter: number; smallAreaConstraints: number; guardedFits: number; fitDeviationBefore: number; fitDeviationAfter: number; mergedTransitionRegions: number; reassignedTransitionPixels: number; straightSpans: number; compactedCurvePairs: number; protectedDetailPixels: number; qualityRefits: number; qualitySkipped: number; finalRasterBefore: number; finalRasterAfter: number; ellipses: number; sceneErrorBefore: number; sceneErrorAfter: number; sceneDetailBefore: number; sceneDetailAfter: number; sceneEdgeBefore: number; sceneEdgeAfter: number; sceneCandidateError: number; globalCandidates: number; globalAccepted: number; regularizedChains: number; protectedDetailCandidates: number; detailProtectionAccepted: number }
type Point = [number, number];
type RGB = [number, number, number];
type Curve = { from: Point; to: Point; controls?: [Point, Point] };
type Edge = { a: number; b: number; right: number; left: number; chain: number; forward: boolean };
type Chain = { curves: Curve[] };
type Measurement = { target: Point; normal: Point; weight: number };
type Loop = { refs: { chain: number; forward: boolean }[]; area: number; nodes: Point[] };
type Region = { label: number; seed: number; loops: Loop[] };
type RasterField = { width: number; height: number; observed: Uint8ClampedArray; predicted: Float64Array | Float32Array };
type RasterChain = { field: RasterField; difference: number[] };
const distance2 = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0);
const mix = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const unit = (a: Point, b: Point): Point => { const d = geometricHypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const xy = (p: Point) => `${fmt(p[0])} ${fmt(p[1])}`;

// Ported from mini-vectorizer's PerceptualColor: palette decisions use Oklab;
// RGB remains the space for antialias mixture reconstruction.
export function perceptualColor(rgb: number[]): RGB {
  const [r, g, b] = rgb.map(c => { const v = c / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [255 * (.2104542553 * l + .7936177850 * m - .0040720468 * s),
    255 * (1.9779984951 * l - 2.4285922050 * m + .4505937099 * s),
    255 * (.0259040371 * l + .7827717662 * m - .8086757660 * s)];
}

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
  const lu = geometricHypot(...u), lv = geometricHypot(...v);
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
  return { evaluate, differentiate, commit: (prediction: Float64Array) => indices.forEach((id, i) => field.predicted.set(prediction.subarray(i * 4, i * 4 + 4), id * 4)), indices, base, observed, xs, ys, raw, difference, field };
}

// [APPROX-PALETTE] Histogram and seeds remain independent adapters;
// Oklab assignment and RGB centroid updates follow mini-vectorizer.

export function quantize(rgba: Uint8ClampedArray, count: number) {
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
  const labs = new Map(samples.map(sample => [sample.key, perceptualColor(sample.color)]));
  if (!samples.length) throw new Error('Gambar sepenuhnya transparan. Pilih gambar dengan bidang berwarna.');
  samples.sort((a, b) => b.n - a.n || a.key - b.key);
  const palette: RGB[] = [[...samples[0].color]];
  let perceptual = palette.map(perceptualColor);
  while (palette.length < Math.min(count, samples.length)) {
    let best = -1, score = 0;
    for (let i = 0; i < samples.length; i++) {
      const d = Math.min(...perceptual.map(p => distance2(p, labs.get(samples[i].key)!)));
      const weighted = d * samples[i].n;
      if (weighted > score) { best = i; score = weighted; }
    }
    if (best < 0 || score < 1) break;
    palette.push([...samples[best].color]);
    perceptual.push(labs.get(samples[best].key)!);
  }
  const assignments = new Int16Array(32768).fill(-1);
  for (let pass = 0; pass < 12; pass++) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    let changed = false;
    for (const sample of samples) {
      let best = 0, cost = Infinity;
      perceptual.forEach((p, k) => { const d = distance2(p, labs.get(sample.key)!); if (d < cost) { cost = d; best = k; } });
      if (assignments[sample.key] !== best) changed = true;
      assignments[sample.key] = best;
      for (let c = 0; c < 3; c++) sums[best][c] += sample.color[c] * sample.n;
      sums[best][3] += sample.n;
    }
    palette.forEach((p, k) => { if (sums[k][3]) for (let c = 0; c < 3; c++) p[c] = sums[k][c] / sums[k][3]; });
    perceptual = palette.map(perceptualColor);
    if (!changed) break;
  }
  // Assign once more to the final centers, rather than the centers from the previous pass.
  for (const sample of samples) {
    let best = 0, cost = Infinity;
    perceptual.forEach((p, k) => { const d = distance2(p, labs.get(sample.key)!); if (d < cost) { cost = d; best = k; } });
    assignments[sample.key] = best;
  }
  const labels = new Int16Array(rgba.length / 4).fill(-1);
  for (let i = 0; i < labels.length; i++) {
    const j = i * 4;
    if (rgba[j + 3] >= 128) labels[i] = assignments[(rgba[j] >> 3) * 1024 + (rgba[j + 1] >> 3) * 32 + (rgba[j + 2] >> 3)];
  }
  return { palette, labels };
}

/** Train on coherent fills so JPEG edge mixtures cannot consume artwork colors. */
export function quantizeFlatInteriors(rgba: Uint8ClampedArray, count: number, width: number, height: number) {
  const stable = new Uint8ClampedArray(rgba); let foreground = 0, stableForeground = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4; if (rgba[at + 3] < 128) continue;
    const ink = Math.min(rgba[at], rgba[at + 1], rgba[at + 2]) < 240;
    if (ink) foreground++; let support = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const q = (ny * width + nx) * 4;
      const error = (rgba[at] - rgba[q]) ** 2 + (rgba[at + 1] - rgba[q + 1]) ** 2 + (rgba[at + 2] - rgba[q + 2]) ** 2;
      if (rgba[q + 3] >= 240 && error <= 144) support++;
    }
    if (support < 8) stable[at + 3] = 0; else if (ink) stableForeground++;
  }
  if (foreground < 64 || stableForeground < foreground * .6) return { ...quantize(rgba, count), flatInteriors: false };
  const q = quantize(stable, count);
  for (let p = 0; p < q.labels.length; p++) {
    if (rgba[p * 4 + 3] < 128) { q.labels[p] = -1; continue; }
    let best = Infinity, label = 0;
    for (let c = 0; c < q.palette.length; c++) {
      const color = q.palette[c], error = (rgba[p * 4] - color[0]) ** 2 + (rgba[p * 4 + 1] - color[1]) ** 2 + (rgba[p * 4 + 2] - color[2]) ** 2;
      if (error < best) { best = error; label = c; }
    }
    q.labels[p] = label;
  }
  return { ...q, flatInteriors: true };
}

// Near-identical palette centers and colors found only in narrow transition
// bands fragment otherwise smooth boundaries. Keep real interior colors and
// isolated high-contrast details; the requested count is an upper bound.
// [APPROX-SEGMENTATION] Our palette/interior support heuristic, not PixelSegmenter cost.
export function compactPalette(rgba: Uint8ClampedArray, labels: Int16Array, palette: RGB[], width: number, height: number, minArea: number, protectedColors: boolean[] = [], flatInteriors = false) {
  const perceptual = palette.map(perceptualColor);
  const shared = palette.map(() => new Int32Array(palette.length)), sourceInteriors = new Int32Array(palette.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * width + x, a = labels[at]; if (a < 0) continue;
    if (!flatInteriors && x > 0 && x + 1 < width && y > 0 && y + 1 < height && rgba[at * 4 + 3] === 255 &&
        (rgba[at * 4] - palette[a][0]) ** 2 + (rgba[at * 4 + 1] - palette[a][1]) ** 2 + (rgba[at * 4 + 2] - palette[a][2]) ** 2 <= 144) {
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (labels[at + dy * width + dx] === a) same++;
      if (same >= 8) sourceInteriors[a]++;
    }
    for (const q of [x + 1 < width ? at + 1 : -1, y + 1 < height ? at + width : -1]) {
      if (q < 0) continue; const b = labels[q];
      if (b >= 0 && a !== b) { shared[a][b]++; shared[b][a]++; }
    }
  }
  const populations = new Int32Array(palette.length);
  for (const label of labels) if (label >= 0) populations[label]++;
  const representative = palette.map((_, i) => i);
  const order = palette.map((_, i) => i).sort((a, b) => populations[b] - populations[a]);
  for (let rank = 0; rank < order.length; rank++) {
    const i = order[rank];
    if (protectedColors[i]) continue;
    for (const j of order.slice(0, rank)) {
      if (representative[j] !== j) continue;
      const a = perceptual[i], b = perceptual[j], d = distance2(a, b);
      const ca = Math.hypot(a[1], a[2]), cb = Math.hypot(b[1], b[2]);
      const sameHue = ca > 8 && cb > 8 && a[1] * b[1] + a[2] * b[2] >= .985 * ca * cb;
      let duplicate = flatInteriors ? distance2(palette[i], palette[j]) <= 324 : d <= 324 || minArea >= 4 && shared[i][j] >= 8 && d <= 625 && sameHue;
      if (!flatInteriors && sourceInteriors[i] >= Math.max(8, minArea * 2) && sourceInteriors[j] >= Math.max(8, minArea * 2) && distance2(palette[i], palette[j]) > 324) duplicate = false;
      if (duplicate) { representative[i] = j; break; }
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
  const retained = order.filter(i => representative[i] === i && (protectedColors[i] || stable.includes(i) || !stable.some(j => distance2(perceptual[i], perceptual[j]) <= 96 ** 2)));
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

// [ADAPTER-PALETTE-INTERIOR] Estimate existing colors from coherent source
// interiors, excluding antialias mixtures. This is not VM's palette objective.
export function refinePaletteInteriors(rgba: Uint8ClampedArray, labels: Int16Array, palette: RGB[], width: number, height: number, protectedColors: boolean[] = []) {
  const sums = palette.map(() => [0, 0, 0, 0]);
  for (let y = 1; y + 1 < height; y++) for (let x = 1; x + 1 < width; x++) {
    const p = y * width + x, label = labels[p], offset = p * 4;
    if (label < 0 || rgba[offset + 3] !== 255) continue;
    let support = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const q = ((y + dy) * width + x + dx) * 4;
      if (rgba[q + 3] !== 255) continue;
      let error = 0;
      for (let c = 0; c < 3; c++) error += (rgba[offset + c] - rgba[q + c]) ** 2;
      if (error <= 18 ** 2) support++;
    }
    if (support >= 8) { for (let c = 0; c < 3; c++) sums[label][c] += rgba[offset + c]; sums[label][3]++; }
  }
  let adjusted = 0;
  palette.forEach((color, k) => {
    if (protectedColors[k] || sums[k][3] < 8) return;
    const candidate = sums[k].slice(0, 3).map(v => v / sums[k][3]) as RGB;
    // Ignore shifts within the same source-coherence radius; these can
    // perturb an already useful palette and move thin antialiased boundaries.
    if (distance2(color, candidate) <= 18 ** 2) return;
    palette[k] = candidate; adjusted++;
  });
  if (adjusted) for (let p = 0; p < labels.length; p++) {
    if (labels[p] < 0) continue;
    let best = labels[p], cost = Infinity;
    for (let k = 0; k < palette.length; k++) {
      let error = 0;
      for (let c = 0; c < 3; c++) error += (rgba[p * 4 + c] - palette[k][c]) ** 2;
      if (error < cost) { cost = error; best = k; }
    }
    labels[p] = best;
  }
  return adjusted;
}

// JPEG and antialiased edges contain mixtures of the two neighboring colors.
// Global nearest-color assignment can turn that mixture into an unrelated third
// palette color. Only replace locally unsupported transition pixels, never alpha.
export function refineTransitions(rgba: Uint8ClampedArray, labels: Int16Array, width: number, height: number, palette: RGB[]) {
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
export function cleanRegions(labels: Int16Array, width: number, height: number, minArea: number, palette: RGB[], rgba?: Uint8ClampedArray) {
  if (minArea <= 1) return;
  const perceptual = palette.map(perceptualColor);
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
      const score = border / (1 + Math.sqrt(distance2(perceptual[color], perceptual[label])));
      if (score > best) { best = score; replacement = label; }
    }
    if (replacement === color && neighbors.has(-1)) replacement = -1;
    // [ADAPTER-SMALL-DETAIL] Area alone cannot distinguish noise from enclosed
    // light slots. Retain a multi-pixel region when the source supports its
    // palette color and replacing it would materially worsen those samples.
    if (rgba && replacement >= 0 && tail >= 3) {
      let supported = 0;
      for (let i = 0; i < tail; i++) {
        const offset = queue[i] * 4;
        if (rgba[offset + 3] !== 255) continue;
        let originalError = 0, replacementError = 0;
        for (let c = 0; c < 3; c++) {
          originalError += (rgba[offset + c] - palette[color][c]) ** 2;
          replacementError += (rgba[offset + c] - palette[replacement][c]) ** 2;
        }
        if (originalError <= 32 ** 2 && replacementError - originalError > 32 ** 2) supported++;
      }
      if (supported >= Math.max(2, Math.ceil(tail / 4))) continue;
    }
    for (let i = 0; i < tail; i++) labels[queue[i]] = replacement;
  }
}

// [ADAPTER-REGION-MIXTURE] Conservative local hypothesis test, not the
// unrecovered VM region merge cost. Ambiguous exact-color details are retained.
export function cleanTransitionRegions(rgba: Uint8ClampedArray, labels: Int16Array, palette: RGB[], width: number, height: number, minArea: number, flatInteriors = false, diagnostics?: TransitionDiagnostics) {
  const stats = { mergedRegions: 0, reassignedPixels: 0 };
  if (minArea <= 1) return stats;
  const { ids, regions } = identifyRegions(labels, width, height);
  const sizes = new Int32Array(regions.length), offsets = new Int32Array(regions.length);
  const interior = new Uint8Array(regions.length);
  for (let p = 0; p < labels.length; p++) {
    const id = ids[p], x = p % width, y = Math.floor(p / width); sizes[id]++;
    if (x > 0 && x + 1 < width && y > 0 && y + 1 < height) {
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (ids[p + dy * width + dx] === id) same++;
      if (same >= 8) interior[id] = 1;
    }
  }
  const members = regions.map((region, id) => region.label >= 0 && sizes[id] <= Math.max(16, minArea * 8) && !interior[id] ? new Int32Array(sizes[id]) : undefined);
  const borders = members.map(pixels => pixels ? new Map<number, number>() : undefined);
  for (let p = 0; p < labels.length; p++) {
    const id = ids[p], pixels = members[id], border = borders[id]; if (!pixels || !border) continue;
    pixels[offsets[id]++] = p;
    const x = p % width, y = Math.floor(p / width);
    for (const q of [x > 0 ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y > 0 ? p - width : -1, y + 1 < height ? p + width : -1])
      if (q >= 0 && ids[q] !== id) border.set(ids[q], (border.get(ids[q]) ?? 0) + 1);
  }
  // Read immutable component identities; only large supported neighbors can be
  // replacement targets, so a proposal cannot target another candidate region.
  for (let id = 0; id < regions.length; id++) {
    const current = regions[id].label, pixels = members[id];
    if (!pixels) continue;
    const neighbors = [...borders[id]!].filter(([other, border]) => regions[other].label >= 0 && border >= 2 && sizes[other] > Math.max(32, minArea * 8, pixels.length * 4));
    let best = Infinity, proposal: number[] | undefined;
    for (let i = 0; i < neighbors.length; i++) for (let j = i + 1; j < neighbors.length; j++) {
      const la = regions[neighbors[i][0]].label, lb = regions[neighbors[j][0]].label;
      if (la === lb) continue;
      const a = palette[la], b = palette[lb], separation = distance2(a, b);
      if (separation < 4000) continue;
      let mixtureError = 0, originalError = 0, valid = true, outliers = 0;
      const replacements: number[] = [];
      for (const p of pixels) {
        if (rgba[p * 4 + 3] !== 255) { valid = false; break; }
        const color: RGB = [rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]];
        const projected = ((color[0] - a[0]) * (b[0] - a[0]) + (color[1] - a[1]) * (b[1] - a[1]) + (color[2] - a[2]) * (b[2] - a[2])) / separation;
        const t = Math.max(0, Math.min(1, projected));
        const residual = distance2(color, a.map((v, c) => v + (b[c] - v) * t));
        if (projected < .05 || projected > (flatInteriors ? 1.1 : .95) || residual > (flatInteriors ? 4000 : 300)) { if (!flatInteriors) { valid = false; break; } outliers++; }
        mixtureError += residual; originalError += distance2(color, palette[current]);
        replacements.push(t < 0.5 ? la : lb);
      }
      if (flatInteriors && outliers > Math.max(1, pixels.length * .1)) valid = false;
      // Do not erase true intermediate colors which already explain the source.
      if (valid && originalError > pixels.length * 64 && mixtureError + pixels.length * 25 < originalError && mixtureError < best) { best = mixtureError; proposal = replacements; }
    }
    if (proposal) { pixels.forEach((p, i) => { labels[p] = proposal![i]; }); stats.mergedRegions++; stats.reassignedPixels += pixels.length; }
  }
  if (flatInteriors && diagnostics) {
    const mixtures = cleanTransitionMixtures(rgba, labels, palette, width, height, diagnostics);
    stats.mergedRegions += mixtures.mergedRegions; stats.reassignedPixels += mixtures.reassignedPixels;
  }
  return stats;
}

/** Remove isolated shade labels only within a coherent hue family. */
export function regularizeShadeLabels(labels: Int16Array, w: number, h: number, palette: RGB[]) {
  const labs = palette.map(perceptualColor);
  const shades = labs.map((a, i) => labs.map((b, j) => {
    const ca = Math.hypot(a[1], a[2]), cb = Math.hypot(b[1], b[2]);
    return i !== j && ca > 8 && cb > 8 && Math.abs(a[0] - b[0]) < 20 && a[1] * b[1] + a[2] * b[2] > .96 * ca * cb;
  }));
  const counts = new Uint8Array(palette.length);
  for (let pass = 0; pass < 2; pass++) {
    const result = new Int16Array(labels);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x, current = labels[p]; if (current < 0) continue; counts.fill(0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) { const label = labels[p + dy * w + dx]; if (label >= 0) counts[label]++; }
      if (counts[current] > 2) continue;
      for (let other = 0; other < counts.length; other++) if (counts[other] >= 5 && shades[current][other]) { result[p] = other; break; }
    }
    labels.set(result);
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

// mini-vectorizer DetailProtection: source-supported pairs and thin strokes,
// captured before cleanup. Isolated specks remain eligible for removal.
export function protectDetails(rgba: Uint8ClampedArray, labels: Int16Array, palette: RGB[], width: number, height: number) {
  const original = labels.slice(), originalPalette = palette.map(p => [...p] as RGB);
  const pixels = new Uint8Array(labels.length), thickness = new Uint8Array(labels.length);
  const colors = palette.map(() => false);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, label = labels[i]; if (label < 0) continue;
    thickness[i] = x === 0 || y === 0 || labels[i - 1] !== label || labels[i - width] !== label ? 1 : Math.min(3, thickness[i - 1] + 1, thickness[i - width] + 1);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x, label = labels[i]; if (label < 0) continue;
    thickness[i] = x === width - 1 || y === height - 1 || labels[i + 1] !== label || labels[i + width] !== label ? 1 : Math.min(thickness[i], thickness[i + 1] + 1, thickness[i + width] + 1);
  }
  const visited = new Uint8Array(labels.length), queue = new Int32Array(labels.length);
  let total = 0;
  for (let seed = 0; seed < labels.length; seed++) {
    if (visited[seed] || labels[seed] < 0) continue;
    const label = labels[seed]; let head = 0, tail = 1, support = 0, thickest = 0;
    const borders = new Map<number, number>();
    queue[0] = seed; visited[seed] = 1;
    while (head < tail) {
      const i = queue[head++], x = i % width, y = Math.floor(i / width);
      thickest = Math.max(thickest, thickness[i]);
      let error = 0; for (let c = 0; c < 3; c++) error += (rgba[i * 4 + c] - palette[label][c]) ** 2;
      if (rgba[i * 4 + 3] >= 240 && error <= 144) support++;
      for (const n of [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y > 0 ? i - width : -1, y + 1 < height ? i + width : -1]) {
        if (n >= 0 && labels[n] >= 0 && labels[n] !== label) borders.set(labels[n], (borders.get(labels[n]) ?? 0) + 1);
        if (n >= 0 && !visited[n] && labels[n] === label) { visited[n] = 1; queue[tail++] = n; }
      }
    }
    // Exclude a thin band explained by a mixture of two substantial adjacent
    // colors before restoring details in the protected tracing candidate.
    const adjacent = [...borders].filter(([, count]) => count >= 3).map(([color]) => color);
    let mixture = false;
    if (thickest <= 2) for (let a = 0; a < adjacent.length; a++) for (let b = a + 1; b < adjacent.length; b++) {
      const p = palette[adjacent[a]], q = palette[adjacent[b]], color = palette[label], separation = distance2(p, q);
      if (separation < 4000) continue;
      const t = color.reduce((sum, v, c) => sum + (v - p[c]) * (q[c] - p[c]), 0) / separation;
      if (t >= .05 && t <= .95 && color.reduce((sum, v, c) => sum + (v - p[c] - t * (q[c] - p[c])) ** 2, 0) <= 300) mixture = true;
    }
    if (!mixture && tail >= 2 && (tail <= 100 || thickest <= 2) && support >= Math.max(2, Math.ceil(tail * .65))) {
      colors[label] = true; total += tail;
      for (let j = 0; j < tail; j++) pixels[queue[j]] = 1;
    }
  }
  const mask = () => palette.map(p => originalPalette.some((q, c) => colors[c] && distance2(p, q) < 1e-9));
  const restore = () => {
    const mapping = originalPalette.map(p => { let best = 0; for (let k = 1; k < palette.length; k++) if (distance2(p, palette[k]) < distance2(p, palette[best])) best = k; return best; });
    for (let i = 0; i < labels.length; i++) if (pixels[i]) labels[i] = mapping[original[i]];
  };
  return { colors, mask, restore, total, pixels };
}

/** White is an export mask: retain opaque labels for shared-boundary fitting. */
export function hiddenRegions(labels: Int16Array, palette: RGB[], regions: Region[], ids: Int32Array, width: number, height: number, mode: NonNullable<TraceOptions['whiteMode']>) {
  const hidden = new Uint8Array(regions.length); if (mode === 'none') return hidden;
  const white = palette.map(p => p.every(v => v >= 242));
  if (mode === 'all') { regions.forEach((region, id) => { if (region.label >= 0 && white[region.label]) hidden[id] = 1; }); return hidden; }
  const visited = new Uint8Array(labels.length), queue = new Int32Array(labels.length); let head = 0, tail = 0;
  const add = (i: number) => { if (!visited[i] && labels[i] >= 0 && white[labels[i]]) { visited[i] = 1; queue[tail++] = i; } };
  for (let i = 0; i < labels.length; i++) if (i < width || i >= labels.length - width || i % width === 0 || i % width === width - 1) add(i);
  while (head < tail) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width); hidden[ids[i]] = 1;
    if (x > 0) add(i - 1); if (x + 1 < width) add(i + 1); if (y > 0) add(i - width); if (y + 1 < height) add(i + width);
  }
  return hidden;
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

// [ADAPTER-EXPORT-COMPACTION] Pairwise refit of already smooth cubics.
// Does not alter researched merge cost. Lines and explicit corners are barriers.
// Dense, bidirectional sampled guards are not a formal Hausdorff certificate.
export function compactSmoothCurves(curves: Curve[], protectedPoints: Point[] = []) {
  const flatten = (curve: Curve) => {
    const c = curve.controls!;
    const length = Math.sqrt(distance2(curve.from, c[0])) + Math.sqrt(distance2(c[0], c[1])) + Math.sqrt(distance2(c[1], curve.to));
    const steps = Math.max(16, Math.min(256, Math.ceil(length * 2)));
    return Array.from({ length: steps + 1 }, (_, i) => bezier(curve.from, c[0], c[1], curve.to, i / steps));
  };
  const output: Curve[] = [];
  for (let i = 0; i < curves.length; i++) {
    const a = curves[i], b = curves[i + 1];
    if (!a.controls || !b?.controls || distance2(a.to, b.from) > 1e-12 || protectedPoints.some(p => distance2(p, a.to) < 1e-12)) { output.push(a); continue; }
    const incoming = unit(a.controls[1], a.to), outgoing = unit(b.from, b.controls[0]);
    if (dot(incoming, outgoing) < 0.9995 || distance2(a.from, b.to) < 4) { output.push(a); continue; }
    const original = [...flatten(a), ...flatten(b).slice(1)];
    // Bound work on long runs; this pass targets redundant local fragments.
    if (original.length > 160) { output.push(a); continue; }
    const left = unit(a.from, a.controls[0]), right = unit(b.to, b.controls[1]);
    const candidate = fitWithSharedTangents(original, 0.08, left, right);
    if (candidate.length !== 1 || !candidate[0].controls || curveDeviation(candidate, original) > 0.08 || curveDeviation([a, b], flatten(candidate[0])) > 0.08) { output.push(a); continue; }
    // Only one pair at a time: no accumulated approximation error from merging
    // previously merged candidates, and endpoint tangent directions stay fixed.
    output.push(candidate[0]); i++;
  }
  return output;
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
function refineCoverage(raw: Point[], initial: Point[], corners: Set<number>, raster: RasterChain, diagnostics: TraceDiagnostics, objective = coverageObjective(raw, raster.field, raster.difference)): Point[] {
  const closed = distance2(raw[0], raw[raw.length - 1]) === 0, count = raw.length - Number(closed);
  const targetArea = signedArea(raw), small = closed && Math.abs(targetArea) <= 7;
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

// [ADAPTER-STRAIGHT-SPANS] Long, monotone contour runs with subpixel
// deviation become lines. Thresholds are ours, not recovered VM decisions.
export function straightSpans(points: Point[], tolerance: number, corners = new Set<number>()) {
  const strictBudget = Math.min(0.35, tolerance * 0.5), budget = 0.65;
  const boundaries = [...new Set([0, points.length - 1, ...corners])].sort((a, b) => a - b), cuts = [0];
  for (let k = 1; k < boundaries.length; k++) {
    const start = boundaries[k - 1], end = boundaries[k];
    for (const index of simplify(points.slice(start, end + 1), budget)) if (index > 0) cuts.push(start + index);
  }
  const spans: { start: number; end: number; direction: Point; error: number }[] = [];
  for (let i = 1; i < cuts.length; i++) {
    const start = cuts[i - 1], end = cuts[i], a = points[start], b = points[end];
    const length2 = distance2(a, b); if (length2 < 144) continue;
    const direction = unit(a, b); let error = 0, previous = 0, valid = true;
    for (let j = start + 1; j <= end; j++) {
      const projection = dot([points[j][0] - a[0], points[j][1] - a[1]], direction);
      if (projection < previous - 1e-8 || (j < end && corners.has(j))) { valid = false; break; }
      previous = projection; error = Math.max(error, lineDistance2(points[j], a, b));
    }
    const localBudget = length2 < 2304 ? Math.min(.08, strictBudget) : strictBudget;
    if (valid && error > localBudget ** 2) {
      // [ADAPTER-UI-LINE-NOISE] Relax only for oscillating subpixel noise,
      // not a consistent bow. Regress normal offsets against arc direction.
      const offsets = points.slice(start, end + 1).map(p => {
        const x = p[0] - a[0], y = p[1] - a[1];
        return [x * direction[0] + y * direction[1], -x * direction[1] + y * direction[0]];
      });
      const n = offsets.length, mt = offsets.reduce((v, p) => v + p[0], 0) / n, mn = offsets.reduce((v, p) => v + p[1], 0) / n;
      let variance = 0, covariance = 0;
      for (const [t, normal] of offsets) { variance += (t - mt) ** 2; covariance += (t - mt) * (normal - mn); }
      const slope = covariance / (variance || 1);
      let squares = 0, crossings = 0, previousSign = 0;
      for (const [t, normal] of offsets) {
        const residual = normal - mn - slope * (t - mt); squares += residual * residual;
        const sign = Math.abs(residual) > 0.05 ? Math.sign(residual) : 0;
        if (sign && previousSign && sign !== previousSign) crossings++;
        if (sign) previousSign = sign;
      }
      valid = crossings >= 3 && squares / n <= 0.32 ** 2;
    }
    if (valid && error <= budget ** 2) spans.push({ start, end, direction, error: Math.sqrt(error) });
  }
  return spans;
}

// [ADAPTER-SHALLOW-DENTS] Only almost-convex closed contours qualify.
// Replace small inward raster dents along hull chords; protect explicit corners.
export function regularizeShallowDents(points: Point[], corners = new Set<number>()) {
  if (points.length < 12 || distance2(points[0], points[points.length - 1]) !== 0) return points;
  const count = points.length - 1, area = Math.abs(signedArea(points));
  if (area < 64) return points;
  const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const sorted = points.slice(0, count).map((p, i) => ({ p, i })).sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1]);
  const half = (input: typeof sorted) => { const result: typeof sorted = []; for (const v of input) { while (result.length > 1 && cross(result[result.length - 2].p, result[result.length - 1].p, v.p) <= 0) result.pop(); result.push(v); } return result; };
  const hull = [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)];
  if (Math.abs(signedArea(hull.map(v => v.p))) - area > area * 0.01) return points;
  // Hull order must match the contour's traversal for each candidate chord.
  if (signedArea(points) < 0) hull.reverse();
  const output = points.slice(0, count).map(p => [...p] as Point);
  for (let k = 0; k < hull.length; k++) {
    const a = hull[k], b = hull[(k + 1) % hull.length], span = (b.i - a.i + count) % count;
    const length2 = distance2(a.p, b.p);
    if (span < 4 || length2 < 8 ** 2) continue;
    const edits: { i: number; p: Point }[] = []; let valid = true, previous = 0;
    for (let j = 1; j < span; j++) {
      const i = (a.i + j) % count, p = points[i];
      const t = ((p[0] - a.p[0]) * (b.p[0] - a.p[0]) + (p[1] - a.p[1]) * (b.p[1] - a.p[1])) / length2;
      const projected = mix(a.p, b.p, t);
      if (corners.has(i) || t < previous || t > 1 || distance2(p, projected) > 0.65 ** 2) { valid = false; break; }
      previous = t; edits.push({ i, p: projected });
    }
    if (valid) for (const edit of edits) output[edit.i] = edit.p;
  }
  return [...output, output[0]];
}

function ellipseSupported(e: number[], points: Point[]) {
  if (e[2] <= 0 || e[3] <= 0) return false;
  const cs = Math.cos(e[4]), sn = Math.sin(e[4]); let sum = 0, max = 0;
  for (const p of points) {
    const x = p[0] - e[0], y = p[1] - e[1], u = (x * cs + y * sn) / e[2], v = (-x * sn + y * cs) / e[3];
    const gradient = 2 * Math.hypot(u / e[2], v / e[3]); if (gradient < 1e-9) return false;
    const d = Math.abs(u * u + v * v - 1) / gradient; sum += d * d; max = Math.max(max, d);
  }
  return max <= .7 && Math.sqrt(sum / points.length) <= .3;
}

// Algebraic conic fit from mini-vectorizer CurveQuality. Only strongly
// supported complete loops qualify for replacement with four cubic arcs.
export function fitEllipse(points: Point[]): number[] | undefined {
  const n = points.length - 1; if (n < 24) return;
  let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += points[i][0]; cy += points[i][1]; } cx /= n; cy /= n;
  let scale = 0; for (let i = 0; i < n; i++) scale = Math.max(scale, Math.hypot(points[i][0] - cx, points[i][1] - cy)); if (scale < 3) return;
  const matrix = Array.from({ length: 5 }, () => Array(6).fill(0) as number[]);
  for (let i = 0; i < n; i++) {
    const x = (points[i][0] - cx) / scale, y = (points[i][1] - cy) / scale, v = [x * x, x * y, y * y, x, y];
    for (let j = 0; j < 5; j++) { matrix[j][5] += v[j]; for (let k = 0; k < 5; k++) matrix[j][k] += v[j] * v[k]; }
  }
  for (let k = 0; k < 5; k++) {
    let pivot = k; for (let j = k + 1; j < 5; j++) if (Math.abs(matrix[j][k]) > Math.abs(matrix[pivot][k])) pivot = j;
    [matrix[k], matrix[pivot]] = [matrix[pivot], matrix[k]];
    let d = matrix[k][k]; if (Math.abs(d) < 1e-9) return;
    for (let j = k; j < 6; j++) matrix[k][j] /= d;
    for (let i = 0; i < 5; i++) if (i !== k) { d = matrix[i][k]; for (let j = k; j < 6; j++) matrix[i][j] -= d * matrix[k][j]; }
  }
  const a = matrix[0][5], b = matrix[1][5] / 2, c = matrix[2][5], d = matrix[3][5], f = matrix[4][5], det = a * c - b * b;
  if (a <= 0 || c <= 0 || det <= 1e-8) return;
  const x = (b * f - c * d) / (2 * det), y = (b * d - a * f) / (2 * det), constant = 1 + a * x * x + 2 * b * x * y + c * y * y;
  const disc = Math.hypot(a - c, 2 * b), l1 = (a + c + disc) / 2, l2 = (a + c - disc) / 2;
  if (l2 <= 0 || constant <= 0) return;
  const result = [cx + x * scale, cy + y * scale, scale * Math.sqrt(constant / l1), scale * Math.sqrt(constant / l2), .5 * Math.atan2(2 * b, a - c)];
  return ellipseSupported(result, points) ? result : undefined;
}

function ellipseCurves(e: number[], positive: boolean): Curve[] {
  const sign = positive ? 1 : -1, k = .5522847498307936, curves: Curve[] = [];
  const point = (x: number, y: number): Point => [e[0] + x * e[2] * Math.cos(e[4]) - y * e[3] * Math.sin(e[4]), e[1] + x * e[2] * Math.sin(e[4]) + y * e[3] * Math.cos(e[4])];
  for (let i = 0; i < 4; i++) {
    const t = i * Math.PI / 2 * sign, u = (i + 1) * Math.PI / 2 * sign;
    const from = i ? curves[i - 1].to : point(1, 0), to = i === 3 ? curves[0].from : point(Math.cos(u), Math.sin(u));
    curves.push({ from, to, controls: [point(Math.cos(t) - sign * k * Math.sin(t), Math.sin(t) + sign * k * Math.cos(t)), point(Math.cos(u) + sign * k * Math.sin(u), Math.sin(u) - sign * k * Math.cos(u))] });
  }
  return curves;
}

// Port of CurveQuality's signed scanline integration. Evaluate the actual
// exported cubics, rather than only the contour points used to fit them.
function finishCurves(raw: Point[], points: Point[], corners: Set<number>, initial: Curve[], raster: RasterChain, options: TraceOptions, diagnostics: TraceDiagnostics, objective: ReturnType<typeof coverageObjective>): Curve[] {
  if (points.length > 6000 || objective.indices.length > 24000) { diagnostics.qualitySkipped++; return initial; }
  const rows = new Map<number, number[]>();
  objective.ys.forEach((y, i) => { const row = rows.get(y) ?? []; row.push(i); rows.set(y, row); });
  const coverage = (polygon: Point[]) => {
    const crossings = new Map<number, [number, number][]>();
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length]; if (Math.abs(a[1] - b[1]) < 1e-12) continue;
      const first = Math.max(0, Math.ceil(Math.min(a[1], b[1]) * 4 - .5));
      const last = Math.min(raster.field.height * 4, Math.ceil(Math.max(a[1], b[1]) * 4 - .5));
      for (let row = first; row < last; row++) {
        if (!rows.has(Math.floor(row / 4))) continue;
        const y = (row + .5) / 4, x = a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
        const hits = crossings.get(row) ?? []; hits.push([x, a[1] > b[1] ? 1 : -1]); crossings.set(row, hits);
      }
    }
    const result = new Float64Array(objective.indices.length);
    for (const [row, pixels] of rows) for (let sample = 0; sample < 4; sample++) {
      const hits = crossings.get(row * 4 + sample); if (!hits) continue; hits.sort((a, b) => a[0] - b[0]);
      const integral = new Float64Array(hits.length), winding = new Int32Array(hits.length);
      for (let j = 0; j < hits.length; j++) {
        if (j) integral[j] = integral[j - 1] + winding[j - 1] * (hits[j][0] - hits[j - 1][0]);
        winding[j] = (j ? winding[j - 1] : 0) + hits[j][1];
      }
      const at = (x: number) => { let lo = 0, hi = hits.length; while (lo < hi) { const mid = (lo + hi) >>> 1; if (hits[mid][0] <= x) lo = mid + 1; else hi = mid; } const i = lo - 1; return i < 0 ? 0 : integral[i] + winding[i] * (x - hits[i][0]); };
      for (const i of pixels) result[i] += (at(objective.xs[i] + 1) - at(objective.xs[i])) / 4;
    }
    return result;
  };
  const flatten = flattenStroke;
  const original = coverage(raw);
  const energy = (curves: Curve[], commit = false) => {
    const area = coverage(flatten(curves)), predicted = new Float64Array(objective.base); let sum = 0;
    for (let i = 0; i < area.length; i++) for (let c = 0; c < 4; c++) {
      const at = i * 4 + c; predicted[at] += (original[i] - area[i]) * raster.difference[c];
      sum += .5 * (predicted[at] - objective.observed[at]) ** 2;
    }
    if (commit) objective.commit(predicted); return sum;
  };
  const intersects = (curves: Curve[]) => {
    const p = flatten(curves), grid = new Map<string, number[]>(); let cells = 0;
    const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i], x0 = Math.floor(Math.min(a[0], b[0]) / 8), x1 = Math.floor(Math.max(a[0], b[0]) / 8), y0 = Math.floor(Math.min(a[1], b[1]) / 8), y1 = Math.floor(Math.max(a[1], b[1]) / 8);
      if ((cells += (x1 - x0 + 1) * (y1 - y0 + 1)) > 50000) return true;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const key = `${x},${y}`, edges = grid.get(key) ?? [];
        for (const j of edges) { if (j === i - 1 || distance2(p[0], p[p.length - 1]) < 1e-12 && j === 1 && i === p.length - 1) continue; const c = p[j - 1], d = p[j]; if (cross(a, b, c) * cross(a, b, d) < -1e-10 && cross(c, d, a) * cross(c, d, b) < -1e-10) return true; }
        edges.push(i); grid.set(key, edges);
      }
    }
    return false;
  };
  const closed = distance2(points[0], points[points.length - 1]) === 0, count = points.length - Number(closed);
  const cuts = new Set([0, points.length - 1, ...corners]);
  if (closed) { let far = 1; for (let i = 2; i < count; i++) if (distance2(points[0], points[i]) > distance2(points[0], points[far])) far = i; cuts.add(far); }
  const sorted = [...cuts].sort((a, b) => a - b);
  const refit = (tolerance: number) => {
    const curves: Curve[] = [], tangent = (i: number) => { const r = Math.min(3, Math.floor((count - 1) / 2)); return unit(points[(i - r + count) % count], points[(i + r) % count]); };
    for (let k = 1; k < sorted.length; k++) {
      const start = sorted[k - 1], end = sorted[k]; if (end <= start) continue;
      const left = corners.has(start % count) ? unit(points[start], points[start + 1]) : tangent(start % count);
      const right = corners.has(end % count) ? unit(points[end - 1], points[end]) : tangent(end % count);
      curves.push(...fitWithSharedTangents(points.slice(start, end + 1), tolerance, left, [-right[0], -right[1]]));
    }
    return curves;
  };
  const curvature = (curve: Curve, end: boolean) => {
    if (!curve.controls) return 0;
    const a = end ? curve.to : curve.from, b = curve.controls[end ? 1 : 0], c = curve.controls[end ? 0 : 1];
    const dx = 3 * (b[0] - a[0]), dy = 3 * (b[1] - a[1]), ddx = 6 * (a[0] - 2 * b[0] + c[0]), ddy = 6 * (a[1] - 2 * b[1] + c[1]), length = Math.hypot(dx, dy);
    return length < 1e-6 ? 0 : (end ? -1 : 1) * (dx * ddy - dy * ddx) / length ** 3;
  };
  const score = (value: number, curves: Curve[]) => {
    let penalty = 0;
    for (let i = 0; i < curves.length; i++) {
      const a = curves[i], b = curves[(i + 1) % curves.length];
      if (distance2(a.to, b.from) > 1e-12 || [...corners].some(j => distance2(points[j], a.to) < 1e-10)) continue;
      penalty += Math.min(2, Math.abs(curvature(a, true) - curvature(b, false)) * Math.min(10, Math.sqrt(distance2(a.from, b.to))));
    }
    return value + .04 * curves.length + .02 * penalty;
  };
  let best = initial, value = energy(initial); const before = value;
  diagnostics.finalRasterBefore += before;
  const tolerance = Math.min(.65, options.tolerance, closed ? Math.max(.15, .04 * Math.sqrt(Math.abs(signedArea(points)))) : .65);
  const accept = (candidate: Curve[]) => { const trial = energy(candidate); if (trial <= before * 1.02 + 1e-6 && score(trial, candidate) < score(value, best) && !intersects(candidate)) { best = candidate; value = trial; return true; } return false; };
  for (const t of [Math.min(.2, tolerance), tolerance]) accept(refit(t));
  if (closed && corners.size <= 2) {
    const ellipse = fitEllipse(points);
    if (ellipse) {
      let e = ellipse, candidate = ellipseCurves(e, signedArea(points) > 0), trial = energy(candidate);
      for (let pass = 0; pass < 3; pass++) for (let axis = 0; axis < 5; axis++) for (const direction of [-1, 1]) {
        const next = [...e]; next[axis] += direction * (axis === 4 ? .0015 : .12) / 2 ** pass;
        if (!ellipseSupported(next, points)) continue; const curves = ellipseCurves(next, signedArea(points) > 0), result = energy(curves);
        if (result < trial) { e = next; candidate = curves; trial = result; }
      }
      if (accept(candidate)) diagnostics.ellipses++;
    }
  }
  if (objective.indices.length <= 12000) {
    const candidate = fairStrokeCurvature(best);
    if (candidate !== best) {
      diagnostics.sharedFairingCandidates++; const trial = energy(candidate);
      if (trial <= value + 1e-9) {
        diagnostics.sharedFairingAccepted++; diagnostics.sharedFairingRoughnessBefore += strokeRoughness(best); diagnostics.sharedFairingRoughnessAfter += strokeRoughness(candidate);
        best = candidate; value = trial;
      }
    }
  }
  if (best !== initial) diagnostics.qualityRefits++;
  diagnostics.finalRasterAfter += energy(best, true);
  return best;
}

// A pointed cusp can occupy a two-pixel flat cap after rasterization. Keeping
// both cap ends as corners exports a tiny rectangle instead of a single tip.
// Only consolidate short straight caps with widening, convergent flanks;
// parallel stroke ends and ordinary rectangle corners remain unchanged.
export function consolidateRasterTips(raw: Point[], corners: Set<number>): Map<number, Point> {
  const targets = new Map<number, Point>();
  const closed = distance2(raw[0], raw[raw.length - 1]) === 0, count = raw.length - Number(closed);
  if (!closed || count < 24 || Math.abs(signedArea(raw)) < 16) return targets;
  const originalCorners = new Set(corners);
  const consumed = new Set<number>();
  for (let start = 0; start < count; start++) {
    const direction = unit(raw[start], raw[(start + 1) % count]);
    if (dot(direction, unit(raw[(start - 1 + count) % count], raw[start])) > .999) continue;
    let span = 1;
    while (span < count && dot(direction, unit(raw[(start + span) % count], raw[(start + span + 1) % count])) > .999) span++;
    const end = (start + span) % count;
    if (consumed.has(start) || consumed.has(end) || span > 3) continue;
    const a = raw[start], b = raw[end], length = Math.sqrt(distance2(a, b));
    if (length < .5 || length > 3) continue;
    let straight = true;
    for (let j = 1; j < span; j++) if (lineDistance2(raw[(start + j) % count], a, b) > 1e-10) straight = false;
    if (!straight) continue;
    const middle = mix(a, b, .5), radius = Math.min(6, Math.floor(count / 12));
    const left = raw[(start - radius + count) % count], right = raw[(end + radius) % count];
    if (dot(unit(middle, left), unit(middle, right)) < .25) continue;
    const cap = unit(a, b), flankWidth = Math.abs(dot([right[0] - left[0], right[1] - left[1]], cap));
    if (flankWidth < length + .75) continue;
    // Flanks must straddle the cap; an off-center stair on a sloping edge
    // must not be promoted to a tip.
    if (Math.abs(dot([left[0] + right[0] - 2 * middle[0], left[1] + right[1] - 2 * middle[1]], cap)) > length + 1) continue;
    const pivot = (start + Math.floor(span / 2)) % count;
    for (let j = -2; j <= span + 2; j++) corners.delete((start + j + count) % count);
    corners.add(pivot);
    targets.set(pivot, middle); consumed.add(start); consumed.add(end);
  }
  // Only four pointed lobes with inset flanks qualify. A short cap on an arrow,
  // rounded stroke or stair step must not become an invented sharp tip.
  let sparkle = targets.size === 4;
  const tips = [...targets.keys()].sort((a, b) => a - b), orientation = Math.sign(signedArea(raw));
  if (sparkle) for (let k = 0; k < tips.length; k++) {
    const from = tips[k], to = tips[(k + 1) % tips.length], span = (to - from + count) % count, a = targets.get(from)!, b = targets.get(to)!;
    const length = Math.sqrt(distance2(a, b)); let inset = false;
    for (let j = 1; j < span; j++) {
      const p = raw[(from + j) % count], cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      if (cross * orientation > length * .75) { inset = true; break; }
    }
    if (!inset) { sparkle = false; break; }
  }
  if (!sparkle) { targets.clear(); corners.clear(); for (const corner of originalCorners) corners.add(corner); }
  return targets;
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
  const tipTargets = consolidateRasterTips(raw, corners);
  const weights = [1, 6, 15, 20, 15, 6, 1];
  const initial = raw.map((p, i): Point => {
    const index = i % count;
    if (tipTargets.has(index)) return tipTargets.get(index)!;
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
  const objective = raster ? coverageObjective(raw, raster.field, raster.difference) : undefined;
  const smoothed = raster ? refineCoverage(raw, warm, corners, raster, diagnostics, objective) : warm;
  const points = regularizeShallowDents(smoothed, corners);
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
  const lines = straightSpans(points, options.tolerance, cuts);
  const lineTangents = new Map<number, Point>();
  for (const line of lines) { cuts.add(line.start); cuts.add(line.end); lineTangents.set(line.start % count, line.direction); lineTangents.set(line.end % count, line.direction); }
  const sorted = [...cuts].sort((a, b) => a - b), curves: Curve[] = [];
  const tangent = (i: number): Point => {
    if (lineTangents.has(i)) return lineTangents.get(i)!;
    const r = Math.min(3, Math.floor((count - 1) / 2));
    return unit(points[(i - r + count) % count], points[(i + r) % count]);
  };
  for (let i = 1; i < sorted.length; i++) {
    const rangeStart = sorted[i - 1], rangeEnd = sorted[i];
    const line = lines.find(l => l.start <= rangeStart && l.end >= rangeEnd);
    if (line) { curves.push({ from: points[rangeStart], to: points[rangeEnd] }); diagnostics.straightSpans++; continue; }
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
  const compact = compactSmoothCurves(curves, [...corners].map(i => points[i]));
  diagnostics.compactedCurvePairs += curves.length - compact.length;
  return raster && objective ? finishCurves(raw, smoothed, corners, compact, raster, options, diagnostics, objective) : compact;
}

function traceRasterRun(rgba: Uint8ClampedArray, width: number, height: number, options: TraceOptions, progress: (value: number, label: string) => void, protect: boolean, capture: (pixels: Uint8Array) => void): TraceResult {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 2048 * 2048 || rgba.length !== width * height * 4) throw new Error('Ukuran raster tidak valid (maksimum 4 megapiksel).');
  if (!Number.isInteger(options.colors) || options.colors < 2 || options.colors > 16 || !Number.isFinite(options.tolerance) || options.tolerance < 0.1 || options.tolerance > 4 || !Number.isFinite(options.minArea) || options.minArea < 0 || options.minArea > 100) throw new Error('Pengaturan tracing tidak valid.');
  const whiteMode = options.whiteMode ?? (options.removeWhite ? 'all' : 'none');
  if (!['none', 'background', 'all'].includes(whiteMode)) throw new Error('Mode hapus putih tidak valid.');
  progress(10, 'Mencari palet warna…');
  const diagnostics: TraceDiagnostics = { ...transitionDefaults, underpaintPairs: 0, underpaintPaths: 0, sharedFairingCandidates: 0, sharedFairingAccepted: 0, sharedFairingRoughnessBefore: 0, sharedFairingRoughnessAfter: 0, unitFragments: 0, merges: 0, swaps: 0, puncturedCorners: 0, tangentRefits: 0, rasterSteps: 0, rasterEnergyBefore: 0, rasterEnergyAfter: 0, smallAreaConstraints: 0, guardedFits: 0, fitDeviationBefore: 0, fitDeviationAfter: 0, mergedTransitionRegions: 0, reassignedTransitionPixels: 0, straightSpans: 0, compactedCurvePairs: 0, protectedDetailPixels: 0, qualityRefits: 0, qualitySkipped: 0, finalRasterBefore: 0, finalRasterAfter: 0, ellipses: 0, sceneErrorBefore: 0, sceneErrorAfter: 0, sceneDetailBefore: 0, sceneDetailAfter: 0, sceneEdgeBefore: 0, sceneEdgeAfter: 0, sceneCandidateError: 0, globalCandidates: 0, globalAccepted: 0, regularizedChains: 0, protectedDetailCandidates: 0, detailProtectionAccepted: 0 };
  const { labels, palette, flatInteriors } = options.smooth && options.colors >= 8 && options.minArea >= 4 && whiteMode === 'background'
    ? quantizeFlatInteriors(rgba, options.colors, width, height) : { ...quantize(rgba, options.colors), flatInteriors: false };
  const detailEvidence = options.smooth || options.minArea > 0 ? protectDetails(rgba, labels, palette, width, height) : undefined;
  const detail = protect ? detailEvidence : undefined;
  const detailPixels = detail?.pixels ?? new Uint8Array(labels.length);
  capture(detailEvidence?.pixels ?? new Uint8Array(labels.length));
  diagnostics.protectedDetailCandidates = detailEvidence?.total ?? 0;
  diagnostics.protectedDetailPixels = detail?.total ?? 0;
  progress(30, 'Merapikan region…');
  if (options.minArea > 0) compactPalette(rgba, labels, palette, width, height, options.minArea, detail?.colors, flatInteriors);
  detail?.restore();
  if (!flatInteriors) refinePaletteInteriors(rgba, labels, palette, width, height, detail?.mask());
  refineTransitions(rgba, labels, width, height, palette);
  if (flatInteriors) regularizeShadeLabels(labels, width, height, palette);
  detail?.restore();
  cleanRegions(labels, width, height, options.minArea, palette, rgba);
  detail?.restore();
  const cleanup = cleanTransitionRegions(rgba, labels, palette, width, height, options.minArea, flatInteriors, diagnostics);
  detail?.restore();
  diagnostics.mergedTransitionRegions = cleanup.mergedRegions;
  diagnostics.reassignedTransitionPixels = cleanup.reassignedPixels;
  if (flatInteriors && options.smooth && options.minArea >= 4) mergeSmallEdgeRegions(rgba, labels, palette, width, height, detail?.pixels ?? new Uint8Array(labels.length), diagnostics, perceptualColor);
  const { ids: regionIds, regions } = identifyRegions(labels, width, height);
  if (regions.length > 2000) throw new Error('Gambar terlalu kompleks. Kurangi jumlah warna atau pilih resolusi 512 px.');
  const hidden = hiddenRegions(labels, palette, regions, regionIds, width, height, whiteMode);
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
  const field: RasterField = { width, height, observed: rgba, predicted: new Float32Array(rgba.length) };
  if (options.smooth) labels.forEach((label, i) => field.predicted.set(color(label), i * 4));
  const chains: Chain[] = [];
  const walkChain = (edgeId: number, start: number) => {
    const seed = edges[edgeId], forward = seed.a === start;
    const left = color(forward ? seed.left : seed.right), right = color(forward ? seed.right : seed.left);
    const raster = options.smooth ? { field, difference: left.map((v, i) => v - right[i]) } : undefined;
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
    const edge = edges[seed], x = edge.a % stride, y = Math.floor(edge.a / stride);
    const horizontal = edge.b === edge.a + 1;
    const pixel = forward ? (horizontal ? y * width + x : y * width + x - 1) : (horizontal ? (y - 1) * width + x : y * width + x);
    regions[regionIds[pixel]].loops.push({ refs, area: area / 2, nodes });
  }
  const colors = palette.map(p => '#' + p.map(v => Math.round(v).toString(16).padStart(2, '0')).join(''));
  const transparentSeeds = regions.filter((r, id) => r.label < 0 || hidden[id]).map(r => [r.seed % width + 0.5, Math.floor(r.seed / width) + 0.5] as Point);
  // [ADAPTER-SVG] Our area-sorted underpainting/transparent-hole export policy.
  const layers = regions.filter((r, id) => r.label >= 0 && !hidden[id]).map(region => {
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
  const exportGeometry = (geometry: Chain[]): TraceResult => {
    let segments = 0;
    const paths = layers.map(layer => {
      const data = layer.loops.map(loop => {
        let d = '';
        for (const ref of loop.refs) {
          const curves = ref.forward ? geometry[ref.chain].curves : [...geometry[ref.chain].curves].reverse().map(c => ({ from: c.to, to: c.from, controls: c.controls ? [c.controls[1], c.controls[0]] as [Point, Point] : undefined }));
          for (const c of curves) { if (!d) d = `M${xy(c.from)}`; d += c.controls ? `C${xy(c.controls[0])} ${xy(c.controls[1])} ${xy(c.to)}` : `L${xy(c.to)}`; segments++; }
        }
        return d + 'Z';
      }).join('');
      return `<path fill="${layer.color}" fill-rule="evenodd" d="${data}"/>`;
    }).join('');
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${paths}</svg>`, colors: visibleColors, paths: layers.length, contours, segments, width, height, diagnostics };
  };
  progress(90, 'Memeriksa kualitas SVG…');
  let result = exportGeometry(chains);
  const before = evaluateSvgScene(result.svg, rgba, width, height, whiteMode !== 'none', detailPixels);
  diagnostics.sceneErrorBefore = diagnostics.sceneErrorAfter = before.error;
  diagnostics.sceneDetailBefore = diagnostics.sceneDetailAfter = before.detailError;
  diagnostics.sceneEdgeBefore = diagnostics.sceneEdgeAfter = before.edgeError;
  if (options.smooth) {
    let bestError = before.error, selected = false;
    const adapter = { fit: fitWithSharedTangents, compact: compactSmoothCurves };
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = chains.map(chain => ({ curves: attempt === 0 ? regularizeStroke(chain.curves, adapter) : balanceStrokeCurvature(chain.curves, attempt === 1 ? .5 : .15) }));
      const changed = candidate.filter((chain, i) => chain.curves !== chains[i].curves).length;
      if (!changed) continue;
      diagnostics.globalCandidates++;
      const proposed = exportGeometry(candidate), after = evaluateSvgScene(proposed.svg, rgba, width, height, whiteMode !== 'none', detailPixels);
      diagnostics.sceneCandidateError = after.error;
      if (sceneAllows(before, after) && (!selected || after.error < bestError)) {
        result = proposed; selected = true; bestError = after.error; diagnostics.globalAccepted++; diagnostics.regularizedChains = changed;
        diagnostics.sceneErrorAfter = after.error; diagnostics.sceneDetailAfter = after.detailError; diagnostics.sceneEdgeAfter = after.edgeError;
      }
    }
  }
  progress(100, 'Tracing selesai');
  return result;
}

function traceRasterGeometry(rgba: Uint8ClampedArray, width: number, height: number, options: TraceOptions, progress: (value: number, label: string) => void = () => {}): TraceResult {
  let detailPixels: Uint8Array | undefined;
  const compareDetails = options.smooth;
  let baseline: TraceResult;
  try { baseline = traceRasterRun(rgba, width, height, options, (v, label) => progress(Math.round(v * (compareDetails ? .7 : 1)), label), !options.smooth, pixels => { detailPixels = pixels; }); }
  catch (error) {
    // Cleanup can remove every foreground component before a baseline SVG
    // exists. Recover only when source-supported details were captured.
    if (!compareDetails || !detailPixels?.some(Boolean) || !(error instanceof Error) || !error.message.includes('Tidak ada bidang tersisa')) throw error;
    const recovered = traceRasterRun(rgba, width, height, options, (v, label) => progress(70 + Math.round(v * .3), label), true, () => {});
    recovered.diagnostics.detailProtectionAccepted = 1;
    return recovered;
  }
  if (!compareDetails || !detailPixels?.some(Boolean)) { progress(100, 'Tracing selesai'); return baseline; }
  let candidate: TraceResult;
  try { candidate = traceRasterRun(rgba, width, height, options, (v, label) => progress(70 + Math.round(v * .3), label), true, () => {}); }
  catch (error) { if (error instanceof Error && error.message.includes('terlalu kompleks')) { progress(100, 'Tracing selesai'); return baseline; } throw error; }
  if (candidate.paths > baseline.paths * 1.25 + 2 || candidate.segments > baseline.segments * 1.25 + 10 || candidate.diagnostics.sceneErrorAfter > baseline.diagnostics.sceneErrorAfter * 1.005 + 1e-9) return baseline;
  const removed = (options.whiteMode ?? (options.removeWhite ? 'all' : 'none')) !== 'none';
  const oldScene = evaluateSvgScene(baseline.svg, rgba, width, height, removed, detailPixels), newScene = evaluateSvgScene(candidate.svg, rgba, width, height, removed, detailPixels);
  if (!sceneAllows(oldScene, newScene)) return baseline;
  candidate.diagnostics.detailProtectionAccepted = 1;
  return candidate;
}

export function traceRaster(rgba: Uint8ClampedArray, width: number, height: number, options: TraceOptions, progress: (value: number, label: string) => void = () => {}): TraceResult {
  const result = traceRasterGeometry(rgba, width, height, options, progress);
  return options.smooth ? underpaint(result) : result;
}
