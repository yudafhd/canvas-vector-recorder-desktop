import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { Worker } from 'node:worker_threads';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { moduleUrl } from './helpers/tracing-module.mjs';
const { TraceBatch, batchEntries, saveBatch, loadBatch }=await import(await moduleUrl('batch'));
const { batchZip }=await import(await moduleUrl('batch-zip'));
const { runTraceWorker }=await import(await moduleUrl('file-task'));
const config={mode:'auto',resolution:1024,options:{colors:6,tolerance:.8,minArea:4,smooth:true,removeWhite:false,whiteMode:'none'}};
const file=(name='a.png')=>new File(['image-bytes'],name,{type:'image/png',lastModified:1234});
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><path fill="#000000" fill-rule="evenodd" d="M0 0L8 0L8 8Z"/></svg>';
const output={result:{svg,width:8,height:8,paths:1,contours:1,segments:3,colors:['#000000'],diagnostics:{}}};

test('batch isolates failures, snapshots settings, retries and processes strictly sequentially',async()=>{
  const queue=new TraceBatch();queue.add([file('ok.png'),file('bad.png'),file('last.png')],config);
  config.options.colors=9;assert.equal(queue.items[0].config.options.colors,6);config.options.colors=6;
  let active=0,max=0;const calls=[];
  await queue.run(async(item,_signal,progress)=>{active++;max=Math.max(max,active);calls.push(item.file.name);progress(50,'Half');progress(20,'Earlier');assert.equal(item.progress,50);await new Promise(resolve=>setTimeout(resolve,1));active--;if(item.file.name==='bad.png')throw new Error('Corrupt image');return structuredClone(output);});
  assert.equal(max,1);assert.deepEqual(calls,['ok.png','bad.png','last.png']);assert.deepEqual(queue.items.map(i=>i.status),['success','error','success']);
  queue.retry(queue.items[1].id,{...config,resolution:512});await queue.run(async()=>structuredClone(output));
  assert.ok(queue.items.every(i=>i.status==='success'));assert.equal(queue.items[1].config.resolution,512);
  queue.remove(queue.items[1].id);assert.equal(queue.items.length,2);queue.remove();assert.equal(queue.items.length,0);
});

test('cancel keeps completed results, rejects late output, and resumes remaining jobs once',async()=>{
  const queue=new TraceBatch();queue.add([file('first.png'),file('cancel.png'),file('last.png')],config);
  let release,started;const waiting=new Promise(resolve=>started=resolve);
  const running=queue.run(async item=>{if(item.file.name==='first.png')return output;started();return new Promise(resolve=>release=resolve);});
  await waiting;assert.equal(queue.running,true);queue.cancel();release(output);await running;
  assert.deepEqual(queue.items.map(i=>i.status),['success','pending','pending']);assert.equal(queue.items[1].output,undefined);
  let jobs=0;await queue.run(async()=>{jobs++;return output;});assert.equal(jobs,2);assert.ok(queue.items.every(i=>i.status==='success'));
});

test('batch input validation is atomic and rejects unsupported files and count overflow',()=>{
  const queue=new TraceBatch();assert.throws(()=>queue.add([file(),new File(['x'],'bad.svg',{type:'image/svg+xml'})],config),/gunakan/);assert.equal(queue.items.length,0);
  assert.throws(()=>queue.add(Array.from({length:51},()=>file()),config),/50/);
  queue.add([file()],config);assert.equal(queue.items.length,1);
});

test('IndexedDB restores source bytes, results, errors and interrupted jobs in original order',async()=>{
  const queue=new TraceBatch();queue.add([file('a.png'),file('b.png'),file('c.png')],config);
  queue.items[0].status='success';queue.items[0].output=output;queue.items[0].progress=100;
  queue.items[1].status='processing';queue.items[1].progress=77;
  queue.items[2].status='error';queue.items[2].error='Corrupt image';
  await saveBatch(queue.items);queue.items[0].file=file('mutated.png');queue.items[0].output=undefined;
  const restored=await loadBatch();assert.deepEqual(restored.map(i=>i.file.name),['a.png','b.png','c.png']);
  assert.deepEqual(restored.map(i=>i.status),['success','pending','error']);assert.equal(restored[1].progress,0);assert.equal(restored[0].output.result.svg,svg);assert.equal(restored[2].error,'Corrupt image');
  assert.equal(await restored[0].file.text(),'image-bytes');assert.equal(restored[0].file.lastModified,1234);
  const resumed=new TraceBatch();resumed.items=restored;let jobs=0;await resumed.run(async()=>{jobs++;return output;});assert.equal(jobs,1);
  const first=saveBatch(resumed.items),second=saveBatch([]);await Promise.all([first,second]);assert.deepEqual(await loadBatch(),[]);
});

