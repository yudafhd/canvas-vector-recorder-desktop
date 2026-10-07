import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { Worker } from 'node:worker_threads';

const modules = new Map();
async function moduleUrl(name) {
  if (modules.has(name)) return modules.get(name);
  const source = await readFile(new URL(`../src/tracing/${name}.ts`, import.meta.url), 'utf8');
  let js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  for (const [, dependency] of js.matchAll(/from ['"]\.\/([^'"]+)['"]/g)) js = js.replaceAll(`'./${dependency}'`, `'${await moduleUrl(dependency)}'`).replaceAll(`"./${dependency}"`, `"${await moduleUrl(dependency)}"`);
  const url = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64'); modules.set(name, url); return url;
}
const { detectAutoSettings, hasFineGrain } = await import(await moduleUrl('auto-settings'));
const { chooseAutoTrace, traceAutoFinal, traceAuto, localRefinementSafe, acceptAutoDetail } = await import(await moduleUrl('auto-trace'));
const { evaluateSvgScene } = await import(await moduleUrl('scene-quality'));
const { resizeRaster } = await import(await moduleUrl('auto-raster'));
const { traceRaster } = await import(await moduleUrl('engine'));
const defaults = { colors: 12, tolerance: .8, minArea: 0, smooth: true, removeWhite: false, whiteMode: 'none' };
function raster(w, h, pixel) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(pixel(x, y), (y * w + x) * 4);
  return rgba;
}
const white = [255,255,255,255], black = [0,0,0,255], green = [40,102,73,255], orange = [233,174,119,255];
const stripes = (w=48,h=48) => raster(w,h,x => x < w/2 ? green : orange);
function boundaryAt(x, w=48, h=48) {
  const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path fill="#286649" fill-rule="evenodd" d="M0 0L${x} 0L${x} ${h}L0 ${h}Z"/><path fill="#e9ae77" fill-rule="evenodd" d="M${x} 0L${w} 0L${w} ${h}L${x} ${h}Z"/></svg>`;
  return { svg, colors: ['#286649','#e9ae77'], paths: 2, contours: 2, segments: 8, width: w, height: h, diagnostics: {} };
}
test('Auto detector distinguishes transparent art, white background and monochrome ink', () => {
  const transparent = raster(100,100,(x,y)=>x>=20&&x<80&&y>=20&&y<80?green:[0,0,0,0]);
  const a = detectAutoSettings(transparent,100,100);
  assert.equal(a.resolution,1024); assert.equal(a.options.removeWhite,true); assert.equal(a.options.tolerance,1.6);
  const whiteArt = raster(100,100,(x,y)=>x>=25&&x<75&&y>=25&&y<75?green:white);
  const b = detectAutoSettings(whiteArt,100,100);
  assert.equal(b.options.whiteMode,'all'); assert.equal(b.options.minArea,4);
  const ink = raster(100,100,(x,y)=>x>=25&&x<75&&y>=25&&y<75?black:white);
  const c = detectAutoSettings(ink,100,100);
  assert.equal(c.sparseInk,true); assert.equal(c.options.colors,2); assert.equal(c.options.tolerance,.2); assert.equal(c.options.minArea,12);
  assert.equal(detectAutoSettings(raster(32,32,()=>white),32,32).options.whiteMode,'background');
});
test('Auto detector chooses photo settings for varied pixels and fine grain', () => {
  let seed=42; const rand = () => { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed>>>24; };
  const photo = raster(48,48,()=>[rand(),rand(),rand(),255]);
  const a = detectAutoSettings(photo,48,48);
  assert.equal(a.photographic,true); assert.equal(a.resolution,512); assert.ok(a.options.colors>=8); assert.equal(a.options.minArea,12);
  const grain = raster(128,128,()=>[46+rand()%17,82+rand()%17,65+rand()%17,255]);
  assert.equal(hasFineGrain(grain,128,128),true);
  assert.equal(detectAutoSettings(grain,128,128).photographic,true);
});
test('Auto detector rejects invalid and invisible rasters', () => {
  assert.throws(()=>detectAutoSettings(new Uint8ClampedArray(12),2,2),/Ukuran/);
  assert.throws(()=>detectAutoSettings(raster(8,8,()=>[0,0,0,0]),8,8),/transparan/);
});
test('Auto resizing is premultiplied and preserves aspect without upscaling', () => {
  const source = new Uint8ClampedArray([255,0,0,255,0,0,255,0,0,0,255,0,0,0,255,0]);
  assert.deepEqual([...resizeRaster(source,2,2,1).pixels],[255,0,0,64]);
  const pixels = stripes(40,20), same=resizeRaster(pixels,40,20,1024); assert.equal(same.pixels,pixels);
  const smaller=resizeRaster(pixels,40,20,20); assert.equal(smaller.width,20); assert.equal(smaller.height,10);
});
test('scene evaluator matches exact layers, even-odd holes, alpha and intentional white removal', () => {
  const rgba=stripes(), perfect=boundaryAt(24);
  assert.ok(evaluateSvgScene(perfect.svg,rgba,48,48).error<1e-25);
  assert.ok(evaluateSvgScene(boundaryAt(23).svg,rgba,48,48).edgeError>0);
  const svg='<svg><path fill="#ff0000" fill-rule="evenodd" d="M0 0L8 0L8 8L0 8ZM2 2L6 2L6 6L2 6Z"/></svg>';
  const hole=raster(8,8,(x,y)=>x>=2&&x<6&&y>=2&&y<6?[0,0,255,0]:[255,0,0,255]);
  assert.equal(evaluateSvgScene(svg,hole,8,8).error,0);
  const whiteHole=raster(8,8,(x,y)=>x>=2&&x<6&&y>=2&&y<6?white:[255,0,0,255]);
  assert.equal(evaluateSvgScene(svg,whiteHole,8,8,true).error,0);
  assert.ok(evaluateSvgScene(svg,whiteHole,8,8,false).error>0);
  const half='<svg><path fill="#000000" fill-rule="evenodd" d="M0 0L0.5 0L0.5 1L0 1Z"/></svg>';
  const fractional=new Uint8ClampedArray([0,0,0,128]);
  assert.ok(evaluateSvgScene(half,fractional,1,1).error<1e-5);
  assert.throws(()=>evaluateSvgScene('<svg/>',rgba,48,48),/path/);
});
test('selector keeps baseline ties and rejects lost edges even for a simpler SVG', () => {
  const pixels=stripes(); let calls=0;
  const selected=chooseAutoTrace(pixels,48,48,defaults,undefined,()=>{calls++; return boundaryAt(24);});
  assert.equal(calls,3); assert.equal(selected.index,0); assert.equal(selected.succeeded,3);
  const rejected=chooseAutoTrace(pixels,48,48,defaults,undefined,()=>boundaryAt(++calls===4?24:20));
  assert.equal(rejected.index,0);
});
test('selector recovers from a failed baseline and chooses a measured improvement', () => {
  let calls=0;
  const result=chooseAutoTrace(stripes(),48,48,defaults,undefined,()=>{if(++calls===1)throw new Error('Preview complex');return boundaryAt(calls===2?23:24);});
  assert.equal(result.index,2); assert.equal(result.succeeded,2); assert.equal(result.baselineScore,null);
  assert.throws(()=>chooseAutoTrace(stripes(),48,48,defaults,undefined,()=>{throw new Error('No candidates');}),/No candidates/);
});
test('final tracing retries settings, bounds complexity and rechecks the preview winner', () => {
  let calls=0;
  const retry=traceAutoFinal(stripes(),48,48,1024,defaults,defaults,undefined,()=>{if(++calls===1)throw new Error('Boundary limit');return boundaryAt(24);});
  assert.equal(retry.attempts,2); assert.equal(retry.fallback,'traceError'); assert.equal(retry.options.minArea,12);
  calls=0;
  const complex=traceAutoFinal(stripes(),48,48,1024,defaults,defaults,undefined,()=>({...boundaryAt(24),paths:++calls===1?10000:2}));
  assert.equal(complex.fallback,'complexity'); assert.equal(complex.attempts,2);
  const selected={...defaults,colors:14,tolerance:.35};
  const corrected=traceAutoFinal(stripes(),48,48,1024,selected,defaults,undefined,(_p,_w,_h,o)=>boundaryAt(o.colors===14?22:24));
  assert.equal(corrected.fallback,'quality'); assert.equal(corrected.options.colors,12);
});
test('final fallback lowers resolution and returns SVG dimensions matching that raster', () => {
  const result=traceAutoFinal(stripes(600,40),600,40,1024,defaults,defaults,undefined,(_p,w,h)=>{if(w>512)throw new Error('Boundary limit');return boundaryAt(w/2,w,h);});
  assert.equal(result.fallback,'resolution'); assert.equal(result.resolution,512); assert.equal(result.result.width,512);
  assert.match(result.result.svg,/viewBox="0 0 512 34"/); assert.ok(result.attempts<=4);
});

test('2048 fallback tries 1024 then 512 once each and propagates cancellation', () => {
  const calls=[],pixels=stripes(1536,48);
  const outcome=traceAutoFinal(pixels,1536,48,2048,defaults,defaults,undefined,(_p,w,h)=>{calls.push(w);if(w>512)throw new Error('Too complex');return boundaryAt(w/2,w,h);});
  assert.deepEqual(calls,[1536,1536,1536,1024,512]); assert.equal(outcome.attempts,5); assert.equal(outcome.resolution,512);
  assert.match(outcome.result.svg,/viewBox="0 0 512 16"/);
  const medium=traceAutoFinal(pixels,1536,48,2048,defaults,defaults,undefined,(_p,w,h)=>{if(w>1024)throw new Error('Too complex');return boundaryAt(w/2,w,h);});
  assert.equal(medium.resolution,1024);assert.equal(medium.attempts,4);
  let attempts=0;
  assert.throws(()=>traceAutoFinal(pixels,1536,48,2048,defaults,defaults,undefined,(_p,w)=>{attempts++;const e=new Error('Cancelled');if(w===1024)e.name='AbortError';throw e;}),{name:'AbortError'});
  assert.equal(attempts,4);
  attempts=0;
  assert.throws(()=>traceAutoFinal(pixels,1536,48,2048,defaults,defaults,undefined,()=>{attempts++;throw new Error('Always fails');}),/tidak dapat disederhanakan/);
  assert.equal(attempts,5);
});

test('detector retains source size for 2048 ink recommendation and caps photo resolution', () => {
  const ink=raster(100,100,(x,y)=>x>=25&&x<75&&y>=25&&y<75?black:white);
  assert.equal(detectAutoSettings(ink,100,100,2400).resolution,2048);
  assert.equal(detectAutoSettings(ink,100,100,1024).resolution,1024);
  assert.throws(()=>resizeRaster(ink,100,100,2049),/Resolusi/);
});

test('failed preview still reaches final tracing while preview cancellation stops immediately', () => {
  const pixels=stripes(300,40), calls=[],progress=[];
  const result=traceAuto(pixels,300,40,v=>progress.push(v),undefined,(_p,w,h)=>{calls.push(w);if(w<=192)throw new Error('Preview failed');return boundaryAt(w/2,w,h);});
  assert.equal(result.result.width,300);assert.equal(result.auto.selection.index,-1);assert.equal(result.auto.selection.succeeded,0);
  assert.equal(progress.at(-1),100); assert.ok(calls.filter(w=>w===300).length>=1);
  for(let i=1;i<progress.length;i++)assert.ok(progress[i]>=progress[i-1]);
  let attempts=0;
  assert.throws(()=>traceAuto(pixels,300,40,undefined,undefined,()=>{attempts++;const e=new Error('Cancelled');e.name='AbortError';throw e;}),{name:'AbortError'});
  assert.equal(attempts,1);
});
test('final detail refit requires actual edge improvement, fixed topology and safe tiles', () => {
  let calls=0;
  const output=traceAutoFinal(stripes(),48,48,1024,defaults,defaults,undefined,()=>boundaryAt(++calls===1?23:24));
  assert.equal(output.fallback,'detail'); assert.equal(output.options.tolerance,.35); assert.equal(output.attempts,2);
  const before=boundaryAt(23), after=boundaryAt(24), oldMetrics=evaluateSvgScene(before.svg,stripes(),48,48), newMetrics=evaluateSvgScene(after.svg,stripes(),48,48);
  assert.equal(acceptAutoDetail(before,oldMetrics,after,newMetrics),true);
  assert.equal(acceptAutoDetail(before,oldMetrics,{...after,contours:1},newMetrics),false);
  const metrics={error:0,edgeError:0,edgePixels:0,tiles:new Float64Array([8,0])};
  assert.equal(localRefinementSafe(metrics,{...metrics,tiles:new Float64Array([3,3])}),false);
  assert.equal(localRefinementSafe(metrics,{...metrics,tiles:new Float64Array([3,.05])}),true);
});
test('optional refit failure keeps the completed trace, cancellation propagates', () => {
  let calls=0;
  const output=traceAutoFinal(stripes(),48,48,1024,defaults,defaults,undefined,()=>{if(++calls>1)throw new Error('Optional failure');return boundaryAt(23);});
  assert.equal(output.result.svg,boundaryAt(23).svg); assert.equal(output.attempts,2);
  const abort=()=>{const error=new Error('Cancelled');error.name='AbortError';throw error;};
  assert.throws(()=>traceAutoFinal(stripes(),48,48,1024,defaults,defaults,undefined,abort),{name:'AbortError'});
  assert.throws(()=>chooseAutoTrace(stripes(),48,48,defaults,undefined,abort),{name:'AbortError'});
  assert.throws(()=>traceAutoFinal(stripes(),48,48,1024,defaults,defaults,undefined,()=>{throw new Error('Always fails');}),/tidak dapat disederhanakan/);
});
test('production Auto pipeline reports applied settings and monotonic progress through completion', () => {
  const pixels=raster(48,48,(x,y)=>x>=12&&x<36&&y>=12&&y<36?black:white), progress=[];
  let recommendation;
  const output=traceAuto(pixels,48,48,v=>progress.push(v),r=>recommendation=r);
  assert.equal(output.auto.recommendation, recommendation); assert.equal(output.auto.options.colors,2);
  assert.equal(output.auto.options.whiteMode,'all'); assert.deepEqual(output.result.colors,['#000000']);
  assert.ok(Number.isFinite(output.auto.error)); assert.equal(progress.at(-1),100);
  for(let i=1;i<progress.length;i++)assert.ok(progress[i]>=progress[i-1]);
  const allWhite=traceAuto(raster(16,16,()=>white),16,16,undefined,undefined,undefined,'none'); assert.deepEqual(allWhite.result.colors,['#ffffff']);
  assert.throws(()=>traceAuto(raster(16,16,()=>white),16,16),/Tidak ada bidang tersisa/);
});
test('Auto retains the user sparkle fixture as an editable vector', async () => {
  const pixels=new Uint8ClampedArray(await readFile(new URL('./fixtures/sparkle-source-28x28.rgba',import.meta.url)));
  const output=traceAuto(pixels,28,28);
  assert.ok(output.result.paths>=2); assert.doesNotMatch(output.result.svg,/NaN|Infinity|<image/);
  assert.ok(output.auto.options.colors>=2 && output.auto.options.colors<=16);
  assert.equal(output.result.width,28); assert.equal(output.result.height,28);
});
test('manual trace remains independent of Auto selection', () => {
  const pixels=stripes(32,32);
  const result=traceRaster(pixels,32,32,{...defaults,smooth:false,minArea:0});
  assert.equal(result.paths,2); assert.doesNotMatch(result.svg,/C/);
});

function createWorker(url) {
  return new Worker(`const { parentPort } = require('node:worker_threads'); globalThis.self = { postMessage: message => parentPort.postMessage(message) }; import(${JSON.stringify(url)}).then(() => parentPort.on('message', data => self.onmessage({ data }))).catch(error => { throw error; });`, { eval: true });
}
test('actual worker delivers recommendations, progress and a result; manual bypasses Auto', async t => {
  const url=await moduleUrl('worker');
  for (const mode of ['auto','manual']) {
    const worker=createWorker(url); t.after(()=>worker.terminate());
    const pixels=raster(32,32,(x,y)=>x>=8&&x<24&&y>=8&&y<24?black:white), messages=[];
    const completed=new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('message',m=>{messages.push(m);if(m.type==='error')reject(new Error(m.message));if(m.type==='result')resolve(m);});});
    worker.postMessage({pixels:pixels.buffer,width:32,height:32,options:defaults,mode},[pixels.buffer]);
    const response=await completed;
    assert.equal(response.result.width,32);
    assert.equal(messages.some(m=>m.type==='auto-settings'),mode==='auto');
    assert.equal(Boolean(response.auto),mode==='auto');
    assert.equal(messages.filter(m=>m.type==='result').length,1);
    assert.equal(messages.filter(m=>m.type==='progress').at(-1).value,100);
    await worker.terminate();
  }
});
test('terminating an active Auto worker cancels without publishing a completed result', async t => {
  const worker=createWorker(await moduleUrl('worker'));t.after(()=>worker.terminate());
  const pixels=stripes(192,192);let results=0;
  const cancelled=new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('message',m=>{if(m.type==='result')results++;if(m.type==='progress')resolve(worker.terminate());});});
  worker.postMessage({pixels:pixels.buffer,width:192,height:192,options:defaults,mode:'auto'},[pixels.buffer]);
  await cancelled; assert.equal(results,0);
});

test('upload detection worker recommends settings without starting tracing or publishing SVG', async t => {
  const worker=createWorker(await moduleUrl('worker'));t.after(()=>worker.terminate());
  const pixels=raster(32,32,(x,y)=>x>=8&&x<24&&y>=8&&y<24?black:white), messages=[];
  const detected=new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('message',m=>{messages.push(m);if(m.type==='error')reject(new Error(m.message));else if(m.type==='auto-settings')resolve(m.recommendation);});});
  worker.postMessage({mode:'detect',pixels:pixels.buffer,width:32,height:32,sourceSide:2400},[pixels.buffer]);
  const recommendation=await detected;
  assert.equal(recommendation.resolution,2048);assert.equal(recommendation.options.colors,2);
  assert.equal(messages.some(m=>m.type==='result'||m.type==='progress'),false);
  await worker.terminate();
});

test('editor snapshots isolate cached Auto recommendations until copied into current settings', async () => {
  const { TracingSettingsState }=await import(await moduleUrl('settings-state'));
  const manual={resolution:512,options:{colors:9,tolerance:1.6,minArea:24,smooth:false,removeWhite:true,whiteMode:'all'}},state=new TracingSettingsState(manual);
  const detected={resolution:2048,options:{...defaults,colors:2,tolerance:.2,minArea:12,whiteMode:'background',removeWhite:true}};
  state.setAuto(detected);assert.deepEqual(state.manualSettings,manual);
  state.setAuto({...detected,resolution:1024});assert.deepEqual(state.manualSettings,manual);
  const restored=new TracingSettingsState(JSON.parse(JSON.stringify(state.manualSettings)));assert.deepEqual(restored.manualSettings,manual);
  const snapshot=state.manualSettings;snapshot.options.colors=2;assert.equal(state.manualSettings.options.colors,9);
  state.setManual(state.autoSettings);assert.deepEqual(state.manualSettings,{...detected,resolution:1024});
  state.setAuto();assert.equal(state.autoSettings,undefined);
  assert.equal(new TracingSettingsState({resolution:999,options:{...defaults}}).manualSettings.resolution,1024);
  assert.equal(new TracingSettingsState(null).manualSettings.options.colors,6);
});
