import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/tracing/engine.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { regularizeShallowDents, compactSmoothCurves, straightSpans, refinePaletteInteriors, cleanTransitionRegions, curveDeviation, coverageObjective, polygonPixelArea, angularPrior, traceRaster, fitFixedEnds, cornerFeatures, probablyPunctured, chooseFragmentOperation, complexityThresholds, mergeThresholdSchedule, chooseBoundaryCandidate } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const defaults = { colors: 3, tolerance: 0.1, minArea: 0, smooth: false, removeWhite: false };
const palette = [[240, 40, 40, 255], [255, 255, 255, 255], [20, 60, 220, 255], [0, 0, 0, 0]];
function raster(w, h, label) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(palette[label(x, y)], (y * w + x) * 4);
  return data;
}
// Independent point-in-polygon rasterization of generated SVG paths, including holes and cubics.
function readPaths(svg) {
  return [...svg.matchAll(/<path fill="(#[a-f0-9]+)" fill-rule="evenodd" d="([^"]+)"/g)].map(([, fill, d]) => {
    const tokens = d.match(/[MLCZ]|[-+]?\d+(?:\.\d+)?/g);
    const loops = []; let loop = [], p;
    for (let i = 0; i < tokens.length;) {
      const command = tokens[i++];
      if (command === 'M' || command === 'L') { p = [Number(tokens[i++]), Number(tokens[i++])]; loop.push(p); }
      else if (command === 'C') {
        const c = [Number(tokens[i++]), Number(tokens[i++])], e = [Number(tokens[i++]), Number(tokens[i++])], b = [Number(tokens[i++]), Number(tokens[i++])];
        for (let k = 1; k <= 32; k++) { const t = k / 32, u = 1 - t; loop.push([0, 1].map(axis => u ** 3 * p[axis] + 3 * u * u * t * c[axis] + 3 * u * t * t * e[axis] + t ** 3 * b[axis])); }
        p = b;
      } else if (command === 'Z') { loops.push(loop); loop = []; }
      else throw new Error('Unknown path command: ' + command);
    }
    return { fill, loops };
  });
}
function at(paths, x, y) {
  let color = null;
  for (const path of paths) {
    let inside = false;
    for (const loop of path.loops) for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [xi, yi] = loop[i], [xj, yj] = loop[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) color = path.fill;
  }
  return color;
}
const hex = color => '#' + color.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');

test('tracer preserves topology at diagonal contacts, holes, disconnected regions and transparency', () => {
  let random = 12345;
  for (let trial = 0; trial < 20; trial++) {
    const w = 8 + trial % 5, h = 9, labels = Array.from({ length: w * h }, () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return (random >>> 16) % 4; });
    const result = traceRaster(raster(w, h, (x, y) => labels[y * w + x]), w, h, defaults);
    const paths = readPaths(result.svg);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const label = labels[y * w + x];
      assert.equal(at(paths, x + 0.5, y + 0.5), label === 3 ? null : hex(palette[label]), `trial ${trial}, pixel ${x},${y}`);
    }
  }
});

test('donut has an empty center and editable paths without embedded raster', () => {
  const result = traceRaster(raster(12, 12, (x, y) => x >= 2 && x < 10 && y >= 2 && y < 10 && !(x >= 4 && x < 8 && y >= 4 && y < 8) ? 0 : 3), 12, 12, defaults);
  assert.equal(result.contours, 2);
  assert.equal(at(readPaths(result.svg), 5.5, 5.5), null);
  assert.equal(at(readPaths(result.svg), 2.5, 5.5), '#f02828');
  assert.doesNotMatch(result.svg, /<image|data:|script/);
});

test('two-region diagonal is simplified and retains shared coverage', () => {
  const size = 64, result = traceRaster(raster(size, size, (x, y) => x + y < size - 1 ? 0 : 1), size, size, { ...defaults, colors: 2, tolerance: 0.8, smooth: true });
  assert.equal(result.paths, 2);
  assert.ok(result.segments < 30, `segments: ${result.segments}`);
  const paths = readPaths(result.svg);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    assert.notEqual(at(paths, x + 0.5, y + 0.5), null);
    if (Math.abs(x + y - size + 1) > 2) assert.equal(at(paths, x + 0.5, y + 0.5), x + y < size - 1 ? '#f02828' : '#ffffff');
  }
});