test('ZIP includes only successful SVGs with safe, case-insensitive unique names',async t=>{
  const queue=new TraceBatch();queue.add([file('Art.png'),file('art.jpg'),file('CON.png'),file('../oops.png'),file('error.png')],config);
  for(const item of queue.items.slice(0,4)){item.status='success';item.output=output;}queue.items[4].status='error';
  const entries=batchEntries(queue.items);assert.deepEqual(entries.map(e=>e.filename),['Art.svg','art_1.svg','vector-CON.svg','---oops.svg']);
  const zip=batchZip(entries),view=new DataView(zip.buffer);assert.equal(view.getUint32(0,true),0x04034b50);assert.equal(view.getUint16(zip.length-22+10,true),4);
  const directory=await mkdtemp(join(tmpdir(),'cvr-batch-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));const path=join(directory,'results.zip');await writeFile(path,zip);
  // Independent platform ZIP reader, without extracting to the filesystem.
  const script="Add-Type -AssemblyName System.IO.Compression.FileSystem; $archive=[IO.Compression.ZipFile]::OpenRead($env:CVR_BATCH_ZIP_TEST); try { $archive.Entries | ForEach-Object { $reader=[IO.StreamReader]::new($_.Open()); try { [PSCustomObject]@{name=$_.FullName;svg=$reader.ReadToEnd()} } finally { $reader.Dispose() } } | ConvertTo-Json -Compress } finally { $archive.Dispose() }";
  const read=JSON.parse(process.platform==='win32'
    ? execFileSync('powershell.exe',['-NoProfile','-Command',script],{env:{...process.env,CVR_BATCH_ZIP_TEST:path},encoding:'utf8'})
    : execFileSync('python3',['-c','import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps([dict(name=n,svg=z.read(n).decode()) for n in z.namelist()]))',path],{encoding:'utf8'}));
  assert.deepEqual(read.map(e=>e.name),entries.map(e=>e.filename));assert.ok(read.every((e,i)=>e.svg===entries[i].svg));
  assert.ok(read.every(e=>{ const w=Number(e.svg.match(/width="([^"]+)"/)[1]), h=Number(e.svg.match(/height="([^"]+)"/)[1]); return w*h>=15_000_000 && w*h<=65_000_000; }));
});

function createWorker(url){const native=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:m=>parentPort.postMessage(m)};import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});const worker={onmessage:null,onerror:null,postMessage:(data,transfer)=>native.postMessage(data,transfer),terminate:()=>native.terminate()};native.on('message',data=>worker.onmessage?.({data}));native.on('error',error=>worker.onerror?.(error));return worker;}
test('batch task executes the real worker and preserves document dimensions and SVG viewBox',async()=>{
  const url=await moduleUrl('worker'),pixels=new Uint8ClampedArray(32*32*4).fill(255);
  for(let y=8;y<24;y++)for(let x=8;x<24;x++)pixels.set([0,0,0,255],(y*32+x)*4);
  const result=await runTraceWorker(pixels,32,32,config,2400,2400,new AbortController().signal,()=>{},()=>createWorker(url));
  assert.match(result.result.svg,/width="2400" height="2400" viewBox="0 0 32 32"/);assert.equal(result.auto.options.colors,2);
});
test('batch task cancellation terminates the worker and does not publish its result',async()=>{
  const url=await moduleUrl('worker'),signal=new AbortController(),pixels=new Uint8ClampedArray(192*192*4).fill(255);
  const task=runTraceWorker(pixels,192,192,config,192,192,signal.signal,()=>signal.abort(),()=>createWorker(url));
  await assert.rejects(task,{name:'AbortError'});
});

test('repeated start does not duplicate jobs; processing jobs cannot be removed or replaced',async()=>{
  const queue=new TraceBatch();queue.add([file()],config);let release,started;const ready=new Promise(resolve=>started=resolve),id=queue.items[0].id;
  const running=queue.run(async()=>{started();return new Promise(resolve=>release=resolve);});await ready;
  let duplicates=0;await queue.run(async()=>{duplicates++;return output;});queue.remove();queue.retry(id,{...config,resolution:512});
  assert.throws(()=>queue.add([file()],config),/Batalkan/);assert.equal(queue.items.length,1);assert.equal(queue.items[0].status,'processing');assert.equal(queue.items[0].config.resolution,1024);
  release(output);await running;assert.equal(duplicates,0);
});

test('manual batch keeps requested options and does not return Auto metadata',async()=>{
  const url=await moduleUrl('worker'),pixels=new Uint8ClampedArray(16*16*4).fill(255);
  for(let y=4;y<12;y++)for(let x=4;x<12;x++)pixels.set([0,0,0,255],(y*16+x)*4);
  const result=await runTraceWorker(pixels,16,16,{...config,mode:'manual',options:{...config.options,smooth:false,minArea:0}},16,16,new AbortController().signal,()=>{},()=>createWorker(url));
  assert.equal(result.auto,undefined);assert.deepEqual(result.result.colors,['#ffffff','#000000']);assert.doesNotMatch(result.result.svg,/C[0-9]/);
});

