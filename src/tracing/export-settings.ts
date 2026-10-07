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
  root.innerHTML = `<div id="traceExportSheetOverlay" class="trace-sheet-overlay" hidden>
    <aside class="trace-sheet" role="dialog" aria-modal="true" aria-labelledby="traceExportSheetTitle">
      <header class="trace-sheet-header">
        <div class="trace-sheet-title-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" x2="20" y1="21" y2="21"/><line x1="4" x2="20" y1="14" y2="14"/><line x1="4" x2="20" y1="7" y2="7"/><circle cx="14" cy="21" r="2"/><circle cx="8" cy="14" r="2"/><circle cx="17" cy="7" r="2"/></svg>
          <h2 id="traceExportSheetTitle">Pengaturan ekspor global</h2>
        </div>
        <button type="button" id="traceExportSheetClose" class="trace-sheet-close" title="Tutup" aria-label="Tutup panel pengaturan ekspor">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </header>
      <div class="trace-sheet-content">
        <p class="trace-sheet-desc">Pengaturan ini diterapkan pada ekspor vektor SVG dan EPS.</p>
        <div class="trace-export-fields">
          <label>Rasio artboard<select id="traceExportRatio"><option value="source">Source</option>${['1:1','4:5','4:3','3:2','2:3','16:9','custom'].map(r => `<option value="${r}">${r === 'custom' ? 'Custom' : r}</option>`).join('')}</select></label>
          <label id="traceExportCustom" hidden>Rasio custom<input id="traceExportCustomRatio" value="1:1" placeholder="Lebar:tinggi"></label>
          <label>Min MP<input id="traceExportMin" type="number" min="15" max="64" step="0.1" value="15"></label>
          <label>Max MP<input id="traceExportMax" type="number" min="15" max="65" step="0.1" value="65"></label>
          <label>Skala artwork (%)<input id="traceExportScale" type="number" min="50" max="300" step="10" value="100"></label>
          <label>Latar putih<select id="traceExportBackground"><option value="keep">Pertahankan latar putih</option><option value="remove">Hapus latar putih</option></select></label>
        </div>
        <p id="traceExportError" role="status" class="trace-help"></p>
      </div>
      <footer class="trace-sheet-footer">
        <button type="button" id="traceExportSheetDone" class="primary trace-sheet-done-btn">Selesai</button>
      </footer>
    </aside>
  </div>`;
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
  root.addEventListener('input', update);
  update();

  const overlay = root.querySelector<HTMLElement>('#traceExportSheetOverlay')!;
  const openSheet = () => {
    overlay.hidden = false;
    get('traceExportRatio')?.focus();
  };
  const closeSheet = () => {
    overlay.hidden = true;
    document.querySelector<HTMLButtonElement>('#traceGlobalExportBtn')?.focus();
  };

  root.querySelector('#traceExportSheetClose')?.addEventListener('click', closeSheet);
  root.querySelector('#traceExportSheetDone')?.addEventListener('click', closeSheet);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeSheet();
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) closeSheet();
  });
  document.addEventListener('click', event => {
    const btn = (event.target as HTMLElement | null)?.closest('#traceGlobalExportBtn');
    if (btn) {
      event.preventDefault();
      openSheet();
    }
  });

  return read;
}
