import './mode-selection.css';

export type TracingMode = 'online' | 'offline';

export function initModeSelection(root: HTMLElement, select: (mode: TracingMode) => void, theme: () => void) {
  root.innerHTML = `
    <header class="mode-header">
      <span class="mode-brand">Canvas Vector Recorder</span>
      <button type="button" id="modeThemeToggle" class="mode-theme" aria-label="Ganti tema">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20.9 13.1A9 9 0 0 1 10.9 3.1 9 9 0 1 0 20.9 13.1Z"/></svg>
        <span>Tema</span>
      </button>
    </header>
    <div class="mode-content">
      <div class="mode-intro"><h1>Tracing</h1><p>Pilih sumber gambar.</p></div>
      <div class="mode-options" aria-label="Mode tracing">
        <button type="button" id="onlineTracingChoice" class="mode-card" disabled>
          <span class="mode-icon" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/></svg></span>
          <span class="mode-card-title">Tracing online</span>
          <span class="mode-card-description">Rekam Canvas dan SVG dari situs.</span>
          <span class="mode-card-action">Buka Recorder <span aria-hidden="true">→</span></span>
        </button>
        <button type="button" id="offlineTracingChoice" class="mode-card mode-card-offline" disabled>
          <span class="mode-icon" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg></span>
          <span class="mode-card-title">Tracing offline</span>
          <span class="mode-card-description">Ubah PNG, JPG, atau WebP menjadi SVG.</span>
          <span class="mode-card-action">Buka daftar gambar <span aria-hidden="true">→</span></span>
        </button>
      </div>
    </div>`;
  const online = root.querySelector<HTMLButtonElement>('#onlineTracingChoice')!;
  const offline = root.querySelector<HTMLButtonElement>('#offlineTracingChoice')!;
  online.addEventListener('click', () => { if (!online.disabled) select('online'); });
  offline.addEventListener('click', () => { if (!offline.disabled) select('offline'); });
  root.querySelector('#modeThemeToggle')!.addEventListener('click', theme);
  return { setEnabled: (enabled: boolean) => { online.disabled = offline.disabled = !enabled; } };
}
