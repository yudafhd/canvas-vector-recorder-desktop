// Paired offline benchmark; assert full SVG and diagnostics equality on every run.
// node tests/tracing-performance.mjs input.bmp output-dir baseline.ts settings.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';
const [input, output, baseline, settingsPath] = process.argv.slice(2);
if (!input || !output || !baseline) throw new Error('Provide BMP, output directory, baseline TS and optional settings.');
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

const hash = value => createHash('sha256').update(value).digest('hex');
const engines = await Promise.all([baseline, 'src/tracing/engine.ts'].map(async path => {
  const source = await readFile(path, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return { path, sha256: hash(source), module: await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64')) };
}));
// Differential coverage check at fractional and exact grid positions, including
// reversed loops, partial alpha, repeated evaluations and independent objectives.
let seed = 123456789;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
for (let sample = 0; sample < 128; sample++) {
  let raw = [[1,1],[2,1],[3,1],[3,2],[3,3],[2,3],[1,3],[1,2],[1,1]];
  if (sample & 1) raw = raw.toReversed();
  const field = {width:5,height:5,observed:Uint8ClampedArray.from({length:100},()=>random()*255),predicted:Float64Array.from({length:100},random)};
  const difference = Array.from({length:4},()=>random()*2-1);
  const objectives = engines.map(e=>e.module.coverageObjective(raw,structuredClone(field),difference));
  for (let iteration = 0; iteration < 3; iteration++) {
    const points = raw.slice(0,-1).map(p=>p.map(v=>v+(sample%8===0?0:(random()-.5)*1.1)));
    const states = objectives.map(o=>o.evaluate(points));
    assert.deepEqual(states[1],states[0]);
    const candidate=objectives[1].evaluate(points,false);
    assert.deepEqual(objectives[1].differentiate(points,candidate.predicted),states[0].gradient);
  }
}
const timings = [[],[]]; let expected, result;
// Warm each implementation once; then alternate order for four measured pairs.
for (let round = -1; round < 4; round++) {
  for (const index of (round%2===0?[1,0]:[0,1])) {
    const start=performance.now();
    result=engines[index].module.traceRaster(pixels,width,height,options);
    const elapsed=performance.now()-start;
    if (!expected) expected=result;
    assert.deepEqual(result,expected);
    if(round>=0) timings[index].push(elapsed);
    console.log(`${round<0?'warmup':`pair ${round+1}`} ${index?'after':'before'}: ${elapsed.toFixed(1)} ms, identical result`);
  }
}
const median = values => { const sorted=values.toSorted((a,b)=>a-b);return (sorted[1]+sorted[2])/2; };
const report={input:resolve(input),inputSha256:hash(bytes),width,height,options,differentialCases:384,fullResultIdentical:true,svgSha256:hash(result.svg),results:engines.map((e,i)=>({path:e.path,sha256:e.sha256,milliseconds:timings[i],medianMs:median(timings[i])})),speedup:median(timings[0])/median(timings[1]),diagnostics:result.diagnostics};
await mkdir(output,{recursive:true});
await writeFile(resolve(output,'benchmark.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(resolve(output,'after.svg'),result.svg);
console.log(JSON.stringify(report,null,2));
