import fs from 'node:fs';
import { moduleUrl } from '../../tests/helpers/tracing-module.mjs';
const engine = await import(await moduleUrl('engine'));
const data = new Uint8ClampedArray(fs.readFileSync('RND/star-quality/source.rgba'));
const width = 1024, height = data.length / width / 4;
const options = { colors: 6, minArea: 4, tolerance: .8, smooth: true, removeWhite: false };
const name = process.argv[2] ?? 'before';
const result = process.argv[3] === 'render' ? { svg: fs.readFileSync(`RND/star-quality/${name}.svg`, 'utf8') } : engine.traceRaster(data, width, height, options);
fs.writeFileSync(`RND/star-quality/${name}.svg`, result.svg);
const magnification = Number(result.svg.match(/viewBox="0 0 (\d+)/)?.[1] ?? 1024) / 1024;
const left = 119 * magnification, top = 77 * magnification, size = 28 * magnification, scale = 10 / magnification, outSize = 280;
const paths = [...result.svg.matchAll(/<path fill="(#[a-f0-9]+)" fill-rule="evenodd" d="([^"]+)"/g)].map(([, fill, d]) => {
  const tokens = d.match(/[MLCZ]|[-+]?\d+(?:\.\d+)?/g), loops = []; let loop = [], p;
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++];
    if (command === 'M' || command === 'L') { p = [+tokens[i++], +tokens[i++]]; loop.push(p); }
    else if (command === 'C') {
      const c = [+tokens[i++], +tokens[i++]], e = [+tokens[i++], +tokens[i++]], b = [+tokens[i++], +tokens[i++]];
      for (let k = 1; k <= 64; k++) { const t = k / 64, u = 1 - t; loop.push([0, 1].map(axis => u ** 3 * p[axis] + 3 * u * u * t * c[axis] + 3 * u * t * t * e[axis] + t ** 3 * b[axis])); } p = b;
    } else if (command === 'Z') { loops.push(loop); loop = []; }
  }
  const xs = loops.flat().map(p => p[0]), ys = loops.flat().map(p => p[1]);
  if (Math.min(...xs) > left && Math.max(...xs) < left + size && Math.min(...ys) > top && Math.max(...ys) < top + size) console.log(JSON.stringify({ fill, d }));
  return { fill, loops };
}).filter(path => path.loops.some(loop => {
  const xs = loop.map(p => p[0]), ys = loop.map(p => p[1]);
  return Math.min(...xs) < left + size && Math.max(...xs) > left && Math.min(...ys) < top + size && Math.max(...ys) > top;
}));
const scanCache = new Map();
const at = (x, y) => {
  if (!scanCache.has(y)) scanCache.set(y, paths.map(path => {
    const hits = [];
    for (const loop of path.loops) for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [xi, yi] = loop[i], [xj, yj] = loop[j];
      if ((yi > y) !== (yj > y)) hits.push((xj - xi) * (y - yi) / (yj - yi) + xi);
    }
    return { fill: path.fill, hits };
  }));
  let color = '#ffffff';
  for (const path of scanCache.get(y)) { let inside = false; for (const hit of path.hits) if (x < hit) inside = !inside; if (inside) color = path.fill; }
  return parseInt(color.slice(1), 16);
};
// Magnified top-left sparkle, independently rasterized from exported SVG.
const bmp = Buffer.alloc(54 + outSize * outSize * 4);
bmp.write('BM'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(outSize, 18); bmp.writeInt32LE(-outSize, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(32, 28);
for (let y = 0; y < outSize; y++) for (let x = 0; x < outSize; x++) { const color = at(left + (x + .5) / scale, top + (y + .5) / scale), offset = 54 + (y * outSize + x) * 4; bmp[offset] = color & 255; bmp[offset + 1] = (color >>> 8) & 255; bmp[offset + 2] = color >>> 16; bmp[offset + 3] = 255; }
fs.writeFileSync(`RND/star-quality/${name}.bmp`, bmp);
console.log(JSON.stringify({ paths: result.paths, segments: result.segments, diagnostics: result.diagnostics }));