test('curved contour uses cubic segments while keeping its interior and exterior', () => {
  const result = traceRaster(raster(80, 80, (x, y) => (x - 40) ** 2 + (y - 40) ** 2 < 28 ** 2 ? 0 : 3), 80, 80, { ...defaults, tolerance: 0.8, smooth: true });
  assert.match(result.svg, /C/); assert.ok(result.segments < 50);
  assert.ok(result.diagnostics.unitFragments > 0 && result.diagnostics.merges > 0, 'production curve fitting must execute fragment merging');
  const paths = readPaths(result.svg);
  assert.equal(at(paths, 40, 40), '#f02828'); assert.equal(at(paths, 4, 4), null);
});

test('noise cleanup and white removal are explicit and do not erase the foreground', () => {
  const image = raster(10, 10, (x, y) => x > 2 && x < 7 && y > 2 && y < 7 ? 0 : x === 0 && y === 0 ? 2 : 1);
  const result = traceRaster(image, 10, 10, { ...defaults, minArea: 3, removeWhite: true });
  const paths = readPaths(result.svg);
  assert.equal(at(paths, 0.5, 0.5), null); assert.equal(at(paths, 4.5, 4.5), '#f02828');
  assert.equal(result.paths, 1);
});

test('invalid, fully transparent, and empty-after-removal input report errors', () => {
  assert.throws(() => traceRaster(new Uint8ClampedArray(0), 0, 0, defaults), /Ukuran/);
  assert.throws(() => traceRaster(raster(4, 4, () => 3), 4, 4, defaults), /transparan/);
  assert.throws(() => traceRaster(raster(4, 4, () => 1), 4, 4, { ...defaults, removeWhite: true }), /Tidak ada bidang/);
  assert.throws(() => traceRaster(raster(4, 4, () => 0), 4, 4, { ...defaults, colors: NaN }), /Pengaturan/);
});

test('smooth closed curves retain tangent continuity at fitted joins and the closing seam', () => {
  const result = traceRaster(raster(96, 96, (x, y) => (x + 0.5 - 48) ** 2 + (y + 0.5 - 48) ** 2 < 32 ** 2 ? 0 : 3), 96, 96, { ...defaults, tolerance: 0.8, smooth: true });
  const d = result.svg.match(/ d="([^"]+)"/)[1];
  const tokens = d.match(/[MLCZ]|[-+]?\d+(?:\.\d+)?/g), segments = [];
  let p;
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++];
    if (command === 'M') p = [Number(tokens[i++]), Number(tokens[i++])];
    if (command === 'L') {
      const b = [Number(tokens[i++]), Number(tokens[i++])], direction = b.map((v, k) => v - p[k]);
      segments.push({ start: direction, end: direction }); p = b;
    }
    if (command === 'C') {
      const c = [Number(tokens[i++]), Number(tokens[i++])], e = [Number(tokens[i++]), Number(tokens[i++])], b = [Number(tokens[i++]), Number(tokens[i++])];
      segments.push({ start: c.map((v, k) => v - p[k]), end: b.map((v, k) => v - e[k]) }); p = b;
    }
  }
  assert.ok(segments.length < 30);
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i].end, b = segments[(i + 1) % segments.length].start;
    const cosine = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b));
    assert.ok(cosine > 0.999, `join ${i}: cosine ${cosine}`);
  }
  for (const p of readPaths(result.svg)[0].loops[0]) assert.ok(Math.abs(Math.hypot(p[0] - 48, p[1] - 48) - 32) < 1.25, 'circle must remain within the geometric error budget');
});

test('smoothing preserves a sharp tip and a narrow connected branch', () => {
  const labels = (x, y) => (y >= 8 && y <= 48 && Math.abs(x - 32) <= (y - 8) / 2) || (x >= 31 && x <= 33 && y > 48 && y <= 58) ? 0 : 3;
  const result = traceRaster(raster(64, 64, labels), 64, 64, { ...defaults, tolerance: 0.8, smooth: true });
  const paths = readPaths(result.svg);
  assert.equal(at(paths, 32.5, 9.5), '#f02828');
  for (let y = 12; y <= 57; y++) assert.equal(at(paths, 32.5, y + 0.5), '#f02828', `disconnected branch at ${y}`);
  assert.equal(at(paths, 27, 10), null);
});

