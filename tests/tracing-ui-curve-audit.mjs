// Operates on the actual exported UI geometry; it does not recreate Canvas input.
import fs from 'node:fs/promises';
import ts from 'typescript';
import assert from 'node:assert/strict';
const root='RND/tracing-quality/barong-curves-v12';
const source=await fs.readFile('src/tracing/engine.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:99,module:99}}).outputText;
const {compactSmoothCurves,curveDeviation}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const loops=JSON.parse(await fs.readFile(root+'/ui-curves.json','utf8'));
let before=0,after=0;
const paths=loops.map(({fill,curves})=>{
 const compact=compactSmoothCurves(curves);before+=curves.length;after+=compact.length;
 // All original line commands must survive unchanged, particularly tongue slit.
 for(const c of curves.filter(c=>!c.controls))assert.ok(compact.some(q=>JSON.stringify(q)===JSON.stringify(c)));
 assert.deepEqual(compact[0].from,curves[0].from);
 assert.deepEqual(compact.at(-1).to,curves.at(-1).to);
 const xy=p=>p.map(v=>Math.round(v*1000)/1000).join(' ');
 return `<path fill="${fill}" fill-rule="evenodd" d="M${xy(compact[0].from)}${compact.map(c=>c.controls?'C'+xy(c.controls[0])+' '+xy(c.controls[1])+' '+xy(c.to):'L'+xy(c.to)).join('')}Z"/>`;
});
await fs.writeFile(root+'/candidate.svg',`<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="4000" viewBox="0 0 1024 1024">${paths.join('')}</svg>`);
await fs.writeFile(root+'/compaction.json',JSON.stringify({before,after,removed:before-after,note:'Experimental processing of exported UI paths, not a fresh Tauri trace; production uses shared chains before export.'},null,2));
console.log({before,after,removed:before-after});
