"""Export static-research test vectors for the independent TypeScript kernels.

No Vector Magic binary/process is loaded. Classifier expected values come from
the existing disassembly interpreter, not the TypeScript decision tree.
"""
import hashlib
import csv
import itertools
import json
import math
from pathlib import Path
import random
import sys

research = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(research / 'scripts'))
from phase5_corner_reference import corner_features

# Load only the existing interpreter definitions, excluding its executable
# validation section (which writes a separate historical summary).
script = research / 'scripts' / 'validate_phase5.py'
namespace = {'__file__': str(script)}
exec(compile(script.read_text().split('rng = random.Random(5121)')[0], str(script), 'exec'), namespace)
interpret = namespace['interpret']
indices = [0, 2, 6, 8, 15, 16]
thresholds = {0: [0.0286571, 0.322933, 0.445642], 2: [0.00209524, 0.122841],
              6: [0.282594, 0.483023, 0.611194, 1.42496, 1.72002],
              8: [0.0046405], 15: [0.5], 16: [0.097537]}
vectors = []
for index, values in thresholds.items():
    for threshold in values:
        for value in (math.nextafter(threshold, -math.inf), threshold, math.nextafter(threshold, math.inf)):
            for c, total, local in itertools.product([0.3, 0.5, 0.7, 1.5, 2], [0, 0.4], [0, 1]):
                f = [0.] * 21
                f[0], f[2], f[6], f[8], f[15], f[16] = total, 0.01, c, 0.01, local, 0.01
                f[index] = value
                vectors.append([[f[i] for i in indices], interpret(f)])
rng = random.Random(5121)
for _ in range(256):
    f = [0.] * 21
    for i in indices:
        f[i] = rng.choice([0, 0.001, 0.01, 0.1, 0.3, 0.5, 1, 2, rng.random() * 4])
    vectors.append([[f[i] for i in indices], interpret(f)])
assert all(len(v) == 2 for v in namespace['coverage'].values()), namespace['coverage']
geometry = []
for _ in range(32):
    points = [[rng.uniform(-10, 10), rng.uniform(-10, 10)] for _ in range(7)]
    f = corner_features(points)
    geometry.append({'points': points, 'features': f})


def fit_reference(points):
    """Independent dense normal matrix / pivoted Gaussian elimination reference."""
    n = len(points) - 2
    times = [0.]
    for a, b in zip(points, points[1:]):
        times.append(times[-1] + math.dist(a, b))
    times = [t / (times[-1] or 1) for t in times]
    a, b = points[0], points[-1]
    controls = ([b, a] if n == 0 else [[0.75*a[k] + 0.25*b[k] for k in range(2)], [0.25*a[k] + 0.75*b[k] for k in range(2)]])
    if n >= 3:
        size = 2 if n == 3 else 4
        rows, targets = [], []
        for p, t in zip(points[1:-1], times[1:-1]):
            u = 1 - t
            weights = [2*u*t] if n == 3 else [3*u*u*t, 3*u*t*t]
            degree = 2 if n == 3 else 3
            for axis in range(2):
                row = [0.] * size
                for j, w in enumerate(weights):
                    row[2*j+axis] = w
                rows.append(row)
                targets.append(p[axis] - u**degree*a[axis] - t**degree*b[axis])
        matrix = [[sum(row[i]*row[j] for row in rows) + (1e-5 if i == j else 0) for j in range(size)]
                  + [sum(row[i]*r for row, r in zip(rows, targets))] for i in range(size)]
        for col in range(size):
            pivot = max(range(col, size), key=lambda r: abs(matrix[r][col]))
            matrix[col], matrix[pivot] = matrix[pivot], matrix[col]
            divisor = matrix[col][col]
            matrix[col] = [v/divisor for v in matrix[col]]
            for r in range(size):
                if r != col:
                    scale = matrix[r][col]
                    matrix[r] = [v-scale*w for v, w in zip(matrix[r], matrix[col])]
        solved = [row[-1] for row in matrix]
        controls = ([[a[k]+2*(solved[k]-a[k])/3 for k in range(2)], [b[k]+2*(solved[k]-b[k])/3 for k in range(2)]]
                    if n == 3 else [solved[:2], solved[2:]])
    residuals = []
    for p, t in zip(points[1:-1], times[1:-1]):
        u = 1-t
        q = [u**3*a[k]+3*u*u*t*controls[0][k]+3*u*t*t*controls[1][k]+t**3*b[k] for k in range(2)]
        residuals.append(math.dist(q, p)**2)
    cost = sum(residuals) if n >= 3 else 0
    if n in (1, 2):
        q = [(1-times[1])*a[k]+times[1]*b[k] for k in range(2)]
        cost = math.dist(q, points[1])**2
    return {'controls': controls, 'times': times, 'cost': cost, 'maxError': max(residuals, default=0)}


samples = [[[0, 0], [4, 0]], [[0, 0], [1, 0], [4, 0]], [[0, 0], [1, 0], [2, 10], [4, 0]],
           [[0, 0], [1, 1], [2, 1.5], [3, 1], [4, 0]],
           [[0, 0], [1, 1], [2, 1.5], [3, 1.5], [4, 1], [5, 0]],
           [[15, -9], [16, -8], [18, -7], [20, -7], [22, -8], [24, -9]], [[100, 80]]*7]
annotation = research / 'phase5' / 'isProbablyPuncturedNode-1000f1b70.annotated.txt'
result = {'scope': 'Static disassembly interpreter; geometric reconstruction; independent dense solver. No target runtime validation.',
          'classifierEvidenceSha256': hashlib.sha256(annotation.read_bytes()).hexdigest(),
          'classifierFeatureIndices': indices, 'classifier': vectors, 'geometry': geometry,
          'fitting': [{'points': p, **fit_reference(p)} for p in samples]}
with (research / 'phase4' / 'curve-slider-thresholds.csv').open(newline='') as table:
    result['complexity'] = [{'value': int(row['complexity']), 'initial': float(row['initial_threshold']), 'final': float(row['final_threshold'])}
                            for row in csv.DictReader(table)]
destination = research.parents[1] / 'tests' / 'fixtures' / 'tracing-research-reference.json'
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(result, separators=(',', ':')) + '\n')
print(json.dumps({'classifierVectors': len(vectors), 'geometryWindows': len(geometry), 'fitBranches': len(samples), 'output': str(destination)}))
