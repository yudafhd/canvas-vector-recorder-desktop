"""Compare reconstructed decision tree with interpreted disassembly, without running target.

This checks transcription and branch inequalities. It is not binary runtime validation,
nor an independent validation of the geometric feature reconstruction.
"""
from pathlib import Path
import itertools
import json
import math
import random
import re
from phase5_corner_reference import corner_features, probably_punctured, punctured_indices

root = Path(__file__).resolve().parents[1] / 'phase5'
source = root / 'isProbablyPuncturedNode-1000f1b70.annotated.txt'
ops = []
for line in source.read_text().splitlines():
    m = re.match(r'([0-9a-f]+):\t[^\t]+\t([^;]+)(?:; (.*))?', line)
    if m and int(m[1], 16) <= 0x1000f1c50:
        ops.append((int(m[1], 16), m[2].strip(), m[3] or ''))
locations = {a: i for i, (a, _, _) in enumerate(ops)}
coverage = {}


def interpret(f):
    registers = {}
    flags = (False, False)  # CF, ZF from UCOMISD
    al, pc = 0, 0

    def operand(value):
        if value.startswith('%xmm'):
            return registers[value]
        m = re.fullmatch(r'(0x[0-9a-f]+)?\(%rdi\)', value)
        if m:
            return f[int(m[1] or '0', 16)//8]
        raise AssertionError(value)

    for _ in range(100):
        address, instruction, annotation = ops[pc]
        name, *rest = instruction.split(None, 1)
        operands = rest[0].split(', ') if rest else []
        pc += 1
        if name == 'movsd':
            registers[operands[1]] = (float(re.search(r'candidate_f64x2=\[([^,]+)', annotation)[1])
                                      if '%rip' in operands[0] else operand(operands[0]))
        elif name == 'ucomisd':
            right, left = map(operand, operands)
            flags = (left < right, left == right)
        elif name in ('jbe', 'ja', 'jmp'):
            taken = name == 'jmp' or (any(flags) if name == 'jbe' else not any(flags))
            if name != 'jmp':
                coverage.setdefault(hex(address), set()).add(taken)
            if taken:
                pc = locations[int(operands[0], 16)]
        elif name in ('seta', 'setbe'):
            al = int(not any(flags) if name == 'seta' else any(flags))
        elif name == 'movb':
            assert operands == ['$0x1', '%al']
            al = 1
        elif name == 'xorl':
            assert operands == ['%eax', '%eax']
            al = 0
        elif name == 'retq':
            return bool(al)
        elif name not in ('pushq', 'movq', 'popq'):
            raise AssertionError(instruction)
    raise AssertionError('Did not return')


rng = random.Random(5121)
thresholds = {0: [0.0286571, 0.322933, 0.445642], 2: [0.00209524, 0.122841],
              6: [0.282594, 0.483023, 0.611194, 1.42496, 1.72002],
              8: [0.0046405], 15: [0.5], 16: [0.097537]}
count = 0


def check(f):
    global count
    assert probably_punctured(f) == interpret(f), f
    count += 1


for _ in range(10000):
    f = [0.0]*21
    for i in thresholds:
        f[i] = rng.choice([0, 0.001, 0.01, 0.1, 0.3, 0.5, 1, 2, rng.random()*4])
    check(f)
# Exact and adjacent representable doubles at every threshold, under varied contexts.
for index, values in thresholds.items():
    for value in values:
        for near in (math.nextafter(value, -math.inf), value, math.nextafter(value, math.inf)):
            for c, total, sides, local in itertools.product([0.3, 0.5, 0.7, 1.5, 2], [0, 0.1, 0.4, 1], [0, 0.01, 0.2], [0, 1]):
                f = [0.0]*21
                f[0], f[2], f[6], f[8], f[15], f[16] = total, sides, c, sides, local, sides
                f[index] = near
                check(f)
assert all(len(outcomes) == 2 for outcomes in coverage.values()), coverage
straight = corner_features([(i, 0) for i in range(7)])
right_angle = corner_features([(-3, 0), (-2, 0), (-1, 0), (0, 0), (0, 1), (0, 2), (0, 3)])
assert not probably_punctured(straight)
assert probably_punctured(right_angle)
assert punctured_indices([(0, 0), (1, 0), (1, 1), (0, 1)]) == []
summary = {'classifier_vectors_checked': count, 'conditional_jump_sites': len(coverage),
           'all_conditional_jump_outcomes_covered': True,
           'synthetic_reference': {'straight': False, 'isolated_right_angle': True, 'four_node_contour_skipped': True},
           'target_binary_executed': False,
           'scope': 'Finite-input decision-tree transcription versus disassembly interpreter; feature geometry remains a static reconstruction'}
(root/'validation-summary.json').write_text(json.dumps(summary, indent=2)+'\n')
print(json.dumps(summary, indent=2))
