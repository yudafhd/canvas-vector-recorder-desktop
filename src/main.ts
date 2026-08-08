import './styles.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { activateLicense, licenseStatus, normalizedEmail } from './license';
import type { CanvasDetection, LicenseStatus, MicrostockSettings, SvgResult, StartRecordingResult } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const activationView = $('activationView');
const workspaceView = $('workspaceView');
const mainTabs = $('mainTabs');
const recorderMainTab = $<HTMLButtonElement>('recorderMainTab');
const targetMainTab = $<HTMLButtonElement>('targetMainTab');
const targetView = $('targetView');
const targetFrame = $<HTMLIFrameElement>('targetFrame');
const targetMainTitle = $('targetMainTitle');
const closeTargetMainTab = $<HTMLButtonElement>('closeTargetMainTab');
const activationStatus = $('activationStatus');
const copyError = $('copyError');
const workspaceStatus = $('workspaceStatus');
const canvasList = $('canvasList');
let currentSession: string | null = null;
let selectedCanvas: string | null = null;
let lastSvg: SvgResult | null = null;
let recordingEnabled = true;
let targetOpen = false;
const isWindows = /Windows/i.test(navigator.userAgent);
let downloadToastTimer: ReturnType<typeof setTimeout> | null = null;
type MainTab = 'recorder' | 'target';
let activeMainTab: MainTab = 'recorder';
type AssetTab = 'canvas' | 'svg';
let activeAssetTab: AssetTab = 'canvas';
let detectedAssets: CanvasDetection[] = [];
let thumbnailGeneration = 0;
const thumbnailUrls = new Map<string, string>();
const thumbnailKeys = new Map<string, string>();
let previewUrl: string | null = null;
let previewRequest = 0;

function updateOpenTargetButton(): void {
  const button = $<HTMLButtonElement>('openTarget');
  if (isWindows) {
    button.textContent = targetOpen ? 'Buka target lain' : 'Buka target';
    button.title = 'Buka target di tab utama aplikasi.';
    button.setAttribute('aria-label', 'Buka target di tab utama aplikasi');
    return;
  }
  if (targetOpen) {
    button.textContent = 'Buka tab baru (maks. 5)';
    button.title = 'Klik untuk membuka URL sebagai tab baru di window target yang sama. Maksimal 5 tab.';
    button.setAttribute('aria-label', 'Buka tab baru di window target');
  } else {
    button.textContent = 'Buka';
    button.title = 'Buka window target';
    button.setAttribute('aria-label', 'Buka window target');
  }
}

function setMainTab(tab: MainTab): void {
  activeMainTab = tab;
  const showTarget = tab === 'target' && targetOpen;
  workspaceView.hidden = showTarget;
  targetView.hidden = !showTarget;
  recorderMainTab.classList.toggle('active', !showTarget);
  recorderMainTab.setAttribute('aria-selected', String(!showTarget));
  targetMainTab.classList.toggle('active', showTarget);
  targetMainTab.setAttribute('aria-selected', String(showTarget));
  if (isWindows) {
    if (showTarget) {
      void invoke('set_target_view_visible', { visible: true }).catch(() => undefined);
      [0, 150, 500, 1000].forEach(delay => setTimeout(syncTargetViewBounds, delay));
    } else {
      void invoke('set_target_view_visible', { visible: false }).catch(() => undefined);
    }
  }
}

function syncTargetViewBounds(): void {
  if (!isWindows || targetView.hidden) return;
  const bounds = targetFrame.getBoundingClientRect();
  void invoke('resize_target_view', {
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
  }).catch(() => undefined);
}

