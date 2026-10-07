import { autoWhitePreference } from './auto-white';
import type { BatchItem, BatchOutput, BatchConfig } from './batch';
const aborted = () => new DOMException('Tracing dibatalkan.','AbortError');
type TraceWorker = Pick<Worker,'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;
export function runTraceWorker(pixels: Uint8ClampedArray, width: number, height: number, config: BatchConfig, sourceWidth: number, sourceHeight: number, signal: AbortSignal, progress: (value: number,label: string) => void, createWorker: () => TraceWorker = () => new Worker(new URL('./worker.ts',import.meta.url),{type:'module'})): Promise<BatchOutput> {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve,reject) => {
    const worker = createWorker();let settled = false;
    const cleanup = () => { settled = true;worker.terminate();signal.removeEventListener('abort',cancel); };
    const cancel = () => {cleanup();reject(aborted());};signal.addEventListener('abort',cancel,{once:true});
    worker.onmessage = event => {
      if (settled || signal.aborted) return;
      const message = event.data;
      if (message.type === 'progress') progress(message.value,message.label);
      else if (message.type === 'error') {cleanup();reject(new Error(message.message));}
      else if (message.type === 'result') {
        cleanup();const result = message.result;
        if (result.svg.length > 2_000_000) {reject(new Error('SVG batch terlalu besar (maksimum 2 MB).'));return;}
        result.svg = result.svg.replace(`width="${result.width}" height="${result.height}"`,`width="${sourceWidth}" height="${sourceHeight}"`);
        resolve({result,auto:message.auto});
      }
    };
    worker.onerror = () => {if (settled) return;cleanup();reject(new Error('Worker tracing gagal dijalankan.'));};
    try {worker.postMessage({pixels:pixels.buffer,width,height,options:config.options,mode:config.mode,sourceSide:Math.max(sourceWidth,sourceHeight),defaultWhite:autoWhitePreference()},[pixels.buffer]);}
    catch (error) {cleanup();reject(error);}
  });
}
export async function traceBatchFile(item: BatchItem, signal: AbortSignal, progress: (value: number,label: string) => void): Promise<BatchOutput> {
  if (signal.aborted) throw aborted();
  const url = URL.createObjectURL(item.file), image = new Image(); image.src = url;
  let cancelDecode: () => void = () => {};
  try {
    await Promise.race([image.decode(),new Promise<never>((_resolve,reject) => {cancelDecode = () => reject(aborted());signal.addEventListener('abort',cancelDecode,{once:true});})]);
    signal.removeEventListener('abort',cancelDecode);if (signal.aborted) throw aborted();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 64000000) throw new Error('Gunakan gambar di bawah 64 megapiksel.');
    const limit = item.config.mode === 'auto' ? 2048 : item.config.resolution, ratio = Math.min(1,limit / Math.max(image.naturalWidth,image.naturalHeight));
    const canvas = document.createElement('canvas');canvas.width = Math.max(1,Math.round(image.naturalWidth * ratio));canvas.height = Math.max(1,Math.round(image.naturalHeight * ratio));
    const ctx = canvas.getContext('2d',{willReadFrequently:true});if (!ctx) throw new Error('Raster gambar tidak dapat disiapkan.');
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const width = canvas.width,height = canvas.height,pixels = ctx.getImageData(0,0,width,height).data;canvas.width = canvas.height = 0;
    return await runTraceWorker(pixels,width,height,item.config,image.naturalWidth,image.naturalHeight,signal,progress);
  } finally {signal.removeEventListener('abort',cancelDecode);image.src = '';URL.revokeObjectURL(url);}
}
