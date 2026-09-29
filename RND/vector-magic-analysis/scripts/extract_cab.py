from pathlib import Path
import struct,json
p=Path('RND/vmde_VectorMagicSetup_pc_1_21.msi'); d=p.read_bytes(); u=lambda b,o:struct.unpack_from('<I',b,o)[0]
assert d[:8]==bytes.fromhex('d0cf11e0a1b11ae1')
ss=1<<struct.unpack_from('<H',d,30)[0]
def sector(n):
 assert 0<=n<(len(d)//ss)-1
 return d[(n+1)*ss:(n+2)*ss]
fat_ids=list(struct.unpack_from('<109I',d,76)); nxt=u(d,68)
for _ in range(u(d,72)):
 s=sector(nxt); fat_ids.extend(struct.unpack_from('<'+str(ss//4-1)+'I',s)); nxt=u(s,ss-4)
fat=[]
for n in [x for x in fat_ids if x<0xfffffffa][:u(d,44)]: fat.extend(struct.unpack('<'+str(ss//4)+'I',sector(n)))
def chain(n):
 seen=set(); chunks=[]
 while n<0xfffffffa:
  assert n not in seen; seen.add(n); chunks.append(sector(n)); n=fat[n]
 return b''.join(chunks)
dirs=chain(u(d,48)); out=Path('/private/tmp/vm-analysis-windows');out.mkdir(exist_ok=True); inventory=[]
for i in range(0,len(dirs),128):
 e=dirs[i:i+128]; ln=struct.unpack_from('<H',e,64)[0]; typ=e[66]
 if not typ:continue
 name=e[:max(0,ln-2)].decode('utf-16le'); size=struct.unpack_from('<Q',e,120)[0]; entry={'id':i//128,'name':name,'type':typ,'size':size};inventory.append(entry)
 if typ==2 and size>=u(d,56):
  data=chain(u(e,116))[:size]
  if data[:4]==b'MSCF':
   target=out/('stream-'+str(i//128)+'.cab');target.write_bytes(data);print(target,size)
(out/'streams.json').write_text(json.dumps(inventory,indent=2))
print('directory entries',len(inventory),'sector size',ss)
