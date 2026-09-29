"""Measure the two tongue slit boundaries in exported SVG, in process pixels."""
import json, math, re
from pathlib import Path
root=Path(__file__).parent
report={}
for name in ['ui']:
    svg=(root/f'{name}.svg').read_text(); edges=[]
    for fill,d in re.findall(r'<path fill="([^"]+)"[^>]* d="([^"]+)"',svg):
        if fill!='#db0203':continue
        tokens=re.findall(r'[MLCZ]|[-+]?\d+(?:\.\d+)?',d);i=0;p=None;start=None
        while i<len(tokens):
            command=tokens[i];i+=1
            if command in 'ML':
                q=list(map(float,tokens[i:i+2]));i+=2
                if command=='L':edges.append((p,q))
                else:start=q
                p=q
            elif command=='C':
                c=list(map(float,tokens[i:i+2]));e=list(map(float,tokens[i+2:i+4]));b=list(map(float,tokens[i+4:i+6]));i+=6;a=p
                for step in range(1,257):
                    t=step/256;u=1-t;q=[u**3*a[k]+3*u*u*t*c[k]+3*u*t*t*e[k]+t**3*b[k] for k in [0,1]]
                    edges.append((p,q));p=q
            elif command=='Z':edges.append((p,start));p=start
    measurements={}
    for label,lo,hi in [('left',500,512),('right',512,522)]:
        samples=[]
        for y in range(530,591):
            xs=[a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]) for a,b in edges if (a[1]>y)!=(b[1]>y)]
            xs=[x for x in xs if lo<x<hi]
            assert len(xs)==1,(name,label,y,xs)
            samples.append((y,xs[0]))
        my=sum(y for y,x in samples)/len(samples);mx=sum(x for y,x in samples)/len(samples)
        slope=sum((y-my)*(x-mx) for y,x in samples)/sum((y-my)**2 for y,x in samples)
        residuals=[x-mx-slope*(y-my) for y,x in samples]
        measurements[label]={'samples':[[x,y] for y,x in samples],'yRange':[530,590],'rmsXResidualPixels':math.sqrt(sum(v*v for v in residuals)/len(samples)),'maxAbsXResidualPixels':max(map(abs,residuals))}
    report[name]=measurements
(root/'line-metrics.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
