/** Independent raster tracer: palette → regions → shared boundaries → bounded curve fitting.
 * Research-informed implementation; no Vector Magic binary, code, or runtime constants are used.
 */
export interface TraceOptions { colors: number; tolerance: number; minArea: number; smooth: boolean; removeWhite: boolean }
export interface TraceResult { svg: string; colors: string[]; paths: number; contours: number; segments: number; width: number; height: number }
type Point = [number, number];
type RGB = [number, number, number];
type Curve = { from: Point; to: Point; controls?: [Point, Point] };
type Edge = { a: number; b: number; right: number; left: number; chain: number; forward: boolean };
type Chain = { curves: Curve[] };
const distance2 = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0);
const mix = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const unit = (a: Point, b: Point): Point => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const xy = (p: Point) => `${fmt(p[0])} ${fmt(p[1])}`;

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

function fit(points: Point[], tolerance: number, left: Point, right: Point, depth = 0): Curve[] {
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
  return [...fit(points.slice(0, split + 1), tolerance, left, [-tangent[0], -tangent[1]], depth + 1), ...fit(points.slice(split), tolerance, tangent, right, depth + 1)];
}

function fitChain(raw: Point[], width: number, height: number, options: TraceOptions): Curve[] {
  if (!options.smooth) {
    const cuts = simplify(raw, options.tolerance);
    return cuts.slice(1).map((to, i) => ({ from: raw[cuts[i]], to: raw[to] }));
  }
  const closed = distance2(raw[0], raw[raw.length - 1]) === 0;
  const count = raw.length - (closed ? 1 : 0);
  const corners = new Set<number>();
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
  const points = raw.map((p, i): Point => {
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
    const start = sorted[i - 1], end = sorted[i], radius = Math.min(3, end - start);
    const left = corners.has(start % count) ? unit(points[start], points[start + radius]) : tangent(start % count);
    const t = corners.has(end % count) ? unit(points[end - radius], points[end]) : tangent(end % count);
    curves.push(...fit(points.slice(start, end + 1), options.tolerance, left, [-t[0], -t[1]]));
  }
  return curves;
}

export function traceRaster(rgba: Uint8ClampedArray, width: number, height: number, options: TraceOptions, progress: (value: number, label: string) => void = () => {}): TraceResult {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1024 * 1024 || rgba.length !== width * height * 4) throw new Error('Ukuran raster tidak valid (maksimum 1024 × 1024 piksel).');
  if (!Number.isInteger(options.colors) || options.colors < 2 || options.colors > 16 || !Number.isFinite(options.tolerance) || options.tolerance < 0.1 || options.tolerance > 4 || !Number.isFinite(options.minArea) || options.minArea < 0 || options.minArea > 100) throw new Error('Pengaturan tracing tidak valid.');
  progress(10, 'Mencari palet warna…');
  const { labels, palette } = quantize(rgba, options.colors);
  progress(30, 'Merapikan region…');
  cleanRegions(labels, width, height, options.minArea, palette);
  if (options.removeWhite) for (let i = 0; i < labels.length; i++) if (labels[i] >= 0 && palette[labels[i]].every(v => v >= 242)) labels[i] = -1;
  progress(45, 'Menelusuri batas warna…');
  const stride = width + 1, edges: Edge[] = [], adjacency = new Map<number, number[]>();
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
  const chains: Chain[] = [];
  const walkChain = (edgeId: number, start: number) => {
    const nodes: Point[] = [[start % stride, Math.floor(start / stride)]];
    let current = start;
    while (true) {
      const edge = edges[edgeId];
      if (edge.chain >= 0) break;
      edge.chain = chains.length; edge.forward = edge.a === current;
      current = edge.forward ? edge.b : edge.a;
      nodes.push([current % stride, Math.floor(current / stride)]);
      if (current === start || junction(current)) break;
      edgeId = adjacency.get(current)!.find(id => id !== edgeId)!;
    }
    chains.push({ curves: fitChain(nodes, width, height, options) });
  };
  progress(60, 'Menyederhanakan kontur…');
  edges.forEach((e, id) => { if (e.chain < 0 && (junction(e.a) || junction(e.b))) walkChain(id, junction(e.a) ? e.a : e.b); });
  edges.forEach((e, id) => { if (e.chain < 0) walkChain(id, e.a); });
  const used = new Uint8Array(edges.length), paths = palette.map(() => [] as string[]);
  let contours = 0, segments = 0;
  const direction = (a: number, b: number) => b === a + 1 ? 0 : b === a + stride ? 1 : b === a - 1 ? 2 : 3;
  progress(85, 'Membangun SVG…');
  for (let seed = 0; seed < edges.length; seed++) for (const forward of [true, false]) {
    const label = forward ? edges[seed].right : edges[seed].left;
    const mask = forward ? 1 : 2;
    if (label < 0 || (used[seed] & mask)) continue;
    let id = seed, dir = forward;
    const loop: { chain: number; forward: boolean }[] = [];
    for (let guard = 0; guard <= edges.length; guard++) {
      const edge = edges[id];
      const bit = dir ? 1 : 2;
      if (used[id] & bit) { if (id === seed && dir === forward) break; throw new Error('Kontur tidak dapat ditutup. Coba resolusi yang lebih kecil.'); }
      used[id] |= bit;
      loop.push({ chain: edge.chain, forward: dir === edge.forward });
      const a = dir ? edge.a : edge.b, b = dir ? edge.b : edge.a;
      const incoming = direction(a, b);
      let next = -1, nextForward = true, best = 99;
      for (const candidate of adjacency.get(b)!) {
        const e = edges[candidate], f = e.a === b;
        if ((f ? e.right : e.left) !== label) continue;
        const turn = (direction(b, f ? e.b : e.a) - incoming + 4) % 4;
        const rank = [1, 0, 3, 2][turn]; // right turn resolves diagonal contacts as separate regions
        if (rank < best) { best = rank; next = candidate; nextForward = f; }
      }
      if (next < 0) throw new Error('Batas region terputus.');
      id = next; dir = nextForward;
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
    let data = '';
    for (const ref of refs) {
      const curves = ref.forward ? chains[ref.chain].curves : [...chains[ref.chain].curves].reverse().map(c => ({ from: c.to, to: c.from, controls: c.controls ? [c.controls[1], c.controls[0]] as [Point, Point] : undefined }));
      for (const curve of curves) {
        if (!data) data = `M${xy(curve.from)}`;
        data += curve.controls ? `C${xy(curve.controls[0])} ${xy(curve.controls[1])} ${xy(curve.to)}` : `L${xy(curve.to)}`;
        segments++;
      }
    }
    paths[label].push(data + 'Z'); contours++;
  }
  const colors = palette.map(p => '#' + p.map(v => Math.round(v).toString(16).padStart(2, '0')).join(''));
  const visible = paths.map((loops, i) => ({ loops, color: colors[i] })).filter(p => p.loops.length);
  if (!visible.length) throw new Error('Tidak ada bidang tersisa. Nonaktifkan hapus putih atau kurangi pembersihan bintik.');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${visible.map(p => `<path fill="${p.color}" fill-rule="evenodd" d="${p.loops.join('')}"/>`).join('')}</svg>`;
  progress(100, 'Tracing selesai');
  return { svg, colors: visible.map(p => p.color), paths: visible.length, contours, segments, width, height };
}
