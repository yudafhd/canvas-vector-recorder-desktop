import { stockSvg } from './stock-export';
import type { TraceOptions, TraceResult } from './engine';
import type { AutoTraceInfo } from './auto-trace';
import { restoreManualSettings, type AppliedSettings } from './settings-state';

export interface BatchConfig { mode: 'auto' | 'manual'; resolution: number; options: TraceOptions }
export interface BatchOutput { result: TraceResult; auto?: AutoTraceInfo }
export interface BatchItem {
  id: string; file: File; config: BatchConfig; status: 'pending' | 'processing' | 'success' | 'error';
  progress: number; label: string; output?: BatchOutput; error?: string;
  autoSettings?: AppliedSettings;
}
export const BATCH_LIMIT = 50;
export type BatchRunner = (item: BatchItem, signal: AbortSignal, progress: (value: number, label: string) => void) => Promise<BatchOutput>;
export class TraceBatch {
  items: BatchItem[] = [];
  private controller?: AbortController;
  constructor(private readonly changed: (checkpoint: boolean) => void = () => {}) {}
  get running() { return !!this.controller; }
  add(files: File[], config: BatchConfig) {
    if (this.running) throw new Error('Batalkan atau tunggu batch sebelum menambah gambar.');
    if (this.items.length + files.length > BATCH_LIMIT) throw new Error(`Maksimum ${BATCH_LIMIT} gambar per batch.`);
    if (this.items.reduce((sum, item) => sum + item.file.size, 0) + files.reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024) throw new Error('Total sumber batch maksimum 200 MB.');
    for (const file of files) if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: gunakan PNG, JPG, WebP maksimum 20 MB.`);
    for (const file of files) this.items.push({ id: crypto.randomUUID(), file, config: structuredClone(config), status: 'pending', progress: 0, label: 'Menunggu' });
    this.changed(true);
  }
  remove(id?: string) { if (this.running) return; this.items = id ? this.items.filter(item => item.id !== id) : []; this.changed(true); }
  retry(id: string, config?: BatchConfig) {
    if (this.running) return;
    const item = this.items.find(item => item.id === id); if (!item) return;
    if (config) item.config = structuredClone(config);
    item.status = 'pending'; item.progress = 0; item.label = 'Menunggu'; delete item.error; delete item.output; this.changed(true);
  }
  updateConfig(id: string, config: BatchConfig) { this.retry(id,config); }
  setDetected(id: string, settings: AppliedSettings) {
    if (this.running) return;
    const item = this.items.find(item => item.id === id);if (!item) return;
    item.autoSettings = restoreManualSettings(settings);
    if (item.config.mode === 'auto' && !item.output) item.config = {...structuredClone(item.autoSettings),mode:'auto'};
    this.changed(true);
  }
  switchMode(id: string, mode: 'auto' | 'manual') {
    if (this.running) return;
    const item = this.items.find(item => item.id === id);if (!item || item.config.mode === mode) return;
    const settings = item.autoSettings ?? item.output?.auto ?? item.config;
    this.updateConfig(id,{...restoreManualSettings(settings),mode});
  }
  resetAutoSettings() {
    if (this.running) return;
    for (const item of this.items) {
      delete item.autoSettings;
      if (item.config.mode === 'auto') { item.status = 'pending'; item.progress = 0; item.label = 'Menunggu'; delete item.output; delete item.error; }
    }
    this.changed(true);
  }
  cancel() { this.controller?.abort(); }
  async run(runner: BatchRunner, ids?: string[]) {
    if (this.running) return;
    const controller = new AbortController(); this.controller = controller; this.changed(false);
    try {
      for (const item of this.items) {
        if (controller.signal.aborted) break;
        if (item.status !== 'pending') continue;
        if (ids && !ids.includes(item.id)) continue;
        item.status = 'processing'; item.progress = 0; item.label = 'Menyiapkan gambar'; this.changed(true);
        try {
          const output = await runner(item, controller.signal, (value, label) => {
            if (controller.signal.aborted) return;
            item.progress = Math.max(item.progress, Math.min(100, Math.max(0, value))); item.label = label; this.changed(false);
          });
          if (controller.signal.aborted) { item.status = 'pending'; item.progress = 0; item.label = 'Dibatalkan'; break; }
          item.output = output; item.status = 'success'; item.progress = 100; item.label = 'Selesai';
          if (output.auto) {item.autoSettings = restoreManualSettings(output.auto);if (item.config.mode === 'auto') item.config = {...structuredClone(item.autoSettings),mode:'auto'};}
        } catch (error) {
          if (controller.signal.aborted || error instanceof Error && error.name === 'AbortError') { item.status = 'pending'; item.progress = 0; item.label = 'Dibatalkan'; break; }
          item.status = 'error'; item.error = error instanceof Error ? error.message : String(error); item.label = 'Gagal';
        }
        this.changed(true);
      }
    } finally { this.controller = undefined; this.changed(true); }
  }
}
export function batchEntries(items: BatchItem[], format: 'svg' | 'eps' = 'svg', normalize = true) {
  const used = new Set<string>();
  const ext = format === 'eps' ? 'eps' : 'svg';
  return items.filter(item => item.status === 'success' && item.output).map(item => {
    let stem = item.file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,100) || 'vector';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `vector-${stem}`;
    let filename = `${stem}.${ext}`, counter = 1;
    while (used.has(filename.toLowerCase())) filename = `${stem}_${counter++}.${ext}`;
    used.add(filename.toLowerCase()); return { filename, svg: normalize ? stockSvg(item.output!.result.svg) : item.output!.result.svg };
  });
}

let database: Promise<IDBDatabase> | undefined;
const openStore = () => database ??= new Promise((resolve,reject) => {
  const request = indexedDB.open('cvr-tracing-batch',1);
  request.onupgradeneeded = () => { request.result.createObjectStore('items');request.result.createObjectStore('sources'); };
  request.onsuccess = () => resolve(request.result);request.onerror = () => {database = undefined;reject(request.error);};
});
const transactionDone = (tx: IDBTransaction) => new Promise<void>((resolve,reject) => {tx.oncomplete = () => resolve();tx.onerror = () => reject(tx.error);tx.onabort = () => reject(tx.error);});
const readRequest = <T>(request: IDBRequest<T>) => new Promise<T>((resolve,reject) => {request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error);});
let saves: Promise<void> = Promise.resolve();
/** Save immutable snapshots in order; source bytes are only written on addition. */
export function saveBatch(items: BatchItem[]) {
  const snapshot = items.map(item => ({ ...structuredClone({...item,file:undefined,...(item.status === 'processing' ? {status:'pending',progress:0,label:'Menunggu'} : {})}), file:item.file }));
  const write = async () => {
    const db = await openStore(), keys = await readRequest(db.transaction('sources').objectStore('sources').getAllKeys()), existing = new Set(keys);
    const tx = db.transaction(['items','sources'],'readwrite'), done = transactionDone(tx), sources = tx.objectStore('sources'), records = tx.objectStore('items'), ids = new Set(snapshot.map(item => item.id));
    for (const id of keys) if (!ids.has(String(id))) {sources.delete(id);records.delete(id);}
    for (const [order,item] of snapshot.entries()) {
      const {file,...record} = item;
      if (!existing.has(item.id)) sources.put(file,item.id);
      records.put({...record,order,fileName:file.name,fileType:file.type,lastModified:file.lastModified},item.id);
    }
    await done;
  };
  const result = saves.then(write,write);saves = result.catch(() => {});return result;
}
export async function loadBatch(): Promise<BatchItem[]> {
  const db = await openStore(), tx = db.transaction(['items','sources']), done = transactionDone(tx);
  const records = await readRequest(tx.objectStore('items').getAll());
  // A new transaction is required after an awaited IDB request.
  await done;
  const restored: BatchItem[] = [];
  for (const record of records.sort((a,b) => a.order - b.order).slice(0,BATCH_LIMIT)) {
    const blob = await readRequest(db.transaction('sources').objectStore('sources').get(record.id));
    if (!(blob instanceof Blob)) continue;
    const file = new File([blob],record.fileName,{type:record.fileType,lastModified:record.lastModified});
    const manual = restoreManualSettings(record.config), config = { ...manual, mode: record.config?.mode === 'manual' ? 'manual' as const : 'auto' as const };
    const status = record.status === 'success' && record.output?.result?.svg ? 'success' : record.status === 'error' ? 'error' : 'pending';
    restored.push({id:record.id,file,config,status,progress:status === 'success' ? 100 : 0,label:status === 'success' ? 'Selesai' : status === 'error' ? 'Gagal' : 'Menunggu',output:status === 'success' ? record.output : undefined,error:record.error,autoSettings:record.autoSettings ? restoreManualSettings(record.autoSettings) : record.output?.auto ? restoreManualSettings(record.output.auto) : undefined});
  }
  return restored;
}
