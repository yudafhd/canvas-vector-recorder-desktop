from pathlib import Path
import struct,json,re
root=Path('/private/tmp/vm-analysis-mac');out=Path('RND/vector-magic-analysis/phase3');raw=(root/'unpacked/Applications/Vector Magic/Vector Magic.app/Contents/MacOS/Vector Magic').read_bytes()
for i in range(struct.unpack_from('>I',raw,4)[0]):
 cpu,_,off,size,_=struct.unpack_from('>IIIII',raw,8+20*i)
 if cpu==0x1000007:d=raw[off:off+size];break
segs=[];o=32
for _ in range(struct.unpack_from('<I',d,16)[0]):
 cmd,sz=struct.unpack_from('<II',d,o)
 if cmd==0x19:segs.append(struct.unpack_from('<QQQQ',d,o+24))
 o+=sz
def read(a):
 for vm,vs,fo,fs in segs:
  if vm<=a<vm+fs:return d[fo+a-vm:fo+a-vm+220]
 return b''
def annotate(l):
 m=re.search(r'(-?0x[0-9a-f]+)\(%rip\)',l)
 if not m:return l
 fields=l.split('\t');a=int(fields[0][:-1],16)+len(fields[1].split())+int(m[1],16);v=read(a)
 if len(v)<8:return l
 z=v.split(b'\0')[0]
 if len(z)>3 and all(32<=b<127 for b in z):label=repr(z.decode())
 else: label='f64='+str(struct.unpack_from('<d',v)[0])+' f32='+str(struct.unpack_from('<f',v)[0])
 return l+' ; @'+hex(a)+' '+label
blocks=json.loads((root/'function-blocks.json').read_text())
for name,ls in blocks.items():
 if name in ['CoreEngine::registerParameters()','BezierFitter::BezierFitter(CoreEngine&)','VectorImage::getMovedVector(int)'] or any(name.startswith(p) for p in ['ContourSmoother::findAngularPriorPotential','ContourSmoother::findPotential','BezierFitter::mergeAndSwapLoop','BezierFitter::initialize','BezierFitter::computeSwapMetric']):
  (out/(name.split('(')[0].replace('::','-')+'.annotated.txt')).write_text(name+'\n'+'\n'.join(map(annotate,ls))+'\n')
