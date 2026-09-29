"""Independent dense geometry audit; does not use the TS compaction guards."""
from audit import parse,audit,root
import json, math

def sample(c):
    if 'controls' not in c:return [c['from'],c['to']]
    a,b=c['from'],c['to'];d,e=c['controls']
    return [[(1-t)**3*a[k]+3*(1-t)**2*t*d[k]+3*(1-t)*t*t*e[k]+t**3*b[k] for k in [0,1]] for t in [i/96 for i in range(97)]]
def dist2(p,a,b):
    dx=b[0]-a[0];dy=b[1]-a[1];length=dx*dx+dy*dy
    t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)) if length else 0
    return (p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2
before=parse(root/'ui-before.svg');after=parse(root/'candidate.svg');assert len(before)==len(after)
results=[];protected=0;line_count=0
for index,(old,new) in enumerate(zip(before,after)):
    assert old['fill']==new['fill']
    originals=old['curves'];candidates=new['curves'];cursor=0;deviations=[]
    for c in candidates:
        group=[]
        while cursor<len(originals):
            group.append(originals[cursor]);cursor+=1
            if originals[cursor-1]['to']==c['to']:break
        assert group[0]['from']==c['from'] and group[-1]['to']==c['to']
        if len(group)==1:
            assert group[0]==c
            if 'controls' not in c:line_count+=1
            continue
        assert len(group)==2
        a=[p for g in group for p in sample(g)];b=sample(c)
        def distance(points,ref):return max(min(dist2(p,x,y) for x,y in zip(ref,ref[1:])) for p in points)**.5
        deviation=max(distance(a,b),distance(b,a));deviations.append(deviation)
        assert deviation<=.085,(index,deviation)
    assert cursor==len(originals)
    results.append({'loop':index,'fill':old['fill'],'before':len(originals),'after':len(candidates),'removed':len(originals)-len(candidates),'maxBidirectionalSampledDeviation':max(deviations,default=0)})
old_audit=audit(before);new_audit=audit(after)
# Deliberate sharp joins must remain at the same coordinates and with same angle.
for join in old_audit['joins']:
    if join['angleDegrees']<10:continue
    matches=[j for j in new_audit['joins'] if j['loop']==join['loop'] and j['point']==join['point']]
    assert matches and abs(matches[0]['angleDegrees']-join['angleDegrees'])<.1
    protected+=1
report={'maxSampledDeviationPixels':max(r['maxBidirectionalSampledDeviation'] for r in results),'sharpJoinsRetained':protected,'linesUnchanged':line_count,'before':{k:v for k,v in old_audit.items() if k!='joins'},'after':{k:v for k,v in new_audit.items() if k!='joins'},'loops':results}
(root/'validation.json').write_text(json.dumps(report,indent=2));(root/'audit-after.json').write_text(json.dumps(new_audit,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='loops'},indent=2))
