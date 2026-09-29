import sys,json,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent.parent/'barong-curves-v12'))
from audit import parse
root=Path(__file__).parent

def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def hull(points):
 p=sorted(set(map(tuple,points)))
 def half(p):
  r=[]
  for v in p:
   while len(r)>1 and cross(r[-2],r[-1],v)<=0:r.pop()
   r.append(v)
  return r
 return half(p)[:-1]+half(p[::-1])[:-1]
def area(p):return abs(sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(p,p[1:]+p[:1]))/2)
report={}
for name in ['before','after']:
 result=[]
 for loop in parse(root/(name+'.svg')):
  curves=loop['curves'];p=[c['from'] for c in curves]
  if loop['fill']!='#ffffff' or not all(450<x<575 and 440<y<490 for x,y in p):continue
  points=[]
  for c in curves:
   a,b=c['from'],c['to']
   if 'controls' not in c:points.append(a);continue
   d,e=c['controls']
   for i in range(64):
    t=i/64;u=1-t;points.append([u**3*a[k]+3*u*u*t*d[k]+3*u*t*t*e[k]+t**3*b[k] for k in [0,1]])
  result.append({'centerX':sum(p[0] for p in points)/len(points),'concavityArea':area(hull(points))-area(points)})
 report[name]=sorted(result,key=lambda x:x['centerX'])
(root/'tooth-metrics.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
