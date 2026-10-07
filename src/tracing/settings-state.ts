import type { TraceOptions } from './engine';

export interface AppliedSettings { options: TraceOptions; resolution: number }
const defaults: AppliedSettings = { options: { colors: 6, tolerance: .8, minArea: 4, smooth: true, removeWhite: false, whiteMode: 'none' }, resolution: 1024 };

export function restoreManualSettings(value: unknown): AppliedSettings {
  const settings = value as AppliedSettings | undefined, o = settings?.options;
  if (!o || !Number.isInteger(o.colors) || o.colors < 2 || o.colors > 16 || ![.2,.35,.8,1.6].includes(o.tolerance) || ![0,4,12,24].includes(o.minArea) || typeof o.smooth !== 'boolean' || typeof o.removeWhite !== 'boolean' || !['none','background','all'].includes(o.whiteMode ?? '') || ![512,1024,2048].includes(settings!.resolution)) return structuredClone(defaults);
  return { resolution: settings!.resolution, options: { colors: o.colors, tolerance: o.tolerance, minArea: o.minArea, smooth: o.smooth, whiteMode: o.whiteMode, removeWhite: o.whiteMode !== 'none' } };
}

/** Editor snapshots. The per-item queue applies Auto values on mode changes. */
export class TracingSettingsState {
  private manual: AppliedSettings;
  private automatic?: AppliedSettings;
  constructor(saved?: unknown) { this.manual = restoreManualSettings(saved); }
  get manualSettings() { return structuredClone(this.manual); }
  get autoSettings() { return this.automatic && structuredClone(this.automatic); }
  setManual(settings: AppliedSettings) { this.manual = restoreManualSettings(settings); }
  setAuto(settings?: AppliedSettings) { this.automatic = settings && structuredClone(settings); }
}
