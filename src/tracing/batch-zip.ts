import { checkStockSize } from './stock-export';
import { buildDosEpsSync } from './eps-export';

/** Uncompressed ZIP with UTF-8 names; compatible with desktop ZIP readers. */
export function batchZip(entries: { filename: string; svg: string; bytes?: Uint8Array }[]) {
  if (!entries.length || entries.length > 50) throw new Error('Tidak ada hasil batch untuk disimpan.');
  const encoder = new TextEncoder(), chunks: Uint8Array[] = [], central: Uint8Array[] = []; let offset = 0;
  for (const entry of entries) {
    let data: Uint8Array;
    if (entry.bytes) {
      data = entry.bytes;
    } else if (entry.filename.endsWith('.eps')) {
      data = buildDosEpsSync(entry.svg, entry.filename);
    } else {
      data = encoder.encode(entry.svg);
    }
    checkStockSize(data);
    const name = encoder.encode(entry.filename);
    let crc = 0xffffffff;for (const byte of data) {crc ^= byte;for (let bit = 0;bit < 8;bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);}crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + name.length),l = new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true);l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,name.length,true);local.set(name,30);
    const directory = new Uint8Array(46 + name.length),d = new DataView(directory.buffer);
    d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);directory.set(name,46);
    chunks.push(local,data);central.push(directory);offset += local.length + data.length;
  }
  const size = central.reduce((sum,chunk) => sum + chunk.length,0),end = new Uint8Array(22),e = new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
  const output = new Uint8Array(offset + size + end.length);let at = 0;
  for (const chunk of [...chunks,...central,end]) {output.set(chunk,at);at += chunk.length;}return output;
}
