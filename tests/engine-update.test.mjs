import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleUrl } from './helpers/tracing-module.mjs';

const { quantizeFlatInteriors, traceRaster } = await import(await moduleUrl('engine'));
const { ColorMixture, canGrowTransitionLabel, cleanTransitionMixtures, transitionDefaults } = await import(await moduleUrl('transition-mixtures'));
const { detectAutoSettings } = await import(await moduleUrl('auto-settings'));
const { resolveAutoWhite } = await import(await moduleUrl('auto-white'));
const { underpaint } = await import(await moduleUrl('underpaint'));
const { evaluateSvgScene } = await import(await moduleUrl('scene-quality'));
const { generatePostScript } = await import(await moduleUrl('eps-export'));
const { TraceBatch } = await import(await moduleUrl('batch'));
const { traceAutoFinal, acceptAutoPalette } = await import(await moduleUrl('auto-trace'));
const raster = (w, h, color) => { const p = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.set(color(x, y), (y * w + x) * 4); return p; };

test('interior palette excludes an antialias band while retaining intentional shadow fills', () => {
  const colors = [[255,255,255,255],[255,204,0,255],[240,156,0,255]];
  const p = raster(64,48,(x,y) => y < 6 || y >= 42 || x < 6 || x >= 58 ? colors[0] : x === 32 ? [247,180,0,255] : colors[x < 32 ? 1 : 2]);
  const q = quantizeFlatInteriors(p,12,64,48);
  assert.equal(q.flatInteriors,true); assert.equal(q.palette.length,3);
  for (const color of colors) assert.ok(q.palette.some(c => c.every((v,i)=>v===color[i])));
  const traced = traceRaster(p,64,48,{colors:12,tolerance:.8,minArea:4,smooth:true,removeWhite:true,whiteMode:'background'});
  assert.ok(traced.colors.includes('#ffcc00')); assert.ok(traced.colors.includes('#f09c00'));
});
test('interior training falls back for thin or translucent foreground', () => {
  assert.equal(quantizeFlatInteriors(raster(20,20,(x)=>x===10?[0,0,0,255]:[255,255,255,255]),8,20,20).flatInteriors,false);
  assert.equal(quantizeFlatInteriors(raster(20,20,()=>[200,0,0,180]),8,20,20).flatInteriors,false);
});
test('Auto white policy uses detected colors and honors explicit keep/all preferences', () => {
  const p=raster(64,64,(x,y)=>x>15&&x<48&&y>15&&y<48?[0,0,0,255]:[255,255,255,255]);
  const a=detectAutoSettings(p,64,64); assert.equal(a.detectedColors,2); assert.equal(a.options.whiteMode,'all');
  for (const mode of ['none','all']) assert.equal(detectAutoSettings(p,64,64,64,mode).options.whiteMode,mode);
  assert.equal(resolveAutoWhite(3,'background'),'background'); assert.equal(resolveAutoWhite(2,'background'),'all');
  assert.throws(()=>resolveAutoWhite(2,'invalid'),/Default/);
});
test('changing the Auto white default resets Auto jobs while retaining Manual results', () => {
  const queue = new TraceBatch(), options = { colors: 2, tolerance: .2, minArea: 12, smooth: true, removeWhite: true, whiteMode: 'all' };
  const config = { mode: 'auto', resolution: 1024, options }, output = { result: { svg: '<svg/>' } };
  queue.items = ['auto','manual'].map((mode,id)=>({id:String(id),config:{...config,mode},status:'success',progress:100,label:'Selesai',output,autoSettings:{resolution:1024,options}}));
  queue.resetAutoSettings();
  assert.equal(queue.items[0].status,'pending'); assert.equal(queue.items[0].output,undefined);
  assert.equal(queue.items[1].status,'success'); assert.equal(queue.items[1].output,output); assert.equal(queue.items[1].config.options,options);
  assert.ok(queue.items.every(item=>!item.autoSettings));
});
test('final Auto retries 16 colors only when measured quality earns the richer palette', () => {
  const pixels=raster(48,48,x=>x<24?[40,102,73,255]:[233,174,119,255]);
  const result=x=>({svg:`<svg><path fill="#286649" fill-rule="evenodd" d="M0 0L${x} 0L${x} 48L0 48Z"/><path fill="#e9ae77" fill-rule="evenodd" d="M${x} 0L48 0L48 48L${x} 48Z"/></svg>`,width:48,height:48,paths:2,contours:2,segments:8,colors:['#286649','#e9ae77'],diagnostics:{}});
  const options={colors:8,tolerance:.2,minArea:4,smooth:true,removeWhite:true,whiteMode:'background'},calls=[];
  const output=traceAutoFinal(pixels,48,48,1024,options,options,undefined,(_p,_w,_h,o)=>{calls.push(o.colors);return result(o.colors===16?24:23);});
  assert.deepEqual(calls,[8,16]);assert.equal(output.fallback,'palette');assert.equal(output.options.colors,16);assert.equal(output.attempts,2);
  const old=result(23),next=result(24),oldMetrics=evaluateSvgScene(old.svg,pixels,48,48,true),nextMetrics=evaluateSvgScene(next.svg,pixels,48,48,true);
  assert.equal(acceptAutoPalette(old,oldMetrics,next,nextMetrics),true);
  assert.equal(acceptAutoPalette(old,oldMetrics,{...next,paths:12},nextMetrics),false);
  assert.equal(acceptAutoPalette(old,oldMetrics,{...next,segments:30},nextMetrics),false);
  assert.equal(acceptAutoPalette(old,oldMetrics,next,{...nextMetrics,edgeError:oldMetrics.edgeError*2}),false);
  const kept=traceAutoFinal(pixels,48,48,1024,options,options,undefined,()=>old);
  assert.equal(kept.fallback,'none');assert.equal(kept.options.colors,8);
  for(const whiteMode of ['none','all']) {
    const specified={...options,whiteMode};let attempts=0;
    traceAutoFinal(pixels,48,48,1024,specified,specified,undefined,()=>{attempts++;return old;});assert.equal(attempts,1);
  }
  let attempts=0;
  assert.throws(()=>traceAutoFinal(pixels,48,48,1024,options,options,undefined,()=>{
    if(++attempts===1)return old;const error=new Error('Cancelled');error.name='AbortError';throw error;
  }),{name:'AbortError'});
});
test('simplex fit recovers three-color junctions with nonnegative normalized weights', () => {
  const model=new ColorMixture([[255,0,0],[0,255,0],[0,0,255]],[0,1,2]);
  assert.ok(model.fit(new Uint8ClampedArray([128,76,51,255]),0,7)<.001);
  assert.ok([...model.weights].every(v=>v>=0)); assert.ok(Math.abs(model.weights.reduce((a,b)=>a+b,0)-1)<1e-10);
  assert.equal(model.heaviest(),0); assert.equal(model.fit(new Uint8ClampedArray(4),0,0),Infinity);
});
test('transition growth rejects joining islands, diagonal jumps and closing holes', () => {
  const labels=new Int16Array(25).fill(0), at=12;
  labels[11]=1; labels[13]=1; assert.equal(canGrowTransitionLabel(labels,at,1,5,5),false);
  labels[13]=0; assert.equal(canGrowTransitionLabel(labels,at,1,5,5),true);
  labels[11]=0; labels[6]=1; assert.equal(canGrowTransitionLabel(labels,at,1,5,5),false);
  labels.fill(1); labels[at]=0; assert.equal(canGrowTransitionLabel(labels,at,1,5,5),false);
});
test('mixture cleanup retains a source-supported thin accent and alpha boundaries', () => {
  const palette=[[255,0,0],[0,0,255],[150,30,150]];
  const p=raster(40,20,x=>[...palette[x===20?2:x<20?0:1],255]);
  const labels=Int16Array.from({length:800},(_,i)=>i%40===20?2:i%40<20?0:1), original=new Int16Array(labels);
  cleanTransitionMixtures(p,labels,palette,40,20,{...transitionDefaults}); assert.deepEqual(labels,original);
  for(let y=0;y<20;y++) p[(y*40+20)*4+3]=180;
  cleanTransitionMixtures(p,labels,palette,40,20,{...transitionDefaults}); assert.deepEqual(labels,original);
});
test('mixture cleanup removes a long unsupported false-color band beyond the area cleanup limit', () => {
  const palette=[[255,0,0],[0,0,255],[0,255,0]], w=40,h=64;
  const p=raster(w,h,x=>x===20?[128,0,128,255]:[...palette[x<20?0:1],255]);
  const labels=Int16Array.from({length:w*h},(_,i)=>i%w===20?2:i%w<20?0:1), diagnostics={...transitionDefaults};
  const stats=cleanTransitionMixtures(p,labels,palette,w,h,diagnostics);
  assert.equal(stats.reassignedPixels,h); assert.equal(labels.includes(2),false);
  assert.equal(diagnostics.mixtureRegionsChanged,1); assert.ok(diagnostics.mixtureFits>=h);
});
const seamSvg = '<svg width="12" height="8" viewBox="0 0 12 8"><path fill="#000000" fill-rule="evenodd" d="M1 1L11 1L11 7L1 7Z"/><path fill="#ff0000" fill-rule="evenodd" d="M2 2L6 2L6 6L2 6Z"/><path fill="#00ff00" fill-rule="evenodd" d="M6 2L10 2L10 6L6 6Z"/><path fill="#000000" fill-rule="evenodd" d="M5 3L7 3L7 5L5 5Z"/></svg>';
test('seam underpaint stays inside artwork, respects later ink and exports EPS clipping', () => {
  const p=raster(12,8,(x,y)=>x<1||x>=11||y<1||y>=7?[0,0,0,0]:x<2||x>=10||y<2||y>=6||x>=5&&x<7&&y>=3&&y<5?[0,0,0,255]:x<6?[255,0,0,255]:[0,255,0,255]);
  const base={svg:seamSvg,width:12,height:8,paths:4,contours:4,segments:16,colors:['#000000','#ff0000','#00ff00'],diagnostics:{}};
  const painted=underpaint(base); assert.equal(painted.diagnostics.underpaintPairs,1); assert.ok(painted.diagnostics.underpaintPaths>0);
  assert.ok(evaluateSvgScene(painted.svg,p,12,8).error<1e-20);
  const ps=generatePostScript(painted.svg); assert.ok(ps.includes('clip\nnewpath')); assert.equal((ps.match(/setrgbcolor/g)??[]).length,painted.paths);
  assert.equal(underpaint(painted),painted);
});
test('nonzero clip winding excludes a reversed hole instead of painting definitions', () => {
  const svg='<svg><defs><clipPath id="c"><path clip-rule="nonzero" d="M0 0L8 0L8 8L0 8ZM2 2L2 6L6 6L6 2Z"/></clipPath></defs><path fill="#ff0000" fill-rule="evenodd" clip-path="url(#c)" d="M0 0L8 0L8 8L0 8Z"/></svg>';
  const p=raster(8,8,(x,y)=>x>=2&&x<6&&y>=2&&y<6?[0,0,0,0]:[255,0,0,255]);
  assert.ok(evaluateSvgScene(svg,p,8,8).error<1e-20);
});
