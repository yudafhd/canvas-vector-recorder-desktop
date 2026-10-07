import type { TraceOptions } from './engine';

export type WhiteMode = NonNullable<TraceOptions['whiteMode']>;
const preferenceKey = 'cvr-auto-white-mode';
let sessionPreference: WhiteMode | undefined;
export function autoWhitePreference(): WhiteMode {
  if (sessionPreference) return sessionPreference;
  try { const mode = globalThis.localStorage?.getItem(preferenceKey); if (mode === 'none' || mode === 'all') return mode; } catch { /* Use the default if storage is unavailable. */ }
  return 'background';
}
export function saveAutoWhitePreference(mode: WhiteMode) {
  resolveAutoWhite(0, mode);
  sessionPreference = mode;
  try { globalThis.localStorage?.setItem(preferenceKey, mode); } catch { /* The current editor choice still applies. */ }
}
/** Port of AutoWhitePolicy: use artwork colors, not the requested palette limit. */
export function resolveAutoWhite(detectedColors: number, defaultMode: WhiteMode = 'background'): WhiteMode {
  if (defaultMode === 'none' || defaultMode === 'all') return defaultMode;
  if (defaultMode !== 'background') throw new Error('Default putih tidak valid.');
  return detectedColors === 2 ? 'all' : 'background';
}
