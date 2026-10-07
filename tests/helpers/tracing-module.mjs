import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const modules = new Map();
export async function moduleUrl(name) {
  if (modules.has(name)) return modules.get(name);
  const source = await readFile(new URL(`../../src/tracing/${name}.ts`, import.meta.url), 'utf8');
  let js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  for (const [, dependency] of js.matchAll(/from ['"]\.\/([^'"]+)['"]/g)) js = js.replaceAll(`'./${dependency}'`, `'${await moduleUrl(dependency)}'`).replaceAll(`"./${dependency}"`, `"${await moduleUrl(dependency)}"`);
  const url = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64'); modules.set(name, url); return url;
}