function status(element: HTMLElement, message: string, tone: 'idle' | 'success' | 'error' = 'idle'): void {
  element.textContent = message; element.className = `status ${tone}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    if (typeof value.message === 'string') return value.message;
    const entries = Object.entries(value);
    if (entries.length === 1) return errorMessage(entries[0][1]);
    try { return JSON.stringify(error); } catch (_) { return 'Terjadi kesalahan yang tidak diketahui.'; }
  }
  return String(error);
}

function showDownloadToast(message: string): void {
  const toast = $('downloadToast');
  toast.textContent = message;
  toast.hidden = false;
  if (downloadToastTimer) clearTimeout(downloadToastTimer);
  downloadToastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}

function settings(): MicrostockSettings {
  return {
    profile: 'custom',
    ratio: ($<HTMLSelectElement>('ratio').value as MicrostockSettings['ratio']),
    minPixels: Number($<HTMLInputElement>('minPixels').value) * 1_000_000,
    maxPixels: Number($<HTMLInputElement>('maxPixels').value) * 1_000_000,
    backgroundColor: $<HTMLInputElement>('backgroundColor').value || '#ffffff',
    transparentBackground: $<HTMLInputElement>('transparentBackground').checked,
  };
}

function syncBackgroundControls(): void {
  const transparent = $<HTMLInputElement>('transparentBackground').checked;
  $<HTMLInputElement>('backgroundColor').disabled = transparent;
}

function thumbnailKey(item: CanvasDetection): string {
  const current = settings();
  return [item.canvas_id, item.revision, item.width, item.height, current.ratio, current.minPixels, current.maxPixels, current.backgroundColor, current.transparentBackground].join('|');
}

function renderLicense(s: LicenseStatus): void {
  const badge = $('licenseBadge');
  badge.textContent = s.perpetual
    ? 'Lisensi aktif selamanya'
    : s.expires_at
      ? `Lisensi aktif sampai ${new Date(s.expires_at).toLocaleDateString()}`
      : 'Lisensi belum aktif';
  if (s.valid) {
    activationView.hidden = true;
    if (isWindows) {
      mainTabs.hidden = false;
      setMainTab(activeMainTab);
    } else {
      mainTabs.hidden = true;
      targetView.hidden = true;
      workspaceView.hidden = false;
    }
  } else {
    workspaceView.hidden = true;
    mainTabs.hidden = true;
    targetView.hidden = true;
    activationView.hidden = false;
    status(activationStatus, s.message || 'Lisensi belum aktif.', 'error');
  }
}

async function loadLicense(): Promise<void> {
  try { renderLicense(await licenseStatus()); }
  catch (error) { activationView.hidden = false; workspaceView.hidden = true; status(activationStatus, `Gagal membaca status lisensi: ${errorMessage(error)}`, 'error'); }
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
  const currentKeys = new Map(items.map(item => [item.canvas_id, thumbnailKey(item)]));
  thumbnailUrls.forEach((url, id) => {
    if (!activeIds.has(id) || thumbnailKeys.get(id) !== currentKeys.get(id)) {
      URL.revokeObjectURL(url);
      thumbnailUrls.delete(id);
      thumbnailKeys.delete(id);
    }
  });
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
    selectedCanvas = item.dataset.canvas || null; renderCanvases(detectedAssets); refreshPreview().catch(error => status(workspaceStatus, errorMessage(error), 'error'));
  }));
  void loadThumbnails(filtered, generation);
}

async function loadThumbnails(items: CanvasDetection[], generation: number): Promise<void> {
  await Promise.all(items.filter(item => thumbnailKeys.get(item.canvas_id) !== thumbnailKey(item)).map(async item => {
    try {
      const result = await invoke<SvgResult>('generate_svg', { canvasId: item.canvas_id, settings: settings() });
      const url = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
      const current = detectedAssets.find(asset => asset.canvas_id === item.canvas_id);
      if (generation !== thumbnailGeneration || !current || thumbnailKey(current) !== thumbnailKey(item)) { URL.revokeObjectURL(url); return; }
      thumbnailUrls.set(item.canvas_id, url);
      thumbnailKeys.set(item.canvas_id, thumbnailKey(item));
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
  previewRequest += 1;
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  selectedCanvas = null;
  lastSvg = null;
  detectedAssets = [];
  setAssetTab('canvas');
  $('preview').innerHTML = '<p class="muted">Preview akan tampil setelah canvas direkam.</p>';
  $('previewTitle').textContent = 'Rendered Preview';
  $('previewFilename').textContent = '';
  $('shapeCount').textContent = '—'; $('gapCount').textContent = '—'; $('errorCount').textContent = '—'; $('artboardSize').textContent = '—';
  $('exportSvg').setAttribute('disabled', 'true');
}

async function refreshPreview(): Promise<void> {
  const canvasId = selectedCanvas;
  if (!canvasId) return;
  const request = ++previewRequest;
  const result = await invoke<SvgResult>('generate_svg', { canvasId, settings: settings() });
  if (request !== previewRequest || selectedCanvas !== canvasId) return;
  lastSvg = result;
  const blob = new Blob([result.svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = url;
  $('preview').innerHTML = `<img src="${url}" alt="SVG preview">`;
  $('previewTitle').textContent = 'Preview SVG'; $('previewFilename').textContent = result.filename;
  $('shapeCount').textContent = String(result.stats.shapes); $('gapCount').textContent = String(result.stats.gap_fillers); $('errorCount').textContent = String(result.stats.errors);
  $('artboardSize').textContent = `${result.stats.artboard.width}×${result.stats.artboard.height}`;
  $('exportSvg').removeAttribute('disabled');
  status(workspaceStatus, result.error || 'SVG siap dipreview.', result.error ? 'idle' : 'success');
}

async function openTarget(): Promise<void> {
  const url = $<HTMLInputElement>('targetUrl').value.trim();
  try { const parsed = new URL(url); if (!/^https?:$/.test(parsed.protocol)) throw new Error(); } catch { status(workspaceStatus, 'URL tidak valid. Gunakan http:// atau https://.', 'error'); return; }
  if (targetOpen) {
    await invoke('open_target_tab', { url });
    status(workspaceStatus, 'Target baru dibuka.', 'success');
    return;
  }
  await invoke('clear_recording');
  const started = await invoke<StartRecordingResult>('start_recording');
  currentSession = started.session_id;
  await invoke('open_target_url', { url, sessionId: currentSession });
  targetOpen = true;
  updateOpenTargetButton();
  selectedCanvas = null;
  lastSvg = null;
  setAssetTab('canvas');
  await refreshCanvases();
  status(workspaceStatus, 'Target dibuka di window target. Perekam aktif di background.', 'success');
}

async function closeTarget(): Promise<void> {
  await invoke('close_target_window');
  targetOpen = false;
  mainTabs.hidden = true;
  targetMainTab.hidden = true;
  setMainTab('recorder');
  updateOpenTargetButton();
  currentSession = null;
  resetDetectedSurfaces();
  status(workspaceStatus, 'Target ditutup. Detected surfaces direset.');
}

document.addEventListener('DOMContentLoaded', () => {
  updateOpenTargetButton();
  mainTabs.hidden = !isWindows;
  if (isWindows) setMainTab('recorder');
  syncBackgroundControls();
  $('activationForm').addEventListener('submit', async event => {
    event.preventDefault(); copyError.hidden = true; const email = normalizedEmail($<HTMLInputElement>('licenseEmail').value); const code = $<HTMLTextAreaElement>('licenseCode').value.trim();
    status(activationStatus, 'Memvalidasi dan mengaktifkan perangkat…');
    try {
      const activated = await activateLicense(email, code);
      if (!activated.valid) throw new Error(activated.message || 'Aktivasi tidak menyimpan lisensi.');
      renderLicense(activated);
    }
    catch (error) { const message = errorMessage(error); status(activationStatus, message, 'error'); copyError.hidden = false; copyError.onclick = () => navigator.clipboard.writeText(message); }
  });
  recorderMainTab.addEventListener('click', () => setMainTab('recorder'));
  targetMainTab.addEventListener('click', () => setMainTab('target'));
  closeTargetMainTab.addEventListener('click', () => closeTarget().catch(error => status(workspaceStatus, errorMessage(error), 'error')));
  window.addEventListener('resize', syncTargetViewBounds);
  $('openTarget').addEventListener('click', () => openTarget().catch(error => status(workspaceStatus, errorMessage(error), 'error')));
  $('closeTarget').addEventListener('click', () => closeTarget().catch(error => status(workspaceStatus, errorMessage(error), 'error')));
  $('canvasTab').addEventListener('click', () => setAssetTab('canvas'));
  $('svgTab').addEventListener('click', () => setAssetTab('svg'));
  $('refreshPreviewButton').addEventListener('click', () => refreshPreview().catch(error => status(workspaceStatus, errorMessage(error), 'error')));
  $('transparentBackground').addEventListener('change', syncBackgroundControls);
  $('recordToggle').addEventListener('click', async () => { recordingEnabled = !recordingEnabled; await invoke('set_recording', { enabled: recordingEnabled }); const button = $('recordToggle'); button.textContent = recordingEnabled ? '● REC ON' : '○ REC OFF'; button.classList.toggle('off', !recordingEnabled); });
  $('refreshSettings').addEventListener('click', () => {
    renderCanvases(detectedAssets);
    refreshPreview().catch(error => status(workspaceStatus, errorMessage(error), 'error'));
  });
  $('exportSvg').addEventListener('click', async () => {
    if (!lastSvg || !selectedCanvas) return;
    try {
      const savedPath = await invoke<string>('save_svg', { canvasId: selectedCanvas, settings: settings() });
      showDownloadToast(`Download tersimpan: ${savedPath}`);
      status(workspaceStatus, `SVG berhasil diexport: ${lastSvg.filename}`, 'success');
    } catch (error) { const message = errorMessage(error); showDownloadToast(`Export gagal: ${message}`); status(workspaceStatus, message, 'error'); }
  });
  void listen<CanvasDetection[]>('canvases-updated', event => renderCanvases(event.payload));
  void listen<string>('recorder-error', event => status(workspaceStatus, event.payload, 'error'));
  void listen('target-closed', () => { targetOpen = false; updateOpenTargetButton(); currentSession = null; resetDetectedSurfaces(); });
  void loadLicense();
});