test('layered nested colors preserve transparency through every ancestor', () => {
  const w = 28, h = 28;
  const label = (x, y) => {
    if (x >= 4 && x < 24 && y >= 4 && y < 24) {
      if (x >= 8 && x < 20 && y >= 8 && y < 20) {
        if (x >= 11 && x < 17 && y >= 11 && y < 17) return 3;
        return 0;
      }
      return 2;
    }
    return 1;
  };
  const result = traceRaster(raster(w, h, label), w, h, defaults), paths = readPaths(result.svg);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const color = label(x, y);
    assert.equal(at(paths, x + 0.5, y + 0.5), color === 3 ? null : hex(palette[color]), `nested pixel ${x},${y}`);
  }
});

test('transition cleanup suppresses mixed edge colors while preserving a real patch, thin line and alpha', () => {
  const w = 48, h = 24, pink = [248, 148, 148, 255];
  const pixels = raster(w, h, (x, y) => x < 24 ? 0 : 1);
  for (let y = 0; y < h; y++) pixels.set(pink, (y * w + 24) * 4);
  for (let y = 3; y <= 10; y++) for (let x = 34; x <= 42; x++) pixels.set(pink, (y * w + x) * 4);
  for (let x = 4; x <= 18; x++) pixels.set(palette[2], (16 * w + x) * 4);
  for (let y = 3; y <= 7; y++) for (let x = 4; x <= 8; x++) pixels.set(palette[3], (y * w + x) * 4);
  const result = traceRaster(pixels, w, h, { ...defaults, colors: 4, minArea: 4 }), paths = readPaths(result.svg);
  assert.equal(at(paths, 38.5, 6.5), '#f89494');
  for (let y = 0; y < h; y++) assert.notEqual(at(paths, 24.5, y + 0.5), '#f89494', `mixed edge remains at ${y}`);
  for (let x = 5; x < 18; x++) assert.equal(at(paths, x + 0.5, 16.5), '#143cdc', `thin line lost at ${x}`);
  assert.equal(at(paths, 6.5, 5.5), null);
});

test('high palette limit does not fragment similar edge tones or remove a genuine interior accent', () => {
  const w = 80, h = 64, pixels = raster(w, h, () => 1);
  for (let y = 8; y < 56; y++) for (let x = 8; x < 64; x++) {
    const edge = x < 10 || x >= 62 || y < 10 || y >= 54;
    const color = edge ? [240 + (x + y) % 3 * 4, 40 + (x + y) % 3 * 4, 40 + (x + y) % 3 * 4, 255] : palette[0];
    pixels.set(color, (y * w + x) * 4);
  }
  for (let y = 24; y < 32; y++) for (let x = 24; x < 32; x++) pixels.set([250, 95, 90, 255], (y * w + x) * 4);
  const settings = { ...defaults, colors: 16 };
  const untouched = traceRaster(pixels, w, h, settings);
  const cleaned = traceRaster(pixels, w, h, { ...settings, minArea: 4 });
  assert.ok(cleaned.contours < untouched.contours, 'edge shades must consolidate');
  assert.equal(cleaned.colors.length, 3, 'background, foreground and accent remain');
  assert.equal(at(readPaths(cleaned.svg), 28.5, 28.5), '#fa5f5a');
  assert.equal(at(readPaths(cleaned.svg), 4.5, 4.5), '#ffffff');
});

test('subpixel smoothing follows an antialiased circle within a pixel without introducing extra regions', () => {
  const w = 80, h = 80, center = [39.35, 40.2], radius = 26.7, pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let inside = 0;
    for (let sy = 0; sy < 8; sy++) for (let sx = 0; sx < 8; sx++)
      if (Math.hypot(x + (sx + 0.5) / 8 - center[0], y + (sy + 0.5) / 8 - center[1]) < radius) inside++;
    const coverage = inside / 64;
    pixels.set([240 * coverage + 255 * (1 - coverage), 40 * coverage + 255 * (1 - coverage), 40 * coverage + 255 * (1 - coverage), 255], (y * w + x) * 4);
  }
  const result = traceRaster(pixels, w, h, { ...defaults, colors: 2, tolerance: 0.35, smooth: true });
  const paths = readPaths(result.svg), foreground = at(paths, ...center);
  const loops = paths.filter(p => p.fill === foreground).flatMap(p => p.loops);
  assert.equal(result.colors.length, 2);
  assert.equal(loops.length, 1);
  const errors = loops[0].map(p => Math.abs(Math.hypot(p[0] - center[0], p[1] - center[1]) - radius));
  assert.ok(Math.max(...errors) < 1, `maximum radial error ${Math.max(...errors)}`);
  assert.ok(errors.reduce((sum, v) => sum + v, 0) / errors.length < 0.3, 'mean radial error must stay subpixel');
});

