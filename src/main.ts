import './styles.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { activateLicense, licenseStatus, normalizedEmail } from './license';
import type { CanvasDetection, LicenseStatus, MicrostockSettings, SvgResult, StartRecordingResult, TargetTabInfo, TargetTabsState } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const activationView = $('activationView');
const workspaceView = $('workspaceView');
const mainTabs = $('mainTabs');
const recorderMainTab = $<HTMLButtonElement>('recorderMainTab');
const targetMainTabs = $('targetMainTabs');
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
const isMac = /Macintosh|Mac OS X/i.test(navigator.userAgent);
let downloadToastTimer: ReturnType<typeof setTimeout> | null = null;
type MainTab = 'recorder' | 'target';
let activeMainTab: MainTab = 'recorder';
let activeTargetId: string | null = null;
let targetTabs: TargetTabInfo[] = [];
let detectedAssets: CanvasDetection[] = [];
let thumbnailGeneration = 0;
const thumbnailUrls = new Map<string, string>();
const thumbnailKeys = new Map<string, string>();
let previewUrl: string | null = null;
let previewRequest = 0;
const ARTWORK_SCALE_MIN = 0.5;
const ARTWORK_SCALE_MAX = 3;
const ARTWORK_SCALE_STEP = 0.1;
const SETTINGS_STORAGE_KEY = 'canvas-vector-recorder.settings.v1';
const RATIO_PRESETS = new Set(['source', '1:1', '4:5', '4:3', '3:2', '2:3', '16:9']);
const PRESET_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1, height: 1 },
  '4:5': { width: 4, height: 5 },
  '4:3': { width: 4, height: 3 },
  '3:2': { width: 3, height: 2 },
  '2:3': { width: 2, height: 3 },
  '16:9': { width: 16, height: 9 },
};
const DEFAULT_CUSTOM_RATIO = { width: 1, height: 1 };
let artworkScale = 1;

interface PersistedSettings {
  ratio: string;
  customRatioWidth: number;
  customRatioHeight: number;
  minPixels: number;
  maxPixels: number;
  backgroundColor: string;
  transparentBackground: boolean;
  artworkScale: number;
  targetUrl: string;
  recordingEnabled: boolean;
}

function updateOpenTargetButton(): void {
  const button = $<HTMLButtonElement>('openTarget');
  if (targetOpen) {
    button.textContent = 'Buka tab baru';
    button.title = 'Buka URL sebagai tab target baru.';
    button.setAttribute('aria-label', 'Buka tab target baru');
  } else {
    button.textContent = 'Buka';
    button.title = 'Buka window target';
    button.setAttribute('aria-label', 'Buka window target');
  }
}

function renderTargetTabs(state: TargetTabsState): void {
  targetTabs = state.tabs;
  activeTargetId = state.active_id;
  targetOpen = targetTabs.length > 0;
  targetMainTabs.replaceChildren();
  targetMainTabs.hidden = !targetTabs.length;
  targetTabs.forEach(tab => {
    const wrapper = document.createElement('span');
    wrapper.className = 'target-tab-wrap';
    const button = document.createElement('button');
    button.className = `main-tab target-main-tab${activeMainTab === 'target' && tab.id === activeTargetId ? ' active' : ''}`;
    button.type = 'button';
    button.dataset.targetId = tab.id;
    button.textContent = tab.title || tab.url || 'Target';
    button.title = tab.url;
    button.setAttribute('aria-selected', String(activeMainTab === 'target' && tab.id === activeTargetId));
    button.addEventListener('click', () => {
      activeTargetId = tab.id;
      setMainTab('target');
      void invoke('switch_target_tab', { tabId: tab.id }).catch(error => status(workspaceStatus, errorMessage(error), 'error'));
    });
    const reload = document.createElement('button');
    reload.className = 'target-tab-reload';
    reload.type = 'button';
    reload.textContent = '↻';
    reload.title = 'Muat ulang target';
    reload.setAttribute('aria-label', `Muat ulang ${tab.title || 'target'}`);
    reload.addEventListener('click', event => {
      event.stopPropagation();
      void invoke('reload_target_tab', { tabId: tab.id }).catch(error => status(workspaceStatus, errorMessage(error), 'error'));
    });
    const close = document.createElement('button');
    close.className = 'target-tab-close';
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Tutup target';
    close.setAttribute('aria-label', `Tutup ${tab.title || 'target'}`);
    close.addEventListener('click', event => {
      event.stopPropagation();
      void invoke('close_target_tab', { tabId: tab.id }).catch(error => status(workspaceStatus, errorMessage(error), 'error'));
    });
    wrapper.append(button, reload, close);
    targetMainTabs.append(wrapper);
  });
  updateOpenTargetButton();
  if (activeMainTab === 'target' && activeTargetId) {
    targetMainTitle.textContent = targetTabs.find(tab => tab.id === activeTargetId)?.title || 'Target';
    setMainTab('target');
  }
}

