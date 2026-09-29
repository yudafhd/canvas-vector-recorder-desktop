// Offline geometry check and vector comparison. No browser or native app needed.
// Input: uncompressed 24-bit RGB or 32-bit BGRA BMP (sips decodes JPEG/PNG).
// node tests/tracing-local-quality.mjs input.bmp output-dir previous-engine.ts [options.json]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import ts from 'typescript';

const [input, output, baseline, settingsPath] = process.argv.slice(2);
if (!input || !output || !baseline) throw new Error('Provide BMP, output directory, previous engine, and optional settings JSON.');
const bytes = await readFile(input);
if (bytes.length < 54 || bytes.toString('ascii', 0, 2) !== 'BM') throw new Error('Expected a BMP.');
const width = bytes.readInt32LE(18), signedHeight = bytes.readInt32LE(22), height = Math.abs(signedHeight), bits = bytes.readUInt16LE(28), offset = bytes.readUInt32LE(10);
if (width < 1 || height < 1 || width * height > 1024 ** 2 || ![24, 32].includes(bits)) throw new Error('Unsupported BMP dimensions/depth.');
const compression = bytes.readUInt32LE(30), header = bytes.readUInt32LE(14);
const bgra = compression === 3 && bits === 32 && header >= 56 && bytes.length >= 70 && [0xff0000, 0xff00, 0xff, 0xff000000].every((mask, i) => bytes.readUInt32LE(54 + i * 4) === mask);
if (compression !== 0 && !bgra) throw new Error('Unsupported BMP compression/channel masks.');
const stride = Math.ceil(width * bits / 32) * 4, pixels = new Uint8ClampedArray(width * height * 4);
if (offset + stride * height > bytes.length) throw new Error('Truncated BMP pixels.');
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = offset + (signedHeight < 0 ? y : height - 1 - y) * stride + x * bits / 8;
  pixels.set([bytes[i + 2], bytes[i + 1], bytes[i], bgra ? bytes[i + 3] : 255], (y * width + x) * 4);
}
const options = { colors: 6, tolerance: 0.8, minArea: 4, smooth: true, removeWhite: false, ...(settingsPath ? JSON.parse(await readFile(settingsPath, 'utf8')) : {}) };
const mix = (a, b) => a.map((v, k) => (v + b[k]) / 2);
const distanceToLine = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = dx * dx + dy * dy;
  const t = d ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / d)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
function readPaths(svg) {
  return [...svg.matchAll(/<path fill="(#[a-f0-9]+)" fill-rule="evenodd" d="([^"]+)"/g)].map(([, fill, d]) => {
    const tokens = d.match(/[MLCZ]|[-+]?\d+(?:\.\d+)?/g), edges = []; let p, start;
    const line = b => { if (p[1] !== b[1]) edges.push([p, b]); p = b; };
    const cubic = (a, c, e, b, depth = 0) => {
      if (Math.max(distanceToLine(c, a, b), distanceToLine(e, a, b)) < 0.04 || depth >= 16) { line(b); return; }
      const ac = mix(a, c), ce = mix(c, e), eb = mix(e, b), left = mix(ac, ce), right = mix(ce, eb), center = mix(left, right);
      cubic(a, ac, left, center, depth + 1); cubic(center, right, eb, b, depth + 1);
    };
    for (let i = 0; i < tokens.length;) {
      const cmd = tokens[i++];
      if (cmd === 'M') p = start = [Number(tokens[i++]), Number(tokens[i++])];
      else if (cmd === 'L') line([Number(tokens[i++]), Number(tokens[i++])]);
      else if (cmd === 'C') { const c = [Number(tokens[i++]), Number(tokens[i++])], e = [Number(tokens[i++]), Number(tokens[i++])], b = [Number(tokens[i++]), Number(tokens[i++])]; cubic(p, c, e, b); }
      else if (cmd === 'Z') line(start);
    }
    const rgb = [1, 3, 5].map(i => parseInt(fill.slice(i, i + 2), 16));
    return { edges, color: (0xff000000 | rgb[2] << 16 | rgb[1] << 8 | rgb[0]) >>> 0 };
  });
}
function render(svg) {
  const scale = 4, sw = width * scale, sh = height * scale, samples = new Uint32Array(sw * sh);
  for (const { edges, color } of readPaths(svg)) {
    const bounds = edges.reduce((range, [a, b]) => [Math.min(range[0], a[1], b[1]), Math.max(range[1], a[1], b[1])], [Infinity, -Infinity]);
    const y0 = Math.max(0, Math.floor(bounds[0] * scale));
    const y1 = Math.min(sh, Math.ceil(bounds[1] * scale));
    for (let sy = y0; sy < y1; sy++) {
      const y = (sy + 0.5) / scale, xs = [];
      for (const [a, b] of edges) if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i += 2) {
        const lo = Math.max(0, Math.ceil(xs[i - 1] * scale - 0.5)), hi = Math.min(sw, Math.ceil(xs[i] * scale - 0.5));
        samples.fill(color, sy * sw + lo, sy * sw + hi);
      }
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sum = [0, 0, 0, 0];
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const c = samples[(y * scale + dy) * sw + x * scale + dx];
      if (c) { sum[0] += c & 255; sum[1] += c >>> 8 & 255; sum[2] += c >>> 16 & 255; sum[3]++; }
    }
    rgba.set(sum[3] ? [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3], 255 * sum[3] / scale ** 2] : [0, 0, 0, 0], (y * width + x) * 4);
  }
  return rgba;
}
function png(rgba, w, h) {
  const crc = bytes => { let c = -1; for (const v of bytes) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ -1) >>> 0; };
  const chunk = (name, data) => { const payload = Buffer.concat([Buffer.from(name), data]), head = Buffer.alloc(4), tail = Buffer.alloc(4); head.writeUInt32BE(data.length); tail.writeUInt32BE(crc(payload)); return Buffer.concat([head, payload, tail]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4)); for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'source.png'), png(pixels, width, height));
