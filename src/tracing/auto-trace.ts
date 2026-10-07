import { resolveAutoWhite, type WhiteMode } from './auto-white';
import { traceRaster, type TraceOptions, type TraceResult } from './engine';
import { resizeRaster, validateRaster } from './auto-raster';
import { detectAutoSettings, recommendAutoSettings, type AutoRecommendation } from './auto-settings';
import { evaluateSvgScene, SCENE_TILE, type SceneMetrics } from './scene-quality';

export type TraceProgress = (value: number, label: string) => void;
export type TraceRunner = (pixels: Uint8ClampedArray, width: number, height: number, options: TraceOptions, progress?: TraceProgress) => TraceResult;
export type AutoFallback = 'none' | 'quality' | 'palette' | 'detail' | 'complexity' | 'traceError' | 'resolution';
export interface AutoSelection { options: TraceOptions; attempted: number; succeeded: number; index: number; score: number; baselineScore: number | null }
export interface AutoFinalOutcome { result: TraceResult; options: TraceOptions; resolution: number; attempts: number; fallback: AutoFallback; metrics: SceneMetrics }
export interface AutoTraceInfo { recommendation: AutoRecommendation; selection: AutoSelection; options: TraceOptions; resolution: number; attempts: number; fallback: AutoFallback; error: number; edgeError: number }
export interface AutoTraceOutcome { result: TraceResult; auto: AutoTraceInfo }
const whiteMode = (options: TraceOptions) => options.whiteMode ?? (options.removeWhite ? 'all' : 'none');
const same = (a: TraceOptions, b: TraceOptions) => a.colors === b.colors && a.tolerance === b.tolerance && a.minArea === b.minArea && a.smooth === b.smooth && whiteMode(a) === whiteMode(b);
const cancelled = (error: unknown) => error instanceof Error && error.name === 'AbortError';

export function autoCandidates(base: TraceOptions): TraceOptions[] {
  const choices = [{ ...base }], less = Math.max(2, base.colors - (base.colors <= 4 ? 1 : 2)), more = Math.min(16, base.colors + (base.colors >= 12 ? 2 : 3));
  if (less !== base.colors) choices.push({ ...base, colors: less, tolerance: base.tolerance < .8 ? .8 : 1.6, minArea: base.minArea < 4 ? 4 : base.minArea < 12 ? 12 : 24 });
  if (more !== base.colors) choices.push({ ...base, colors: more, tolerance: base.tolerance > .8 ? .8 : .35, minArea: base.minArea > 12 ? 12 : base.minArea > 4 ? 4 : 0 });
  return choices;
}

export function autoScore(result: TraceResult, metrics: SceneMetrics) {
  return metrics.error + .05 * metrics.edgeError + .015 * (result.segments + 6 * result.paths) / (result.width * result.height);
}

const measuredTrace = (pixels: Uint8ClampedArray, w: number, h: number, options: TraceOptions, progress: TraceProgress | undefined, runner: TraceRunner) => {
  const result = runner(pixels, w, h, options, progress);
  if (result.width !== w || result.height !== h) throw new Error('Ukuran hasil tracing tidak cocok dengan raster.');
  // Reject oversized exports before spending time rasterizing the SVG.
  if (result.paths > 2000 || result.segments > 12000 || result.svg.length > 2_000_000) return { result, metrics: { error: Infinity, detailError: Infinity, edgeError: Infinity, edgePixels: 0, tiles: new Float64Array() } };
  const metrics = evaluateSvgScene(result.svg, pixels, w, h, whiteMode(options) !== 'none');
  return { result, metrics };
};

/** AutoTraceSelector: baseline wins ties; fewer paths cannot justify lost edges. */
export function chooseAutoTrace(pixels: Uint8ClampedArray, width: number, height: number, suggested: TraceOptions, progress?: TraceProgress, runner: TraceRunner = traceRaster): AutoSelection {
  validateRaster(pixels, width, height);
  if (Math.max(width, height) > 192) throw new Error('Ukuran pratinjau Auto tidak valid.');
  const choices = autoCandidates(suggested);
  let best: AutoSelection | undefined, firstFailure: unknown, succeeded = 0, baselineScore: number | null = null, baselineError = NaN;
  for (let i = 0; i < choices.length; i++) {
    try {
      const { result, metrics } = measuredTrace(pixels, width, height, choices[i], (value) => progress?.(Math.round(30 * (i + value / 100) / choices.length), 'Analisis gambar…'), runner);
      const score = autoScore(result, metrics); if (!Number.isFinite(score)) throw new Error('Kualitas tracing tidak valid.');
      succeeded++;
      if (i === 0) { baselineScore = score; baselineError = metrics.error; }
      if (!best || score < best.score * .98 && (Number.isNaN(baselineError) || metrics.error <= baselineError * 1.08 + 1e-5)) best = { options: choices[i], attempted: choices.length, succeeded, index: i, score, baselineScore };
    } catch (error) { if (cancelled(error)) throw error; if (i === 0) firstFailure = error; }
    progress?.(Math.round(30 * (i + 1) / choices.length), 'Analisis gambar…');
  }
  if (!best) throw firstFailure ?? new Error('Gambar tidak dapat diproses otomatis.');
  return { ...best, succeeded, baselineScore };
}