const reference = JSON.parse(await readFile(new URL('./fixtures/tracing-research-reference.json', import.meta.url), 'utf8'));
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);

test('fixed-end fitting matches independent dense solver for n=0/1/2/3/4+, including regularization and short-branch costs', () => {
  for (const example of reference.fitting) {
    const result = fitFixedEnds(example.points);
    result.curve.controls.flat().forEach((v, i) => close(v, example.controls.flat()[i], 'control coordinate'));
    result.times.forEach((v, i) => close(v, example.times[i], 'fixed chord parameter'));
    close(result.cost, example.cost, 'returned fragment cost');
    close(result.maxError, example.maxError, 'independent maximum-error guard');
  }
  const short = fitFixedEnds([[0, 0], [1, 0], [4, 0]]);
  assert.equal(short.cost, 0, 'short branch measures linear residual');
  assert.ok(short.maxError > 0, 'collinear cubic parameterization has a different residual');
  const cubic = fitFixedEnds(reference.fitting[4].points);
  assert.ok(cubic.cost < 1e-5 * cubic.curve.controls.flat().reduce((sum, v) => sum + v * v, 0) + reference.fitting[4].cost, 'returned cost must exclude the ridge penalty');
});

test('corner classifier matches static disassembly interpreter at exact and adjacent thresholds', () => {
  assert.equal(reference.classifier.length, 1036);
  for (const [values, expected] of reference.classifier) {
    const features = Array(21).fill(0);
    reference.classifierFeatureIndices.forEach((index, i) => { features[index] = values[i]; });
    assert.equal(probablyPunctured(features), expected, JSON.stringify(values));
  }
  for (const example of reference.geometry) cornerFeatures(example.points).forEach((value, i) => close(value, example.features[i], 'seven-point feature ' + i));
  assert.equal(probablyPunctured(cornerFeatures([[-3, 0], [-2, 0], [-1, 0], [0, 0], [0, 1], [0, 2], [0, 3]])), true);
  assert.equal(probablyPunctured(cornerFeatures([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]])), false);
});

test('merge/swap honors strict thresholds, finite metrics and minus-before-plus priority', () => {
  assert.equal(chooseFragmentOperation(0.1, 0.2, -4, -10), 'merge');
  assert.equal(chooseFragmentOperation(0.2, 0.2, -4, -10), 'swap-');
  assert.equal(chooseFragmentOperation(0.2, 0.2, 0, -10), 'swap+');
  assert.equal(chooseFragmentOperation(0.2, 0.2, 0, 0), 'keep');
  assert.equal(chooseFragmentOperation(NaN, 0.2, NaN, -1), 'swap+');
  assert.equal(chooseFragmentOperation(-Infinity, 0.2, Infinity, Infinity), 'keep');
});

test('merge schedule scans before updating and does not clamp geometric growth', () => {
  const regular = mergeThresholdSchedule(1, 16, 4, 0.5);
  regular.forEach((v, i) => close(v, [1, 4, 16, 16][i], 'scheduled threshold'));
  const fractional = mergeThresholdSchedule(1, 16, 4, 0.6);
  assert.ok(fractional[3] > 16, 'the recovered schedule is not min(T*q,Tf)');
  for (const row of reference.complexity) {
    const result = complexityThresholds(row.value);
    assert.equal(result.initial, row.initial, 'T0 from phase4 CSV at ' + row.value);
    assert.equal(result.final, row.final, 'Tf from phase4 CSV at ' + row.value);
  }
});

