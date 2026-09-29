// Independent SVG raster comparison of UI baseline and geometry-only candidate.
import {readFile,writeFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
const width=1024,height=576,root='RND/tracing-quality/doodle-details-v14';
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

const before=render(await readFile(root+'/before.svg','utf8')),after=render(await readFile(root+'/after.svg','utf8'));
const regions={fold:[74,325,36,24],arrow:[15,308,277,110]};
const report={};
for(const [name,[x,y,w,h]] of Object.entries(regions)){
 let error=0,changed=0;const panel=new Uint8ClampedArray(w*2*h*4);
 for(let row=0;row<h;row++)for(let col=0;col<w;col++){
  const i=((y+row)*width+x+col)*4;let delta=0;
  for(let c=0;c<4;c++)delta+=Math.abs(before[i+c]-after[i+c]);
  error+=delta;if(delta)changed++;
  panel.set(before.subarray(i,i+4),(row*w*2+col)*4);panel.set(after.subarray(i,i+4),(row*w*2+w+col)*4);
 }
 report[name]={bounds:[x,y,w,h],meanAbsoluteRGBAChange:error/(w*h*4),changedPixels:changed,totalPixels:w*h};
 await writeFile(root+'/'+name+'-comparison.png',png(panel,w*2,h));
}
await writeFile(root+'/raster-change.json',JSON.stringify(report,null,2));console.log(report);

await writeFile(root+'/ui-provided.png',png(render(await readFile(root+'/ui-provided.svg','utf8')),width,height));