const results = [], panels = [{ name: 'source', rgba: pixels }];
for (const [name, path] of [['before', baseline], ['after', 'src/tracing/engine.ts']]) {
  const source = await readFile(path, 'utf8'), js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const { traceRaster } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  const start = performance.now(), result = traceRaster(pixels, width, height, options), milliseconds = Math.round(performance.now() - start);
  const rendered = render(result.svg); panels.push({ name, rgba: rendered });
  await writeFile(resolve(output, name + '.svg'), result.svg); await writeFile(resolve(output, name + '.png'), png(rendered, width, height));
  let total = 0, edgeError = 0, edgePixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4; let error = 0;
    for (let c = 0; c < 3; c++) error += Math.abs((rendered[i + c] * rendered[i + 3] + 255 * (255 - rendered[i + 3])) / 255 - (pixels[i + c] * pixels[i + 3] + 255 * (255 - pixels[i + 3])) / 255);
    total += error;
    if ([x + 1 < width ? i + 4 : i, y + 1 < height ? i + width * 4 : i].some(j => [0, 1, 2].reduce((sum, c) => sum + (pixels[i + c] - pixels[j + c]) ** 2, 0) > 1024)) { edgePixels++; edgeError += error; }
  }
  results.push({ name, options, engineSha256: createHash('sha256').update(source).digest('hex'), colors: result.colors, contours: result.contours, segments: result.segments, bytes: Buffer.byteLength(result.svg), milliseconds, diagnostics: result.diagnostics ?? null, meanAbsoluteRGBError: total / pixels.length * 4 / 3, meanAbsoluteEdgeRGBError: edgePixels ? edgeError / edgePixels / 3 : null, edgePixels });
}
const comparison = new Uint8ClampedArray(width * 3 * height * 4);
for (let k = 0; k < panels.length; k++) for (let y = 0; y < height; y++) comparison.set(panels[k].rgba.subarray(y * width * 4, (y + 1) * width * 4), (y * width * 3 + k * width) * 4);
await writeFile(resolve(output, 'comparison.png'), png(comparison, width * 3, height));
const report = { input: resolve(input), inputSha256: createHash('sha256').update(bytes).digest('hex'), width, height, renderer: 'Independent software polygon rasterizer; cubics flattened to 0.04 px; 4x4 sample grid; no browser antialias', panels: ['source', 'before', 'after'], results };
await writeFile(resolve(output, 'metrics.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