test('local tracing follows recovered direction order, first-cell context and last fallback', () => {
  const candidates = [{ direction: 2, first: [1, 1] }, { direction: 0, first: [0, 0] }];
  assert.equal(chooseBoundaryCandidate(candidates), 1, 'west before east without context');
  assert.equal(chooseBoundaryCandidate(candidates, [0, 0]), 1);
  assert.equal(chooseBoundaryCandidate(candidates, [1, 1]), 0);
  assert.equal(chooseBoundaryCandidate(candidates, [3, 3]), 0, 'last ordered candidate is fallback');
  assert.equal(chooseBoundaryCandidate([]), -1, 'our empty-list handling remains independent');
});


test('coverage clipping conserves area and angular gradient matches finite differences', () => {
  const polygon = [[.2,.3],[2.4,.3],[2.4,1.7],[.2,1.7]];
  let area = 0;
  for (let y=0;y<3;y++) for(let x=0;x<3;x++) area += polygonPixelArea(polygon,x,y);
  assert.ok(Math.abs(area-2.2*1.4)<1e-12);
  const p = [[.1,.2],[1.3,.8],[2.1,2.4]], result=angularPrior(...p, 2, 3, .25);
  for(let i=0;i<3;i++) for(let k=0;k<2;k++) {
    const a=structuredClone(p),b=structuredClone(p); a[i][k]+=1e-6;b[i][k]-=1e-6;
    const numerical=(angularPrior(...a,2,3,.25).energy-angularPrior(...b,2,3,.25).energy)/2e-6;
    assert.ok(Math.abs(numerical-result.gradient[i][k])<1e-7);
  }
});

test('swept coverage gradient matches independently perturbed closed and open boundaries', () => {
  const field={width:4,height:4,observed:new Uint8ClampedArray(64).fill(180),predicted:new Float64Array(64).fill(.5)};
  for(const raw of [[[1,1],[2,1],[2,2],[1,2],[1,1]],[[1,1],[2,1],[2,2]]]) {
    const objective=coverageObjective(raw,field,[.7,-.2,.3,0]);
    const closed=raw.length===5;
    const points=raw.slice(0,closed?-1:undefined).map(([x,y],i)=>[x+.13+(i%2)*.07,y-.17]);
    const result=objective.evaluate(points);
    for(let i=closed?0:1;i<points.length-(closed?0:1);i++) for(let k=0;k<2;k++) {
      const a=structuredClone(points),b=structuredClone(points);a[i][k]+=1e-6;b[i][k]-=1e-6;
      const numerical=(objective.evaluate(a,false).energy-objective.evaluate(b,false).energy)/2e-6;
      assert.ok(Math.abs(numerical-result.gradient[i][k])<1e-7, `${i},${k}: ${numerical} / ${result.gradient[i][k]}`);
    }
  }
});


test('coverage refinement preserves a small closed feature and reduces its raster objective', () => {
  const data=raster(16,16,(x,y)=>x>=7&&x<9&&y>=7&&y<9?0:1);
  const result=traceRaster(data,16,16,{...defaults,colors:2,smooth:true,tolerance:.35});
  assert.ok(result.diagnostics.smallAreaConstraints>0);
  assert.ok(result.diagnostics.rasterEnergyAfter<=result.diagnostics.rasterEnergyBefore+1e-9);
  const paths=readPaths(result.svg);
  assert.equal(at(paths,8,8),'#f02828');
  assert.equal(at(paths,6,8),'#ffffff');
});


test('buffered raster clipping matches polygon reference and reused predictions retain gradients', () => {
  let seed = 912341;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const raw = [[1,1],[2,1],[2,2],[1,2],[1,1]];
  const field = { width: 4, height: 4, observed: new Uint8ClampedArray(64).fill(127), predicted: new Float64Array(64).fill(.5) };
  const difference = [.6,-.3,.1,.2], objective = coverageObjective(raw,field,difference);
  for(let sample=0;sample<64;sample++) {
    const points = raw.slice(0,-1).map(p=>p.map(v=>v+(sample%8===0?0:(random()-.5)*1.2)));
    const expected = Float64Array.from(objective.indices.flatMap(()=>[.5,.5,.5,.5]));
    for(let i=0;i<4;i++) for(let p=0;p<objective.indices.length;p++) {
      const id=objective.indices[p],x=id%4,y=Math.floor(id/4),a=points[i],b=points[(i+1)%4];
      const area=polygonPixelArea([raw[i],raw[i+1],b],x,y)+polygonPixelArea([raw[i],b,a],x,y);
      for(let c=0;c<4;c++) expected[p*4+c]+=area*difference[c];
    }
    const candidate=objective.evaluate(points,false), full=objective.evaluate(points);
    assert.deepEqual(candidate.predicted,expected);
    assert.deepEqual(objective.differentiate(points,candidate.predicted),full.gradient);
    assert.equal(candidate.energy,full.energy);
  }
});


