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

const code=await readFile(baseline,'utf8');
const patched=code.replace('  const points = raster ? refineCoverage(raw, warm, corners, raster, diagnostics) : warm;', `  const points = raster ? refineCoverage(raw, warm, corners, raster, diagnostics) : warm;
if(raw.every(p=>p[0]>450&&p[0]<575&&p[1]>440&&p[1]<490))globalThis.__teeth.push({raw,points,corners:[...corners]});`);
globalThis.__teeth=[];
const js=ts.transpileModule(patched,{compilerOptions:{target:99,module:99}}).outputText;
const {traceRaster}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
traceRaster(pixels,width,height,options);
await mkdir(output,{recursive:true});await writeFile(resolve(output,'contours.json'),JSON.stringify(globalThis.__teeth));
console.log(globalThis.__teeth.map(c=>({samples:c.points.length,corners:c.corners})));