function setMainTab(tab: MainTab): void {
  activeMainTab = tab;
  const showTarget = tab === 'target' && targetOpen && Boolean(activeTargetId);
  workspaceView.hidden = showTarget;
  targetView.hidden = !showTarget;
  targetView.classList.toggle('mac-target-view', isMac && showTarget);
  recorderMainTab.classList.toggle('active', !showTarget);
  recorderMainTab.setAttribute('aria-selected', String(!showTarget));
  targetTabs.forEach(target => {
    const button = targetMainTabs.querySelector<HTMLButtonElement>(`button[data-target-id="${target.id}"]`);
    if (button) {
      button.classList.toggle('active', showTarget && target.id === activeTargetId);
      button.setAttribute('aria-selected', String(showTarget && target.id === activeTargetId));
    }
  });
  if (showTarget) targetMainTitle.textContent = targetTabs.find(target => target.id === activeTargetId)?.title || 'Target';
  if (isWindows || isMac) {
    if (showTarget) {
      void invoke('set_target_view_visible', { visible: true }).catch(() => undefined);
      [0, 150, 500, 1000].forEach(delay => setTimeout(syncTargetViewBounds, delay));
    } else {
      void invoke('set_target_view_visible', { visible: false }).catch(() => undefined);
    }
  }
}

function syncTargetViewBounds(): void {
  if ((!isWindows && !isMac) || targetView.hidden) return;
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

function selectedRatioForBackend(): string {
  const selected = $<HTMLSelectElement>('ratio').value;
  if (selected !== 'custom') return selected || 'source';
  const width = Number($<HTMLInputElement>('customRatioWidth').value);
  const height = Number($<HTMLInputElement>('customRatioHeight').value);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return 'source';
  return `${width}:${height}`;
}

function settings(): MicrostockSettings {
  return {
    profile: 'custom',
    ratio: selectedRatioForBackend(),
    minPixels: Number($<HTMLInputElement>('minPixels').value) * 1_000_000,
    maxPixels: Number($<HTMLInputElement>('maxPixels').value) * 1_000_000,
    backgroundColor: $<HTMLInputElement>('backgroundColor').value || '#ffffff',
    transparentBackground: $<HTMLInputElement>('transparentBackground').checked,
    artworkScale,
  };
}

function settingValidationError(): string | null {
  const ratio = $<HTMLSelectElement>('ratio').value;
  const minPixels = Number($<HTMLInputElement>('minPixels').value);
  const maxPixels = Number($<HTMLInputElement>('maxPixels').value);
  if (!Number.isFinite(minPixels) || minPixels <= 0) return 'Min MP harus lebih besar dari 0.';
  if (!Number.isFinite(maxPixels) || maxPixels <= 0) return 'Max MP harus lebih besar dari 0.';
  if (maxPixels <= minPixels) return 'Max MP harus lebih besar daripada Min MP.';
  if (ratio !== 'custom') return null;
  const width = Number($<HTMLInputElement>('customRatioWidth').value);
  const height = Number($<HTMLInputElement>('customRatioHeight').value);
  if (!Number.isInteger(width) || width < 1 || width > 10_000) return 'Lebar rasio custom harus berupa bilangan bulat 1–10.000.';
  if (!Number.isInteger(height) || height < 1 || height > 10_000) return 'Tinggi rasio custom harus berupa bilangan bulat 1–10.000.';
  return null;
}

function updateRatioControls(): void {
  const custom = $<HTMLSelectElement>('ratio').value === 'custom';
  const fields = $<HTMLDivElement>('customRatioFields');
  fields.hidden = false;
  fields.classList.toggle('is-custom', custom);
  const dimensions = custom
    ? { width: $<HTMLInputElement>('customRatioWidth').value, height: $<HTMLInputElement>('customRatioHeight').value }
    : PRESET_RATIO_DIMENSIONS[$<HTMLSelectElement>('ratio').value] || sourceRatioDimensions();
  $('ratioHelp').textContent = custom
    ? 'Masukkan dua bilangan bulat positif, misalnya 7 : 5. Rasio output akan dipertahankan exact.'
    : `Rasio ${dimensions.width} : ${dimensions.height}. Ubah salah satu nilai untuk beralih ke Custom.`;
}

function ratioDimensions(width: number, height: number): { width: number; height: number } {
  let left = Math.max(1, Math.round(width));
  let right = Math.max(1, Math.round(height));
  while (right !== 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  const divisor = Math.max(1, left);
  return { width: Math.round(width) / divisor, height: Math.round(height) / divisor };
}

function sourceRatioDimensions(): { width: number; height: number } {
  const canvas = (selectedCanvas && detectedAssets.find(item => item.canvas_id === selectedCanvas)) || detectedAssets[0];
  return canvas && Number.isFinite(canvas.width) && Number.isFinite(canvas.height)
    ? ratioDimensions(canvas.width, canvas.height)
    : DEFAULT_CUSTOM_RATIO;
}

function syncRatioInputsFromSelection(): void {
  const selected = $<HTMLSelectElement>('ratio').value;
  if (selected === 'custom') return;
  const dimensions = selected === 'source' ? sourceRatioDimensions() : PRESET_RATIO_DIMENSIONS[selected] || DEFAULT_CUSTOM_RATIO;
  $<HTMLInputElement>('customRatioWidth').value = String(dimensions.width);
  $<HTMLInputElement>('customRatioHeight').value = String(dimensions.height);
}

function persistedSettings(): PersistedSettings {
  return {
    ratio: $<HTMLSelectElement>('ratio').value || 'source',
    customRatioWidth: Number($<HTMLInputElement>('customRatioWidth').value) || DEFAULT_CUSTOM_RATIO.width,
    customRatioHeight: Number($<HTMLInputElement>('customRatioHeight').value) || DEFAULT_CUSTOM_RATIO.height,
    minPixels: Number($<HTMLInputElement>('minPixels').value),
    maxPixels: Number($<HTMLInputElement>('maxPixels').value),
    backgroundColor: $<HTMLInputElement>('backgroundColor').value || '#ffffff',
    transparentBackground: $<HTMLInputElement>('transparentBackground').checked,
    artworkScale,
    targetUrl: $<HTMLInputElement>('targetUrl').value,
    recordingEnabled,
  };
}

function persistSettingsSilently(): void {
  if (settingValidationError()) return;
  try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(persistedSettings())); } catch (_) { /* Storage may be disabled by the host. */ }
}

