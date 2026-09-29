import './tracing.css';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { TraceOptions, TraceResult } from './engine';

export function initTracing(root: HTMLElement) {
  root.innerHTML = `
    <header class="trace-header">
      <div><span class="trace-eyebrow">RASTER → VECTOR</span><h1>Tracing</h1><p>Ubah gambar menjadi bidang warna dan kurva yang bisa diedit.</p></div>
      <button type="button" id="traceDownload" class="primary" disabled>Simpan SVG</button>
    </header>
    <div class="trace-layout">
      <aside class="trace-sidebar" id="traceSidebar">
        <div class="trace-section">
          <div class="trace-sidebar-title-row">
            <h2>Gambar sumber</h2>
            <button type="button" id="traceSidebarClose" class="trace-sidebar-close" title="Tutup panel samping" aria-label="Tutup panel samping">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 18-6-6 6-6"/>
              </svg>
            </button>
          </div>
          <button type="button" id="traceUpload" class="trace-upload"><span class="trace-upload-symbol" aria-hidden="true">＋</span><strong>Pilih gambar</strong><span>PNG, JPG, atau WebP · maks. 20 MB</span></button>
          <input id="traceFile" type="file" accept="image/png,image/jpeg,image/webp" hidden>
          <p id="traceFileInfo" class="trace-help">Atau tarik gambar ke area pratinjau.</p>
        </div>
        <fieldset id="traceSettings" class="trace-section" aria-labelledby="traceSettingsTitle"><h2 id="traceSettingsTitle">Pengaturan tracing</h2>
          <label for="traceColors">Maksimum warna <output id="traceColorsValue" for="traceColors">6</output></label>
          <input id="traceColors" type="range" min="2" max="16" value="6">
          <label for="traceDetail">Detail kontur</label>
          <select id="traceDetail"><option value="0.35">Tinggi — pertahankan detail</option><option value="0.8" selected>Seimbang</option><option value="1.6">Sederhana — lebih sedikit titik</option></select>
          <label for="traceNoise">Bersihkan bintik</label>
          <select id="traceNoise"><option value="0">Mati — simpan semua bidang</option><option value="4" selected>Kecil — di bawah 4 piksel</option><option value="12">Sedang — di bawah 12 piksel</option><option value="24">Kuat — di bawah 24 piksel</option></select>
          <p class="trace-help">Merapikan warna transisi di tepi dan bidang kecil. Warna yang sangat mirip dapat digabung. Pilih Mati untuk mempertahankan detail warna.</p>
          <label for="traceResolution">Resolusi proses</label>
          <select id="traceResolution"><option value="512">512 px — cepat</option><option value="1024" selected>1024 px — detail</option></select>
          <label class="trace-check"><input type="checkbox" id="traceSmooth" checked> Haluskan kurva</label>
          <label class="trace-check"><input type="checkbox" id="traceWhite"> Hapus bidang putih</label>
          <p class="trace-help">Semua bidang hampir putih akan transparan. Transparansi sebagian pada PNG diubah menjadi batas bidang.</p>
        </fieldset>
        <div class="trace-section trace-run-section"><button type="button" id="traceRun" class="primary" disabled>Mulai tracing</button><button type="button" id="traceCancel" hidden>Batalkan</button>
          <p class="trace-help">Cocok untuk logo, ikon, dan ilustrasi warna datar. Proses berjalan lokal.</p>
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
          <section class="trace-pane"><header><h2>Gambar asli</h2><span>RASTER</span></header><div class="trace-stage" id="traceStageOriginal"><div class="trace-stage-inner"><img id="traceOriginal" alt="Gambar sumber tracing" draggable="false" hidden><div id="traceOriginalEmpty" class="trace-empty"><strong>Mulai dari sebuah gambar</strong><p>Pilih atau tarik gambar ke sini.<br>Hasil vektor akan tampil di sebelahnya.</p></div></div></div></section>
          <section class="trace-pane"><header><h2>Hasil tracing</h2><span>SVG</span></header><div class="trace-stage" id="traceStageOutput"><div class="trace-stage-inner"><img id="traceOutput" alt="Hasil tracing vektor" draggable="false" hidden><div id="traceOutputEmpty" class="trace-empty"><strong>Pratinjau vektor</strong><p>Sesuaikan warna dan detail,<br>lalu pilih Mulai tracing.</p></div></div></div></section>
        </div>
        <div class="trace-result-bar"><div id="tracePalette" class="trace-palette" aria-label="Palet hasil"></div><span id="traceStats">Hasil SVG akan berisi path vektor.</span></div>
        <div class="trace-progress"><progress id="traceProgress" max="100" value="0" hidden aria-label="Progres tracing"></progress><p id="traceStatus" role="status" aria-live="polite">Siap menerima gambar.</p></div>
      </div>
    </div>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const fileInput = $<HTMLInputElement>('traceFile');
  const original = $<HTMLImageElement>('traceOriginal'), output = $<HTMLImageElement>('traceOutput');
  const stageOriginal = $<HTMLElement>('traceStageOriginal'), stageOutput = $<HTMLElement>('traceStageOutput');
  const run = $<HTMLButtonElement>('traceRun'), cancel = $<HTMLButtonElement>('traceCancel'), download = $<HTMLButtonElement>('traceDownload');
  const settings = $<HTMLFieldSetElement>('traceSettings'), progress = $<HTMLProgressElement>('traceProgress');
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
  const stop = () => { worker?.terminate(); worker = null; generation++; settings.disabled = loading; cancel.hidden = true; progress.hidden = true; run.disabled = !source || loading; root.setAttribute('aria-busy', String(loading)); };
  const invalidate = () => {
    stop(); result = null; download.disabled = true;
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null; output.removeAttribute('src'); output.hidden = true; $('traceOutputEmpty').hidden = false;
    $('tracePalette').replaceChildren(); $('traceStats').textContent = 'Hasil SVG akan berisi path vektor.';
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
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { status('Pilih file PNG, JPG, atau WebP.', true); return; }
    if (file.size > 20 * 1024 * 1024) { status('Ukuran file melebihi 20 MB.', true); return; }
    const version = ++sourceGeneration;
    loading = true;
    invalidate(); run.disabled = true; status('Membuka gambar…');
    const url = URL.createObjectURL(file), image = new Image();
    image.src = url;
    try {
      await image.decode();
      if (version !== sourceGeneration) { URL.revokeObjectURL(url); return; }
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 64000000) throw new Error('Gambar terlalu besar. Gunakan gambar di bawah 64 megapiksel.');
      if (source) URL.revokeObjectURL(source.url);
      source = { file, image, url };
      original.src = url; original.hidden = false; $('traceOriginalEmpty').hidden = true;
      $('traceFileInfo').textContent = file.name;
      $('traceDimensions').textContent = `${image.naturalWidth} × ${image.naturalHeight} px`;
      loading = false; settings.disabled = false; root.setAttribute('aria-busy', 'false');
      currentZoom = 100; applyZoom(100); run.disabled = false;
      status('Gambar siap. Sesuaikan pengaturan lalu mulai tracing.');
    } catch (error) {
      URL.revokeObjectURL(url);
      if (version === sourceGeneration) { loading = false; stop(); status(error instanceof Error ? error.message : 'Gambar tidak dapat dibuka.', true); }
    }
  };
  $('traceUpload').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) void load(file); fileInput.value = ''; });
  const dropZone = $('traceDropZone');
  dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('trace-dragging'); });
  dropZone.addEventListener('dragleave', event => { if (!dropZone.contains(event.relatedTarget as Node | null)) dropZone.classList.remove('trace-dragging'); });
  dropZone.addEventListener('drop', event => { event.preventDefault(); dropZone.classList.remove('trace-dragging'); const file = event.dataTransfer?.files[0]; if (file) void load(file); });
  settings.addEventListener('input', () => {
    $('traceColorsValue').textContent = $<HTMLInputElement>('traceColors').value;
    invalidate(); if (source) status('Pengaturan berubah. Jalankan tracing untuk memperbarui hasil.');
  });
  cancel.addEventListener('click', () => { stop(); status('Tracing dibatalkan. Gambar tetap siap diproses.'); });
  run.addEventListener('click', () => {
    if (!source || loading) return;
    invalidate();
    const image = source.image, limit = Number($<HTMLSelectElement>('traceResolution').value);
    const ratio = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * ratio)), height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const options: TraceOptions = {
      colors: Number($<HTMLInputElement>('traceColors').value), tolerance: Number($<HTMLSelectElement>('traceDetail').value),
      minArea: Number($<HTMLSelectElement>('traceNoise').value), smooth: $<HTMLInputElement>('traceSmooth').checked, removeWhite: $<HTMLInputElement>('traceWhite').checked,
    };
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) { status('Perangkat tidak dapat menyiapkan raster gambar.', true); return; }
    ctx.drawImage(image, 0, 0, width, height);
    const id = generation, started = performance.now();
    try {
      const pixels = ctx.getImageData(0, 0, width, height).data;
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      settings.disabled = true; run.disabled = true; cancel.hidden = false; progress.hidden = false; progress.value = 0; root.setAttribute('aria-busy', 'true');
      status('Menyiapkan tracing…');
      worker.onmessage = (event: MessageEvent) => {
        if (id !== generation) return;
        if (event.data.type === 'progress') { progress.value = event.data.value; status(event.data.label); return; }
        if (event.data.type === 'error') { stop(); status(event.data.message, true); return; }
        result = event.data.result as TraceResult;
        // Keep original document size while geometry uses the bounded working raster.
        result.svg = result.svg.replace(`width="${width}" height="${height}"`, `width="${image.naturalWidth}" height="${image.naturalHeight}"`);
        resultUrl = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
        output.src = resultUrl; output.hidden = false; $('traceOutputEmpty').hidden = true;
        $('tracePalette').replaceChildren(...result.colors.map(color => { const swatch = document.createElement('span'); swatch.style.background = color; swatch.title = color; swatch.setAttribute('aria-label', color); return swatch; }));
        $('traceStats').textContent = `${result.colors.length} warna · ${result.contours} kontur · ${result.segments} segmen · ${((performance.now() - started) / 1000).toFixed(1)} dtk`;
        stop(); download.disabled = saving;
        status(`Selesai. Resolusi proses ${width} × ${height} px; SVG mempertahankan ukuran gambar asli.`);
      };
      worker.onerror = () => { if (id === generation) { stop(); status('Tracing gagal dijalankan. Coba resolusi lebih kecil.', true); } };
      worker.postMessage({ pixels: pixels.buffer, width, height, options }, [pixels.buffer]);
    } catch (error) { stop(); status(error instanceof Error ? error.message : 'Tracing gagal.', true); }
  });
  download.addEventListener('click', async () => {
    if (!result || !source || saving) return;
    saving = true; download.disabled = true;
    const filename = source.file.name.replace(/\.[^.]+$/, '') + '-traced.svg';
    try {
      if (isTauri()) {
        const path = await invoke<string>('save_tracing_svg', { svg: result.svg, filename });
        status(`SVG disimpan: ${path}`);
      } else {
        const url = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000); status('SVG berhasil diunduh.');
      }
    } catch (error) { status(`Gagal menyimpan SVG: ${error instanceof Error ? error.message : String(error)}`, true); }
    finally { saving = false; download.disabled = !result; }
  });
  window.addEventListener('beforeunload', () => {
    stop();
    window.removeEventListener('resize', onWindowResize);
    if (source) URL.revokeObjectURL(source.url);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
  });
}
