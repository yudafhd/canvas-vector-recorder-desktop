import json, math, re, hashlib
from pathlib import Path
root=Path(__file__).parent

def parse(path):
    result=[]
    for fill,d in re.findall(r'<path fill="([^"]+)"[^>]* d="([^"]+)"',path.read_text()):
        tokens=re.findall(r'[MLCZ]|[-+]?\d+(?:\.\d+)?',d);i=0;p=None;loop=[]
        while i<len(tokens):
            cmd=tokens[i];i+=1
            if cmd=='M':p=list(map(float,tokens[i:i+2]));i+=2
            elif cmd=='L':
                q=list(map(float,tokens[i:i+2]));i+=2;loop.append({'from':p,'to':q});p=q
            elif cmd=='C':
                c=list(map(float,tokens[i:i+2]));e=list(map(float,tokens[i+2:i+4]));q=list(map(float,tokens[i+4:i+6]));i+=6
                loop.append({'from':p,'to':q,'controls':[c,e]});p=q
            elif cmd=='Z':result.append({'fill':fill,'curves':loop});loop=[]
    return result

def tangent(c,end):
    a,b=(c.get('controls',[c['from']])[ -1],c['to']) if end else (c['from'],c.get('controls',[c['to']])[0])
    return [b[k]-a[k] for k in [0,1]]
def angle(a,b):
    n=math.hypot(*a)*math.hypot(*b)
    return None if n<1e-12 else math.degrees(math.acos(max(-1,min(1,sum(x*y for x,y in zip(a,b))/n))))
def audit(loops):
    joins=[];short=0;total=0
    for k,loop in enumerate(loops):
        cs=loop['curves'];total+=len(cs)
        for i,c in enumerate(cs):
            if math.dist(c['from'],c['to'])<1:short+=1
            nxt=cs[(i+1)%len(cs)];a=angle(tangent(c,True),tangent(nxt,False))
            if a is not None and a>2:joins.append({'loop':k,'segment':i,'point':c['to'],'angleDegrees':a,'fill':loop['fill']})
    return {'loops':len(loops),'segments':total,'subpixelChordSegments':short,'joinsOver2Degrees':len(joins),'joins':sorted(joins,key=lambda x:-x['angleDegrees'])}
if __name__=='__main__':
    loops=parse(root/'ui-before.svg');(root/'ui-curves.json').write_text(json.dumps(loops))
    report=audit(loops);report['sha256']=hashlib.sha256((root/'ui-before.svg').read_bytes()).hexdigest()
    (root/'audit-before.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='joins'},indent=2));print(json.dumps(report['joins'][:12],indent=2))
