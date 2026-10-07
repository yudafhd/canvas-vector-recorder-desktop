import fs from 'node:fs/promises';
import ts from 'typescript';
const modules = new Map();
async function moduleUrl(name) {
  if (modules.has(name)) return modules.get(name);
  const source = await fs.readFile(`src/tracing/${name}.ts`, 'utf8');
  let js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  for (const [, dependency] of js.matchAll(/from ['"]\.\/([^'"]+)['"]/g)) js = js.replaceAll(`'./${dependency}'`, `'${await moduleUrl(dependency)}'`);
  const url = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64'); modules.set(name, url); return url;
}
const { traceAuto } = await import(await moduleUrl('auto-trace'));
const pixels = new Uint8ClampedArray(await fs.readFile(process.argv[3] ?? 'RND/star-quality/source.rgba'));
const width = Number(process.argv[4] ?? 1024), height = pixels.length / width / 4, start = performance.now();
const output = traceAuto(pixels, width, height);
const report = { milliseconds: Math.round(performance.now() - start), ...output.auto, paths: output.result.paths, contours: output.result.contours, segments: output.result.segments, width: output.result.width, height: output.result.height, diagnostics: output.result.diagnostics };
const name = process.argv[2] ?? 'auto';
await fs.writeFile(`RND/star-quality/${name}.svg`, output.result.svg);
await fs.writeFile(`RND/star-quality/${name}-report.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
