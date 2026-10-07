import { autoWhitePreference, saveAutoWhitePreference, type WhiteMode } from './auto-white';
import { initGlobalExportSettings, exportSource, onlineExportSettings } from './export-settings';
import { renderExport } from './export-render';
import { checkStockSize } from './stock-export';
import './tracing.css';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { TraceOptions, TraceResult } from './engine';
import { TracingSettingsState } from './settings-state';
import { initTracingBatch } from './batch-page';
import type { BatchItem } from './batch';

export function initTracing(root: HTMLElement) {
  root.innerHTML = `
    <header id="traceListHeader" class="trace-header">
      <div class="trace-header-identity">
      <span class="trace-header-icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg></span>
      <div class="trace-header-left">
        <h1>Tracing offline</h1>
      </div></div>
    </header>
    <section id="traceGlobalExport" aria-label="Pengaturan ekspor global"></section>
    <section id="traceBatch" class="trace-batch" aria-label="Daftar gambar tracing"></section>
    <div id="traceEditor" class="trace-detail" hidden>
    <header class="trace-header">
      <div class="trace-header-left">
        <h1 id="traceEditorTitle">Editor tracing</h1>
        <p>Tracing offline</p>
      </div>
      <div class="trace-detail-actions">
        <button type="button" id="traceBack" class="trace-btn-back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          <span>Daftar gambar</span>
        </button>
        <div class="trace-export-dropdown-wrap">
          <div class="trace-split-btn">
            <button type="button" id="traceDownload" class="primary" disabled title="Simpan Vektor (SVG)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span id="traceDownloadLabel">Simpan Vektor</span>
            </button>
            <button type="button" id="traceDownloadToggle" class="primary trace-dropdown-toggle" disabled aria-haspopup="true" aria-expanded="false" title="Pilih format vektor (SVG / EPS)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </div>
          <div id="traceDownloadMenu" class="trace-export-menu" hidden role="menu" aria-label="Format ekspor vektor">
            <button type="button" id="traceDownloadSvg" class="trace-export-menu-item" role="menuitem">
              <span class="menu-item-badge svg">SVG</span>
              <span class="trace-menu-text">
                <strong>SVG</strong>
                <small>Scalable Vector Graphics</small>
              </span>
            </button>
            <button type="button" id="traceDownloadEps" class="trace-export-menu-item" role="menuitem">
              <span class="menu-item-badge eps">EPS</span>
              <span class="trace-menu-text">
                <strong>EPS</strong>
                <small>Encapsulated PostScript</small>
              </span>
            </button>
          </div>
        </div>
      </div>
    </header>
    <div class="trace-layout">
      <aside class="trace-sidebar" id="traceSidebar">
        <input id="traceFile" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>
        <span id="traceFileInfo" hidden></span>
        <fieldset id="traceSettings" class="trace-section" aria-labelledby="traceSettingsTitle">
          <div class="trace-sidebar-title-row">
            <h2 id="traceSettingsTitle">Pengaturan tracing</h2>
            <button type="button" id="traceSidebarClose" class="trace-sidebar-close" title="Tutup panel samping" aria-label="Tutup panel samping">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 18-6-6 6-6"/>
              </svg>
            </button>
          </div>
          <div class="trace-mode-pills" role="group" aria-label="Mode tracing">
            <button type="button" class="trace-mode-pill active" id="traceModePillAuto" data-mode="auto" aria-pressed="true">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
              <span>Auto</span>
            </button>
            <button type="button" class="trace-mode-pill" id="traceModePillManual" data-mode="manual" aria-pressed="false">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/></svg>
              <span>Manual</span>
            </button>
          </div>
          <label for="traceMode" style="display:none">Mode</label>
          <select id="traceMode" hidden><option value="auto" selected>Auto</option><option value="manual">Manual</option></select>
          <p id="traceAutoSummary" class="trace-help" aria-live="polite">Pengaturan dipilih otomatis dari gambar.</p>
          <div id="traceAutoWhiteSettings">
            <label for="traceAutoWhite">Default putih Auto</label>
            <select id="traceAutoWhite"><option value="background">Latar putih saja</option><option value="none">Pertahankan semua</option><option value="all">Semua bidang putih</option></select>
            <p class="trace-help">Latar putih saja menghapus semua putih pada artwork dua warna.</p>
          </div>
          <div id="traceManualSettings" hidden>
            <label for="traceColors">Maksimum warna <output id="traceColorsValue" for="traceColors">6</output></label>
            <input id="traceColors" type="range" min="2" max="16" value="6">
            <label for="traceDetail">Detail kontur</label>
            <select id="traceDetail"><option value="0.2">Sangat tinggi</option><option value="0.35">Tinggi</option><option value="0.8" selected>Seimbang</option><option value="1.6">Sederhana</option></select>
            <label for="traceNoise">Bersihkan bintik</label>
            <select id="traceNoise"><option value="0">Mati</option><option value="4" selected>Kecil · &lt; 4 px</option><option value="12">Sedang · &lt; 12 px</option><option value="24">Kuat · &lt; 24 px</option></select>
            <p class="trace-help">Pilih Mati untuk mempertahankan bidang kecil dan warna transisi.</p>
            <label for="traceResolution">Resolusi proses</label>
            <select id="traceResolution"><option value="512">512 px — cepat</option><option value="1024" selected>1024 px — detail</option><option value="2048">2048 px — detail tinggi</option></select>
            <label class="trace-check"><input type="checkbox" id="traceSmooth" checked><span>Haluskan kurva</span></label>
            <label for="traceWhite">Hapus putih</label>
            <select id="traceWhite"><option value="none" selected>Pertahankan semua</option><option value="background">Latar putih saja</option><option value="all">Semua bidang putih</option></select>
            <p class="trace-help">Latar putih hanya menghapus area putih yang terhubung ke tepi gambar.</p>
          </div>
        </fieldset>
        <div class="trace-section trace-run-section">
          <button type="button" id="traceRun" class="primary" disabled>Mulai tracing</button>
          <button type="button" id="traceCancel" hidden>Batalkan</button>
        </div>
      </aside>
      <div class="trace-workbench" id="traceDropZone">
        <div class="trace-toolbar">
          <button type="button" id="traceSidebarToggle" class="trace-toolbar-toggle" title="Sembunyikan panel samping" aria-label="Buka atau tutup panel samping" aria-expanded="true">
            <svg class="trace-sidebar-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M9 3v18" />
              <path class="trace-sidebar-chevron" d="m14 9-3 3 3 3" />
            </svg>
            <span id="traceSidebarToggleLabel">Panel samping</span>
          </button>
          <span id="traceDimensions">Belum ada gambar</span>
          <div class="trace-zoom-group">
            <button type="button" id="traceZoomOut" class="trace-zoom-btn" title="Perkecil zoom" aria-label="Perkecil zoom" disabled>−</button>
            <label for="traceZoom">Zoom</label>
            <input id="traceZoom" type="range" min="100" max="500" step="5" value="100" disabled>
            <output id="traceZoomValue">100%</output>
            <button type="button" id="traceZoomIn" class="trace-zoom-btn" title="Perbesar zoom" aria-label="Perbesar zoom" disabled>＋</button>
            <button type="button" id="traceFit" disabled>Pas layar</button>
          </div>
        </div>
        <div class="trace-comparison">
          <section class="trace-pane">
            <header><h2>Gambar asli</h2><span>RASTER</span></header>
            <div class="trace-stage" id="traceStageOriginal">
              <div class="trace-stage-inner">
                <img id="traceOriginal" alt="Gambar sumber tracing" draggable="false" hidden>
                <div id="traceOriginalEmpty" class="trace-empty">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 8px; opacity:0.6; display:block;"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                  <strong>Gambar sumber</strong>
                  <p>Pilih gambar dari daftar.</p>
                </div>
              </div>
            </div>
          </section>
          <section class="trace-pane">
            <header><h2>Hasil tracing</h2><span>Vektor</span></header>
            <div class="trace-stage" id="traceStageOutput">
              <div class="trace-stage-inner">
                <img id="traceOutput" alt="Hasil tracing vektor" draggable="false" hidden>
                <div id="traceOutputEmpty" class="trace-empty">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 8px; opacity:0.6; display:block;"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
                  <strong>Pratinjau vektor</strong>
                  <p>Pilih Mulai tracing untuk melihat hasil.</p>
                </div>
              </div>
            </div>
          </section>
        </div>
        <div class="trace-result-bar">
          <div id="tracePalette" class="trace-palette" aria-label="Palet hasil"></div>
          <span id="traceStats">Belum ada hasil</span>
        </div>
        <div class="trace-progress">
          <progress id="traceProgress" max="100" value="0" hidden aria-label="Progres tracing"></progress>
          <p id="traceStatus" role="status" aria-live="polite">Siap menerima gambar.</p>
        </div>
      </div>
    </div></div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const fileInput = $<HTMLInputElement>('traceFile');
  const original = $<HTMLImageElement>('traceOriginal'), output = $<HTMLImageElement>('traceOutput');
  const stageOriginal = $<HTMLElement>('traceStageOriginal'), stageOutput = $<HTMLElement>('traceStageOutput');
  const run = $<HTMLButtonElement>('traceRun'), cancel = $<HTMLButtonElement>('traceCancel'), download = $<HTMLButtonElement>('traceDownload'), downloadToggle = $<HTMLButtonElement>('traceDownloadToggle');
  const settings = $<HTMLFieldSetElement>('traceSettings'), progress = $<HTMLProgressElement>('traceProgress');
  const mode = $<HTMLSelectElement>('traceMode');
  const autoSummary = $('traceAutoSummary');
  const autoPill = root.querySelector<HTMLButtonElement>('#traceModePillAuto');
  const manualPill = root.querySelector<HTMLButtonElement>('#traceModePillManual');
  const setModeDisabled = (disabled: boolean) => {
    mode.disabled = disabled;
    if (autoPill) autoPill.disabled = disabled;
    if (manualPill) manualPill.disabled = disabled;
  };

  autoPill?.addEventListener('click', () => {
    if (!mode.disabled && !settings.disabled && mode.value !== 'auto') {
      mode.value = 'auto';
      mode.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  manualPill?.addEventListener('click', () => {
    if (!mode.disabled && !settings.disabled && mode.value !== 'manual') {
      mode.value = 'manual';
      mode.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  const autoWhiteSelect = $<HTMLSelectElement>('traceAutoWhite');
  autoWhiteSelect.value = autoWhitePreference();
  let settingsState = new TracingSettingsState();
  const readManualSettings = () => ({
    resolution: Number($<HTMLSelectElement>('traceResolution').value), options: {
      colors: Number($<HTMLInputElement>('traceColors').value), tolerance: Number($<HTMLSelectElement>('traceDetail').value), minArea: Number($<HTMLSelectElement>('traceNoise').value),
      smooth: $<HTMLInputElement>('traceSmooth').checked, whiteMode: $<HTMLSelectElement>('traceWhite').value as TraceOptions['whiteMode'], removeWhite: $<HTMLSelectElement>('traceWhite').value !== 'none',
    }
  });
  const saveManual = () => settingsState.setManual(readManualSettings());
  const describeSettings = (options: TraceOptions, resolution: number) => `${options.colors} warna maksimum · detail ${options.tolerance <= .35 ? 'tinggi' : options.tolerance <= .8 ? 'seimbang' : 'sederhana'} · bintik ${options.minArea === 0 ? 'dipertahankan' : `< ${options.minArea} px`} · ${resolution} px · ${options.whiteMode === 'background' ? 'hapus latar putih' : options.whiteMode === 'all' ? 'hapus semua putih' : 'pertahankan putih'}`;
  const applyManualSettings = (options: TraceOptions, resolution: number) => {
    $<HTMLInputElement>('traceColors').value = String(options.colors); $('traceColorsValue').textContent = String(options.colors);
    $<HTMLSelectElement>('traceDetail').value = String(options.tolerance);
    $<HTMLSelectElement>('traceNoise').value = String(options.minArea);
    $<HTMLSelectElement>('traceResolution').value = String(resolution);
    $<HTMLInputElement>('traceSmooth').checked = options.smooth;
    $<HTMLSelectElement>('traceWhite').value = options.whiteMode ?? (options.removeWhite ? 'all' : 'none');
  };
  const syncMode = () => {
    const isAuto = mode.value === 'auto';
    $('traceManualSettings').hidden = isAuto;
    $('traceAutoWhiteSettings').hidden = !isAuto;
    autoSummary.hidden = !isAuto;
    if (autoPill && manualPill) {
      autoPill.classList.toggle('active', isAuto);
      manualPill.classList.toggle('active', !isAuto);
      autoPill.setAttribute('aria-pressed', String(isAuto));
      manualPill.setAttribute('aria-pressed', String(!isAuto));
    }
  };
  applyManualSettings(settingsState.manualSettings.options, settingsState.manualSettings.resolution);
  syncMode();
  const zoom = $<HTMLInputElement>('traceZoom');
  const zoomIn = root.querySelector<HTMLButtonElement>('#traceZoomIn');
  const zoomOut = root.querySelector<HTMLButtonElement>('#traceZoomOut');
  const fitBtn = $<HTMLButtonElement>('traceFit');
  const sidebarToggle = $<HTMLButtonElement>('traceSidebarToggle');
  const sidebarClose = root.querySelector<HTMLButtonElement>('#traceSidebarClose');
  const layout = root.querySelector<HTMLElement>('.trace-layout')!;
  const toggleLabel = $('traceSidebarToggleLabel');

  const SIDEBAR_STORAGE_KEY = 'cvr_trace_sidebar_collapsed';
  let isSidebarCollapsed = localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';

  const applySidebarState = () => {
    layout.classList.toggle('sidebar-collapsed', isSidebarCollapsed);
    sidebarToggle.classList.toggle('is-collapsed', isSidebarCollapsed);
    sidebarToggle.setAttribute('aria-expanded', String(!isSidebarCollapsed));
    sidebarToggle.title = isSidebarCollapsed ? 'Buka panel samping' : 'Sembunyikan panel samping';
    toggleLabel.textContent = isSidebarCollapsed ? 'Buka panel' : 'Panel samping';
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isSidebarCollapsed));
  };
  applySidebarState();

  sidebarToggle.addEventListener('click', () => {
    isSidebarCollapsed = !isSidebarCollapsed;
    applySidebarState();
  });
  if (sidebarClose) {
    sidebarClose.addEventListener('click', () => {
      isSidebarCollapsed = true;
      applySidebarState();
    });
  }

  let source: { file: File; image: HTMLImageElement; url: string } | null = null;
  let result: TraceResult | null = null, worker: Worker | null = null, resultUrl: string | null = null;
  let generation = 0, sourceGeneration = 0, saving = false, loading = false;
  const globalExportSettings = initGlobalExportSettings($('traceGlobalExport'));
  let batch: ReturnType<typeof initTracingBatch> | undefined;
  let activeItemId: string | null = null;
  let displayedOutput: BatchItem['output'];
  let currentZoom = 100;
  const ZOOM_MIN = 100;
  const ZOOM_MAX = 500;
  let isSyncingScroll = false;

  const updateZoomControls = () => {
    const disabled = !source;
    zoom.disabled = disabled;
    fitBtn.disabled = disabled;
    if (zoomIn) zoomIn.disabled = disabled || currentZoom >= ZOOM_MAX;
    if (zoomOut) zoomOut.disabled = disabled || currentZoom <= ZOOM_MIN;
    zoom.value = String(Math.round(currentZoom));
    $('traceZoomValue').textContent = `${Math.round(currentZoom)}%`;
    stageOriginal.classList.toggle('can-pan', !disabled && currentZoom > 100);
    stageOutput.classList.toggle('can-pan', !disabled && currentZoom > 100);
  };

  const applyZoom = (targetZoom: number, focalPoint?: { fx: number; fy: number; refStage?: HTMLElement }) => {
    if (!source) return;
    const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(targetZoom)));
    const oldZoom = currentZoom;
    if (nextZoom === oldZoom && focalPoint === undefined) return;

    const refStage = focalPoint?.refStage || stageOriginal;
    const vw = refStage.clientWidth;
    const vh = refStage.clientHeight;
    const fx = focalPoint?.fx ?? vw / 2;
    const fy = focalPoint?.fy ?? vh / 2;

    const k = nextZoom / oldZoom;
    const contentX = refStage.scrollLeft + fx;
    const contentY = refStage.scrollTop + fy;

    currentZoom = nextZoom;
    root.querySelectorAll<HTMLElement>('.trace-stage-inner').forEach(el => {
      el.style.width = `${nextZoom}%`;
      el.style.height = `${nextZoom}%`;
    });

    let targetLeft = 0;
    let targetTop = 0;
    if (nextZoom > 100) {
      targetLeft = Math.max(0, contentX * k - fx);
      targetTop = Math.max(0, contentY * k - fy);
    }

    isSyncingScroll = true;
    stageOriginal.scrollLeft = targetLeft;
    stageOriginal.scrollTop = targetTop;
    stageOutput.scrollLeft = targetLeft;
    stageOutput.scrollTop = targetTop;
    requestAnimationFrame(() => {
      isSyncingScroll = false;
    });

    updateZoomControls();
  };

  const syncScroll = (from: HTMLElement, to: HTMLElement) => {
    if (isSyncingScroll) return;
    isSyncingScroll = true;
    to.scrollLeft = from.scrollLeft;
    to.scrollTop = from.scrollTop;
    requestAnimationFrame(() => {
      isSyncingScroll = false;
    });
  };

  stageOriginal.addEventListener('scroll', () => syncScroll(stageOriginal, stageOutput), { passive: true });
  stageOutput.addEventListener('scroll', () => syncScroll(stageOutput, stageOriginal), { passive: true });

  const handleWheel = (event: WheelEvent, stage: HTMLElement) => {
    if (!source) return;
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    const fx = event.clientX - rect.left;
    const fy = event.clientY - rect.top;

    let delta = 0;
    if (event.ctrlKey) {
      delta = -event.deltaY * 0.5;
    } else if (Math.abs(event.deltaY) >= 50) {
      delta = -Math.sign(event.deltaY) * 25;
    } else {
      delta = -event.deltaY * 0.4;
    }

    const nextZoom = currentZoom + delta;
    applyZoom(nextZoom, { fx, fy, refStage: stage });
  };

  stageOriginal.addEventListener('wheel', e => handleWheel(e, stageOriginal), { passive: false });
  stageOutput.addEventListener('wheel', e => handleWheel(e, stageOutput), { passive: false });

  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartScrollLeft = 0;
  let panStartScrollTop = 0;

  const startPan = (event: PointerEvent, stage: HTMLElement) => {
    if (event.button !== 0 || !source || currentZoom <= 100) return;
    isPanning = true;
    panStartX = event.clientX;
    panStartY = event.clientY;
    panStartScrollLeft = stage.scrollLeft;
    panStartScrollTop = stage.scrollTop;
    stage.setPointerCapture(event.pointerId);
    root.classList.add('trace-is-panning');
  };

  const movePan = (event: PointerEvent) => {
    if (!isPanning) return;
    const dx = event.clientX - panStartX;
    const dy = event.clientY - panStartY;
    const nextLeft = panStartScrollLeft - dx;
    const nextTop = panStartScrollTop - dy;

    isSyncingScroll = true;
    stageOriginal.scrollLeft = nextLeft;
    stageOriginal.scrollTop = nextTop;
    stageOutput.scrollLeft = nextLeft;
    stageOutput.scrollTop = nextTop;
    requestAnimationFrame(() => {
      isSyncingScroll = false;
    });
  };

  const endPan = (event: PointerEvent, stage: HTMLElement) => {
    if (!isPanning) return;
    isPanning = false;
    root.classList.remove('trace-is-panning');
    try {
      if (stage.hasPointerCapture(event.pointerId)) {
        stage.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore
    }
  };

  [stageOriginal, stageOutput].forEach(stage => {
    stage.addEventListener('pointerdown', e => startPan(e, stage));
    stage.addEventListener('pointermove', movePan);
    stage.addEventListener('pointerup', e => endPan(e, stage));
    stage.addEventListener('pointercancel', e => endPan(e, stage));
    stage.addEventListener('dragstart', e => e.preventDefault());

    stage.addEventListener('dblclick', (event: MouseEvent) => {
      if (!source) return;
      const rect = stage.getBoundingClientRect();
      const fx = event.clientX - rect.left;
      const fy = event.clientY - rect.top;
      if (currentZoom > 100) {
        applyZoom(100);
      } else {
        applyZoom(200, { fx, fy, refStage: stage });
      }
    });
  });

  zoom.addEventListener('input', () => {
    applyZoom(Number(zoom.value));
  });

  if (zoomIn) {
    zoomIn.addEventListener('click', () => {
      applyZoom(currentZoom + 25);
    });
  }
  if (zoomOut) {
    zoomOut.addEventListener('click', () => {
      applyZoom(currentZoom - 25);
    });
  }
  fitBtn.addEventListener('click', () => {
    applyZoom(100);
    stageOriginal.scrollTo(0, 0);
    stageOutput.scrollTo(0, 0);
  });

  const onWindowResize = () => {
    if (source && currentZoom > 100) {
      stageOutput.scrollLeft = stageOriginal.scrollLeft;
      stageOutput.scrollTop = stageOriginal.scrollTop;
    }
  };
  window.addEventListener('resize', onWindowResize);

  const status = (message: string, error = false) => { $('traceStatus').textContent = message; $('traceStatus').classList.toggle('trace-error', error); };
  const detectSourceSettings = () => {
    if (!source || mode.value !== 'auto') return;
    const image = source.image, id = generation, selectedId = activeItemId, side = Math.max(image.naturalWidth, image.naturalHeight), ratio = Math.min(1, 1024 / side);
    autoSummary.textContent = 'Mendeteksi pengaturan gambar…'; setModeDisabled(true);
    try {
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw new Error('Raster tidak dapat disiapkan.');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const detector = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); worker = detector;
      detector.onmessage = event => {
        if (id !== generation) return;
        detector.terminate(); if (worker === detector) worker = null; setModeDisabled(false);
        if (event.data.type === 'auto-settings') {
          const detected = event.data.recommendation; settingsState.setAuto(detected);
          if (selectedId) batch?.setDetected(selectedId, detected);
          applyManualSettings(detected.options, detected.resolution);
          autoSummary.textContent = `Pengaturan awal: ${describeSettings(detected.options, detected.resolution)}. Hasil akhir diperiksa kembali saat tracing.`;
        } else autoSummary.textContent = `Deteksi belum tersedia: ${event.data.message ?? 'coba Mulai tracing.'}`;
      };
      detector.onerror = () => { if (id !== generation) return; detector.terminate(); if (worker === detector) worker = null; setModeDisabled(false); autoSummary.textContent = 'Deteksi belum tersedia. Coba Mulai tracing atau gunakan Manual.'; };
      detector.postMessage({ mode: 'detect', pixels: pixels.buffer, width: canvas.width, height: canvas.height, sourceSide: side, defaultWhite: autoWhiteSelect.value }, [pixels.buffer]);
    } catch { worker?.terminate(); worker = null; setModeDisabled(false); autoSummary.textContent = 'Deteksi belum tersedia. Coba Mulai tracing atau gunakan Manual.'; }
  };
  const stop = () => { worker?.terminate(); worker = null; generation++; setModeDisabled(false); settings.disabled = loading || (batch?.running ?? false); cancel.hidden = true; progress.hidden = true; run.disabled = !source || loading || (batch?.running ?? false); root.setAttribute('aria-busy', String(loading || batch?.running)); };
  const invalidate = () => {
    stop(); result = null; download.disabled = downloadToggle.disabled = true;
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null; output.removeAttribute('src'); output.hidden = true; $('traceOutputEmpty').hidden = false;
    $('tracePalette').replaceChildren(); $('traceStats').textContent = 'Belum ada hasil';
    if (!source) {
      currentZoom = 100;
      root.querySelectorAll<HTMLElement>('.trace-stage-inner').forEach(el => {
        el.style.width = '100%';
        el.style.height = '100%';
      });
      updateZoomControls();
    }
  };
  const load = async (file: File) => {
    if (batch?.running) { status('Batalkan atau tunggu batch sebelum mengganti pratinjau.'); return; }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { status('Pilih file PNG, JPG, atau WebP.', true); return; }
    if (file.size > 20 * 1024 * 1024) { status('Ukuran file melebihi 20 MB.', true); return; }
    const version = ++sourceGeneration;
    loading = true;
    if (source) URL.revokeObjectURL(source.url); source = null; original.removeAttribute('src'); original.hidden = true;
    autoSummary.textContent = 'Membuka gambar dan menyiapkan pengaturan item…';
    invalidate(); run.disabled = true; status('Membuka gambar…');
    const url = URL.createObjectURL(file), image = new Image();
    image.src = url;
    try {
      await image.decode();
      if (version !== sourceGeneration) { URL.revokeObjectURL(url); return; }
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 64000000) throw new Error('Gambar terlalu besar. Gunakan gambar di bawah 64 megapiksel.');
      source = { file, image, url };
      original.src = url; original.hidden = false; $('traceOriginalEmpty').hidden = true;
      $('traceFileInfo').textContent = file.name; $('traceEditorTitle').textContent = file.name;
      $('traceDimensions').textContent = `${image.naturalWidth} × ${image.naturalHeight} px`;
      loading = false; settings.disabled = false; root.setAttribute('aria-busy', 'false');
      currentZoom = 100; applyZoom(100); run.disabled = false;
      autoSummary.textContent = 'Pengaturan dipilih otomatis dari gambar.';
      status(mode.value === 'auto' ? 'Gambar siap. Auto menyiapkan rekomendasi; pilih Mulai tracing untuk membuat vektor.' : 'Gambar siap. Sesuaikan pengaturan lalu mulai tracing.');
      if (mode.value === 'auto' && !settingsState.autoSettings) detectSourceSettings();
      else if (settingsState.autoSettings) { const detected = settingsState.autoSettings; autoSummary.textContent = `Pengaturan Auto: ${describeSettings(detected.options, detected.resolution)}`; }
    } catch (error) {
      URL.revokeObjectURL(url);
      if (version === sourceGeneration) { loading = false; stop(); status(error instanceof Error ? error.message : 'Gambar tidak dapat dibuka.', true); }
    }
  };
  fileInput.addEventListener('change', () => { batch?.addFiles(Array.from(fileInput.files ?? [])); fileInput.value = ''; });
  const dropZone = $('traceDropZone');
  dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('trace-dragging'); });
  dropZone.addEventListener('dragleave', event => { if (!dropZone.contains(event.relatedTarget as Node | null)) dropZone.classList.remove('trace-dragging'); });
  dropZone.addEventListener('drop', event => { event.preventDefault(); dropZone.classList.remove('trace-dragging'); batch?.addFiles(Array.from(event.dataTransfer?.files ?? [])); });
  settings.addEventListener('input', event => {
    if (!activeItemId || !batch || batch.running) return;
    if (event.target === autoWhiteSelect) {
      saveAutoWhitePreference(autoWhiteSelect.value as WhiteMode);
      batch.resetAutoSettings(); settingsState.setAuto(undefined); invalidate();
      if (source) detectSourceSettings(); return;
    }
    if (event.target === mode) {
      batch.switchMode(activeItemId, mode.value === 'auto' ? 'auto' : 'manual');
      const item = batch.item(activeItemId); if (item) { settingsState = new TracingSettingsState(item.config); settingsState.setAuto(item.autoSettings); applyManualSettings(item.config.options, item.config.resolution); }
    } else { saveManual(); batch.updateConfig(activeItemId, { ...readManualSettings(), mode: 'manual' }); mode.value = 'manual'; }
    syncMode();
    $('traceColorsValue').textContent = $<HTMLInputElement>('traceColors').value;
    if (mode.value === 'manual') saveManual();
    invalidate(); if (source) status('Pengaturan berubah. Jalankan tracing untuk memperbarui hasil.');
    if (mode.value === 'auto' && !settingsState.autoSettings) detectSourceSettings();
  });
  cancel.addEventListener('click', () => { batch?.cancel(); stop(); status('Tracing dibatalkan. Gambar tetap siap diproses.'); });
  const showList = () => {
    const wasEditor = root.dataset.traceView === 'detail';
    sourceGeneration++; loading = false; activeItemId = null; displayedOutput = undefined; invalidate();
    if (source) URL.revokeObjectURL(source.url); source = null; original.removeAttribute('src'); original.hidden = true;
    root.dataset.traceView = 'list'; $('traceListHeader').hidden = false; $('traceBatch').hidden = false; $('traceEditor').hidden = true;
    root.setAttribute('aria-busy', String(batch?.running ?? false));
    if (wasEditor && !root.hidden) $('traceBatchAdd').focus();
  };
  const renderItem = (item: BatchItem) => {
    if (item.id !== activeItemId || loading) return;
    if (!item.output && displayedOutput) { displayedOutput = undefined; invalidate(); }
    if (item.output && item.output !== displayedOutput) {
      displayedOutput = item.output;
      const activeResult = structuredClone(item.output.result);
      result = activeResult;
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(new Blob([activeResult.svg], { type: 'image/svg+xml' })); output.src = resultUrl; output.hidden = false; $('traceOutputEmpty').hidden = true;
      $('tracePalette').replaceChildren(...activeResult.colors.map(color => { const swatch = document.createElement('span'); swatch.style.background = color; swatch.title = color; swatch.setAttribute('aria-label', color); return swatch; }));
      $('traceStats').textContent = activeResult.colors.length + ' warna · ' + activeResult.contours + ' kontur · ' + activeResult.segments + ' segmen'; download.disabled = downloadToggle.disabled = saving;
      const auto = item.output.auto;
      if (auto) {
        settingsState.setAuto({ options: auto.options, resolution: auto.resolution });
        if (mode.value === 'auto') applyManualSettings(auto.options, auto.resolution);
        const adjustment = auto.fallback === 'resolution' ? 'Resolusi diturunkan.' : auto.fallback === 'palette' ? 'Warna diperbaiki.' : auto.fallback === 'detail' ? 'Detail diperbaiki.' : auto.fallback !== 'none' ? 'Pengaturan disesuaikan pada hasil akhir.' : '';
        autoSummary.textContent = 'Hasil Auto: ' + describeSettings(auto.options, auto.resolution) + (adjustment ? '. ' + adjustment : '');
      }
    }
    const processing = item.status === 'processing'; settings.disabled = processing || (batch?.running ?? false); run.disabled = processing || (batch?.running ?? false) || !source;
    cancel.hidden = !processing; progress.hidden = !processing; progress.value = item.progress;
    if (processing) status(item.label);
    else if (item.status === 'success') status('Hasil ' + item.file.name + ' siap disimpan sebagai vektor.');
    else if (item.status === 'error') status(item.error ?? 'Tracing gagal.', true);
  };
  run.addEventListener('click', () => { if (activeItemId && !loading && !batch?.running) batch?.runItem(activeItemId); });
  batch = initTracingBatch($('traceBatch'), () => ({ ...new TracingSettingsState().manualSettings, mode: 'auto' }), async item => {
    activeItemId = item.id; displayedOutput = undefined;
    settingsState = new TracingSettingsState(item.config); settingsState.setAuto(item.autoSettings);
    mode.value = item.config.mode; applyManualSettings(item.config.options, item.config.resolution); syncMode();
    root.dataset.traceView = 'detail'; $('traceListHeader').hidden = true; $('traceBatch').hidden = true; $('traceEditor').hidden = false;
    await load(item.file); if (activeItemId !== item.id || source?.file !== item.file) return;
    renderItem(item);
    const heading = $('traceEditorTitle'); heading.tabIndex = -1; if (!root.hidden) heading.focus();
  }, running => {
    if (running) { sourceGeneration++; loading = false; stop(); } settings.disabled = loading || running; run.disabled = !source || loading || running; fileInput.disabled = running;
    root.setAttribute('aria-busy', String(loading || running));
  }, items => {
    if (!activeItemId) return; const item = items.find(item => item.id === activeItemId);
    if (item) renderItem(item); else showList();
  }, showList, globalExportSettings);
  $('traceBack').addEventListener('click', showList);
  const batchActions = $('traceBatch').querySelector('.trace-batch-actions');
  if (batchActions) $('traceListHeader').append(batchActions);
  const list = $('traceBatch'); list.addEventListener('dragover', event => { event.preventDefault(); list.classList.add('trace-library-dragging'); });
  list.addEventListener('dragleave', event => { if (!list.contains(event.relatedTarget as Node | null)) list.classList.remove('trace-library-dragging'); });
  list.addEventListener('drop', event => { event.preventDefault(); list.classList.remove('trace-library-dragging'); batch?.addFiles(Array.from((event as DragEvent).dataTransfer?.files ?? [])); });
  root.dataset.traceView = 'list';
  const saveVector = async (format: 'svg' | 'eps' = 'svg') => {
    if (!result || !source || saving) return;
    saving = true; download.disabled = downloadToggle.disabled = true;
    const base = source.file.name.replace(/\.[^.]+$/, '');
    const filename = `${base}-traced.${format}`;
    try {
      const exportSettings = globalExportSettings();
      const item = activeItemId && batch?.item(activeItemId);
      if (!item) throw new Error('Gambar tracing tidak tersedia.');
      const exportSvg = await exportSource(item, exportSettings);
      if (format === 'eps') {
        const epsBytes = new TextEncoder().encode(await renderExport(exportSvg, exportSettings, 'eps', base));
        checkStockSize(epsBytes);
        if (isTauri()) {
          const path = await invoke<string>('save_tracing_eps', { bytes: Array.from(epsBytes), filename });
          status(`Vektor disimpan: ${path}`);
        } else {
          const url = URL.createObjectURL(new Blob([epsBytes.buffer as ArrayBuffer], { type: 'application/postscript' }));
          const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000); status('Vektor berhasil diunduh.');
        }
      } else {
        if (isTauri()) {
          const path = await invoke<string>('save_tracing_svg', { svg: exportSvg, filename, settings: onlineExportSettings(exportSettings) });
          status(`Vektor disimpan: ${path}`);
        } else {
          const url = URL.createObjectURL(new Blob([await renderExport(exportSvg, exportSettings, 'svg', base)], { type: 'image/svg+xml' }));
          const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000); status('Vektor berhasil diunduh.');
        }
      }
    } catch (error) { status(`Gagal menyimpan vektor: ${error instanceof Error ? error.message : String(error)}`, true); }
    finally { saving = false; download.disabled = downloadToggle.disabled = !result; }
  };
  const toggleDownloadMenu = (e?: Event) => {
    e?.stopPropagation();
    if (download.disabled) return;
    const menu = $('traceDownloadMenu');
    menu.hidden = !menu.hidden;
    downloadToggle.setAttribute('aria-expanded', String(!menu.hidden));
  };
  download.addEventListener('click', toggleDownloadMenu);
  downloadToggle.addEventListener('click', toggleDownloadMenu);
  $<HTMLButtonElement>('traceDownloadSvg').addEventListener('click', () => {
    $('traceDownloadMenu').hidden = true;
    downloadToggle.setAttribute('aria-expanded', 'false');
    void saveVector('svg');
  });
  $<HTMLButtonElement>('traceDownloadEps').addEventListener('click', () => {
    $('traceDownloadMenu').hidden = true;
    downloadToggle.setAttribute('aria-expanded', 'false');
    void saveVector('eps');
  });
  root.addEventListener('click', e => {
    if (!(e.target as HTMLElement).closest('.trace-export-dropdown-wrap')) {
      const menu = root.querySelector<HTMLElement>('#traceDownloadMenu');
      if (menu && !menu.hidden) {
        menu.hidden = true;
        downloadToggle.setAttribute('aria-expanded', 'false');
      }
    }
  });
  const onPaste = (event: ClipboardEvent) => {
    if (root.hidden) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    const filesToUpload: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) filesToUpload.push(file);
      }
    }
    if (filesToUpload.length > 0) {
      event.preventDefault();
      batch?.addFiles(filesToUpload);
    }
  };
  window.addEventListener('paste', onPaste);

  window.addEventListener('beforeunload', () => {
    stop();
    window.removeEventListener('resize', onWindowResize);
    window.removeEventListener('paste', onPaste);
    if (source) URL.revokeObjectURL(source.url);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
  });
}
