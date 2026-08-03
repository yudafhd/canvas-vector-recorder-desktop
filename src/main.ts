import './styles.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { activateLicense, licenseStatus, normalizedEmail } from './license';
import type { CanvasDetection, LicenseStatus, MicrostockSettings, SvgResult, StartRecordingResult } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const activationView = $('activationView');
const workspaceView = $('workspaceView');
const activationStatus = $('activationStatus');
const copyError = $('copyError');
const workspaceStatus = $('workspaceStatus');
const canvasList = $('canvasList');
let currentSession: string | null = null;
let selectedCanvas: string | null = null;
let lastSvg: SvgResult | null = null;
let recordingEnabled = true;
let targetOpen = false;
let downloadToastTimer: ReturnType<typeof setTimeout> | null = null;
type AssetTab = 'canvas' | 'svg';
let activeAssetTab: AssetTab = 'canvas';
let detectedAssets: CanvasDetection[] = [];
let thumbnailGeneration = 0;
const thumbnailUrls = new Map<string, string>();

function status(element: HTMLElement, message: string, tone: 'idle' | 'success' | 'error' = 'idle'): void {
  element.textContent = message; element.className = `status ${tone}`;
}

function showDownloadToast(message: string): void {
  const toast = $('downloadToast');
  toast.textContent = message;
  toast.hidden = false;
  if (downloadToastTimer) clearTimeout(downloadToastTimer);
  downloadToastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}

function settings(): MicrostockSettings {
  return { profile: 'custom', ratio: ($<HTMLSelectElement>('ratio').value as MicrostockSettings['ratio']), minPixels: Number($<HTMLInputElement>('minPixels').value) * 1_000_000, maxPixels: Number($<HTMLInputElement>('maxPixels').value) * 1_000_000 };
}

function renderLicense(s: LicenseStatus): void {
  const badge = $('licenseBadge');
  badge.textContent = s.expires_at ? `Lisensi aktif sampai ${new Date(s.expires_at).toLocaleDateString()}` : 'Lisensi belum aktif';
  if (s.valid) { activationView.hidden = true; workspaceView.hidden = false; }
  else { workspaceView.hidden = true; activationView.hidden = false; status(activationStatus, s.message || 'Lisensi belum aktif.', 'error'); }
}

async function loadLicense(): Promise<void> {
  try { renderLicense(await licenseStatus()); }
  catch (error) { activationView.hidden = false; workspaceView.hidden = true; status(activationStatus, `Gagal membaca status lisensi: ${String(error)}`, 'error'); }
}

function setAssetTab(tab: AssetTab): void {
  activeAssetTab = tab;
  $('canvasTab').classList.toggle('active', tab === 'canvas'); $('canvasTab').setAttribute('aria-selected', String(tab === 'canvas'));
  $('svgTab').classList.toggle('active', tab === 'svg'); $('svgTab').setAttribute('aria-selected', String(tab === 'svg'));
  renderCanvases(detectedAssets);
}

function renderCanvases(items: CanvasDetection[]): void {
  detectedAssets = items;
  const activeIds = new Set(items.map(item => item.canvas_id));
  thumbnailUrls.forEach((url, id) => { if (!activeIds.has(id)) { URL.revokeObjectURL(url); thumbnailUrls.delete(id); } });
  const filtered = items.filter(item => {
    if ((item.asset_type || 'canvas') !== activeAssetTab) return false;
    return activeAssetTab === 'svg' || item.shapes > 0 || item.gap_fillers > 0;
  });
  $('assetCount').textContent = `${filtered.length} item · 1 tab`;
  if (!filtered.length) {
    const label = activeAssetTab === 'canvas' ? 'Canvas' : 'SVG';
    canvasList.innerHTML = `<p class="muted">Belum ada ${label}. Buka target dan tunggu asset dimuat.</p>`;
    return;
  }
  const generation = ++thumbnailGeneration;
  canvasList.innerHTML = filtered.map(item => `<div class="canvas-item${item.canvas_id === selectedCanvas ? ' selected' : ''}" data-canvas="${item.canvas_id}"><div class="canvas-thumb" data-thumb-canvas="${item.canvas_id}">${thumbnailUrls.has(item.canvas_id) ? `<img src="${thumbnailUrls.get(item.canvas_id)}" alt="Thumbnail ${activeAssetTab}">` : '<span>Memuat thumbnail…</span>'}</div><strong>${activeAssetTab === 'svg' ? 'SVG' : 'Canvas'} · ${item.canvas_id}</strong><small>${item.width}×${item.height} · ${item.shapes} shapes · ${item.gap_fillers} strokes · ${item.errors} errors</small></div>`).join('');
  canvasList.querySelectorAll<HTMLElement>('.canvas-item').forEach(item => item.addEventListener('click', () => {
    selectedCanvas = item.dataset.canvas || null; renderCanvases(detectedAssets); refreshPreview().catch(error => status(workspaceStatus, String(error), 'error'));
  }));
  void loadThumbnails(filtered, generation);
}

async function loadThumbnails(items: CanvasDetection[], generation: number): Promise<void> {
  await Promise.all(items.filter(item => !thumbnailUrls.has(item.canvas_id)).map(async item => {
    try {
      const result = await invoke<SvgResult>('generate_svg', { canvasId: item.canvas_id, settings: settings() });
      const url = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
      if (generation !== thumbnailGeneration) { URL.revokeObjectURL(url); return; }
      thumbnailUrls.set(item.canvas_id, url);
      const slot = Array.from(canvasList.querySelectorAll<HTMLElement>('[data-thumb-canvas]')).find(element => element.dataset.thumbCanvas === item.canvas_id);
      if (slot) { const image = document.createElement('img'); image.src = url; image.alt = `Thumbnail ${activeAssetTab}`; slot.replaceChildren(image); }
    } catch (_) {
      const slot = Array.from(canvasList.querySelectorAll<HTMLElement>('[data-thumb-canvas]')).find(element => element.dataset.thumbCanvas === item.canvas_id);
      if (slot && generation === thumbnailGeneration) slot.textContent = 'Preview tidak tersedia';
    }
  }));
}

