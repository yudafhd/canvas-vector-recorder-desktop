import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleUrl } from './helpers/tracing-module.mjs';
const { evaluateSvgScene, sceneAllows } = await import(await moduleUrl('scene-quality'));
const { balanceStrokeCurvature, strokeRoughness, strokeSelfIntersects, oppositeStrokeSides, strokeWithin, flattenStroke } = await import(await moduleUrl('stroke-regularizer'));
const { traceRaster, curveDeviation } = await import(await moduleUrl('engine'));

test('scene gate rejects masked detail damage and tile damage hidden by global improvement', () => {
  const before = { error: .01, detailError: .02, edgeError: .03, edgePixels: 10, tiles: new Float64Array([1, 1]) };
  assert.equal(sceneAllows(before, { ...before, error: .009 }), true);
  assert.equal(sceneAllows(before, { ...before, error: .009, detailError: .021 }), false);
  assert.equal(sceneAllows(before, { ...before, error: .009, edgeError: .031 }), false);
  assert.equal(sceneAllows(before, { ...before, error: .009, tiles: new Float64Array([.5, 1.04]) }), false);
  assert.equal(sceneAllows(before, { ...before, detailError: Infinity }), false);
  const rgba = new Uint8ClampedArray(32 * 16 * 4).fill(255), mask = new Uint8Array(32 * 16); mask[4 * 32 + 4] = 1;
  const perfect = '<svg><path fill="#ffffff" fill-rule="evenodd" d="M0 0L32 0L32 16L0 16Z"/></svg>';
  const damaged = perfect.replace('</svg>', '<path fill="#000000" fill-rule="evenodd" d="M4 4L5 4L5 5L4 5Z"/></svg>');
  const old = evaluateSvgScene(perfect, rgba, 32, 16, false, mask), changed = evaluateSvgScene(damaged, rgba, 32, 16, false, mask);
  assert.equal(old.detailError, 0); assert.equal(changed.detailError, .75);
  assert.equal(sceneAllows(old, changed), false);
  assert.throws(() => evaluateSvgScene(perfect, rgba, 32, 16, false, new Uint8Array(1)), /Ukuran/);
});

test('curvature balancing reduces roughness without moving anchors, corners or endpoints', () => {
  const curves = Array.from({length:8}, (_,i) => {
    const a = i * Math.PI / 4, b = (i + 1) * Math.PI / 4, p = [30*Math.cos(a),30*Math.sin(a)], q = [30*Math.cos(b),30*Math.sin(b)], h = i%2 ? 6 : 9;
    return { from:p, to:q, controls:[[p[0]-h*Math.sin(a),p[1]+h*Math.cos(a)],[q[0]+h*Math.sin(b),q[1]-h*Math.cos(b)]] };
  });
  curves.at(-1).to = curves[0].from;
  const original = structuredClone(curves), balanced = balanceStrokeCurvature(curves,.5);
  assert.notEqual(balanced,curves); assert.ok(strokeRoughness(balanced)<strokeRoughness(curves)); assert.deepEqual(curves,original);
  for(let i=0;i<curves.length;i++) { assert.deepEqual(balanced[i].from,curves[i].from); assert.deepEqual(balanced[i].to,curves[i].to); }
  assert.equal(strokeSelfIntersects(balanced),false);
  const corners = Array.from({length:6},(_,i)=>({from:[i*4,0],to:[(i+1)*4,0],controls:[[i*4,3],[(i+1)*4,3]]}));
  assert.equal(balanceStrokeCurvature(corners,.5),corners);
});

test('opposite stroke boundaries pair across the width and skip protected caps', () => {
  const points = [...Array.from({length:40},(_,i)=>[i,0]),...Array.from({length:40},(_,i)=>[39-i,3])], corners = new Set([0,39,40,79]);
  const pairs=oppositeStrokeSides(points,true,corners);
  for(const i of corners)assert.equal(pairs[i],-1);
  for(let i=5;i<35;i++) { assert.equal(pairs[i],79-i); assert.equal(pairs[pairs[i]],i); }
  const crossing=[{from:[0,0],to:[10,10]},{from:[10,10],to:[0,10]},{from:[0,10],to:[10,0]}];
  assert.equal(strokeSelfIntersects(crossing),true);
});