test('export guard detects overshoot between exact endpoints, including straight replacements', () => {
  const points=[[0,0],[1,0]];
  assert.equal(curveDeviation([{from:[0,0],to:[1,0]}],points),0);
  const overshoot={from:[0,0],to:[1,0],controls:[[0,2],[1,2]]};
  // Endpoints have zero error, but the cubic rises to y=1.5 at t=.5.
  assert.ok(Math.abs(curveDeviation([overshoot],points)-1.5)<1e-12);
  assert.ok(curveDeviation([{from:[0,0],to:[2,0]}],[[0,0],[1,1],[2,0]])>.6);
});


test('region mixture cleanup rejects exact-color details, isolated dots, alpha and disabled mode', () => {
  const width=20,height=16;
  function fixture({exact=false,alpha=255,isolated=false}={}) {
    const colors=[[255,255,255],[0,0,0],exact?[110,110,110]:[120,130,100]];
    const labels=new Int16Array(width*height),rgba=new Uint8ClampedArray(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const p=y*width+x; labels[p]=!isolated&&x>=10?1:0;
      rgba.set([...colors[labels[p]],255],p*4);
    }
    for(let y=6;y<10;y++){const p=y*width+9;labels[p]=2;rgba.set([110,110,110,alpha],p*4);}
    return {colors,labels,rgba};
  }
  const artifact=fixture(),result=cleanTransitionRegions(artifact.rgba,artifact.labels,artifact.colors,width,height,4);
  assert.equal(result.mergedRegions,1);assert.equal(result.reassignedPixels,4);
  assert.equal(artifact.labels[7*width+9],1);
  for(const options of [{exact:true},{alpha:200},{isolated:true}]){
    const f=fixture(options),before=new Int16Array(f.labels);
    assert.equal(cleanTransitionRegions(f.rgba,f.labels,f.colors,width,height,4).mergedRegions,0);
    assert.deepEqual(f.labels,before);
  }
  const f=fixture();assert.equal(cleanTransitionRegions(f.rgba,f.labels,f.colors,width,height,0).mergedRegions,0);
});


test('palette interiors recover a small coherent color without adding palette entries', () => {
  const width=24,height=20,rgba=new Uint8ClampedArray(width*height*4),labels=new Int16Array(width*height);
  const colors=[[255,255,255],[120,130,122],[30,50,80]], green=[134,152,110];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x,inside=x>=5&&x<11&&y>=6&&y<12;
    labels[p]=inside?1:0;rgba.set([...(inside?green:colors[0]),255],p*4);
  }
  // One-pixel stroke lacks interior support; its existing color must survive.
  for(let x=3;x<20;x++){labels[16*width+x]=2;rgba.set([30,50,80,255],(16*width+x)*4);}
  assert.equal(refinePaletteInteriors(rgba,labels,colors,width,height),1);
  assert.deepEqual(colors,[[255,255,255],green,[30,50,80]]);
  assert.equal(labels[8*width+8],1);assert.equal(labels[16*width+8],2);
  assert.equal(refinePaletteInteriors(rgba,labels,colors,width,height),0);
});

test('palette interior estimation ignores transparent and partially transparent samples', () => {
  const colors=[[100,120,100]],labels=new Int16Array(64),rgba=new Uint8ClampedArray(256);
  for(let i=0;i<64;i++)rgba.set([140,160,120,i%2?0:200],i*4);
  const before=structuredClone(colors);
  assert.equal(refinePaletteInteriors(rgba,labels,colors,8,8),0);
  assert.deepEqual(colors,before);
});


test('straight spans recognize long jittered edges while retaining bends, corners and reversals', () => {
  const points=Array.from({length:101},(_,i)=>[i, .2*i + .08*Math.sin(i)]);
  const spans=straightSpans(points,.8);
  assert.equal(spans.length,1);assert.equal(spans[0].start,0);assert.equal(spans[0].end,100);
  assert.ok(spans[0].error<=.35);
  assert.equal(straightSpans(points,.8,new Set([50])).length,0);
  assert.equal(straightSpans(points.slice(0,20),.8).length,0);
  assert.equal(straightSpans(Array.from({length:101},(_,i)=>[80*Math.cos(i*Math.PI/100),80*Math.sin(i*Math.PI/100)]),.8).length,0);
  assert.equal(straightSpans([[0,0],[55,0],[40,0],[100,0]],.8).length,0);
});


