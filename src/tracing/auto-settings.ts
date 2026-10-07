import { perceptualColor, quantize, quantizeFlatInteriors, type TraceOptions } from './engine';
import { resolveAutoWhite, type WhiteMode } from './auto-white';
import { resizeRaster, validateRaster } from './auto-raster';

export interface AutoRecommendation { options: TraceOptions; resolution: number; photographic: boolean; fineDetail: boolean; sparseInk: boolean; detectedColors: number }
const distance2 = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0);
const neighbors = (i: number, w: number, h: number) => [i % w > 0 ? i - 1 : -1, i % w + 1 < w ? i + 1 : -1, i >= w ? i - w : -1, i + w < w * h ? i + w : -1];
const key = (p: Uint8ClampedArray, i: number) => p[i * 4 + 3] < 128 ? -1 : (p[i * 4] >>> 4) * 256 + (p[i * 4 + 1] >>> 4) * 16 + (p[i * 4 + 2] >>> 4);

export function hasFineGrain(p: Uint8ClampedArray, w: number, h: number): boolean {
  let interior = 0, fine = 0, strong = 0;
  const rgbDistance = (a: number, b: number) => Math.abs(p[a * 4] - p[b * 4]) + Math.abs(p[a * 4 + 1] - p[b * 4 + 1]) + Math.abs(p[a * 4 + 2] - p[b * 4 + 2]);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, left = i - 1, right = i + 1, up = i - w, down = i + w;
    if ([i, left, right, up, down].some(j => p[j * 4 + 3] < 128)) continue;
    if (Math.max(rgbDistance(left, right), rgbDistance(up, down), rgbDistance(left, up), rgbDistance(right, down)) > 90) continue;
    interior++; let deviation = 0;
    for (let c = 0; c < 3; c++) deviation += Math.abs(p[i * 4 + c] - Math.floor((p[left * 4 + c] + p[right * 4 + c] + p[up * 4 + c] + p[down * 4 + c]) / 4));
    if (deviation >= 6 && deviation <= 60) fine++;
    if (deviation >= 12 && deviation <= 60) strong++;
  }
  return interior > 64 && fine / interior >= .20 && strong / interior >= .07;
}

function thinRuns(p: Uint8ClampedArray, w: number, h: number) {
  let total = 0;
  for (let axis = 0; axis < 2; axis++) {
    const rows = axis ? w : h, columns = axis ? h : w;
    for (let r = 1; r < rows - 1; r++) {
      let start = 0, previous = key(p, axis ? r : r * w);
      for (let c = 1; c <= columns; c++) {
        const current = c === columns ? -2 : key(p, axis ? c * w + r : r * w + c);
        if (current === previous) continue;
        if (start > 0 && c < columns && c - start <= 3 && key(p, axis ? (start - 1) * w + r : r * w + start - 1) === current) {
          const index = axis ? start * w + r : r * w + start, offset = axis ? 1 : w;
          if (key(p, index - offset) === previous && key(p, index + offset) === previous) total++;
        }
        start = c; previous = current;
      }
    }
  }
  return total;
}

// Keep the Java detector's nearest-neighbor 96px palette samples and costs.
function choosePalette(p: Uint8ClampedArray, w: number, h: number, photographic: boolean) {
  const scale = Math.min(1, 96 / Math.max(w, h)), sw = Math.max(1, Math.round(w * scale)), sh = Math.max(1, Math.round(h * scale));
  const pixels = new Uint8ClampedArray(sw * sh * 4), labs: (number[] | undefined)[] = [];
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = y * sw + x, at = (Math.min(h - 1, Math.floor(y / scale)) * w + Math.min(w - 1, Math.floor(x / scale))) * 4;
    pixels.set(p.subarray(at, at + 4), i * 4);
    if (pixels[i * 4 + 3] >= 128) labs[i] = perceptualColor(Array.from(pixels.subarray(i * 4, i * 4 + 3)));
  }
  if (!labs.some(Boolean)) return { limit: 2, size: 0 };
  let best = 2, bestScore = Infinity;
  for (const count of [2, 4, 6, 8, 12]) {
    const q = quantize(pixels, count), palette = q.palette.map(perceptualColor);
    let error = 0, missed = 0, isolated = 0, population = 0;
    for (let i = 0; i < sw * sh; i++) {
      const lab = labs[i]; if (!lab) continue; population++;
      const label = q.labels[i]; error += distance2(lab, palette[label]); let similar = 0, count = 0;
      for (const n of neighbors(i, sw, sh)) if (n >= 0 && labs[n]) { count++; if (q.labels[n] === label) { similar++; if (distance2(lab, labs[n]!) > 100) missed++; } }
      if (count >= 3 && similar === 0) isolated++;
    }
    const score = (error + 8 * missed + 4 * isolated) / Math.max(1, population) + .35 * palette.length;
    if (score < bestScore) { bestScore = score; best = count; }
  }
  const limit = photographic ? Math.max(8, best) : best;
  const detected = photographic ? quantize(pixels, limit) : quantizeFlatInteriors(pixels, limit, sw, sh);
  return { limit, size: detected.palette.length };
}

