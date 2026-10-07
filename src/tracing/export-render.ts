import { invoke, isTauri } from '@tauri-apps/api/core';
import { onlineExportSettings, type GlobalExportSettings } from './export-settings';
import { checkStockSize } from './stock-export';
import { generatePostScript } from './eps-export';
import { tracingSvgPaths } from './svg-paths';

/** Desktop uses the Online exporters directly; browser preview follows their layout. */
export async function renderExport(svg: string, s: GlobalExportSettings, format: 'svg' | 'eps', title: string): Promise<string> {
  const settings = onlineExportSettings(s);
  if (isTauri()) return invoke<string>('render_tracing_export', { svg, settings, format, title });
  const box = svg.match(/viewBox="([^"]+)"/)?.[1].trim().split(/\s+/).map(Number);
  if (!box || box.length !== 4 || box.some(n => !Number.isFinite(n)) || box[2] <= 0 || box[3] <= 0) throw new Error('Artboard SVG tidak valid.');
  const rawRatio = s.ratio === 'source' ? [Math.round(box[2]), Math.round(box[3])] : s.ratio.split(':').map(Number);
  let a = rawRatio[0], b = rawRatio[1];
  while (b) [a, b] = [b, a % b];
  const [rw, rh] = rawRatio.map(n => n / Math.max(1, a));
  const area = Math.min(settings.maxPixels, Math.max(settings.minPixels, box[2] * box[3]));
  const multiplier = Math.sqrt(area / (rw * rh));
  const candidates = [Math.max(1, Math.floor(multiplier)), Math.max(1, Math.ceil(multiplier))]
    .filter(n => n * n * rw * rh >= settings.minPixels && n * n * rw * rh <= settings.maxPixels)
    .sort((l, r) => Math.abs(l * l * rw * rh - area) - Math.abs(r * r * rw * rh - area));
  if (!candidates.length) throw new Error('Rasio artboard tidak dapat memenuhi rentang MP yang dipilih.');
  const width = rw * candidates[0], height = rh * candidates[0];
  const scale = Math.min(width * .9 / box[2], height * .9 / box[3]) * s.artworkScale;
  const x = (width - box[2] * scale) / 2 - box[0] * scale, y = (height - box[3] * scale) / 2 - box[1] * scale;
  const definitions = [...svg.matchAll(/<defs\b[^>]*>[\s\S]*?<\/defs>/g)].map(([defs]) => defs).join('');
  const paths = tracingSvgPaths(svg).map(({ original }) => original.replace('<path', `<path transform="matrix(${scale} 0 0 ${scale} ${x} ${y})"`)).join('');
  const background = s.removeWhiteBackground ? '' : `<path fill="#ffffff" d="M0 0L${width} 0L${width} ${height}L0 ${height}Z"/>`;
  const output = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${definitions}${background}${paths}</svg>`;
  const result = format === 'svg' ? output : generatePostScript(output, title);
  checkStockSize(result); return result;
}