export function excessiveAutoTrace(result: TraceResult, metrics: SceneMetrics) {
  return !Number.isFinite(metrics.error) || !Number.isFinite(metrics.edgeError) || result.paths > 2000 || result.segments > 12000 || result.svg.length > 2_000_000;
}

export function localRefinementSafe(before: SceneMetrics, after: SceneMetrics) {
  if (before.tiles.length !== after.tiles.length) return false;
  let worstBefore = 0, worstAfter = 0; const floor = .001 * SCENE_TILE * SCENE_TILE * 4;
  for (let i = 0; i < before.tiles.length; i++) {
    if (after.tiles[i] > before.tiles[i] * 1.05 + floor) return false;
    worstBefore = Math.max(worstBefore, before.tiles[i]); worstAfter = Math.max(worstAfter, after.tiles[i]);
  }
  return worstAfter <= worstBefore * 1.1 + .1;
}

export function acceptAutoDetail(before: TraceResult, oldMetrics: SceneMetrics, after: TraceResult, newMetrics: SceneMetrics) {
  return !excessiveAutoTrace(after, newMetrics) && after.width === before.width && after.height === before.height && after.paths === before.paths && after.contours === before.contours && after.segments <= before.segments * 1.25 + 8
    && newMetrics.error <= oldMetrics.error && newMetrics.edgeError < oldMetrics.edgeError * .98 && localRefinementSafe(oldMetrics, newMetrics);
}

/** AutoFinalTracer.acceptPaletteCandidate: earn extra colors with source fidelity. */
export function acceptAutoPalette(before: TraceResult, oldMetrics: SceneMetrics, after: TraceResult, newMetrics: SceneMetrics) {
  return !excessiveAutoTrace(after, newMetrics) && after.width === before.width && after.height === before.height
    && after.paths <= before.paths * 1.5 + 8 && after.segments <= before.segments * 1.25 + 8
    && newMetrics.error < oldMetrics.error * .95 && newMetrics.edgeError <= oldMetrics.edgeError * 1.05 + 1e-6
    && autoScore(after, newMetrics) < autoScore(before, oldMetrics) * .98;
}

