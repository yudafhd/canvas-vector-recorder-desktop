// Optional browser smoke test. Requires Vite on :1420 and Chrome CDP on :9337.
// IPC is mocked only in this test page; native export validation is covered in Rust.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const artifactDir = '/private/tmp/cvr-tracing-smoke';
await mkdir(artifactDir, { recursive: true });
// Each run owns a fresh page so mocks and CSP from prior runs cannot accumulate.
const target = await (await fetch('http://127.0.0.1:9337/json/new?about:blank', { method: 'PUT' })).json();
assert.ok(target.webSocketDebuggerUrl, 'Chrome must provide a page target');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const requests = new Map(), errors = [];
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && requests.has(message.id)) { const pending = requests.get(message.id); requests.delete(message.id); clearTimeout(pending.timer); message.error ? pending.reject(message.error) : pending.resolve(message.result); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId, timer = setTimeout(() => { requests.delete(id); reject(new Error('CDP timeout: ' + method)); }, 30000);
  requests.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const until = async (expression, timeout = 25000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Timed out: ' + expression + '\n' + await evaluate('document.body.innerText.slice(-1500)'));
};
try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifactDir });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__testEvents = {}; window.__testCallbacks = {}; window.__testSaved = null;
    window.__testBlobs = new Map();
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = originalCreateObjectURL(blob); window.__testBlobs.set(url, blob); return url; };
    let callbackId = 0;
    window.__TAURI_INTERNALS__ = {
      transformCallback(fn) { const id = ++callbackId; window.__testCallbacks[id] = fn; return id; },
      async invoke(cmd, args) {
        if (cmd === 'get_license_status') return { valid: true, activated: true, perpetual: true, device_bound: true };
        if (cmd === 'plugin:event|listen') { window.__testEvents[args.event] = args.handler; return args.handler; }
        if (cmd === 'get_discover') return { success: true, data: [] };
        if (cmd === 'list_canvases' || cmd === 'list_svg_assets') return [];
        if (cmd === 'save_tracing_svg') { window.__testSaved = args; return '/test-downloads/' + args.filename; }
        return null;
      }
    };
    document.addEventListener('DOMContentLoaded', () => {
      const meta = document.createElement('meta'); meta.httpEquiv = 'Content-Security-Policy';
      meta.content = "default-src 'self'; connect-src 'self' ipc: http://ipc.localhost; img-src 'self' blob: data: https://cdn.mahes.app; frame-src http: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'";
      document.head.append(meta);
    });
  ` });
  // Runtime.enable replays exceptions from the previous page; scope checks to this navigation.
  errors.length = 0;
  await send('Page.navigate', { url: 'http://127.0.0.1:1420/' });
  await until("document.getElementById('mainTabs') && !document.getElementById('mainTabs').hidden");
  await evaluate("document.getElementById('tracingMainTab').click()");
  assert.ok(await evaluate("!document.getElementById('tracingView').hidden && document.getElementById('workspaceView').hidden && document.getElementById('targetView').hidden"));
  assert.ok(await evaluate("document.getElementById('traceRun').disabled && document.getElementById('traceDownload').disabled"));
  const results = [];
  for (const [name, file, colors] of [
    ['diagonal', '5a03e635edf18aeeea8d449da76ab4e0.jpg', 2],
    ['triangle', '0bc532eac697b88907841729b2b72a86.jpg', 2],
    ['circle', '3ab1424eff80b6359672d82fb8d5e4a4.jpg', 3],
    ['apple', '757fc2ab58535227c9f6a57e26fce0fa.jpg', 6],
  ]) {
    const dom = await send('DOM.getDocument');
    const input = await send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#traceFile' });
    await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [resolve('RND/aset_jpg', file)] });
    await until(`!document.getElementById('traceRun').disabled && document.getElementById('traceFileInfo').textContent === ${JSON.stringify(file)}`);
    await evaluate(`document.getElementById('traceColors').value = ${colors}; document.getElementById('traceColors').dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('traceRun').click()`);
    await until("!document.getElementById('traceDownload').disabled || document.getElementById('traceStatus').classList.contains('trace-error')");
    const state = await evaluate(`({ status: document.getElementById('traceStatus').textContent, stats: document.getElementById('traceStats').textContent, ready: !document.getElementById('traceDownload').disabled })`);
    assert.ok(state.ready, JSON.stringify(state));
    await until("document.getElementById('traceOutput').complete && document.getElementById('traceOutput').naturalWidth > 0");
    const svg = await evaluate("window.__testBlobs.get(document.getElementById('traceOutput').src).text()");
    assert.match(svg, /<path/); assert.doesNotMatch(svg, /<image/);
    await writeFile(`${artifactDir}/${name}.svg`, svg);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${artifactDir}/${name}.png`, Buffer.from(screenshot.data, 'base64'));
    results.push({ name, ...state });
    console.log(name, state.stats);
  }
  // Switching pages retains the image and completed result.
  await evaluate("document.getElementById('recorderMainTab').click()");
  assert.ok(await evaluate("document.getElementById('tracingView').hidden && !document.getElementById('workspaceView').hidden"));
  await evaluate("document.getElementById('tracingMainTab').click()");
  assert.ok(await evaluate("!document.getElementById('traceDownload').disabled"));
  // Browser download and native IPC payload, using identical finished SVG.
  await evaluate("document.getElementById('traceDownload').click()");
  await until("document.getElementById('traceStatus').textContent.includes('diunduh')");
  await new Promise(r => setTimeout(r, 500));
  assert.ok((await readdir(artifactDir)).some(name => name.endsWith('-traced.svg')));
  await evaluate("window.isTauri = true; document.getElementById('traceDownload').click()");
  await until('window.__testSaved !== null');
  const saved = await evaluate('window.__testSaved');
  assert.match(saved.svg, /<svg/); assert.ok(saved.filename.endsWith('-traced.svg'));
  // Changing settings invalidates stale output; cancel terminates the worker.
  await evaluate("document.getElementById('traceWhite').click()");
  assert.ok(await evaluate("document.getElementById('traceDownload').disabled && document.getElementById('traceOutput').hidden"));
  await evaluate("document.getElementById('traceRun').click(); document.getElementById('traceCancel').click()");
  assert.ok(await evaluate("!document.getElementById('traceRun').disabled && document.getElementById('traceStatus').textContent.includes('dibatalkan')"));
  await evaluate("document.documentElement.dataset.theme = 'dark'");
  const dark = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${artifactDir}/dark.png`, Buffer.from(dark.data, 'base64'));
  assert.deepEqual(errors, []);
  await writeFile(`${artifactDir}/results.json`, JSON.stringify({ results, checks: ['navigation', 'real-worker', 'CSP', 'four-jpeg-inputs', 'preview', 'svg-download', 'native-save-payload', 'invalidate', 'cancel'], errors }, null, 2));
  console.log('Browser checks passed. Artifacts:', artifactDir);
} finally {
  try { await send('Target.closeTarget', { targetId: target.id }); } finally { socket.close(); }
}