test('actual UI tongue boundaries are recognized despite subpixel oscillation at high detail', async () => {
  const fixture=JSON.parse(await readFile(new URL('./fixtures/barong-ui-lines.json',import.meta.url),'utf8'));
  for(const {samples} of Object.values(fixture.boundaries)) for(const tolerance of [.35,.8]) {
    const spans=straightSpans(samples,tolerance);
    assert.equal(spans.length,1);assert.equal(spans[0].start,0);assert.equal(spans[0].end,samples.length-1);
    assert.ok(spans[0].error<=.65);
  }
  // A shallow coherent bow has a similar amplitude but must remain curved.
  const bow=Array.from({length:101},(_,i)=>[i,.6*Math.sin(Math.PI*i/100)]);
  assert.equal(straightSpans(bow,.35).length,0);
});


test('export compaction reduces redundant smooth cubics while keeping endpoint directions and protected corners', () => {
  const a=[0,0],c=[4,0],d=[10,6],b=[10,10];
  const mid=(a,b)=>a.map((v,i)=>(v+b[i])/2);
  const ac=mid(a,c),cd=mid(c,d),db=mid(d,b),left=mid(ac,cd),right=mid(cd,db),center=mid(left,right);
  const curves=[{from:a,to:center,controls:[ac,left]},{from:center,to:b,controls:[right,db]}];
  const result=compactSmoothCurves(curves);
  assert.equal(result.length,1);assert.deepEqual(result[0].from,a);assert.deepEqual(result[0].to,b);
  assert.equal(result[0].controls[0][1],0);assert.equal(result[0].controls[1][0],10);
  assert.deepEqual(compactSmoothCurves(curves,[center]),curves);
  const line={from:b,to:[10,70]};assert.deepEqual(compactSmoothCurves([...curves,line]).at(-1),line);
  const corner=[curves[0],{from:center,to:[15,5],controls:[[8,1],[14,5]]}];
  assert.deepEqual(compactSmoothCurves(corner),corner);
  const loop=[{from:[0,0],to:[5,5],controls:[[4,0],[5,2]]},{from:[5,5],to:[0,0],controls:[[5,8],[-4,0]]}];
  assert.deepEqual(compactSmoothCurves(loop),loop);
});


test('shallow dent regularization protects corners, deep notches and open boundaries', () => {
  const make=depth=>{
    const p=[];for(let x=0;x<=30;x++)p.push([x,x>10&&x<20?depth:0]);
    for(let y=1;y<=30;y++)p.push([30,y]);for(let x=29;x>=0;x--)p.push([x,30]);for(let y=29;y>=0;y--)p.push([0,y]);return p;
  };
  const shallow=make(.4),result=regularizeShallowDents(shallow);
  assert.equal(result[15][1],0);assert.deepEqual(result[30],[30,0]);assert.deepEqual(shallow[15],[15,.4]);
  assert.deepEqual(regularizeShallowDents(shallow,new Set([15])),shallow);
  const deep=make(3);assert.deepEqual(regularizeShallowDents(deep),deep);
  assert.deepEqual(regularizeShallowDents(shallow.slice(0,-1)),shallow.slice(0,-1));
  assert.deepEqual(regularizeShallowDents([...shallow].reverse()),[...result].reverse());
});


test('strong cleanup preserves source-supported light slots enclosed by dark outlines', () => {
  const w=40,h=24,data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const slot=y>=7&&y<15&&((x>=9&&x<11)||(x>=15&&x<17)||(x>=21&&x<23));
    data.set(slot?[244,232,216,255]:[15,15,15,255],(y*w+x)*4);
  }
  const result=traceRaster(data,w,h,{...defaults,colors:2,minArea:24,smooth:false});
  const paths=readPaths(result.svg);
  for(const x of [9.5,15.5,21.5])assert.equal(at(paths,x,10.5),'#f4e8d8');
  assert.equal(at(paths,13,10.5),'#0f0f0f');
});
