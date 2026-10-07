import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleUrl } from './helpers/tracing-module.mjs';

const { rasterThumbnail } = await import(await moduleUrl('thumbnail'));

test('gallery thumbnails bound decoded raster size, preserve aspect and release temporary sources on failure',async t=>{
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const active = new Set(), sizes = [];
  let width = 4800,height = 2400,decodeFails = false,contextAvailable = true,blobAvailable = true;
  URL.createObjectURL = blob => {const url = originalCreate(blob);active.add(url);return url;};
  URL.revokeObjectURL = url => {active.delete(url);originalRevoke(url);};
  globalThis.Image = class {
    naturalWidth = width;naturalHeight = height;src = '';
    async decode() {if (decodeFails) throw new Error('Decode failed');}
  };
  globalThis.document = {createElement:tag=>{
    assert.equal(tag,'canvas');
    return {width:0,height:0,getContext(){return contextAvailable ? {drawImage:(_,x,y,w,h)=>sizes.push([w,h])} : null;},toBlob(callback,type){callback(blobAvailable ? new Blob(['small raster'],{type}) : null);}};
  }};
  t.after(()=>{URL.createObjectURL = originalCreate;URL.revokeObjectURL = originalRevoke;});
  const file = new File(['source'],'large.png',{type:'image/png'});
  assert.equal((await rasterThumbnail(file)).type,'image/png');assert.deepEqual(sizes.at(-1),[384,192]);assert.equal(active.size,0);
  width = 1000;height = 4000;await rasterThumbnail(file);assert.deepEqual(sizes.at(-1),[96,384]);
  width = 20;height = 10;await rasterThumbnail(file);assert.deepEqual(sizes.at(-1),[20,10]);
  const drawn = sizes.length;width = 10000;height = 10000;
  await assert.rejects(rasterThumbnail(file),/Pratinjau/);assert.equal(sizes.length,drawn);assert.equal(active.size,0);
  width = 20;height = 10;decodeFails = true;
  await assert.rejects(rasterThumbnail(file),/Decode failed/);assert.equal(active.size,0);
  decodeFails = false;contextAvailable = false;
  await assert.rejects(rasterThumbnail(file),/Pratinjau/);assert.equal(active.size,0);
  contextAvailable = true;blobAvailable = false;
  await assert.rejects(rasterThumbnail(file),/Pratinjau/);assert.equal(active.size,0);
});
