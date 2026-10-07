/** Optional audit against the actual Java sources, never a frozen TS reference. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { moduleUrl } from './helpers/tracing-module.mjs';
const source = resolve(process.argv[2] ?? '../mini-vectorizer/app/src/main/java/com/mini/vectorizer');
const output = resolve('build/mini-engine-parity'); await mkdir(output, { recursive: true });
const driver = `package com.mini.vectorizer;
import java.io.*; import java.util.*;
public class DesktopPortAudit {
 public static void main(String[] args) throws Exception {
  DataInputStream in=new DataInputStream(System.in); int count=in.readInt();
  for(int test=0;test<count;test++) {
   int n=in.readInt(); List<double[]>palette=new ArrayList<>();int[]labels=new int[n];
   for(int i=0;i<n;i++){labels[i]=i;palette.add(new double[]{in.readDouble(),in.readDouble(),in.readDouble()});}
   byte[]pixel=new byte[4];in.readFully(pixel);int active=in.readInt();
   NativeTraceEngine.ColorMixture model=new NativeTraceEngine.ColorMixture(palette,labels,25);
   double residual=model.fit(pixel,0,active);
   System.out.println("{\\"residual\\":"+residual+",\\"weights\\":"+Arrays.toString(model.weights)+",\\"heaviest\\":"+model.heaviest()+"}");
  }
  int w=in.readInt(),h=in.readInt();byte[]rgba=new byte[w*h*4];in.readFully(rgba);
  NativeTraceEngine.Quantized q=NativeTraceEngine.quantizeFlatInteriors(rgba,12,w,h);
  StringJoiner colors=new StringJoiner(",","[","]");for(double[]c:q.palette)colors.add(Arrays.toString(c));
  System.out.println("{\\"flat\\":"+q.flatInteriors+",\\"palette\\":"+colors+",\\"labels\\":"+Arrays.toString(q.labels)+"}");
 }
}`;
await writeFile(`${output}/DesktopPortAudit.java`, driver);
const run = (exe, args, input) => {
  const result=spawnSync(exe,args,{input,encoding:'utf8',maxBuffer:16*1024*1024});
  assert.equal(result.status,0,result.stderr||String(result.error));return result.stdout;
};
run('javac',['-encoding','UTF-8','-d',output,...['NativeTraceEngine','CurveQuality','PerceptualColor','DetailProtection','SvgSceneQuality','StrokeRegularizer'].map(n=>`${source}/${n}.java`),`${output}/DesktopPortAudit.java`]);
const { ColorMixture }=await import(await moduleUrl('transition-mixtures'));
const { quantizeFlatInteriors }=await import(await moduleUrl('engine'));
const chunks=[];
const int=v=>{const b=Buffer.alloc(4);b.writeInt32BE(v);chunks.push(b);};
const double=v=>{const b=Buffer.alloc(8);b.writeDoubleBE(v);chunks.push(b);};
const fixtures=[];let seed=73;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;};
for(let n=2;n<=6;n++)for(let trial=0;trial<8;trial++){
 const palette=Array.from({length:n},()=>[random(),random(),random()]);
 const pixel=new Uint8ClampedArray([random(),random(),random(),255]), active=(1<<n)-1;
 const model=new ColorMixture(palette,palette.map((_,i)=>i));
 const residual=model.fit(pixel,0,active);assert.ok(Number.isFinite(residual));
 fixtures.push({palette,pixel,active,residual,weights:[...model.weights],heaviest:model.heaviest()});
}
int(fixtures.length);
for(const f of fixtures){int(f.palette.length);for(const c of f.palette)for(const v of c)double(v);chunks.push(Buffer.from(f.pixel));int(f.active);}
const w=64,h=48,rgba=new Uint8ClampedArray(w*h*4);
for(let y=0;y<h;y++)for(let x=0;x<w;x++)rgba.set(y<6||y>=42||x<6||x>=58?[255,255,255,255]:x===32?[247,180,0,255]:x<32?[255,204,0,255]:[240,156,0,255],(y*w+x)*4);
int(w);int(h);chunks.push(Buffer.from(rgba));
const actual=run('java',['-cp',output,'com.mini.vectorizer.DesktopPortAudit'],Buffer.concat(chunks)).trim().split(/\r?\n/).map(JSON.parse);
for(let i=0;i<fixtures.length;i++){
 const a=actual[i],b=fixtures[i];assert.ok(Math.abs(a.residual-b.residual)<1e-7);assert.equal(a.heaviest,b.heaviest);
 a.weights.forEach((v,j)=>assert.ok(Math.abs(v-b.weights[j])<1e-9));
}
const q=quantizeFlatInteriors(rgba,12,w,h),native=actual.at(-1);
assert.equal(q.flatInteriors,native.flat);assert.deepEqual(q.palette,native.palette);assert.deepEqual([...q.labels],native.labels);
const report={source,mixtureCases:fixtures.length,flatPaletteColors:q.palette.length,paletteAndLabelsMatch:true};
await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
console.log(`Java parity passed: ${fixtures.length} simplex fits, interior palette and ${w*h} pixel labels.`);