function loadPersistedSettings(): void {
  let stored: Partial<PersistedSettings> = {};
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<PersistedSettings>;
  } catch (_) { stored = {}; }

  const storedRatio = typeof stored.ratio === 'string' ? stored.ratio : 'source';
  const customRatio = storedRatio === 'custom' || /^\d+:\d+$/.test(storedRatio);
  const ratioSelect = $<HTMLSelectElement>('ratio');
  ratioSelect.value = customRatio ? 'custom' : RATIO_PRESETS.has(storedRatio) ? storedRatio : 'source';
  if (customRatio) {
    const parts = storedRatio.split(':');
    const width = Number(stored.customRatioWidth) || Number(parts[0]) || DEFAULT_CUSTOM_RATIO.width;
    const height = Number(stored.customRatioHeight) || Number(parts[1]) || DEFAULT_CUSTOM_RATIO.height;
    $<HTMLInputElement>('customRatioWidth').value = String(Math.min(10_000, Math.max(1, Math.round(width))));
    $<HTMLInputElement>('customRatioHeight').value = String(Math.min(10_000, Math.max(1, Math.round(height))));
  }
  const minPixels = Number(stored.minPixels);
  const maxPixels = Number(stored.maxPixels);
  if (Number.isFinite(minPixels) && minPixels > 0) $<HTMLInputElement>('minPixels').value = String(minPixels);
  if (Number.isFinite(maxPixels) && maxPixels > 0) $<HTMLInputElement>('maxPixels').value = String(maxPixels);
  if (typeof stored.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(stored.backgroundColor)) {
    $<HTMLInputElement>('backgroundColor').value = stored.backgroundColor;
  }
  if (typeof stored.transparentBackground === 'boolean') $<HTMLInputElement>('transparentBackground').checked = stored.transparentBackground;
  if (typeof stored.artworkScale === 'number' && Number.isFinite(stored.artworkScale)) {
    artworkScale = Math.round(Math.min(ARTWORK_SCALE_MAX, Math.max(ARTWORK_SCALE_MIN, stored.artworkScale)) * 100) / 100;
  }
  if (typeof stored.targetUrl === 'string') $<HTMLInputElement>('targetUrl').value = stored.targetUrl;
  if (typeof stored.recordingEnabled === 'boolean') recordingEnabled = stored.recordingEnabled;
  syncRatioInputsFromSelection();
  updateRatioControls();
  syncBackgroundControls();
  updateArtworkScaleControl();
  const recordButton = $<HTMLButtonElement>('recordToggle');
  recordButton.textContent = recordingEnabled ? '● REC ON' : '○ REC OFF';
  recordButton.classList.toggle('off', !recordingEnabled);
}

