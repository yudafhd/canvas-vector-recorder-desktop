import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import 'fake-indexeddb/auto';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { Worker as NativeWorker } from 'node:worker_threads';
import { moduleUrl } from './helpers/tracing-module.mjs';

// Execute the actual page/controller DOM handlers. Only host APIs (canvas,
// image decoding and native save) are simulated; tracing uses the real worker.
const urls=new Map();
async function uiModule(name) {
  if(urls.has(name))return urls.get(name);
  const source=await readFile(new URL(`../src/tracing/${name}.ts`,import.meta.url),'utf8');
  let js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  js=js.replace(/import ['"]\.\/tracing\.css['"];?/g,'');
  const bridge='data:text/javascript;base64,'+Buffer.from("export const isTauri=()=>true;export const invoke=async(command,args)=>{globalThis.__tracingExports.push({command,args});return 'Downloads/result.svg';};").toString('base64');
  js=js.replaceAll("'@tauri-apps/api/core'",JSON.stringify(bridge));
  for(const [,dependency] of js.matchAll(/from ['"]\.\/([^'"]+)['"]/g))js=js.replaceAll(`'./${dependency}'`,JSON.stringify(await uiModule(dependency)));
  js=js.replace(/new URL\(['"]\.\/worker\.ts['"], import\.meta\.url\)/g,"new URL('file:///tracing-worker.ts')");
  const url='data:text/javascript;base64,'+Buffer.from(js).toString('base64');urls.set(name,url);return url;
}
const workerUrl=await moduleUrl('worker'),live=new Set();
class BrowserWorker {
  onmessage=null;onerror=null;
  constructor(){this.native=new NativeWorker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:m=>parentPort.postMessage(m)};import(${JSON.stringify(workerUrl)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});live.add(this);this.native.on('message',data=>this.onmessage?.({data}));this.native.on('error',error=>this.onerror?.(error));}
  postMessage(data,transfer){this.native.postMessage(data,transfer);}
  terminate(){live.delete(this);return this.native.terminate();}
}
const wait=async predicate=>{for(let i=0;i<250;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Timed out waiting for workspace state');};

test('list → item editor → Auto/Manual → selected tracing → export keeps per-item settings',async t=>{
  const dom=new Window({url:'http://localhost:1420',settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableComputedStyleRendering:true}});
  const originalCreateURL=URL.createObjectURL,originalRevokeURL=URL.revokeObjectURL,liveUrls=new Set();
  URL.createObjectURL=blob=>{const url=originalCreateURL(blob);liveUrls.add(url);return url;};
  URL.revokeObjectURL=url=>{liveUrls.delete(url);originalRevokeURL(url);};
  Object.assign(globalThis,{window:dom,document:dom.document,Event:dom.Event,localStorage:dom.localStorage,Worker:BrowserWorker,requestAnimationFrame:fn=>setImmediate(()=>fn(performance.now())),__tracingExports:[]});
  globalThis.Image=class{naturalWidth=32;naturalHeight=32;src='';async decode(){}};
  dom.HTMLCanvasElement.prototype.toBlob=function(callback){queueMicrotask(()=>callback(new Blob(['thumbnail'],{type:'image/png'})));};
  dom.HTMLCanvasElement.prototype.getContext=function(){const canvas=this;return {drawImage(){},getImageData(){const p=new Uint8ClampedArray(canvas.width*canvas.height*4).fill(255);for(let y=8;y<24;y++)for(let x=8;x<24;x++)p.set([0,0,0,255],(y*canvas.width+x)*4);return {data:p};}};};
  dom.HTMLElement.prototype.scrollTo=function(x,y){this.scrollLeft=x;this.scrollTop=y;};
  const {initTracing}=await import(await uiModule('page'));const {loadBatch,saveBatch}=await import(await uiModule('batch'));await saveBatch([]);
  t.after(async()=>{try{dom.dispatchEvent(new dom.Event('beforeunload'));await Promise.all([...live].map(worker=>worker.terminate()));await saveBatch([]);await dom.happyDOM.close();}finally{URL.createObjectURL=originalCreateURL;URL.revokeObjectURL=originalRevokeURL;}});
  const root=dom.document.createElement('main');root.className='tracing-page';dom.document.body.append(root);initTracing(root);
  const $=id=>root.querySelector(`#${id}`),change=(id,value)=>{const el=$(id);el.value=String(value);el.dispatchEvent(new dom.Event('input',{bubbles:true}));};
  await wait(()=>!$('traceBatchAdd').disabled);
  assert.equal(root.dataset.traceView,'list');assert.equal($('traceEditor').hidden,true);
  const ids=[...root.querySelectorAll('[id]')].map(el=>el.id);assert.equal(new Set(ids).size,ids.length,'editor IDs must be unique');
  const sources=[new File(['a'],'first.png',{type:'image/png'}),new File(['b'],'second.png',{type:'image/png'})];
  const drop=new dom.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:{files:sources}});$('traceBatchEmpty').dispatchEvent(drop);
  await wait(()=>root.querySelectorAll('.trace-batch-item').length===2);
  await wait(()=>root.querySelectorAll('.trace-source-image[src]').length===2);
  assert.equal($('traceBatchItems').dataset.layout,'list');
  const firstThumbnail=root.querySelector('.trace-source-image').src;
  assert.match(firstThumbnail,/^blob:/);
  $('traceGridView').click();assert.equal($('traceBatchItems').dataset.layout,'grid');assert.equal($('traceGridView').getAttribute('aria-pressed'),'true');
  $('traceBatchSearch').value='FIRST';$('traceBatchSearch').dispatchEvent(new dom.Event('input'));
  assert.equal(root.querySelectorAll('.trace-batch-item:not([hidden])').length,1);
  root.querySelector('[data-filter="error"]').click();assert.equal($('traceBatchNoResults').hidden,false);
  $('traceResetFilters').click();assert.equal(root.querySelectorAll('.trace-batch-item:not([hidden])').length,2);assert.equal($('traceBatchSearch').value,'');
  $('tracePreviewVector').click();assert.equal(root.querySelector('.trace-vector-placeholder').hidden,false);assert.equal(root.querySelector('.trace-preview-source').hidden,true);
  $('tracePreviewSource').click();assert.equal(root.querySelector('.trace-source-image').src,firstThumbnail,'view changes reuse source thumbnails');
  assert.equal(root.dataset.traceView,'list');assert.equal($('traceEditor').hidden,true);
  root.hidden=true;
  const hiddenPaste=new dom.Event('paste',{cancelable:true});Object.defineProperty(hiddenPaste,'clipboardData',{value:{items:[{kind:'file',type:'image/png',getAsFile:()=>new File(['x'],'hidden.png',{type:'image/png'})}]}});dom.dispatchEvent(hiddenPaste);
  assert.equal(root.querySelectorAll('.trace-batch-item').length,2);assert.equal(hiddenPaste.defaultPrevented,false);root.hidden=false;
  root.querySelector('.trace-batch-thumbnail').click();await wait(()=>!$('traceMode').disabled&&$('traceAutoSummary').textContent.includes('Pengaturan awal'));
  assert.equal(root.dataset.traceView,'detail');assert.equal($('traceBatch').hidden,true);assert.equal($('traceMode').value,'auto');
  $('traceModePillManual').click();assert.equal($('traceModePillManual').getAttribute('aria-pressed'),'true');assert.equal($('traceColors').value,'2');assert.equal($('traceDetail').value,'0.2');assert.equal($('traceWhite').value,'all');
  assert.equal($('traceEditorTitle').textContent,'first.png');
  change('traceColors',9);change('traceResolution',512);change('traceDetail',1.6);
  $('traceBack').click();await wait(()=>!$('traceBatchAdd').disabled);assert.equal(root.dataset.traceView,'list');
  root.querySelectorAll('.trace-batch-name')[1].click();await wait(()=>!$('traceSettings').disabled&&!$('traceMode').disabled&&$('traceFileInfo').textContent==='second.png'&&$('traceAutoSummary').textContent.includes('Pengaturan awal'));
  assert.equal($('traceMode').value,'auto');change('traceMode','manual');assert.equal($('traceColors').value,'2');change('traceColors',4);
  $('traceBack').click();root.querySelectorAll('.trace-batch-name')[0].click();await wait(()=>!$('traceRun').disabled&&$('traceFileInfo').textContent==='first.png');
  assert.equal($('traceMode').value,'manual');assert.equal($('traceColors').value,'9');assert.equal($('traceResolution').value,'512');assert.equal($('traceDetail').value,'1.6');
  change('traceMode','auto');change('traceMode','manual');assert.equal($('traceColors').value,'2');assert.equal($('traceResolution').value,'1024');
  $('traceRun').click();await wait(()=>!$('traceDownload').disabled&&!$('traceRun').disabled);
  const firstVectorThumbnail=root.querySelector('.trace-vector-image').src;assert.match(firstVectorThumbnail,/^blob:/);
  assert.ok(root.querySelectorAll('.trace-item-palette span').length>0);
  change('traceExportRatio','4:5');change('traceExportMin','20');change('traceExportScale','80');
  assert.equal($('traceOutput').hidden,false);$('traceDownload').click();$('traceDownloadSvg').click();await wait(()=>globalThis.__tracingExports.length===1);
  assert.equal(globalThis.__tracingExports[0].command,'save_tracing_svg');assert.equal(globalThis.__tracingExports[0].args.filename,'first-traced.svg');
  assert.equal(globalThis.__tracingExports[0].args.settings.ratio,'4:5');assert.equal(globalThis.__tracingExports[0].args.settings.minPixels,20_000_000);assert.equal(globalThis.__tracingExports[0].args.settings.artworkScale,.8);
  await wait(()=>!$('traceDownload').disabled);
  change('traceExportBackground','remove');$('traceDownload').click();$('traceDownloadSvg').click();await wait(()=>globalThis.__tracingExports.length===2);
  assert.equal(globalThis.__tracingExports[1].args.settings.transparentBackground,true);assert.doesNotMatch(globalThis.__tracingExports[1].args.svg,/fill="#ffffff"/);
  await wait(()=>!$('traceDownload').disabled);
  $('traceBack').click();await wait(()=>$('traceBatchStorage').textContent.includes('tersimpan'));
  $('traceBatchExport').click();$('traceBatchExportSvg').click();await wait(()=>globalThis.__tracingExports.length===3);
  assert.equal(globalThis.__tracingExports[2].command,'save_tracing_batch');assert.equal(globalThis.__tracingExports[2].args.entries[0].settings.ratio,'4:5');assert.equal(globalThis.__tracingExports[2].args.entries[0].settings.transparentBackground,true);
  await wait(()=>!$('traceBatchExport').disabled);
  root.querySelector('[data-filter="success"]').click();assert.equal(root.querySelectorAll('.trace-batch-item:not([hidden])').length,1);
  $('tracePreviewVector').click();assert.equal(root.querySelector('.trace-vector-image').hidden,false);assert.equal(root.querySelector('.trace-vector-placeholder').hidden,true);
  root.querySelector('[data-filter="all"]').click();$('tracePreviewSource').click();
  const restored=await loadBatch();assert.equal(restored[0].status,'success');assert.equal(restored[1].status,'pending');assert.equal(restored[1].config.options.colors,4);
  root.querySelectorAll('.trace-batch-name')[1].click();await wait(()=>!$('traceRun').disabled&&$('traceFileInfo').textContent==='second.png');
  assert.equal($('traceColors').value,'4');assert.equal($('traceOutput').hidden,true);
  change('traceMode','auto');$('traceRun').click();await wait(()=>!$('traceRun').disabled&&!$('traceDownload').disabled);
  assert.equal($('traceColors').value,'2');change('traceMode','manual');assert.equal($('traceColors').value,'2');assert.equal($('traceOutput').hidden,true);
  assert.equal(root.querySelectorAll('.trace-vector-image[src]').length,1,'changing settings removes the stale second SVG thumbnail');
  Object.defineProperty($('traceFile'),'files',{configurable:true,value:[new File(['c'],'third.png',{type:'image/png'})]});$('traceFile').dispatchEvent(new dom.Event('change'));
  await wait(()=>root.querySelectorAll('.trace-batch-item').length===3&&$('traceBatchStorage').textContent.includes('tersimpan'));
  assert.equal(root.dataset.traceView,'list');assert.equal($('traceEditor').hidden,true);
  const current=await loadBatch();assert.equal(current[2].config.mode,'auto');assert.equal(current[2].config.options.colors,6);
  await wait(()=>root.querySelectorAll('.trace-source-image[src]').length===3);
  dom.dispatchEvent(new dom.Event('beforeunload'));root.remove();
  assert.equal(liveUrls.size,0,'closing the workspace releases editor and gallery URLs');
  const reopened=dom.document.createElement('main');reopened.className='tracing-page';dom.document.body.append(reopened);initTracing(reopened);
  await wait(()=>reopened.querySelectorAll('.trace-batch-item').length===3&&!reopened.querySelector('#traceBatchAdd').disabled);
  await wait(()=>reopened.querySelectorAll('.trace-source-image[src]').length===3);
  assert.equal(reopened.querySelector('#traceExportRatio').value,'4:5');assert.equal(reopened.querySelector('#traceExportMin').value,'20');assert.equal(reopened.querySelector('#traceExportScale').value,'80');
  assert.equal(reopened.querySelector('#traceBatchItems').dataset.layout,'grid','layout choice survives reopening');
  assert.equal(reopened.querySelectorAll('.trace-vector-image[src]').length,1,'completed SVG thumbnails are restored from saved results');
  assert.equal(reopened.dataset.traceView,'list');reopened.querySelectorAll('.trace-batch-name')[1].click();
  await wait(()=>reopened.querySelector('#traceFileInfo').textContent==='second.png'&&!reopened.querySelector('#traceRun').disabled);
  assert.equal(reopened.querySelector('#traceMode').value,'manual');assert.equal(reopened.querySelector('#traceColors').value,'2');
  reopened.querySelector('#traceBack').click();await wait(()=>!reopened.querySelector('#traceBatchAdd').disabled);
  const removedRow=reopened.querySelectorAll('.trace-batch-item')[2],removedThumbnail=removedRow.querySelector('.trace-source-image').src;
  assert.equal(liveUrls.has(removedThumbnail),true);removedRow.querySelector('.trace-remove-item').click();
  assert.equal(reopened.querySelectorAll('.trace-batch-item').length,2);assert.equal(liveUrls.has(removedThumbnail),false,'removing an item releases its source thumbnail');
});
