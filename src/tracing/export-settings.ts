import type { MicrostockSettings } from '../types';
import type { BatchItem } from './batch';
import { traceBatchFile } from './file-task';

export interface GlobalExportSettings { minMp: number; maxMp: number; ratio: string; artworkScale: number; removeWhiteBackground: boolean }
export const exportDefaults: GlobalExportSettings = { minMp: 15, maxMp: 65, ratio: 'source', artworkScale: 1, removeWhiteBackground: false };
export function validateExportSettings(s: GlobalExportSettings): void {
  if (!Number.isFinite(s.minMp) || !Number.isFinite(s.maxMp) || s.minMp < 15 || s.maxMp > 65 || s.maxMp <= s.minMp) throw new Error('Gunakan Min MP ≥ 15 dan Max MP ≤ 65, dengan Max lebih besar dari Min.');
  if (!Number.isFinite(s.artworkScale) || s.artworkScale < .5 || s.artworkScale > 3) throw new Error('Skala artwork harus 50–300%.');
  if (s.ratio !== 'source' && !/^\d+:\d+$/.test(s.ratio)) throw new Error('Rasio artboard tidak valid.');
  if (s.ratio !== 'source' && s.ratio.split(':').some(n => +n < 1 || +n > 10000)) throw new Error('Rasio harus antara 1 dan 10000.');
}
export function onlineExportSettings(s: GlobalExportSettings): MicrostockSettings {
  validateExportSettings(s);
  return { profile: 'adobe-stock', minPixels: s.minMp * 1e6, maxPixels: s.maxMp * 1e6, ratio: s.ratio, artworkScale: s.artworkScale, backgroundColor: '#ffffff', transparentBackground: s.removeWhiteBackground, removedColors: [], removedElements: [] };
}

/** Reprocess only when the export background differs from the completed trace. */
export async function exportSource(item: BatchItem, s: GlobalExportSettings): Promise<string> {
  validateExportSettings(s);
  if (!item.output) throw new Error('Jalankan tracing terlebih dahulu.');
  const applied = item.output.auto?.options ?? item.config.options;
  const whiteMode = s.removeWhiteBackground ? 'background' : 'none';
  if ((applied.whiteMode ?? (applied.removeWhite ? 'all' : 'none')) === whiteMode) return item.output.result.svg;
  const output = await traceBatchFile({ ...item, config: { mode: 'manual', resolution: item.output.auto?.resolution ?? item.config.resolution, options: { ...applied, whiteMode, removeWhite: s.removeWhiteBackground } } }, new AbortController().signal, () => {});
  return output.result.svg;
}

export function initGlobalExportSettings(root: HTMLElement): () => GlobalExportSettings {
  root.innerHTML = `<details class="trace-global-export"><summary>Pengaturan ekspor global</summary>
    <div class="trace-export-fields">
      <label>Rasio artboard<select id="traceExportRatio"><option value="source">Source</option>${['1:1','4:5','4:3','3:2','2:3','16:9','custom'].map(r => `<option value="${r}">${r === 'custom' ? 'Custom' : r}</option>`).join('')}</select></label>
      <label id="traceExportCustom" hidden>Rasio custom<input id="traceExportCustomRatio" value="1:1" placeholder="Lebar:tinggi"></label>
      <label>Min MP<input id="traceExportMin" type="number" min="15" max="64" step="0.1" value="15"></label>
      <label>Max MP<input id="traceExportMax" type="number" min="15" max="65" step="0.1" value="65"></label>
      <label>Skala artwork (%)<input id="traceExportScale" type="number" min="50" max="300" step="10" value="100"></label>
      <label>Latar putih<select id="traceExportBackground"><option value="keep">Pertahankan latar putih</option><option value="remove">Hapus latar putih</option></select></label>
    </div>
    <p id="traceExportError" role="status" class="trace-help"></p></details>`;
  const get = (id: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  try {
    const saved = JSON.parse(localStorage.getItem('cvr-offline-export-settings') ?? 'null');
    if (saved) { validateExportSettings(saved); get('traceExportMin').value = String(saved.minMp); get('traceExportMax').value = String(saved.maxMp); get('traceExportScale').value = String(saved.artworkScale * 100); get('traceExportBackground').value = saved.removeWhiteBackground ? 'remove' : 'keep'; get('traceExportRatio').value = Array.from((get('traceExportRatio') as HTMLSelectElement).options).some(o => o.value === saved.ratio) ? saved.ratio : 'custom'; get('traceExportCustomRatio').value = saved.ratio; }
  } catch { /* Use defaults if stored settings are unavailable or invalid. */ }
  const read = () => {
    const s = { minMp: +get('traceExportMin').value, maxMp: +get('traceExportMax').value, artworkScale: +get('traceExportScale').value / 100, ratio: get('traceExportRatio').value === 'custom' ? get('traceExportCustomRatio').value.trim() : get('traceExportRatio').value, removeWhiteBackground: get('traceExportBackground').value === 'remove' };
    validateExportSettings(s); return s;
  };
  const update = () => {
    root.querySelector<HTMLElement>('#traceExportCustom')!.hidden = get('traceExportRatio').value !== 'custom';
    try { const s = read(); root.querySelector('#traceExportError')!.textContent = ''; try { localStorage.setItem('cvr-offline-export-settings', JSON.stringify(s)); } catch {} }
    catch (e) { root.querySelector('#traceExportError')!.textContent = (e as Error).message; }
  };
  root.addEventListener('input', update); update(); return read;
}