test('spatial stroke deviation guard agrees with independent dense fitter measurement', () => {
  const curve = [{from:[-5,0],to:[30,10],controls:[[2,15],[20,-5]]}], samples=flattenStroke(curve);
  for(const dy of [0,.1,.29,.31,1]) {
    const moved=samples.map(([x,y])=>[x,y+dy]);
    assert.equal(strokeWithin(curve,moved,.3),curveDeviation(curve,moved)<=.3);
  }
  assert.equal(strokeWithin([{from:[0,0],to:[10,0]}],[[0,1],[10,1]],.3),false);
});

test('core emits measured scene diagnostics and conservatively selects protected detail', () => {
  const w=48,h=32,pixels=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)pixels.set(x>=10&&x<=30&&y>=8&&y<=23?[30,60,180,255]:x===37&&(y===15||y===16)?[230,40,30,255]:[255,255,255,255],(y*w+x)*4);
  const result=traceRaster(pixels,w,h,{colors:3,tolerance:.8,minArea:12,smooth:true,removeWhite:false});
  const measured=evaluateSvgScene(result.svg,pixels,w,h),d=result.diagnostics;
  assert.equal(d.sceneErrorAfter,measured.error); assert.equal(d.sceneEdgeAfter,measured.edgeError);
  assert.equal(d.protectedDetailCandidates,2); assert.equal(d.detailProtectionAccepted,1);
  assert.ok(result.colors.includes('#e6281e')); assert.ok(d.sceneErrorAfter<=d.sceneErrorBefore*1.01+1e-9);
});

test('production global regularization improves a curved thin stroke and safely rejects worse proposals', () => {
  const w=80,h=128,pixels=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) { const center=40+8*Math.sin(y/15)+Math.sin(y*1.1)*.2;pixels.set(y>8&&y<120&&Math.abs(x-center)<4?[0,0,0,255]:[255,255,255,255],(y*w+x)*4); }
  const options={colors:2,tolerance:.8,minArea:0,smooth:true,removeWhite:true};
  const result=traceRaster(pixels,w,h,options),d=result.diagnostics,measured=evaluateSvgScene(result.svg,pixels,w,h,true);
  assert.ok(d.globalCandidates>0);assert.ok(d.globalAccepted>0);assert.equal(d.regularizedChains,1);
  assert.ok(d.sceneErrorAfter<d.sceneErrorBefore);assert.ok(d.sceneEdgeAfter<d.sceneEdgeBefore);
  assert.equal(d.sceneErrorAfter,measured.error);assert.equal(result.paths,1);assert.equal(result.contours,1);
  // Opaque-source fitting can now also improve the simpler tolerance, as in Java.
  const simpler=traceRaster(pixels,w,h,{...options,tolerance:1.6}).diagnostics;
  assert.ok(simpler.globalCandidates>0);assert.ok(simpler.sceneErrorAfter<=simpler.sceneErrorBefore);
  assert.ok(simpler.sceneEdgeAfter<=simpler.sceneEdgeBefore*1.02+1e-9);
});

test('protected detail recovers when cleanup leaves no baseline foreground to export', () => {
  const pixels=new Uint8ClampedArray(16*16*4).fill(255);
  for(const y of [8,9])pixels.set([0,0,0,255],(y*16+8)*4);
  const result=traceRaster(pixels,16,16,{colors:2,tolerance:.2,minArea:12,smooth:true,removeWhite:true});
  assert.deepEqual(result.colors,['#000000']);assert.equal(result.diagnostics.detailProtectionAccepted,1);
  assert.equal(result.diagnostics.protectedDetailPixels,2);assert.equal(result.paths,1);
});
