import { tracingSvgPaths } from './svg-paths';
/** Port of mini-vectorizer SvgSceneQuality. Only accepts the opaque even-odd
 * M/L/C/Z subset exported by our engine; no DOM or external SVG resources. */
type Point = [number, number];
type Edge = { x: number; y: number; dx: number; dy: number; layer: number; end: number; winding: number };
export interface SceneMetrics { error: number; detailError: number; edgeError: number; edgePixels: number; tiles: Float64Array }
export const SCENE_TILE = 16;
const SAMPLES = 8;
const mix = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const distance = (p: Point, a: Point, b: Point) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
  return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
};

export function sceneAllows(before: SceneMetrics, after: SceneMetrics) {
  if (![after.error, after.detailError, after.edgeError].every(Number.isFinite) || after.tiles.length !== before.tiles.length) return false;
  if (after.error > before.error * 1.01 + 1e-9 || after.detailError > before.detailError * 1.01 + 1e-9 || after.edgeError > before.edgeError * 1.02 + 1e-9) return false;
  for (let i = 0; i < before.tiles.length; i++) if (!Number.isFinite(after.tiles[i]) || after.tiles[i] > before.tiles[i] * 1.03 + .002) return false;
  return true;
}

export function evaluateSvgScene(svg: string, rgba: Uint8ClampedArray, width: number, height: number, whiteRemoved = false, protectedPixels?: Uint8Array): SceneMetrics {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 2048 * 2048 || rgba.length !== width * height * 4 || protectedPixels && protectedPixels.length !== width * height) throw new Error('Ukuran evaluasi SVG tidak valid.');
  const starts: (Edge[] | undefined)[] = new Array(height * SAMPLES), colors: number[][] = [], clipLayers = new Map<number, number>(), nonzero = new Set<number>();
  const edge = (a: Point | undefined, b: Point | undefined, layer: number) => {
    if (!a || !b) throw new Error('Kontur SVG tidak lengkap.');
    if (Math.abs(a[1] - b[1]) < 1e-12) return;
    const first = Math.max(0, Math.ceil(Math.min(a[1], b[1]) * SAMPLES - .5));
    const end = Math.min(height * SAMPLES, Math.ceil(Math.max(a[1], b[1]) * SAMPLES - .5));
    if (first >= end) return;
    (starts[first] ??= []).push({ x: a[0], y: a[1], dx: b[0] - a[0], dy: b[1] - a[1], layer, end, winding: a[1] < b[1] ? 1 : -1 });
  };
  const cubic = (a: Point, b: Point, c: Point, d: Point, layer: number, depth = 0) => {
    if (depth >= 14 || Math.max(distance(b, a, d), distance(c, a, d)) <= .0004) { edge(a, d, layer); return; }
    const ab = mix(a, b), bc = mix(b, c), cd = mix(c, d), abc = mix(ab, bc), bcd = mix(bc, cd), mid = mix(abc, bcd);
    cubic(a, ab, abc, mid, layer, depth + 1); cubic(mid, bcd, cd, d, layer, depth + 1);
  };
  const parsePath = (data: string, layer: number) => {
    const tokens = [...data.matchAll(/[MLCZ]|-?\d+(?:\.\d+)?/g)]; let end = 0;
    for (const token of tokens) { if (data.slice(end, token.index).trim()) throw new Error('Format SVG tidak didukung.'); end = token.index + token[0].length; }
    if (data.slice(end).trim()) throw new Error('Format SVG tidak didukung.');
    let first: Point | undefined, current: Point | undefined;
    for (let i = 0; i < tokens.length;) {
      const command = tokens[i++][0];
      if (command === 'Z') { edge(current, first, layer); current = first; continue; }
      if (!['M', 'L', 'C'].includes(command)) throw new Error('Format SVG tidak didukung.');
      const values: number[] = [];
      for (let n = command === 'C' ? 6 : 2; n > 0; n--) { const v = Number(tokens[i++]?.[0]); if (!Number.isFinite(v)) throw new Error('Koordinat SVG tidak valid.'); values.push(v); }
      const to: Point = [values[values.length - 2], values[values.length - 1]];
      if (command === 'M') first = to;
      else if (command === 'L') edge(current, to, layer);
      else { if (!current) throw new Error('Kontur SVG tidak lengkap.'); cubic(current, [values[0], values[1]], [values[2], values[3]], to, layer); }
      current = to;
    }
  }
  for (const path of tracingSvgPaths(svg)) {
    const rgb = parseInt(path.color.slice(1), 16), layer = colors.length;
    colors.push([((rgb >>> 16) & 255) / 255, ((rgb >>> 8) & 255) / 255, (rgb & 255) / 255, 1]);
    parsePath(path.data, layer); if (!path.evenodd) nonzero.add(layer);
    if (path.clip) { const clip = colors.length; colors.push([]); nonzero.add(clip); clipLayers.set(layer, clip); parsePath(path.clip, clip); }
  }
  if (!colors.length) throw new Error('SVG tidak memiliki path untuk dievaluasi.');
  const columns = Math.ceil(width / SCENE_TILE), tiles = new Float64Array(columns * Math.ceil(height / SCENE_TILE));
  const metrics: SceneMetrics = { error: 0, detailError: 0, edgeError: 0, edgePixels: 0, tiles }; let detailPixels = 0;
  const row = new Float64Array(width * 4); let active: Edge[] = [];
  const span = (from: number, to: number, color: number[]) => {
    from = Math.max(0, from); to = Math.min(width, to); if (to <= from) return;
    for (let x = Math.floor(from); x < Math.ceil(to); x++) {
      const area = (Math.min(to, x + 1) - Math.max(from, x)) / SAMPLES;
      for (let c = 0; c < 4; c++) row[x * 4 + c] += area * color[c];
    }
  };
  const strongContrast = (a: number, b: number) => {
    const alpha = rgba[a + 3] / 255, beta = rgba[b + 3] / 255; let sum = whiteRemoved ? 0 : (alpha - beta) ** 2;
    for (let c = 0; c < 3; c++) { const p = alpha * rgba[a + c] / 255 + (whiteRemoved ? 1 - alpha : 0), q = beta * rgba[b + c] / 255 + (whiteRemoved ? 1 - beta : 0); sum += (p - q) ** 2; }
    return sum > .04;
  };
  for (let scan = 0; scan < height * SAMPLES; scan++) {
    if (scan % SAMPLES === 0) row.fill(0);
    active = active.filter(e => e.end > scan); if (starts[scan]) active.push(...starts[scan]!);
    const y = (scan + .5) / SAMPLES, hits = active.map(e => ({ x: e.x + (y - e.y) * e.dx / e.dy, layer: e.layer, winding: e.winding })).sort((a, b) => a.x - b.x);
    const paint = new Set<number>(), windings = new Int32Array(colors.length); let previous = 0, top = -1;
    for (const hit of hits) {
      if (top >= 0) span(previous, hit.x, colors[top]);
      if (nonzero.has(hit.layer)) { windings[hit.layer] += hit.winding; if (windings[hit.layer]) paint.add(hit.layer); else paint.delete(hit.layer); }
      else if (!paint.delete(hit.layer)) paint.add(hit.layer);
      top = -1;
      for (const layer of paint) if (colors[layer].length && layer > top && (!clipLayers.has(layer) || paint.has(clipLayers.get(layer)!))) top = layer;
      previous = hit.x;
    }
    if (scan % SAMPLES !== SAMPLES - 1) continue;
    const py = Math.floor(scan / SAMPLES);
    for (let x = 0; x < width; x++) {
      const offset = (py * width + x) * 4, alpha = rgba[offset + 3] / 255; let error = whiteRemoved ? 0 : (alpha - row[x * 4 + 3]) ** 2;
      for (let c = 0; c < 3; c++) { const expected = rgba[offset + c] / 255 * alpha + (whiteRemoved ? 1 - alpha : 0), actual = row[x * 4 + c] + (whiteRemoved ? 1 - row[x * 4 + 3] : 0); error += (expected - actual) ** 2; }
      metrics.error += error; tiles[Math.floor(py / SCENE_TILE) * columns + Math.floor(x / SCENE_TILE)] += error;
      if (protectedPixels?.[py * width + x]) { metrics.detailError += error; detailPixels++; }
      if (x > 0 && strongContrast(offset, offset - 4) || x + 1 < width && strongContrast(offset, offset + 4) || py > 0 && strongContrast(offset, offset - width * 4) || py + 1 < height && strongContrast(offset, offset + width * 4)) { metrics.edgeError += error; metrics.edgePixels++; }
    }
  }
  metrics.error /= width * height * 4; metrics.edgeError /= Math.max(1, metrics.edgePixels) * 4;
  metrics.detailError /= Math.max(1, detailPixels) * 4;
  return metrics;
}