test('each item adopts its own Auto settings on mode changes and selected runs leave other jobs untouched',async()=>{
  const queue=new TraceBatch();queue.add([file('first.png'),file('second.png')],config);
  const [a,b]=queue.items,firstAuto={resolution:2048,options:{...config.options,colors:2,tolerance:.2,minArea:12,whiteMode:'background',removeWhite:true}},secondAuto={resolution:1024,options:{...config.options,colors:4,tolerance:.35,minArea:0}};
  queue.setDetected(a.id,firstAuto);queue.setDetected(b.id,secondAuto);queue.switchMode(a.id,'manual');
  assert.deepEqual(a.config,{...firstAuto,mode:'manual'});assert.deepEqual(b.config,{...secondAuto,mode:'auto'});
  queue.updateConfig(a.id,{...a.config,options:{...a.config.options,colors:9},resolution:512});
  queue.switchMode(a.id,'auto');queue.switchMode(a.id,'manual');assert.deepEqual(a.config,{...firstAuto,mode:'manual'});assert.equal(b.config.options.colors,4);
  await queue.run(async()=>output,[a.id]);assert.equal(a.status,'success');assert.equal(b.status,'pending');
  queue.switchMode(a.id,'auto');assert.equal(a.output,undefined);assert.equal(a.status,'pending');
  const final={...firstAuto,resolution:1024,options:{...firstAuto.options,tolerance:.35}};
  await queue.run(async()=>({...output,auto:final}),[a.id]);assert.equal(a.config.resolution,1024);
  queue.switchMode(a.id,'manual');assert.equal(a.config.options.tolerance,.35);assert.equal(b.config.options.tolerance,.35);
  await saveBatch(queue.items);const restored=await loadBatch();assert.deepEqual(restored[0].config,a.config);assert.deepEqual(restored[0].autoSettings,final);assert.deepEqual(restored[1].config,b.config);await saveBatch([]);
});

test('EPS batch export generates DOS EPS binary header, XMP packet and embedded TIFF preview',async()=>{
  const { buildDosEpsSync }=await import(await moduleUrl('eps-export'));
  const queue=new TraceBatch();queue.add([file('Sample.png')],config);
  queue.items[0].status='success';queue.items[0].output=output;
  const entries=batchEntries(queue.items,'eps');
  assert.equal(entries[0].filename,'Sample.eps');
  const zip=batchZip(entries);
  assert.ok(zip.length>100);

  // Directly verify buildDosEpsSync
  const eps=buildDosEpsSync(svg,'Sample');
  assert.equal(eps[0],0xc5);assert.equal(eps[1],0xd0);assert.equal(eps[2],0xd3);assert.equal(eps[3],0xc6);
  const view=new DataView(eps.buffer,eps.byteOffset,eps.byteLength);
  const psOffset=view.getUint32(4,true);
  const psLen=view.getUint32(8,true);
  const tiffOffset=view.getUint32(20,true);
  const tiffLen=view.getUint32(24,true);
  const checksum=view.getUint16(28,true);
  assert.equal(psOffset,30);
  assert.equal(tiffOffset,30+psLen);
  assert.equal(checksum,0xffff);
  assert.ok(tiffLen>180);

  // Verify TIFF header
  assert.equal(eps[tiffOffset],0x49); // 'I'
  assert.equal(eps[tiffOffset+1],0x49); // 'I'
  assert.equal(view.getUint16(tiffOffset+2,true),42); // 42

  // Verify PostScript string contains DSC comments and XMP packet
  const decoder=new TextDecoder();
  const psText=decoder.decode(eps.subarray(psOffset,psOffset+psLen));
  assert.match(psText,/%!PS-Adobe-3\.0 EPSF-3\.0/);
  assert.match(psText,/%XMPbegin: XMP/);
  assert.match(psText,/%XMPend:/);
  assert.match(psText,/%%BoundingBox:/);
  assert.match(psText,/showpage\n%%EOF/);

  // Verify rectangular aspect ratio is preserved in preview TIFF
  const rectSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1529" viewBox="0 0 2048 1529"><path fill="#000" d="M0 0L2048 0L2048 1529Z"/></svg>';
  const rectEps = buildDosEpsSync(rectSvg, 'Rect');
  const rectView = new DataView(rectEps.buffer, rectEps.byteOffset, rectEps.byteLength);
  const rectTiffOffset = rectView.getUint32(20, true);
  const rectTiffW = rectView.getUint32(rectTiffOffset + 18, true);
  const rectTiffH = rectView.getUint32(rectTiffOffset + 30, true);
  assert.equal(rectTiffW, 32);
  assert.equal(rectTiffH, 24);
});
