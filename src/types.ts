export type Ratio = 'source' | '1:1' | '4:5' | '4:3' | '3:2' | '2:3' | '16:9';

export interface MicrostockSettings {
  profile: 'adobe-stock' | 'custom';
  minPixels: number;
  maxPixels: number;
  ratio: Ratio;
}

export interface CanvasDetection {
  canvas_id: string;
  asset_type?: 'canvas' | 'svg';
  width: number;
  height: number;
  revision: number;
  shapes: number;
  gap_fillers: number;
  errors: number;
  state: string;
}

export interface SvgStats {
  shapes: number;
  gap_fillers: number;
  errors: number;
  artboard: { width: number; height: number; pixels: number; ratio: string };
  stock_validation: { valid: boolean; unsupported_fills: number; unsupported_strokes: number; has_strokes: boolean };
  asset_type?: 'canvas' | 'svg';
}

export interface SvgResult {
  svg: string;
  filename: string;
  stats: SvgStats;
  error?: string;
}

export interface LicenseStatus {
  valid: boolean;
  email?: string;
  license_id?: string;
  expires_at?: string;
  last_validated_at?: string;
  offline: boolean;
  perpetual: boolean;
  grace_remaining_days?: number;
  message?: string;
}

export interface StartRecordingResult { session_id: string; target_capability: string; }