function updateArtworkScaleControl(): void {
  const value = $<HTMLSpanElement>('artworkScaleValue');
  value.textContent = `${Math.round(artworkScale * 100)}%`;
  $<HTMLButtonElement>('artworkScaleDown').disabled = artworkScale <= ARTWORK_SCALE_MIN;
  $<HTMLButtonElement>('artworkScaleUp').disabled = artworkScale >= ARTWORK_SCALE_MAX;
}

function setArtworkScale(delta: number): void {
  const next = Math.min(ARTWORK_SCALE_MAX, Math.max(ARTWORK_SCALE_MIN, artworkScale + delta));
  artworkScale = Math.round(next * 100) / 100;
  persistSettingsSilently();
  updateArtworkScaleControl();
  renderCanvases(detectedAssets);
  refreshPreview().catch(error => status(workspaceStatus, errorMessage(error), 'error'));
}

function syncBackgroundControls(): void {
  const transparent = $<HTMLInputElement>('transparentBackground').checked;
  $<HTMLInputElement>('backgroundColor').disabled = transparent;
}

function thumbnailKey(item: CanvasDetection): string {
  const current = settings();
  return [item.canvas_id, item.revision, item.width, item.height, current.ratio, current.minPixels, current.maxPixels, current.backgroundColor, current.transparentBackground, current.artworkScale].join('|');
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
    if (isWindows || isMac) {
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

function renderCanvases(items: CanvasDetection[]): void {
  detectedAssets = items;
  if ($<HTMLSelectElement>('ratio').value === 'source') syncRatioInputsFromSelection();
  const activeIds = new Set(items.map(item => item.canvas_id));
  const currentKeys = new Map(items.map(item => [item.canvas_id, thumbnailKey(item)]));
  thumbnailUrls.forEach((url, id) => {
    if (!activeIds.has(id) || thumbnailKeys.get(id) !== currentKeys.get(id)) {
      URL.revokeObjectURL(url);
      thumbnailUrls.delete(id);
      thumbnailKeys.delete(id);
    }
  });
  const filtered = items.filter(item => item.shapes > 0 || item.gap_fillers > 0);
  if (!filtered.length) {
    canvasList.innerHTML = '<p class="muted">Belum ada Canvas. Buka target dan tunggu asset dimuat.</p>';
    return;
  }
  const generation = ++thumbnailGeneration;
  canvasList.innerHTML = filtered.map(item => `<div class="canvas-item${item.canvas_id === selectedCanvas ? ' selected' : ''}" data-canvas="${item.canvas_id}"><div class="canvas-thumb" data-thumb-canvas="${item.canvas_id}">${thumbnailUrls.has(item.canvas_id) ? `<img src="${thumbnailUrls.get(item.canvas_id)}" alt="Thumbnail Canvas">` : '<span>Memuat thumbnail…</span>'}</div><strong>Canvas · ${item.canvas_id}</strong><small>${item.width}×${item.height} · ${item.shapes} shapes · ${item.gap_fillers} strokes · ${item.errors} errors</small></div>`).join('');
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
      if (slot) { const image = document.createElement('img'); image.src = url; image.alt = 'Thumbnail Canvas'; slot.replaceChildren(image); }
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
    setMainTab('target');
    status(workspaceStatus, 'Target baru dibuka.', 'success');
    return;
  }
  await invoke('clear_recording');
  const started = await invoke<StartRecordingResult>('start_recording');
  currentSession = started.session_id;
  await invoke('set_recording', { enabled: recordingEnabled });
  await invoke('open_target_url', { url, sessionId: currentSession });
  targetOpen = true;
  if (isMac) setMainTab('target');
  else activeMainTab = 'target';
  updateOpenTargetButton();
  selectedCanvas = null;
  lastSvg = null;
  await refreshCanvases();
  status(workspaceStatus, 'Perekam aktif di background.', 'success');
}

async function closeTarget(): Promise<void> {
  await invoke('close_target_window');
  targetOpen = false;
  mainTabs.hidden = !(isWindows || isMac);
  renderTargetTabs({ active_id: null, tabs: [] });
  setMainTab('recorder');
  updateOpenTargetButton();
  currentSession = null;
  resetDetectedSurfaces();
  status(workspaceStatus, 'Target ditutup. Detected surfaces direset.');
}

document.addEventListener('DOMContentLoaded', () => {
  loadPersistedSettings();
  updateOpenTargetButton();
  mainTabs.hidden = !(isWindows || isMac);
  if (isWindows || isMac) setMainTab('recorder');
  void invoke('set_recording', { enabled: recordingEnabled }).catch(() => undefined);
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
  closeTargetMainTab.addEventListener('click', () => closeTarget().catch(error => status(workspaceStatus, errorMessage(error), 'error')));
  window.addEventListener('resize', syncTargetViewBounds);
  $('openTarget').addEventListener('click', () => openTarget().catch(error => status(workspaceStatus, errorMessage(error), 'error')));
  $('closeTarget').addEventListener('click', () => closeTarget().catch(error => status(workspaceStatus, errorMessage(error), 'error')));
  $('refreshSurfacesButton').addEventListener('click', () => refreshCanvases().catch(error => status(workspaceStatus, errorMessage(error), 'error')));
  $('clearSurfacesButton').addEventListener('click', async () => {
    try {
      await invoke('clear_surfaces');
      resetDetectedSurfaces();
      await refreshCanvases();
      status(workspaceStatus, 'Daftar Canvas dibersihkan.', 'success');
    } catch (error) { status(workspaceStatus, errorMessage(error), 'error'); }
  });
  $('ratio').addEventListener('change', () => {
    syncRatioInputsFromSelection();
    updateRatioControls();
    persistSettingsSilently();
  });
  ['customRatioWidth', 'customRatioHeight', 'minPixels', 'maxPixels', 'backgroundColor', 'transparentBackground'].forEach(id => {
    $(id).addEventListener('input', () => {
      if (id === 'customRatioWidth' || id === 'customRatioHeight') {
        const ratioSelect = $<HTMLSelectElement>('ratio');
        if (ratioSelect.value !== 'custom') {
          ratioSelect.value = 'custom';
          updateRatioControls();
        }
      }
      persistSettingsSilently();
    });
    $(id).addEventListener('change', () => { syncBackgroundControls(); persistSettingsSilently(); });
  });
  $('artworkScaleDown').addEventListener('click', () => setArtworkScale(-ARTWORK_SCALE_STEP));
  $('artworkScaleUp').addEventListener('click', () => setArtworkScale(ARTWORK_SCALE_STEP));
  $('targetUrl').addEventListener('input', () => persistSettingsSilently());
  $('recordToggle').addEventListener('click', async () => {
    recordingEnabled = !recordingEnabled;
    const button = $<HTMLButtonElement>('recordToggle');
    button.textContent = recordingEnabled ? '● REC ON' : '○ REC OFF';
    button.classList.toggle('off', !recordingEnabled);
    persistSettingsSilently();
    await invoke('set_recording', { enabled: recordingEnabled });
  });
  $('exportSettingsForm').addEventListener('submit', event => {
    event.preventDefault();
    const validationError = settingValidationError();
    if (validationError) { status(workspaceStatus, validationError, 'error'); return; }
    persistSettingsSilently();
    renderCanvases(detectedAssets);
    refreshPreview().catch(error => status(workspaceStatus, errorMessage(error), 'error'));
    status(workspaceStatus, 'Pengaturan disimpan dan diterapkan.', 'success');
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
  void listen<TargetTabsState>('target-tabs-updated', event => renderTargetTabs(event.payload));
  void listen<string>('recorder-error', event => status(workspaceStatus, event.payload, 'error'));
  void listen('target-closed', () => { targetOpen = false; activeTargetId = null; renderTargetTabs({ active_id: null, tabs: [] }); updateOpenTargetButton(); currentSession = null; resetDetectedSurfaces(); setMainTab('recorder'); });
  window.addEventListener('beforeunload', persistSettingsSilently);
  void loadLicense();
});
