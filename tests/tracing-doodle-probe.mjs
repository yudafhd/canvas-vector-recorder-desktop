// Offline geometry check and vector comparison. No browser or native app needed.
// Input: uncompressed 24-bit RGB or 32-bit BGRA BMP (sips decodes JPEG/PNG).
// node tests/tracing-doodle-probe.mjs input.bmp output-dir engine.ts [options.json]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

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

const engineSource=await readFile(baseline,'utf8');
const js=ts.transpileModule(engineSource+'\nexport {quantize,compactPalette,refineTransitions,cleanRegions,identifyRegions};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const engine=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const {labels,palette}=engine.quantize(pixels,options.colors);
const stages=[];
function inspect(name) {
 const {ids,regions}=engine.identifyRegions(labels,width,height);
 const areas=new Int32Array(regions.length),interiors=new Int32Array(regions.length),borders=regions.map(()=>new Map());
 for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
  const p=y*width+x,id=ids[p];areas[id]++;
  let full=true;
  for(const q of [x>0?p-1:-1,x+1<width?p+1:-1,y>0?p-width:-1,y+1<height?p+width:-1]) {
   if(q<0||ids[q]!==id) full=false;
   if(q>=0&&ids[q]!==id)borders[id].set(ids[q],(borders[id].get(ids[q])??0)+1);
  }
  if(full)interiors[id]++;
 }
 stages.push({roi:regions.map((r,i)=>({label:r.label,area:areas[i],seed:r.seed})).filter(r=>r.seed%width>=76&&r.seed%width<=108&&Math.floor(r.seed/width)>=328&&Math.floor(r.seed/width)<=346),name,regions:regions.length,palette:structuredClone(palette),byColor:palette.map((color,label)=>({label,color,regions:regions.filter(r=>r.label===label).length,pixels:regions.reduce((n,r,i)=>n+(r.label===label?areas[i]:0),0)})),small:regions.map((r,i)=>({id:i,label:r.label,area:areas[i],interior:interiors[i],neighbors:[...borders[i]].map(([id,border])=>({label:regions[id].label,area:areas[id],border}))})).filter(r=>r.area<128)});
}
inspect('quantize');
engine.compactPalette(pixels,labels,palette,width,height,options.minArea);inspect('compact');
if(engine.refinePaletteInteriors){engine.refinePaletteInteriors(pixels,labels,palette,width,height);inspect('palette-interiors');}
engine.refineTransitions(pixels,labels,width,height,palette);inspect('transition');
engine.cleanRegions(labels,width,height,options.minArea,palette,pixels);inspect('cleanup');
let changes=[];
if(engine.cleanTransitionRegions) {
 const before=new Int16Array(labels);
 const stats=engine.cleanTransitionRegions(pixels,labels,palette,width,height,options.minArea);
 for(let p=0;p<labels.length;p++)if(labels[p]!==before[p])changes.push({x:p%width,y:Math.floor(p/width),from:before[p],to:labels[p]});
 inspect('region-mixture');
 console.log(stats);
}
await mkdir(output,{recursive:true});
await writeFile(resolve(output,'region-analysis.json'),JSON.stringify({input,options,changes,stages},null,2));
console.log(JSON.stringify(stages.map(({name,regions,byColor})=>({name,regions,byColor})),null,2));