/** AutoFinalTracer port, including bounded retries and optional detail refits. */
export function traceAutoFinal(pixels: Uint8ClampedArray, width: number, height: number, resolution: number, selected: TraceOptions, suggested: TraceOptions, progress?: TraceProgress, runner: TraceRunner = traceRaster): AutoFinalOutcome {
  validateRaster(pixels, width, height);
  const choices: TraceOptions[] = [];
  const add = (option: TraceOptions) => { if (!choices.some(o => same(o, option))) choices.push(option); };
  add(selected);
  if (!same(selected, suggested)) add(suggested);
  else add({ ...selected, colors: Math.min(selected.colors, Math.max(2, suggested.colors - 2)), tolerance: 1.6, minArea: Math.max(12, selected.minArea) });
  add({ ...selected, colors: Math.min(6, selected.colors), tolerance: 1.6, minArea: 24 });
  let attempts = 0, firstFailure: unknown, reason: AutoFallback = 'none';
  const refine = (result: TraceResult, metrics: SceneMetrics, options: TraceOptions, fallback: AutoFallback): AutoFinalOutcome => {
    if (attempts < 4 && options.colors >= 8 && options.colors < 16 && whiteMode(options) === 'background' && options.minArea >= 4 && Math.max(result.width, result.height) <= 1024) {
      const richer = { ...options, colors: 16 }; attempts++;
      try {
        const candidate = measuredTrace(pixels, width, height, richer, value => progress?.(90 + Math.floor(value * .04), 'Memeriksa warna…'), runner);
        if (acceptAutoPalette(result, metrics, candidate.result, candidate.metrics)) {
          result = candidate.result; metrics = candidate.metrics; options = richer; if (fallback === 'none') fallback = 'palette';
        }
      } catch (error) { if (cancelled(error)) throw error; }
    }
    for (const [pass, tolerance] of [.35, .2].entries()) {
      if (!options.smooth || metrics.edgeError <= 1e-5 || result.segments > 6000 || attempts >= 5) break;
      if (options.tolerance <= tolerance) continue;
      const detailed = { ...options, tolerance }; attempts++;
      try {
        const candidate = measuredTrace(pixels, width, height, detailed, value => progress?.(94 + pass * 2 + Math.floor(value * .02), 'Merapikan detail…'), runner);
        if (!acceptAutoDetail(result, metrics, candidate.result, candidate.metrics)) break;
        result = candidate.result; metrics = candidate.metrics; options = detailed; if (fallback === 'none') fallback = 'detail';
      } catch (error) { if (cancelled(error)) throw error; break; }
    }
    progress?.(100, 'Selesai'); return { result, metrics, options, resolution, attempts, fallback };
  };
  for (let i = 0; i < choices.length; i++) {
    try {
      attempts++;
      const trace = measuredTrace(pixels, width, height, choices[i], (value, label) => progress?.(i === 0 ? Math.min(75, Math.round(value * .75)) : 75 + Math.round((i - 1 + value / 100) * 15 / Math.max(1, choices.length - 1)), i === 0 ? label : 'Menghaluskan hasil…'), runner);
      if (!excessiveAutoTrace(trace.result, trace.metrics)) {
        if (i === 0 && !same(selected, suggested)) {
          try {
            attempts++;
            const baseline = measuredTrace(pixels, width, height, suggested, value => progress?.(75 + Math.round(value * .15), 'Memeriksa detail…'), runner);
            if (!excessiveAutoTrace(baseline.result, baseline.metrics) && (autoScore(trace.result, trace.metrics) >= autoScore(baseline.result, baseline.metrics) * .98 || trace.metrics.error > baseline.metrics.error * 1.2 + .0001)) return refine(baseline.result, baseline.metrics, suggested, 'quality');
          } catch (error) { if (cancelled(error)) throw error; }
        }
        return refine(trace.result, trace.metrics, choices[i], i === 0 ? 'none' : reason);
      }
      reason = 'complexity';
    } catch (error) { if (cancelled(error)) throw error; firstFailure ??= error; if (reason === 'none') reason = 'traceError'; }
  }
  // Retry each lower tier once, sampling the original working raster.
  for (const side of [1024, 512]) {
    if (Math.max(width, height) <= side) continue;
    const lower = resizeRaster(pixels, width, height, side), options = choices[choices.length - 1]; attempts++;
    try {
      const trace = measuredTrace(lower.pixels, lower.width, lower.height, options, value => progress?.(90 + Math.round(value * .04), 'Menyesuaikan resolusi…'), runner);
      if (!excessiveAutoTrace(trace.result, trace.metrics)) { progress?.(100, 'Selesai'); return { ...trace, options, resolution: side, attempts, fallback: 'resolution' }; }
    } catch (error) { if (cancelled(error)) throw error; firstFailure ??= error; }
  }
  throw new Error(`Gambar tidak dapat disederhanakan. ${firstFailure instanceof Error ? firstFailure.message : 'SVG tetap terlalu kompleks.'}`);
}

export function traceAuto(pixels: Uint8ClampedArray, width: number, height: number, progress?: TraceProgress, onRecommendation?: (recommendation: AutoRecommendation) => void, runner: TraceRunner = traceRaster, defaultWhite: WhiteMode = 'background', sourceSide = Math.max(width, height)): AutoTraceOutcome {
  let lastProgress = 0;
  const report: TraceProgress = (value, label) => { lastProgress = Math.max(lastProgress, Math.min(100, value)); progress?.(lastProgress, label); };
  report(0, 'Mendeteksi pengaturan…');
  let recommendation = recommendAutoSettings(pixels, width, height, sourceSide, defaultWhite);
  const raster = resizeRaster(pixels, width, height, recommendation.resolution);
  const preview = resizeRaster(raster.pixels, raster.width, raster.height, recommendation.options.colors >= 8 && recommendation.options.minArea >= 12 ? 128 : 192);
  // VectorSession rechecks artwork colors on this exact selection preview.
  // A prior palette limit or a differently sampled upload must not decide white removal.
  if (defaultWhite === 'background') {
    const detectedColors = detectAutoSettings(preview.pixels, preview.width, preview.height).detectedColors;
    const mode = resolveAutoWhite(detectedColors, defaultWhite);
    recommendation = { ...recommendation, detectedColors, options: { ...recommendation.options, whiteMode: mode, removeWhite: mode !== 'none' } };
  }
  onRecommendation?.(recommendation); const suggested = recommendation.options;
  let selection: AutoSelection;
  try { selection = chooseAutoTrace(preview.pixels, preview.width, preview.height, suggested, report, runner); }
  catch (error) {
    if (cancelled(error)) throw error;
    // A failed preview must not prevent the bounded final-resolution retries.
    selection = { options: suggested, attempted: autoCandidates(suggested).length, succeeded: 0, index: -1, score: Infinity, baselineScore: null };
  }
  const outcome = traceAutoFinal(raster.pixels, raster.width, raster.height, recommendation.resolution, selection.options, suggested, (value, label) => report(30 + Math.round(value * .7), label), runner);
  return { result: outcome.result, auto: { recommendation, selection, options: outcome.options, resolution: outcome.resolution, attempts: outcome.attempts, fallback: outcome.fallback, error: outcome.metrics.error, edgeError: outcome.metrics.edgeError } };
}
