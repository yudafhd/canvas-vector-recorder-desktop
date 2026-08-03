import { invoke } from '@tauri-apps/api/core';
import type { LicenseStatus } from './types';

export const licenseStatus = (): Promise<LicenseStatus> => invoke('get_license_status');
export const validateLicense = (email: string, licenseCode: string): Promise<LicenseStatus> =>
  invoke('validate_license', { email, licenseCode });
export const activateLicense = (email: string, licenseCode: string): Promise<LicenseStatus> =>
  invoke('activate_license', { email, licenseCode });

export function normalizedEmail(value: string): string { return value.trim().toLowerCase(); }