async function refreshCanvases(): Promise<void> { renderCanvases(await invoke<CanvasDetection[]>('list_canvases')); }

function resetDetectedSurfaces(): void {
  selectedCanvas = null;
  lastSvg = null;
  detectedAssets = [];
  setAssetTab('canvas');
  $('preview').innerHTML = '<p class="muted">Preview akan tampil setelah canvas direkam.</p>';
  $('previewTitle').textContent = 'Rendered Preview';
  $('previewFilename').textContent = 'Pilih canvas dari daftar';
  $('shapeCount').textContent = '—'; $('gapCount').textContent = '—'; $('errorCount').textContent = '—'; $('artboardSize').textContent = '—';
  $('exportSvg').setAttribute('disabled', 'true');
}

async function refreshPreview(): Promise<void> {
  if (!selectedCanvas) return;
  lastSvg = await invoke<SvgResult>('generate_svg', { canvasId: selectedCanvas, settings: settings() });
  const blob = new Blob([lastSvg.svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  $('preview').innerHTML = `<img src="${url}" alt="SVG preview">`;
  $('previewTitle').textContent = 'Preview SVG'; $('previewFilename').textContent = lastSvg.filename;
  $('shapeCount').textContent = String(lastSvg.stats.shapes); $('gapCount').textContent = String(lastSvg.stats.gap_fillers); $('errorCount').textContent = String(lastSvg.stats.errors);
  $('artboardSize').textContent = `${lastSvg.stats.artboard.width}×${lastSvg.stats.artboard.height}`;
  $('exportSvg').removeAttribute('disabled');
  status(workspaceStatus, lastSvg.error || 'SVG siap dipreview.', lastSvg.error ? 'idle' : 'success');
}

async function openTarget(): Promise<void> {
  const url = $<HTMLInputElement>('targetUrl').value.trim();
  try { const parsed = new URL(url); if (!/^https?:$/.test(parsed.protocol)) throw new Error(); } catch { status(workspaceStatus, 'URL tidak valid. Gunakan http:// atau https://.', 'error'); return; }
  await invoke('clear_recording');
  const started = await invoke<StartRecordingResult>('start_recording');
  currentSession = started.session_id;
  await invoke('open_target_url', { url, sessionId: currentSession });
  targetOpen = true; selectedCanvas = null; lastSvg = null; setAssetTab('canvas'); await refreshCanvases();
  status(workspaceStatus, 'Target dibuka. Recorder menunggu Canvas atau SVG.', 'success');
}

async function closeTarget(): Promise<void> { await invoke('close_target_window'); targetOpen = false; currentSession = null; resetDetectedSurfaces(); status(workspaceStatus, 'Target ditutup. Detected surfaces direset.'); }

document.addEventListener('DOMContentLoaded', () => {
  $('activationForm').addEventListener('submit', async event => {
    event.preventDefault(); copyError.hidden = true; const email = normalizedEmail($<HTMLInputElement>('licenseEmail').value); const code = $<HTMLTextAreaElement>('licenseCode').value.trim();
    status(activationStatus, 'Memvalidasi dan mengaktifkan perangkat…');
    try {
      const activated = await activateLicense(email, code);
      if (!activated.valid) throw new Error(activated.message || 'Aktivasi tidak menyimpan lisensi.');
      renderLicense(activated);
    }
    catch (error) { const message = String(error); status(activationStatus, message, 'error'); copyError.hidden = false; copyError.onclick = () => navigator.clipboard.writeText(message); }
  });
  $('openTarget').addEventListener('click', () => openTarget().catch(error => status(workspaceStatus, String(error), 'error')));
  $('closeTarget').addEventListener('click', () => closeTarget().catch(error => status(workspaceStatus, String(error), 'error')));
  $('canvasTab').addEventListener('click', () => setAssetTab('canvas'));
  $('svgTab').addEventListener('click', () => setAssetTab('svg'));
  $('refreshPreviewButton').addEventListener('click', () => refreshPreview().catch(error => status(workspaceStatus, String(error), 'error')));
  $('recordToggle').addEventListener('click', async () => { recordingEnabled = !recordingEnabled; await invoke('set_recording', { enabled: recordingEnabled }); const button = $('recordToggle'); button.textContent = recordingEnabled ? '● REC ON' : '○ REC OFF'; button.classList.toggle('off', !recordingEnabled); });
  $('refreshSettings').addEventListener('click', () => refreshPreview().catch(error => status(workspaceStatus, String(error), 'error')));
  $('exportSvg').addEventListener('click', async () => {
    if (!lastSvg || !selectedCanvas) return;
    try {
      const svg = await invoke<string>('export_svg', { canvasId: selectedCanvas, settings: settings() });
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const link = document.createElement('a'); link.href = url; link.download = lastSvg.filename; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showDownloadToast(`Download berhasil dimulai: ${lastSvg.filename}`);
      status(workspaceStatus, `SVG berhasil diexport: ${lastSvg.filename}`, 'success');
    } catch (error) { showDownloadToast(`Export gagal: ${String(error)}`); status(workspaceStatus, String(error), 'error'); }
  });
  void listen<CanvasDetection[]>('canvases-updated', event => renderCanvases(event.payload));
  void listen<string>('recorder-error', event => status(workspaceStatus, event.payload, 'error'));
  void listen('target-closed', () => { targetOpen = false; currentSession = null; resetDetectedSurfaces(); });
  void loadLicense();
});
