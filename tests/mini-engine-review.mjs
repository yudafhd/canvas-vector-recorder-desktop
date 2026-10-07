/** Integration audit: real Java pipeline stages and exported SVGs on identical RGBA. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { moduleUrl } from './helpers/tracing-module.mjs';
const source = resolve(process.argv[2] ?? '../mini-vectorizer/app/src/main/java/com/mini/vectorizer');
const maxSide = Number(process.argv[3] ?? 128);
assert.ok(Number.isInteger(maxSide) && maxSide >= 32 && maxSide <= 2048, 'Audit resolution must be 32–2048');
const output = resolve(maxSide === 128 ? 'build/mini-engine-review' : `build/mini-engine-review-${maxSide}`); await mkdir(output, { recursive: true });
const engine = await import(await moduleUrl('engine'));
const { mergeSmallEdgeRegions, transitionDefaults } = await import(await moduleUrl('transition-mixtures'));
const { evaluateSvgScene } = await import(await moduleUrl('scene-quality'));
const { detectAutoSettings } = await import(await moduleUrl('auto-settings'));
const run = (exe, args, input) => {
  const result = spawnSync(exe, args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || String(result.error)); return result.stdout;
};
const driver = String.raw`package com.mini.vectorizer;
import java.io.*; import java.util.*; import java.nio.charset.StandardCharsets;
import static com.mini.vectorizer.NativeTraceEngine.*;
public class EngineReview {
 static void snapshot(String stage,int[]labels,List<double[]>palette,Diagnostics d,DetailProtection detail) {
  StringJoiner colors=new StringJoiner(",","[","]");for(double[]c:palette)colors.add(Arrays.toString(c));
  StringJoiner stats=new StringJoiner(",","{","}");for(Map.Entry<String,Number> e:d.asMap().entrySet())stats.add("\""+e.getKey()+"\":"+e.getValue());
  System.out.println("{\"stage\":\""+stage+"\",\"palette\":"+colors+",\"labels\":"+Arrays.toString(labels)+",\"detail\":"+Arrays.toString(detail.pixels.stream().toArray())+",\"stats\":"+stats+"}");
 }
 public static void main(String[]args) throws Exception {
  if(args.length==3) {
   java.awt.image.BufferedImage original=javax.imageio.ImageIO.read(new File(args[0]));int max=Integer.parseInt(args[2]);
   double scale=Math.min(1,max/(double)Math.max(original.getWidth(),original.getHeight()));int w=Math.max(1,(int)Math.round(original.getWidth()*scale)),h=Math.max(1,(int)Math.round(original.getHeight()*scale));
   java.awt.image.BufferedImage image=new java.awt.image.BufferedImage(w,h,java.awt.image.BufferedImage.TYPE_INT_ARGB);
   java.awt.Graphics2D graphics=image.createGraphics();graphics.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION,java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);graphics.drawImage(original,0,0,w,h,null);graphics.dispose();
   DataOutputStream out=new DataOutputStream(new FileOutputStream(args[1]));out.writeInt(w);out.writeInt(h);
   for(int y=0;y<h;y++)for(int x=0;x<w;x++){int p=image.getRGB(x,y);out.writeByte(p>>16);out.writeByte(p>>8);out.writeByte(p);out.writeByte(p>>>24);}out.close();return;
  }
  DataInputStream in=new DataInputStream(System.in);int cases=in.readInt();
  for(int t=0;t<cases;t++) {
   int w=in.readInt(),h=in.readInt(),count=in.readInt();double tolerance=in.readDouble(),minArea=in.readDouble();
   boolean smooth=in.readBoolean(),protect=in.readBoolean();String mode=new String[]{"none","background","all"}[in.readInt()];
   byte[]rgba=new byte[w*h*4];in.readFully(rgba);
   Options options=new Options(count,tolerance,minArea,smooth,mode);
   Quantized q=smooth&&count>=8&&minArea>=4&&mode.equals("background")?quantizeFlatInteriors(rgba,count,w,h):quantize(rgba,count);
   int[]labels=q.labels;List<double[]>palette=q.palette;Diagnostics d=new Diagnostics();DetailProtection detail=new DetailProtection(rgba,labels,palette,w,h);
   snapshot("quantize",labels,palette,d,detail);
   if(minArea>0)compactPalette(rgba,labels,palette,w,h,minArea,protect?detail.colors:new boolean[palette.size()],q.flatInteriors);
   if(protect)detail.restore(labels,palette);snapshot("compact",labels,palette,d,detail);
   if(!q.flatInteriors)refinePaletteInteriors(rgba,labels,palette,w,h,protect?detail.paletteMask(palette):new boolean[palette.size()]);
   snapshot("interiors",labels,palette,d,detail);
   refineTransitions(rgba,labels,w,h,palette);if(q.flatInteriors)regularizeShadeLabels(labels,w,h,palette);
   if(protect)detail.restore(labels,palette);snapshot("transitions",labels,palette,d,detail);
   cleanRegions(labels,w,h,minArea,palette,rgba);if(protect)detail.restore(labels,palette);snapshot("smallRegions",labels,palette,d,detail);
   int[]stats=cleanTransitionRegions(rgba,labels,palette,w,h,minArea,q.flatInteriors,d);
   if(protect)detail.restore(labels,palette);d.mergedTransitionRegions=stats[0];d.reassignedTransitionPixels=stats[1];snapshot("mixtures",labels,palette,d,detail);
   if(q.flatInteriors&&smooth&&minArea>=4)mergeSmallEdgeRegions(rgba,labels,palette,w,h,protect?detail.pixels:new BitSet(),d);
   snapshot("edgeMerge",labels,palette,d,detail);
   int[]argb=new int[w*h];for(int p=0;p<argb.length;p++)argb[p]=((rgba[p*4+3]&255)<<24)|((rgba[p*4]&255)<<16)|((rgba[p*4+1]&255)<<8)|(rgba[p*4+2]&255);
   AutoSettingsDetector.Recommendation a=AutoSettingsDetector.detect(argb,w,h,2400,1600,2048);
   System.out.println("{\"recommendation\":{\"colors\":"+a.colors+",\"resolution\":"+a.resolution+",\"tolerance\":"+a.tolerance+",\"minArea\":"+a.minArea+",\"detectedColors\":"+a.detectedColors+",\"whiteMode\":\""+AutoWhitePolicy.resolve(a.detectedColors,mode)+"\"}}");
   if(!protect) {
    try {
     Result traced=traceRaster(rgba,w,h,options,null);
     String svg=Base64.getEncoder().encodeToString(traced.svg.getBytes(StandardCharsets.UTF_8));
     System.out.println("{\"svg\":\""+svg+"\",\"paths\":"+traced.paths+",\"contours\":"+traced.contours+",\"segments\":"+traced.segments+"}");
    }catch(IllegalArgumentException e){System.out.println("{\"error\":true}");}
   }
  }
 }
}`;
await writeFile(`${output}/EngineReview.java`, driver);
run('javac', ['-encoding','UTF-8','-d',output,...['NativeTraceEngine','CurveQuality','PerceptualColor','DetailProtection','SvgSceneQuality','StrokeRegularizer','AutoSettingsDetector','AutoWhitePolicy'].map(name=>`${source}/${name}.java`),`${output}/EngineReview.java`]);
const cases=[];
const add=(name,w,h,pixel,options={},supplied)=>{
 const rgba=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)rgba.set(pixel(x,y),(y*w+x)*4);
 if(supplied)rgba.set(supplied);
 for(const protect of [false,true])cases.push({name,w,h,rgba,protect,options:{colors:12,tolerance:.8,minArea:4,smooth:true,removeWhite:true,whiteMode:'background',...options}});
};
const white=[255,255,255,255],dark=[30,30,30,255],yellow=[255,204,0,255],orange=[240,156,0,255],green=[40,102,73,255],blue=[0,0,255,255];
add('adjacent-source-shadows',64,48,(x,y)=>y<6||y>=42||x<6||x>=58?white:x===32?[247,180,0,255]:x<32?yellow:orange);
add('unsupported-long-band',64,48,(x,y)=>y<4||y>=44||x<4||x>=60?white:x===32?[128,0,128,255]:x<32?[255,0,0,255]:blue);
add('neighbor-specks',48,40,(x,y)=>y<4||y>=36||x<4||x>=44?white:x===14&&y===14?[60,110,80,255]:x===30&&y===20?[180,90,40,255]:x<24?green:orange,{colors:8,minArea:12});
add('coherent-pair',48,40,(x,y)=>x===22&&(y===20||y===21)?orange:x>8&&x<39&&y>7&&y<33?green:white,{colors:6,minArea:24,whiteMode:'none',removeWhite:false});
add('thin-accent',48,40,(x,y)=>x===23&&y>7&&y<33?yellow:x>6&&x<41&&y>5&&y<35?green:white,{colors:8,minArea:24});
add('alpha-detail',48,40,(x,y)=>x===22? [240,156,0,180]:x>5&&x<42&&y>5&&y<35?green:[0,0,0,0],{whiteMode:'none',removeWhite:false});
for(const mode of ['none','background','all'])add('aa-circle-'+mode,48,40,(x,y)=>{
 const a=Math.max(0,Math.min(1,14-Math.hypot(x+.5-24,y+.5-20)));return [Math.round(255-215*a),Math.round(255-145*a),Math.round(255-200*a),255];
},{colors:8,whiteMode:mode,removeWhite:mode!=='none'});
add('nested-white-hole',48,40,(x,y)=>x<4||x>=44||y<4||y>=36?white:x<10||x>=38||y<10||y>=30?dark:x<17||x>=31||y<15||y>=25?green:white,{colors:6,whiteMode:'all'});
add('clipped-underpaint',64,48,(x,y)=>x>=24&&x<40&&y>=22&&y<26?[75,75,75,255]:
 x>=14&&x<50&&y>=10&&y<38?(x<32?orange:[40,170,85,255]):[15,15,15,255]);
add('manual-no-cleanup',48,40,(x,y)=>x<24?green:orange,{minArea:0,colors:6,whiteMode:'none',removeWhite:false});
add('manual-polygons',48,40,(x,y)=>x<24?green:orange,{smooth:false,colors:6,whiteMode:'none',removeWhite:false});
add('two-pixel-detail',32,24,(x,y)=>(x===9||x===10)&&y===10||x===22&&y===10?[20,60,220,255]:white,{colors:6,minArea:24,whiteMode:'none',removeWhite:false});
for(const tolerance of [.8,1.6])add('wavy-stroke-'+tolerance,80,128,(x,y)=>{
 const center=40+8*Math.sin(y/15)+Math.sin(y*1.1)*.2;return y>8&&y<120&&Math.abs(x-center)<4?[0,0,0,255]:white;
},{colors:2,tolerance,minArea:0,whiteMode:'all'});
for(const [name,asset] of [
 ['real-arrows','../mini-vectorizer/tests/assets/hard-samples/arrow-junctions.png'],
 ['real-face','../mini-vectorizer/tests/assets/hard-samples/face-details.png'],
 ['real-shaded','../mini-vectorizer/tests/assets/user-images/weightlifter-green.png'],
 ['real-monochrome','../mini-vectorizer/tests/assets/user-images/monochrome-silhouette-sheet.jpg'],
]) {
 const decoded=`${output}/${name}.rgba`;
 run('java',['-cp',output,'com.mini.vectorizer.EngineReview',resolve(asset),decoded,String(maxSide)]);
 const b=await readFile(decoded),w=b.readInt32BE(0),h=b.readInt32BE(4);add(name,w,h,()=>[0,0,0,0],{},b.subarray(8));
}
// Deterministic stress inputs: JPEG noise, color junctions, alpha thresholds,
// and manual palette limits. Each raster is shared by both engines and modes.
for (let seed=0;seed<8;seed++) {
 let state=0x6d2b79f5+seed;
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const fills=[[40,102,73],[240,156,0],[255,204,0],[48,91,167],[151,52,95],[60,55,49],[255,255,255]];
 add('stress-'+seed,56,48,(x,y)=>{
  const q=y<4||y>=44||x<4||x>=52?6:Math.min(5,Math.floor((x-4)/8));
  let c=seed===0&&q<6?fills[0]:fills[q];
  if(seed!==0&&y>=20&&y<=22&&q<6)c=fills[(q+1)%6].map((v,k)=>Math.round((v+c[k])/2));
  const jitter=seed>=4?Math.floor(random()*9)-4:0;
  const alpha=seed===7&&x>=26&&x<=29?[127,128,180,239][x-26]:255;
  return [...c.map(v=>Math.max(0,Math.min(255,v+jitter))),alpha];
 },{colors:[2,6,8,16,16,8,12,16][seed],minArea:[0,4,12,24,4,12,24,4][seed],
    tolerance:[.2,.35,.8,1.6,.8,1.6,.35,.8][seed],whiteMode:seed===7?'none':'background',removeWhite:seed!==7});
}
const chunks=[];const int=v=>{const b=Buffer.alloc(4);b.writeInt32BE(v);chunks.push(b);};const double=v=>{const b=Buffer.alloc(8);b.writeDoubleBE(v);chunks.push(b);};
int(cases.length);
for(const c of cases){int(c.w);int(c.h);int(c.options.colors);double(c.options.tolerance);double(c.options.minArea);chunks.push(Buffer.from([+c.options.smooth,+c.protect]));int(['none','background','all'].indexOf(c.options.whiteMode));chunks.push(Buffer.from(c.rgba));}
const native=run('java',['-cp',output,'com.mini.vectorizer.EngineReview'],Buffer.concat(chunks)).trim().split(/\r?\n/).map(JSON.parse);
let cursor=0;const stages=[],scenes=[],failures=[];
for(const c of cases){
 const {rgba,w,h,options:o,protect}=c,q=o.smooth&&o.colors>=8&&o.minArea>=4&&o.whiteMode==='background'?engine.quantizeFlatInteriors(rgba,o.colors,w,h):{...engine.quantize(rgba,o.colors),flatInteriors:false};
 const {labels,palette,flatInteriors}=q,detail=engine.protectDetails(rgba,labels,palette,w,h),d={...transitionDefaults,mergedTransitionRegions:0,reassignedTransitionPixels:0};
 const check=stage=>{
  const expected=native[cursor++];assert.equal(expected.stage,stage);
  const labelMismatch=labels.reduce((sum,label,i)=>sum+(label!==expected.labels[i]),0),paletteError=palette.length!==expected.palette.length?Infinity:Math.max(0,...palette.flatMap((p,i)=>p.map((v,k)=>Math.abs(v-expected.palette[i][k]))));
  const pixels=Array.from(detail.pixels.keys()).filter(i=>detail.pixels[i]),detailMismatch=JSON.stringify(pixels)!==JSON.stringify(expected.detail);
  const diagnosticsMatch=Object.keys(d).every(k=>d[k]===expected.stats[k]);
  const record={name:c.name,protect,stage,labelMismatch,paletteError,detailMismatch,diagnosticsMatch};stages.push(record);
  if(labelMismatch||paletteError>1e-8||detailMismatch||!diagnosticsMatch)failures.push(record);
 };
 check('quantize');
 if(o.minArea>0)engine.compactPalette(rgba,labels,palette,w,h,o.minArea,protect?detail.colors:[],flatInteriors);
 if(protect)detail.restore();check('compact');
 if(!flatInteriors)engine.refinePaletteInteriors(rgba,labels,palette,w,h,protect?detail.mask():[]);check('interiors');
 engine.refineTransitions(rgba,labels,w,h,palette);if(flatInteriors)engine.regularizeShadeLabels(labels,w,h,palette);if(protect)detail.restore();check('transitions');
 engine.cleanRegions(labels,w,h,o.minArea,palette,rgba);if(protect)detail.restore();check('smallRegions');
 const cleaned=engine.cleanTransitionRegions(rgba,labels,palette,w,h,o.minArea,flatInteriors,d);if(protect)detail.restore();d.mergedTransitionRegions=cleaned.mergedRegions;d.reassignedTransitionPixels=cleaned.reassignedPixels;check('mixtures');
 if(flatInteriors&&o.smooth&&o.minArea>=4)mergeSmallEdgeRegions(rgba,labels,palette,w,h,protect?detail.pixels:new Uint8Array(labels.length),d,engine.perceptualColor);check('edgeMerge');
 const recommendation=native[cursor++].recommendation,detected=detectAutoSettings(rgba,w,h,2400,o.whiteMode);
 assert.deepEqual({colors:detected.options.colors,resolution:detected.resolution,tolerance:detected.options.tolerance,minArea:detected.options.minArea,detectedColors:detected.detectedColors,whiteMode:detected.options.whiteMode},recommendation,`${c.name}: Auto recommendation`);
 if(!protect){
  const expected=native[cursor++];let actual;
  try{actual=engine.traceRaster(rgba,w,h,o);}catch(error){assert.equal(expected.error,true,c.name);continue;}
  assert.ok(!expected.error,c.name);
  const svg=Buffer.from(expected.svg,'base64').toString('utf8'),javaMetrics=evaluateSvgScene(svg,rgba,w,h,o.removeWhite),tsMetrics=evaluateSvgScene(actual.svg,rgba,w,h,o.removeWhite);
  scenes.push({name:c.name,javaPaths:expected.paths,desktopPaths:actual.paths,javaContours:expected.contours,desktopContours:actual.contours,javaSegments:expected.segments,desktopSegments:actual.segments,javaError:javaMetrics.error,desktopError:tsMetrics.error,javaEdge:javaMetrics.edgeError,desktopEdge:tsMetrics.edgeError,identicalSvg:svg===actual.svg});
  assert.equal(actual.paths,expected.paths,`${c.name}: path topology`);assert.equal(actual.contours,expected.contours,`${c.name}: contour topology`);assert.equal(actual.segments,expected.segments,`${c.name}: fitting complexity`);
  assert.ok(Math.abs(javaMetrics.error-tsMetrics.error)<1e-12,`${c.name}: SVG raster error`);assert.ok(Math.abs(javaMetrics.edgeError-tsMetrics.edgeError)<1e-12,`${c.name}: SVG edge error`);
  assert.equal(actual.svg,svg,`${c.name}: exported SVG`);
  if(c.name==='clipped-underpaint')assert.ok(actual.diagnostics.underpaintPaths>0&&actual.svg.includes('<clipPath'), 'Engine-generated underpaint must be audited');
  await writeFile(`${output}/${c.name}-java.svg`,svg);await writeFile(`${output}/${c.name}-desktop.svg`,actual.svg);
 }
}
const report={source,maxSide,cases:cases.length,stageChecks:stages.length,recommendationChecks:cases.length,failures,scenes};await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({cases:cases.length,stageChecks:stages.length,stageFailures:failures.length,scenes},null,2));
assert.equal(failures.length,0,`Java segmentation mismatch; see ${output}/report.json`);
