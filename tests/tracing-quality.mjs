// Local visual comparison, with real browser decoding and the production engine.
// Chrome must expose CDP on :9337. Does not require the Tauri app or a license mock.
// node tests/tracing-quality.mjs /path/input.jpg /path/artifacts [previous-engine.ts]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const [input, output = '/private/tmp/cvr-tracing-quality-run', baseline] = process.argv.slice(2);
if (!input) throw new Error('Provide an input PNG, JPEG, or WebP path.');
const mime = ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' })[extname(input).toLowerCase()];
if (!mime) throw new Error('Unsupported image extension.');
const bytes = await readFile(input), dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
await mkdir(output, { recursive: true });
const browser = await (await fetch('http://127.0.0.1:9337/json/version')).json();
const socket = new WebSocket(browser.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data), request = pending.get(message.id);
  if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); }
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 30000);
  pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
});
let targetId;
try {
  ({ targetId } = await send('Target.createTarget', { url: 'about:blank' }));
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const raster = await evaluate(`(async () => {
    const image = new Image(); image.src = ${JSON.stringify(dataUrl)}; await image.decode();
    const ratio = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let binary = ''; for (let i = 0; i < pixels.length; i += 8192) binary += String.fromCharCode(...pixels.subarray(i, i + 8192));
    return { width: canvas.width, height: canvas.height, originalWidth: image.naturalWidth, originalHeight: image.naturalHeight, pixels: btoa(binary) };
  })()`);
  const pixels = new Uint8ClampedArray(Buffer.from(raster.pixels, 'base64'));
  const options = { colors: 6, tolerance: 0.8, minArea: 4, smooth: true, removeWhite: false };
  const variants = [ ...(baseline ? [['before', baseline, options]] : []), ['balanced', 'src/tracing/engine.ts', options], ['detail', 'src/tracing/engine.ts', { ...options, tolerance: 0.35, minArea: 0 }], ['simple', 'src/tracing/engine.ts', { ...options, tolerance: 1.6 }], ['transparent', 'src/tracing/engine.ts', { ...options, removeWhite: true }] ];
  const panels = [{ name: 'Original', url: dataUrl }], results = [];
  for (const [name, modulePath, settings] of variants) {
    const source = await readFile(modulePath, 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const { traceRaster } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
    const start = performance.now(), result = traceRaster(pixels, raster.width, raster.height, settings);
    const svg = result.svg.replace(`width="${raster.width}" height="${raster.height}"`, `width="${raster.originalWidth}" height="${raster.originalHeight}"`);
    await writeFile(resolve(output, name + '.svg'), svg);
    const url = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    panels.push({ name, url });
    const coverage = await evaluate(`(async () => {
      const image = new Image(); image.src = ${JSON.stringify(url)}; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = ${raster.width}; canvas.height = ${raster.height};
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let translucent = 0, transparent = 0;
      for (let y = 1; y < canvas.height - 1; y++) for (let x = 1; x < canvas.width - 1; x++) {
        const alpha = pixels[(y * canvas.width + x) * 4 + 3];
        if (alpha < 250) translucent++; if (alpha === 0) transparent++;
      }
      // Compare on the same white matte as the preview. Report source edges
      // separately so a large flat background does not hide contour errors.
      ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const rendered = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const original = new Image(); original.src = ${JSON.stringify(dataUrl)}; await original.decode();
      ctx.globalCompositeOperation = 'copy'; ctx.drawImage(original, 0, 0, canvas.width, canvas.height);
      const source = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let error = 0, edgeError = 0, edgePixels = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        let e = 0;
        for (let c = 0; c < 3; c++) e += Math.abs(rendered[i + c] - (source[i + c] * source[i + 3] / 255 + 255 - source[i + 3]));
        error += e;
        const neighbors = [x + 1 < canvas.width ? i + 4 : i, y + 1 < canvas.height ? i + canvas.width * 4 : i];
        if (neighbors.some(j => [0, 1, 2].reduce((sum, c) => sum + (source[i + c] - source[j + c]) ** 2, 0) > 1024)) { edgePixels++; edgeError += e; }
      }
      return { interiorPixelsBelowAlpha250: translucent, fullyTransparentInteriorPixels: transparent,
        meanAbsoluteRGBErrorOnWhite: Number((error / (canvas.width * canvas.height * 3)).toFixed(3)),
        meanAbsoluteEdgeRGBErrorOnWhite: edgePixels ? Number((edgeError / (edgePixels * 3)).toFixed(3)) : null, edgePixels };

    })()`);
    results.push({ name, options: settings, paths: result.paths, engineSha256: createHash('sha256').update(source).digest('hex'), coverage, colors: result.colors, contours: result.contours, segments: result.segments, bytes: Buffer.byteLength(svg), milliseconds: Math.round(performance.now() - start) });
  }
  const html = `<!doctype html><html><meta charset="utf-8"><title>Tracing comparison</title><style>body{font:16px system-ui;margin:24px;background:#eee;color:#111}main{display:flex;gap:16px;align-items:flex-start}section{flex:1;min-width:0}img{width:100%;background:white}button{padding:8px;margin-bottom:12px}.zoom main{width:${panels.length * raster.originalWidth}px}.zoom section{flex:0 0 ${raster.originalWidth}px}</style><h1>Tracing comparison</h1><p>Same input raster; “before” and “balanced” use identical settings. “detail” retains small regions.</p><button onclick="document.body.classList.toggle('zoom')">Fit / original size</button><main>${panels.map(p => `<section><h2>${p.name}</h2><img src="${p.url}"></section>`).join('')}</main></html>`;
  await writeFile(resolve(output, 'comparison.html'), html);
  await send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
  const { frameTree } = await send('Page.getFrameTree', {}, sessionId);
  await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html }, sessionId);
  await evaluate('Promise.all([...document.images].map(image => image.decode()))');
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
  await writeFile(resolve(output, 'comparison.png'), Buffer.from(screenshot.data, 'base64'));
  await evaluate(`document.querySelector('main').innerHTML = ${JSON.stringify(panels.filter(p => p.name === 'Original' || p.name === 'balanced').map(p => `<section><h2>${p.name}</h2><img src="${p.url}"></section>`).join(''))}`);
  await evaluate('Promise.all([...document.images].map(image => image.decode()))');
  const fullSize = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  await writeFile(resolve(output, 'original-vs-balanced.png'), Buffer.from(fullSize.data, 'base64'));
  if (baseline) {
    await evaluate(`document.querySelector('main').innerHTML = ${JSON.stringify(panels.filter(p => p.name === 'before' || p.name === 'balanced').map(p => `<section><h2>${p.name}</h2><img src="${p.url}"></section>`).join(''))}`);
    await evaluate('Promise.all([...document.images].map(image => image.decode()))');
    const beforeAfter = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    await writeFile(resolve(output, 'before-vs-balanced.png'), Buffer.from(beforeAfter.data, 'base64'));
  }
  const report = { input: resolve(input), inputSha256: createHash('sha256').update(bytes).digest('hex'), originalSize: [raster.originalWidth, raster.originalHeight], processSize: [raster.width, raster.height], results };
  await writeFile(resolve(output, 'metrics.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('Artifacts:', resolve(output));
} finally {
  if (targetId) await send('Target.closeTarget', { targetId });
  socket.close();
}
