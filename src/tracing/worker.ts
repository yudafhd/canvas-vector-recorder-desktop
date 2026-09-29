import { traceRaster, type TraceOptions } from './engine';

self.onmessage = (event: MessageEvent<{ pixels: ArrayBuffer; width: number; height: number; options: TraceOptions }>) => {
  try {
    const { pixels, width, height, options } = event.data;
    const result = traceRaster(new Uint8ClampedArray(pixels), width, height, options, (value, label) => self.postMessage({ type: 'progress', value, label }));
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