/** AutoSettingsDetector: retain the source dimensions when analyzing a preview. */
export function detectAutoSettings(p: Uint8ClampedArray, w: number, h: number, sourceSide = Math.max(w, h), defaultWhite: WhiteMode = 'background'): AutoRecommendation {
  validateRaster(p, w, h);
  const bins = new Int32Array(32768); let opaque = 0, transparent = 0, white = 0, border = 0, borderWhite = 0, extremes = 0, dark = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = (y * w + x) * 4; if (p[at + 3] < 128) { transparent++; continue; }
    const r = p[at], g = p[at + 1], b = p[at + 2], max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min <= 12 && (max <= 48 || min >= 240)) extremes++;
    if (max <= 80) dark++;
    bins[(r >>> 3) * 1024 + (g >>> 3) * 32 + (b >>> 3)]++; opaque++;
    const nearWhite = min >= 245; if (nearWhite) white++;
    if (x < Math.max(1, Math.floor(w / 20)) || y < Math.max(1, Math.floor(h / 20)) || x >= w - Math.max(1, Math.floor(w / 20)) || y >= h - Math.max(1, Math.floor(h / 20))) { border++; if (nearWhite) borderWhite++; }
  }
  if (!opaque) throw new Error('Gambar sepenuhnya transparan. Pilih gambar dengan bidang berwarna.');
  bins.sort(); let topEight = 0; for (let i = bins.length - 8; i < bins.length; i++) topEight += bins[i];
  const coverage = topEight / opaque, photographic = coverage < .55 || hasFineGrain(p, w, h);
  const choice = choosePalette(p, w, h, photographic);
  let colors = choice.limit, detectedColors = choice.size;
  const fineDetail = !photographic && thinRuns(p, w, h) > Math.max(8, w * h / 500);
  const sparseInk = !photographic && extremes / opaque >= .94 && dark / opaque >= .01 && dark / opaque <= .45;
  if (sparseInk) { colors = 2; detectedColors = 2; }
  let resolution = photographic ? 512 : sourceSide > 1024 && (sparseInk || fineDetail && sourceSide > 1536) ? 2048 : 1024, tolerance = sparseInk ? .2 : fineDetail ? .8 : coverage >= .8 || photographic ? 1.6 : .8;
  let minArea = sparseInk ? 12 : fineDetail ? 0 : photographic ? 12 : 4;
  const removeWhite = transparent / (w * h) < .05 && white / opaque >= .35 && white / opaque < .95 && border > 0 && borderWhite / border >= .8;
  if (!photographic && !sparseInk && !fineDetail && removeWhite && colors >= 8 && sourceSide > 1536) {
    resolution = 2048; colors = 16; tolerance = .8; minArea = 12;
  }
  const whiteMode = resolveAutoWhite(detectedColors, defaultWhite);
  return { options: { colors, tolerance, minArea, smooth: true, removeWhite: whiteMode !== 'none', whiteMode }, resolution, photographic, fineDetail, sparseInk, detectedColors };
}

export function recommendAutoSettings(pixels: Uint8ClampedArray, width: number, height: number, sourceSide = Math.max(width, height), defaultWhite: WhiteMode = 'background') {
  const sample = resizeRaster(pixels, width, height, 256);
  let recommendation = detectAutoSettings(sample.pixels, sample.width, sample.height, sourceSide, defaultWhite);
  // Mobile's high-resolution grain safeguard: a 256px preview can hide texture.
  const grain = resizeRaster(pixels, width, height, 1024);
  if (recommendation.resolution > 512 && Math.max(width, height) >= 1024 && hasFineGrain(grain.pixels, grain.width, grain.height)) recommendation = detectAutoSettings(grain.pixels, grain.width, grain.height, sourceSide, defaultWhite);
  return recommendation;
}
