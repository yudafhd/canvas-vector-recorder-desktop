import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { Window } from 'happy-dom';

const dataModule=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const transpile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Navigation state did not settle');};

test('licensed startup → mode menu → Recorder/offline → menu keeps editor and hides native target',async t=>{
  const dom=new Window({url:'http://localhost:1420',settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableComputedStyleRendering:true}});
  Object.defineProperty(dom.navigator,'userAgent',{value:'Windows desktop test'});
  Object.assign(globalThis,{window:dom,document:dom.document,localStorage:dom.localStorage,Event:dom.Event});
  globalThis.setTimeout=dom.setTimeout.bind(dom);globalThis.clearTimeout=dom.clearTimeout.bind(dom);
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.navigator});
  dom.document.write((await readFile(new URL('../src/index.html',import.meta.url),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
  dom.HTMLCanvasElement.prototype.getContext=()=>null;
  t.after(()=>dom.happyDOM.close());
  const calls=[],events=new Map();let resolveLicense,traceInits=0;
  globalThis.__navigationHost={
    invoke:async(command,args)=>{calls.push({command,args});return null;},
    listen:async(event,callback)=>{events.set(event,callback);return ()=>{};},
    licenseStatus:()=>new Promise(resolve=>{resolveLicense=resolve;}),
    activateLicense:async()=>({valid:true}),
    initTracing:root=>{traceInits++;root.innerHTML='<h1>Tracing offline</h1><input id="savedManual" value="6">';},
  };
  t.after(()=>delete globalThis.__navigationHost);
  const host=dataModule('export const isTauri=()=>true;export const invoke=(...args)=>globalThis.__navigationHost.invoke(...args);export const listen=(...args)=>globalThis.__navigationHost.listen(...args);export const check=async()=>null;export const open=async()=>null;');
  const license=dataModule('export const licenseStatus=()=>globalThis.__navigationHost.licenseStatus();export const activateLicense=()=>globalThis.__navigationHost.activateLicense();export const normalizedEmail=s=>s.trim().toLowerCase();');
  const tracing=dataModule('export const initTracing=root=>globalThis.__navigationHost.initTracing(root);');
  const discover=dataModule('export const initDiscover=()=>({setEnabled(){}});');
  let source=await readFile(new URL('../src/main.ts',import.meta.url),'utf8');
  const iconImport=source.match(/import\s*\{([^{}]*?)\}\s*from 'lucide';/);
  const iconNames=iconImport[1].split(',').map(s=>s.trim()).filter(Boolean);
  const icons=dataModule(iconNames.map(name=>`export const ${name}=${name==='createIcons'?'()=>{}':'{}'};`).join(''));
  const mode=dataModule(transpile((await readFile(new URL('../src/mode-selection.ts',import.meta.url),'utf8')).replace(/import '\.\/mode-selection\.css';/,'')));
  // Run the production app controller against the real HTML. Only platform
  // services and the editor boundary are stubbed; the editor has its own worker test.
  source=source.replace(/import '\.\/styles\.css';/,'').replace(/import packageJson from '\.\.\/package\.json';/,'const packageJson={version:"test"};');
  for(const name of ['@tauri-apps/api/core','@tauri-apps/api/event','@tauri-apps/plugin-updater','@tauri-apps/plugin-dialog'])source=source.replaceAll(`'${name}'`,JSON.stringify(host));
  for(const [name,url] of [['lucide',icons],['./license',license],['./discover',discover],['./tracing/page',tracing],['./mode-selection',mode]])source=source.replaceAll(`'${name}'`,JSON.stringify(url));
  await import(dataModule(transpile(source)));
  dom.document.dispatchEvent(new dom.Event('DOMContentLoaded'));
  const $=id=>dom.document.getElementById(id);
  assert.equal($('onlineTracingChoice').disabled,true);
  $('offlineTracingChoice').click();assert.equal(traceInits,0);
  await wait(()=>resolveLicense);resolveLicense({valid:false,message:'Aktivasi diperlukan'});
  await wait(()=>!$('activationView').hidden);
  assert.equal($('modeSelectionView').hidden,true);assert.equal($('workspaceView').hidden,true);assert.equal($('tracingView').hidden,true);
  $('licenseEmail').value='user@example.com';$('licenseCode').value='test';$('activationForm').dispatchEvent(new dom.Event('submit',{cancelable:true}));
  await wait(()=>!$('modeSelectionView').hidden);
  assert.equal($('mainTabs').hidden,true);assert.equal($('landingView').hidden,true);assert.equal(traceInits,0);
  $('modeThemeToggle').click();assert.equal(dom.document.documentElement.dataset.theme,'dark');assert.equal($('modeThemeToggle').getAttribute('aria-pressed'),'true');
  $('onlineTracingChoice').click();assert.equal($('workspaceView').hidden,false);assert.equal($('tracingView').hidden,true);assert.equal($('modeSelectionView').hidden,true);assert.equal(traceInits,0);
  assert.equal($('tracingMainTab').hidden,true);assert.equal($('recorderMainTab').textContent.includes('Recorder'),true);
  $('homeMainTab').click();assert.equal($('modeSelectionView').hidden,false);assert.equal($('mainTabs').hidden,true);
  $('offlineTracingChoice').click();assert.equal($('tracingView').hidden,false);assert.equal($('workspaceView').hidden,true);assert.equal(traceInits,1);
  assert.equal($('recorderMainTab').hidden,true);assert.equal($('tracingMainTab').hidden,false);assert.equal($('newTargetMainTab').hidden,true);assert.equal($('targetMainTabs').hidden,true);assert.equal($('targetTabsCount').hidden,true);
  $('savedManual').value='9';const editor=$('savedManual');
  events.get('target-closed')({});assert.equal($('tracingView').hidden,false,'closing target must not interrupt offline editor');
  $('homeMainTab').click();$('offlineTracingChoice').click();assert.equal(traceInits,1);assert.equal($('savedManual'),editor);assert.equal($('savedManual').value,'9');
  events.get('target-tabs-updated')({payload:{active_id:'tab1',tabs:[{id:'tab1',title:'Example',url:'https://example.com'}]}});
  assert.equal($('targetMainTabs').hidden,true);assert.equal($('targetTabsCount').hidden,true,'background updates must not show Recorder navigation offline');
  dom.dispatchEvent(new dom.KeyboardEvent('keydown',{key:'Tab',ctrlKey:true,bubbles:true}));assert.equal($('tracingView').hidden,false);
  $('homeMainTab').click();$('onlineTracingChoice').click();assert.equal($('recorderMainTab').hidden,false);assert.equal($('tracingMainTab').hidden,true);assert.equal($('newTargetMainTab').hidden,false);assert.equal($('targetMainTabs').hidden,false);assert.equal($('targetTabsCount').hidden,false);
  dom.document.querySelector('[data-target-id="tab1"]').click();assert.equal($('targetView').hidden,false);assert.equal(calls.filter(call=>call.command==='set_target_view_visible').at(-1).args.visible,true);
  $('homeMainTab').click();assert.equal($('targetView').hidden,true);assert.equal(calls.at(-1).args.visible,false);
  assert.equal(calls.some(call=>call.command==='open_target_url'||call.command==='open_target_tab'),false,'choosing online opens the existing Recorder');
});
