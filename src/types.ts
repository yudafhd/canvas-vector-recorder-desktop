export type Ratio = 'source' | '1:1' | '4:5' | '4:3' | '3:2' | '2:3' | '16:9' | (string & {});

export interface MicrostockSettings {
  profile: 'adobe-stock' | 'custom';
  minPixels: number;
  maxPixels: number;
  ratio: Ratio;
  backgroundColor: string;
  transparentBackground: boolean;
  artworkScale: number;
}

export interface CanvasDetection {
  canvas_id: string;
  width: number;
  height: number;
  revision: number;
  shapes: number;
  gap_fillers: number;
  errors: number;
  state: string;
}

export interface SvgAsset {
  svg_id: string;
  width: number;
  height: number;
  shapes: number;
  filename: string;
  markup: string;
  revision: number;
}

export interface SvgStats {
  shapes: number;
  gap_fillers: number;
  errors: number;
  artboard: { width: number; height: number; pixels: number; ratio: string };
  stock_validation: { valid: boolean; unsupported_fills: number; unsupported_strokes: number; has_strokes: boolean };
}

export interface SvgResult {
  svg: string;
  filename: string;
  stats: SvgStats;
  error?: string;
}

export interface LicenseStatus {
  valid: boolean;
  activated: boolean;
  product?: string;
  email?: string;
  license_id?: string;
  activation_expires_at?: string;
  expires_at?: string;
  perpetual: boolean;
  device_bound: boolean;
  activated_at?: string;
  last_validated_at?: string;
  message?: string;
}

export interface StartRecordingResult { session_id: string; target_capability: string; }

export interface TargetTabInfo {
  id: string;
  url: string;
  title: string;
}

export interface TargetTabsState {
  active_id: string | null;
  tabs: TargetTabInfo[];
}
