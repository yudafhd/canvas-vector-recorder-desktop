from pathlib import Path
import re,bisect,json
b=Path('/private/tmp/vm-analysis-mac'); out=Path('RND/vector-magic-analysis'); sy={}
for l in (b/'symbols.txt').read_text().splitlines():
 m=re.match(r'([0-9a-f]+) [Tt] (.*)',l)
 if m: sy[int(m[1],16)]=m[2]
addresses=sorted(sy); blocks={}; calls={}
for l in (b/'disassembly.txt').read_text().splitlines():
 m=re.match(r'([0-9a-f]+):',l)
 if not m: continue
 a=int(m[1],16); i=bisect.bisect_right(addresses,a)-1
 if i<0: continue
 name=sy[addresses[i]]; blocks.setdefault(name,[]).append(l)
 if '\tcallq\t' in l:
  dest=l.split('\tcallq\t')[1]; dm=re.match(r'0x([0-9a-f]+)',dest)
  resolved=sy.get(int(dm[1],16)) if dm else None
  calls.setdefault(name,[]).append({'address':hex(a),'target':resolved or dest})
chosen=['VmController::segmentImage','VmController::contourSmoothImage','VmController::bezierFitImage','Segmenter::execute','SubPixelSegmenter::execute','SuperPixelSegmenter::execute','ContourSmoother::execute','ContourSmoother::findPotential','ContourSmoother::findGradient','GenerativeModel::computePixelColor','GenerativeModel::findPotential','BezierFitter::execute','BezierFitter::computeSelfCost','BezierFitter::fitBezierCurve','BezierFitter::computeMergeMetric','PaletteFinder::computeCost','PaletteFinder::doKMeans','PixelSegmenter::computeMergeMetric']
selected={n:v for n,v in calls.items() if any(n.startswith(p+'(') for p in chosen)}
(out/'direct-calls.json').write_text(json.dumps(selected,indent=2)+'\n')
(b/'function-blocks.json').write_text(json.dumps(blocks))
for n,v in selected.items():
 print(n)
 for c in v:
  if '::' in c['target'] or '_dgesv' in c['target']: print(' ',c['address'],c['target'])
for p in chosen:
 for n,lines in blocks.items():
  if n.startswith(p+'('):
   (out/(p.replace('::','-')+'.asm.txt')).write_text(n+'\n'+'\n'.join(lines)+'\n')
