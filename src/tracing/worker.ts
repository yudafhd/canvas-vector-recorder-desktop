import type { WhiteMode } from './auto-white';
import { traceRaster, type TraceOptions } from './engine';
import { traceAuto } from './auto-trace';
import { recommendAutoSettings } from './auto-settings';

self.onmessage = (event: MessageEvent<{ pixels: ArrayBuffer; width: number; height: number; options: TraceOptions; mode?: 'auto' | 'manual' | 'detect'; sourceSide?: number; defaultWhite?: WhiteMode }>) => {
  try {
    const { pixels, width, height, options, mode } = event.data;
    const progress = (value: number, label: string) => self.postMessage({ type: 'progress', value, label });
    if (mode === 'detect') {
      const recommendation = recommendAutoSettings(new Uint8ClampedArray(pixels), width, height, event.data.sourceSide, event.data.defaultWhite);
      self.postMessage({ type: 'auto-settings', recommendation });
    } else if (mode === 'auto') {
      const outcome = traceAuto(new Uint8ClampedArray(pixels), width, height, progress, recommendation => self.postMessage({ type: 'auto-settings', recommendation }), undefined, event.data.defaultWhite, event.data.sourceSide);
      self.postMessage({ type: 'result', ...outcome });
    } else {
      const result = traceRaster(new Uint8ClampedArray(pixels), width, height, options, progress);
      self.postMessage({ type: 'result', result });
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
