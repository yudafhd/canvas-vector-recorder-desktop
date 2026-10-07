import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { moduleUrl } from './helpers/tracing-module.mjs';
const { stockSvg, checkStockSize } = await import(await moduleUrl('stock-export'));
const { generatePostScript, parseSvgDimensions } = await import(await moduleUrl('eps-export'));
const { batchZip } = await import(await moduleUrl('batch-zip'));
const { tracingSvgPaths } = await import(await moduleUrl('svg-paths'));
// Run the production browser export path; only the native host is simulated.
let renderer = ts.transpileModule(await readFile(new URL('../src/tracing/export-render.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const host = 'data:text/javascript;base64,' + Buffer.from('export const isTauri=()=>false;export const invoke=()=>{throw new Error("Unexpected native export");};').toString('base64');
renderer = renderer.replaceAll("'@tauri-apps/api/core'", JSON.stringify(host));
for (const [, dependency] of renderer.matchAll(/from ['"]\.\/([^'"]+)['"]/g)) {
  renderer = renderer.replaceAll(`'./${dependency}'`, JSON.stringify(await moduleUrl(dependency)));
}
const { renderExport } = await import('data:text/javascript;base64,' + Buffer.from(renderer).toString('base64'));

test('stock exports fit 15–65 MP while preserving geometry and centering EPS', () => {
  for (const [w,h] of [[1024,1024],[2048,1529],[10000,10000],[2400,32]]) {
    const original = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path fill="#000000" d="M0 0L${w} 0L${w} ${h}Z"/></svg>`;
    const svg = stockSvg(original);
    const { width, height } = parseSvgDimensions(svg);
    assert.ok(width * height >= 15_000_000 && width * height <= 65_000_000);
    assert.equal(svg.match(/<path.*$/)[0], original.match(/<path.*$/)[0]);
    assert.match(svg, new RegExp(`viewBox="0 0 ${w} ${h}"`));
    assert.match(generatePostScript(svg), new RegExp(`%%BoundingBox: 0 0 ${width} ${height}`));
    assert.equal(stockSvg(svg), svg);
  }
  const svg = stockSvg('<svg width="1024" height="1024" viewBox="0 0 1024 1024"><path d="M0 0L1024 0L1024 1024Z"/></svg>');
  assert.match(generatePostScript(svg), /3\.7822 3\.7822 scale/);
});

test('stock export rejects invalid dimensions and files above 45 MB', () => {
  for (const box of ['0 0 0 4', '0 0 NaN 4', '1 0 4 4']) assert.throws(() => stockSvg(`<svg viewBox="${box}"></svg>`));
  checkStockSize(new Uint8Array(45_000_000));
  assert.throws(() => checkStockSize(new Uint8Array(45_000_001)), /45 MB/);
  assert.throws(() => batchZip([{ filename: 'large.eps', svg: '', bytes: new Uint8Array(45_000_001) }]), /45 MB/);
});

test('browser export layout preserves underpaint clipping in SVG and EPS', async () => {
  const domain = 'M1 1L7 1L7 7L1 7ZM3 3L3 5L5 5L5 3Z';
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><defs><clipPath id="seam" clipPathUnits="userSpaceOnUse"><path clip-rule="nonzero" d="${domain}"/></clipPath></defs><path fill="#ff0000" fill-rule="evenodd" clip-path="url(#seam)" d="M0 0L8 0L8 8L0 8Z"/></svg>`;
  for (const removeWhiteBackground of [true, false]) {
    const settings = { minMp:15, maxMp:65, ratio:'4:5', artworkScale:1.3, removeWhiteBackground };
    const svg = await renderExport(source, settings, 'svg', 'clipped');
    assert.match(svg, /<clipPath id="seam" clipPathUnits="userSpaceOnUse">/);
    const paths = tracingSvgPaths(svg);
    assert.equal(paths.length, removeWhiteBackground ? 1 : 2, 'definitions are not painted');
    assert.equal(paths.at(-1).clip, domain);
    assert.match(paths.at(-1).original, /transform="matrix\(/);
    assert.doesNotMatch(svg.match(/<defs>[\s\S]*?<\/defs>/)[0], /transform=/, 'clip uses the painted path coordinate system');
    const eps = await renderExport(source, settings, 'eps', 'clipped');
    assert.equal(eps.match(/\nclip\n/g)?.length, 1);
    assert.equal(eps.match(/setrgbcolor/g)?.length, removeWhiteBackground ? 1 : 2);
    assert.match(eps, /3 3 moveto\n3 5 lineto\n5 5 lineto\n5 3 lineto\nclosepath\nclip\n/);
    assert.ok(eps.indexOf('concat\n') < eps.indexOf('\nclip\n'));
  }
});
