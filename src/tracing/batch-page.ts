import { exportSource, onlineExportSettings, exportDefaults, type GlobalExportSettings } from './export-settings';
import { renderExport } from './export-render';
import { checkStockSize } from './stock-export';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { TraceBatch, batchEntries, loadBatch, saveBatch, type BatchConfig, type BatchItem } from './batch';
import { batchZip } from './batch-zip';
import { traceBatchFile } from './file-task';
import { rasterThumbnail } from './thumbnail';

const icon = (paths: string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const galleryIcon = icon('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>');
const listIcon = icon('<path d="M9 6h12M9 12h12M9 18h12"/><path d="M3 6h1M3 12h1M3 18h1"/>');
const imageIcon = icon('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>');
const statusNames = { pending: 'Menunggu', processing: 'Diproses', success: 'Selesai', error: 'Gagal' };
const fileSize = (size: number) => size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;

interface GalleryRow {
  element: HTMLElement;
  source?: string;
  vector?: string;
  svg?: string;
  disposed: boolean;
}

export function initTracingBatch(root: HTMLElement, config: () => BatchConfig, preview: (item: BatchItem) => Promise<void>, busy: (running: boolean) => void, itemChanged: (items: BatchItem[]) => void = () => { }, added: () => void = () => { }, exportSettings: () => GlobalExportSettings = () => ({ ...exportDefaults })) {
  root.innerHTML = `<div class="trace-batch-heading-row">
    <div class="trace-batch-heading"><h2>Daftar gambar</h2><span id="traceBatchCount">Memulihkan antrean…</span><span class="trace-batch-limit">50 gambar / 200 MB</span></div>
    <p id="traceBatchStorage" class="trace-help" role="status"></p>
  </div>
  <div class="trace-batch-actions">
    <button type="button" id="traceBatchAdd">${icon('<path d="M12 5v14M5 12h14"/>')}<span>Tambah gambar</span></button>
    <button type="button" id="traceBatchRun" class="primary">${icon('<path d="m9 5 11 7-11 7V5Z"/>')}<span>Convert</span></button>
    <button type="button" id="traceBatchCancel" class="trace-button-quiet" hidden>${icon('<path d="M18 6 6 18M6 6l12 12"/>')}<span>Batalkan</span></button>
    <div class="trace-batch-export-wrap">
      <div class="trace-split-btn">
        <button type="button" id="traceBatchExport" class="trace-button-tonal" title="Ekspor ZIP">${icon('<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>')}<span>Ekspor ZIP</span></button>
        <button type="button" id="traceBatchExportToggle" class="trace-button-tonal trace-dropdown-toggle" aria-haspopup="true" aria-expanded="false" title="Pilih format ZIP (SVG / EPS)">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
      </div>
      <div id="traceBatchExportMenu" class="trace-export-menu" hidden role="menu" aria-label="Format ekspor ZIP">
        <button type="button" id="traceBatchExportSvg" class="trace-export-menu-item" role="menuitem">
          <span class="menu-item-badge svg">SVG</span>
          <span class="trace-menu-text">
            <strong>ZIP SVG</strong>
            <small>Ekspor semua hasil sebagai .svg</small>
          </span>
        </button>
        <button type="button" id="traceBatchExportEps" class="trace-export-menu-item" role="menuitem">
          <span class="menu-item-badge eps">EPS</span>
          <span class="trace-menu-text">
            <strong>ZIP EPS</strong>
            <small>Ekspor semua hasil sebagai .eps</small>
          </span>
        </button>
      </div>
    </div>
    <button type="button" id="traceBatchClear" class="trace-button-quiet">${icon('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>')}<span>Semua</span></button>
  </div>
  <div class="trace-library-controls">
    <div id="traceBatchFilters" class="trace-filter-group" role="group" aria-label="Filter status gambar">
      <button type="button" data-filter="all" aria-pressed="true">Semua <span>0</span></button>
      <button type="button" data-filter="pending" aria-pressed="false"><i class="trace-status-dot"></i>Menunggu <span>0</span></button>
      <button type="button" data-filter="success" aria-pressed="false"><i class="trace-status-dot"></i>Selesai <span>0</span></button>
      <button type="button" data-filter="error" aria-pressed="false"><i class="trace-status-dot"></i>Gagal <span>0</span></button>
    </div>
    <label class="trace-batch-search">${icon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>')}<span class="trace-sr">Cari nama gambar</span><input id="traceBatchSearch" type="search" placeholder="Cari gambar…" autocomplete="off"></label>
  </div>
  <div class="trace-library-display">
    <span id="traceVisibleCount" class="trace-help" aria-live="polite">Buka gambar untuk mengatur tracing.</span>
    <div class="trace-display-controls">
      <div class="trace-segmented" role="group" aria-label="Thumbnail yang ditampilkan">
        <button type="button" id="tracePreviewSource" aria-pressed="true">Asli</button>
        <button type="button" id="tracePreviewVector" aria-pressed="false">Hasil Vektor</button>
      </div>
      <div class="trace-segmented trace-view-options" role="group" aria-label="Tampilan gambar">
        <button type="button" id="traceListView" aria-label="Tampilan daftar" title="Daftar" aria-pressed="true">${listIcon}</button>
        <button type="button" id="traceGridView" aria-label="Tampilan kartu" title="Kartu" aria-pressed="false">${galleryIcon}</button>
      </div>
    </div>
  </div>
  <input id="traceBatchFiles" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>
  <div id="traceBatchEmpty" class="trace-batch-empty">
    <div class="trace-batch-empty-icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
    </div>
    <strong>Tambahkan gambar</strong>
    <p>Tarik file ke sini atau pilih dari komputer.<br>PNG, JPG, WebP · maks. 20 MB per gambar</p>
    <div class="trace-batch-empty-actions">
      <button type="button" class="trace-batch-empty-cta" id="traceBatchEmptyPick">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
        <span>Pilih gambar</span>
      </button>
      <button type="button" class="trace-batch-empty-sample" id="traceBatchEmptySample">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <span>Gunakan contoh</span>
      </button>
    </div>
  </div>
  <div id="traceBatchNoResults" class="trace-no-results" hidden>${icon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>')}<strong>Tidak ada gambar yang cocok</strong><button type="button" id="traceResetFilters">Hapus filter</button></div>
  <div id="traceBatchItems" class="trace-batch-items" data-layout="list" data-preview="source" role="list" aria-label="Antrean tracing" hidden></div>
  <div id="traceBatchDropHint" class="trace-drop-hint" hidden>${icon('<path d="M12 16V3m-4 4 4-4 4 4M4 16v5h16v-5"/>')}<span>Tarik gambar untuk menambah ke daftar</span></div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const files = $<HTMLInputElement>('traceBatchFiles'), add = $<HTMLButtonElement>('traceBatchAdd'), run = $<HTMLButtonElement>('traceBatchRun'), cancel = $<HTMLButtonElement>('traceBatchCancel'), exportButton = $<HTMLButtonElement>('traceBatchExport'), exportToggle = $<HTMLButtonElement>('traceBatchExportToggle'), exportMenu = $<HTMLElement>('traceBatchExportMenu'), exportSvg = $<HTMLButtonElement>('traceBatchExportSvg'), exportEps = $<HTMLButtonElement>('traceBatchExportEps'), clear = $<HTMLButtonElement>('traceBatchClear');
  const emptyZone = $<HTMLElement>('traceBatchEmpty');
  const pickBtn = $<HTMLButtonElement>('traceBatchEmptyPick');
  const sampleBtn = $<HTMLButtonElement>('traceBatchEmptySample');
  const itemsContainer = $<HTMLElement>('traceBatchItems');
  const search = $<HTMLInputElement>('traceBatchSearch');
  let filter = 'all', layout = 'list', previewKind = 'source';
  try { layout = localStorage.getItem('cvr-tracing-gallery-layout') === 'grid' ? 'grid' : 'list'; } catch { /* Host storage may be unavailable. */ }

  let restoring = true, saving = false, viewing = false, revision = 0;
  const rows = new Map<string, GalleryRow>();
  let thumbnailWork = Promise.resolve();
  const dispose = (row: GalleryRow) => {
    row.disposed = true;
    if (row.source) URL.revokeObjectURL(row.source);
    if (row.vector) URL.revokeObjectURL(row.vector);
    row.element.querySelectorAll('img').forEach(image => image.removeAttribute('src'));
  };
  const note = (message: string) => { $('traceBatchStorage').textContent = message; };

  pickBtn.addEventListener('click', e => { e.stopPropagation(); if (!files.disabled) files.click(); });
  emptyZone.addEventListener('click', event => {
    if (files.disabled || (event.target as HTMLElement).closest('button')) return;
    files.click();
  });
  emptyZone.addEventListener('dragover', event => { event.preventDefault(); emptyZone.classList.add('is-dragover'); });
  emptyZone.addEventListener('dragleave', () => emptyZone.classList.remove('is-dragover'));
  emptyZone.addEventListener('drop', event => {
    event.preventDefault();
    event.stopPropagation();
    emptyZone.classList.remove('is-dragover');
    root.classList.remove('trace-library-dragging');
    addFiles(Array.from(event.dataTransfer?.files ?? []));
  });

  sampleBtn.addEventListener('click', event => {
    event.stopPropagation();
    if (sampleBtn.disabled) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 400, 400);

      // Outer emblem circle
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.arc(200, 200, 150, 0, Math.PI * 2);
      ctx.fill();

      // Inner cyan ring
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(200, 200, 110, 0, Math.PI * 2);
      ctx.fill();

      // Amber center core
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(200, 200, 65, 0, Math.PI * 2);
      ctx.fill();

      // White center cutout
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(200, 200, 25, 0, Math.PI * 2);
      ctx.fill();

      canvas.toBlob(blob => {
        if (!blob) return;
        const sampleFile = new File([blob], 'sample-vector-emblem.png', { type: 'image/png' });
        addFiles([sampleFile]);
      }, 'image/png');
    } catch {
      // Ignore
    }
  });

  const createRow = (item: BatchItem): GalleryRow => {
    const element = document.createElement('article'); element.className = 'trace-batch-item'; element.setAttribute('role', 'listitem'); element.dataset.itemId = item.id;
    element.innerHTML = `<button type="button" class="trace-batch-thumbnail">
      <span class="trace-preview-source"><img class="trace-source-image" alt="" loading="lazy" decoding="async" hidden><span class="trace-thumb-placeholder">${imageIcon}<span>Memuat…</span></span></span>
      <span class="trace-preview-vector" hidden><img class="trace-vector-image" alt="" loading="lazy" decoding="async" hidden><span class="trace-vector-placeholder">${icon('<path d="M4 5h16v14H4zM4 5l16 14M20 5 4 19"/>')}<span>Belum diproses</span></span></span>
      <span class="trace-thumb-tag">ASLI</span><span class="trace-thumb-open">${icon('<path d="M7 17 17 7M7 7h10v10"/>')}<span>Buka editor</span></span>
    </button>
    <div class="trace-batch-body">
      <div class="trace-item-topline"><span class="trace-file-type"></span><span class="trace-item-status"></span></div>
      <button type="button" class="trace-batch-name"></button>
      <div class="trace-item-meta"><span class="trace-file-size"></span><span class="trace-item-settings"></span></div>
      <p class="trace-row-message" hidden></p>
      <progress max="100" hidden></progress>
      <div class="trace-item-result" hidden><div class="trace-item-palette" aria-label="Warna hasil vektor"></div><span class="trace-item-contours"></span></div>
    </div>
    <div class="trace-batch-actions">
      <button type="button" class="trace-open-item trace-button-tonal"><span>Buka editor</span>${icon('<path d="m9 5 7 7-7 7"/>')}</button>
      <button type="button" class="trace-retry-item" hidden>${icon('<path d="M3 11a9 9 0 1 1 3 7M3 4v7h7"/>')}<span>Coba ulang</span></button>
      <button type="button" class="trace-remove-item trace-icon-button">${icon('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>')}</button>
    </div>`;
    const row: GalleryRow = { element, disposed: false };
    const title = element.querySelector<HTMLButtonElement>('.trace-batch-name')!;
    title.textContent = item.file.name; title.title = item.file.name;
    const thumb = element.querySelector<HTMLButtonElement>('.trace-batch-thumbnail')!;
    thumb.setAttribute('aria-label', `Buka editor ${item.file.name}`);
    element.querySelector('.trace-file-type')!.textContent = item.file.type === 'image/jpeg' ? 'JPG' : item.file.type === 'image/webp' ? 'WEBP' : 'PNG';
    element.querySelector('.trace-file-size')!.textContent = fileSize(item.file.size);
    const open = () => {
      if (queue.running || restoring || saving || viewing) return;
      viewing = true; render(); void preview(item).catch(error => note(String(error))).finally(() => { viewing = false; render(); });
    };
    title.addEventListener('click', open); thumb.addEventListener('click', open); element.querySelector('.trace-open-item')!.addEventListener('click', open);
    element.addEventListener('click', event => { if (!(event.target as HTMLElement).closest('button')) open(); });
    element.querySelector('.trace-retry-item')!.addEventListener('click', () => queue.retry(item.id));
    const remove = element.querySelector<HTMLButtonElement>('.trace-remove-item')!; remove.title = 'Hapus gambar'; remove.setAttribute('aria-label', `Hapus ${item.file.name}`); remove.addEventListener('click', () => queue.remove(item.id));
    element.querySelector('progress')!.setAttribute('aria-label', `Progres ${item.file.name}`);
    const sourceImage = element.querySelector<HTMLImageElement>('.trace-source-image')!;
    const placeholder = element.querySelector<HTMLElement>('.trace-thumb-placeholder')!;
    const unavailable = () => { sourceImage.hidden = true; placeholder.hidden = false; placeholder.lastElementChild!.textContent = 'Pratinjau tidak tersedia'; };
    sourceImage.addEventListener('error', unavailable);
    thumbnailWork = thumbnailWork.then(async () => {
      if (row.disposed) return;
      try {
        const blob = await rasterThumbnail(item.file);
        if (row.disposed) return;
        row.source = URL.createObjectURL(blob); sourceImage.src = row.source; sourceImage.hidden = false; placeholder.hidden = true;
      } catch { if (!row.disposed) unavailable(); }
    });
    itemsContainer.append(element); return row;
  };
  const render = () => {
    const locked = queue.running || restoring || saving || viewing;
    add.disabled = clear.disabled = files.disabled = pickBtn.disabled = sampleBtn.disabled = locked;
    clear.disabled ||= !queue.items.length;
    const pending = queue.items.filter(item => item.status === 'pending' || item.status === 'processing').length;
    const success = queue.items.filter(item => item.status === 'success').length, error = queue.items.filter(item => item.status === 'error').length;
    run.disabled = locked || !queue.items.some(item => item.status === 'pending'); exportButton.disabled = exportToggle.disabled = locked || !success; cancel.hidden = !queue.running;
    $('traceBatchCount').textContent = restoring ? 'Memulihkan antrean…' : `${queue.items.length} gambar`;
    const counts: Record<string, number> = { all: queue.items.length, pending, success, error };
    root.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.filter === filter)); button.querySelector('span')!.textContent = String(counts[button.dataset.filter!]); });
    const hasItems = queue.items.length > 0;
    emptyZone.hidden = hasItems || restoring; $('traceBatchDropHint').hidden = !hasItems;
    itemsContainer.dataset.layout = layout; itemsContainer.dataset.preview = previewKind;
    $('traceListView').setAttribute('aria-pressed', String(layout === 'list')); $('traceGridView').setAttribute('aria-pressed', String(layout === 'grid'));
    $('tracePreviewSource').setAttribute('aria-pressed', String(previewKind === 'source')); $('tracePreviewVector').setAttribute('aria-pressed', String(previewKind === 'vector'));
    const ids = new Set(queue.items.map(item => item.id));
    for (const [id, row] of rows) if (!ids.has(id)) { dispose(row); row.element.remove(); rows.delete(id); }
    let visible = 0;
    const query = search.value.trim().toLocaleLowerCase();
    for (const item of queue.items) {
      let entry = rows.get(item.id); if (!entry) { entry = createRow(item); rows.set(item.id, entry); }
      const row = entry.element;
      row.hidden = !(item.file.name.toLocaleLowerCase().includes(query) && (filter === 'all' || filter === 'pending' && (item.status === 'pending' || item.status === 'processing') || item.status === filter));
      if (!row.hidden) visible++;
      row.dataset.status = item.status;
      const badge = row.querySelector<HTMLElement>('.trace-item-status')!; badge.textContent = statusNames[item.status] + (item.status === 'processing' ? ` ${Math.round(item.progress)}%` : '');
      const applied = item.output?.auto;
      row.querySelector('.trace-item-settings')!.textContent = `${item.config.mode === 'auto' ? 'Auto' : 'Manual'} · ${applied?.options.colors ?? item.config.options.colors} warna · ${applied?.resolution ?? item.config.resolution} px`;
      const message = row.querySelector<HTMLElement>('.trace-row-message')!;
      message.textContent = item.error ?? (item.status === 'processing' ? item.label : item.label === 'Dibatalkan' ? item.label : applied && applied.fallback !== 'none' ? 'Pengaturan Auto disesuaikan pada hasil akhir.' : ''); message.hidden = !message.textContent;
      const bar = row.querySelector('progress')!; bar.value = item.progress; bar.hidden = item.status !== 'processing';
      const svg = item.output?.result.svg;
      if (entry.svg !== svg) {
        if (entry.vector) URL.revokeObjectURL(entry.vector); entry.vector = undefined; entry.svg = svg;
        const image = row.querySelector<HTMLImageElement>('.trace-vector-image')!; image.removeAttribute('src'); image.hidden = !svg;
        if (svg) { entry.vector = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); image.src = entry.vector; }
        const palette = row.querySelector<HTMLElement>('.trace-item-palette')!;
        palette.replaceChildren(...(item.output?.result.colors ?? []).map(color => { const swatch = document.createElement('span'); swatch.style.backgroundColor = color; swatch.title = color; swatch.setAttribute('aria-label', color); return swatch; }));
        row.querySelector('.trace-item-contours')!.textContent = item.output ? `${item.output.result.contours} kontur · Vektor ${fileSize(new Blob([svg!]).size)}` : '';
      }
      row.querySelector<HTMLElement>('.trace-item-result')!.hidden = !svg;
      row.querySelector<HTMLElement>('.trace-vector-placeholder')!.hidden = !!svg;
      row.querySelector<HTMLElement>('.trace-preview-source')!.hidden = previewKind !== 'source'; row.querySelector<HTMLElement>('.trace-preview-vector')!.hidden = previewKind !== 'vector';
      row.querySelector('.trace-thumb-tag')!.textContent = previewKind === 'source' ? 'ASLI' : 'VEKTOR';
      row.querySelectorAll('button').forEach(button => { button.disabled = locked; }); row.querySelector<HTMLElement>('.trace-retry-item')!.hidden = item.status !== 'error';
    }
    itemsContainer.hidden = !visible;
    $('traceBatchNoResults').hidden = !hasItems || !!visible;
    $('traceVisibleCount').textContent = hasItems ? `${visible} dari ${queue.items.length} gambar · klik thumbnail untuk membuka` : 'Buka gambar untuk mengatur tracing.';
  };
  const queue = new TraceBatch(checkpoint => {
    render(); itemChanged(queue.items); if (!checkpoint) return;
    const current = ++revision; note('Menyimpan antrean…'); void saveBatch(queue.items).then(() => { if (current === revision) note('Antrean dan hasil tersimpan lokal.'); }).catch(error => { if (current === revision) note(`Antrean belum tersimpan: ${error instanceof Error ? error.message : String(error)}. Hasil tetap dapat diekspor pada sesi ini.`); });
  });
  $('traceBatchFilters').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-filter]');
    if (button) { filter = button.dataset.filter!; render(); }
  });
  search.addEventListener('input', render);
  const setLayout = (value: 'list' | 'grid') => {
    layout = value; try { localStorage.setItem('cvr-tracing-gallery-layout', value); } catch { /* Host storage may be unavailable. */ }
    render();
  };
  $('traceListView').addEventListener('click', () => setLayout('list'));
  $('traceGridView').addEventListener('click', () => setLayout('grid'));
  $('tracePreviewSource').addEventListener('click', () => { previewKind = 'source'; render(); });
  $('tracePreviewVector').addEventListener('click', () => { previewKind = 'vector'; render(); });
  $('traceResetFilters').addEventListener('click', () => { search.value = ''; filter = 'all'; render(); search.focus(); });
  add.addEventListener('click', () => files.click());
  const addFiles = (selected: File[]) => { if (restoring || saving || viewing) { note('Tunggu pemulihan atau penyimpanan antrean selesai.'); return; } try { queue.add(selected, config()); filter = 'all'; search.value = ''; render(); added(); } catch (error) { note(error instanceof Error ? error.message : String(error)); } };
  files.addEventListener('change', () => { addFiles(Array.from(files.files ?? [])); files.value = ''; });
  run.addEventListener('click', () => { if (queue.running || restoring || saving || viewing) return; busy(true); void queue.run(traceBatchFile).finally(() => { busy(false); render(); }); });
  cancel.addEventListener('click', () => queue.cancel()); clear.addEventListener('click', () => queue.remove());
  const exportBatch = (format: 'svg' | 'eps' = 'svg') => {
    if (queue.running || restoring || saving || viewing) return;
    let entries: ReturnType<typeof batchEntries>;
    try { entries = batchEntries(queue.items, format, false); } catch (error) { note(String(error)); return; }
    if (!entries.length) return;
    saving = true;
    render();
    void (async () => {
      try {
        const settings = exportSettings();
        const successful = queue.items.filter(item => item.status === 'success' && item.output);
        for (let i = 0; i < entries.length; i++) entries[i].svg = await exportSource(successful[i], settings);
        if (format === 'eps') {
          const payloadEntries: { filename: string; svg: string; bytes?: number[] }[] = [];
          const zipEntries: { filename: string; svg: string; bytes?: Uint8Array }[] = [];
          for (const entry of entries) {
            const stem = entry.filename.replace(/\.[^.]+$/, '');
            const epsBytes = new TextEncoder().encode(await renderExport(entry.svg, settings, 'eps', stem));
            checkStockSize(epsBytes);
            payloadEntries.push({ filename: entry.filename, svg: entry.svg, bytes: Array.from(epsBytes) });
            zipEntries.push({ filename: entry.filename, svg: entry.svg, bytes: epsBytes });
          }
          if (isTauri()) {
            const path = await invoke<string>('save_tracing_batch', { entries: payloadEntries });
            note(`ZIP hasil disimpan: ${path}. Ekstrak SVG/EPS sebelum upload ke Adobe Stock.`);
          } else {
            const bytes = batchZip(zipEntries);
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `tracing-batch-eps.zip`;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            note(`${entries.length} file EPS diekspor dalam ZIP. Ekstrak sebelum upload ke Adobe Stock.`);
          }
        } else {
          if (isTauri()) {
            const path = await invoke<string>('save_tracing_batch', { entries: entries.map(entry => ({ ...entry, settings: onlineExportSettings(settings) })) });
            note(`ZIP hasil disimpan: ${path}. Ekstrak SVG/EPS sebelum upload ke Adobe Stock.`);
          } else {
            for (const entry of entries) entry.svg = await renderExport(entry.svg, settings, 'svg', entry.filename);
            const bytes = batchZip(entries);
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `tracing-batch-svg.zip`;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            note(`${entries.length} file SVG diekspor dalam ZIP. Ekstrak sebelum upload ke Adobe Stock.`);
          }
        }
      } catch (error) {
        note(`Ekspor gagal: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        saving = false;
        render();
      }
    })();
  };
  const toggleBatchMenu = (e?: Event) => {
    e?.stopPropagation();
    if (exportButton.disabled) return;
    exportMenu.hidden = !exportMenu.hidden;
    exportToggle.setAttribute('aria-expanded', String(!exportMenu.hidden));
  };
  exportButton.addEventListener('click', toggleBatchMenu);
  exportToggle.addEventListener('click', toggleBatchMenu);
  exportSvg.addEventListener('click', () => {
    exportMenu.hidden = true;
    exportToggle.setAttribute('aria-expanded', 'false');
    exportBatch('svg');
  });
  exportEps.addEventListener('click', () => {
    exportMenu.hidden = true;
    exportToggle.setAttribute('aria-expanded', 'false');
    exportBatch('eps');
  });
  root.addEventListener('click', e => {
    if (!(e.target as HTMLElement).closest('.trace-batch-export-wrap')) {
      if (!exportMenu.hidden) {
        exportMenu.hidden = true;
        exportToggle.setAttribute('aria-expanded', 'false');
      }
    }
  });
  render();
  void loadBatch().then(items => { queue.items = items; }).catch(error => note(`Antrean tidak dapat dipulihkan: ${String(error)}`)).finally(() => { restoring = false; render(); });
  window.addEventListener('beforeunload', () => { queue.cancel(); rows.forEach(dispose); });
  return {
    get running() { return queue.running; }, resetAutoSettings: () => queue.resetAutoSettings(), cancel: () => queue.cancel(), addFiles,
    item: (id: string) => queue.items.find(item => item.id === id),
    updateConfig: (id: string, value: BatchConfig) => queue.updateConfig(id, value),
    setDetected: (id: string, value: Parameters<TraceBatch['setDetected']>[1]) => queue.setDetected(id, value),
    switchMode: (id: string, mode: 'auto' | 'manual') => queue.switchMode(id, mode),
    runItem: (id: string) => {
      if (queue.running || restoring || saving || viewing || !queue.items.some(item => item.id === id)) return;
      queue.retry(id); busy(true); void queue.run(traceBatchFile, [id]).finally(() => { busy(false); render(); });
    }
  };
}
