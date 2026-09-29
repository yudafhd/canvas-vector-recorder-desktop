"""Static, sample-specific extraction of contour/fragment evidence; never executes target."""
from pathlib import Path
import argparse
import bisect
import hashlib
import json
import re
import struct

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, default=Path('/private/tmp/vm-analysis-mac'))
parser.add_argument('--output', type=Path, default=Path('RND/vector-magic-analysis/phase5'))
args = parser.parse_args()
raw = (args.source/'unpacked/Applications/Vector Magic/Vector Magic.app/Contents/MacOS/Vector Magic').read_bytes()
assert raw[:4].hex() == 'cafebabe'
for i in range(struct.unpack_from('>I', raw, 4)[0]):
    cpu, _, off, size, _ = struct.unpack_from('>IIIII', raw, 8+20*i)
    if cpu == 0x1000007:
        data = raw[off:off+size]
        break
segments = []
pos = 32
for _ in range(struct.unpack_from('<I', data, 16)[0]):
    cmd, size = struct.unpack_from('<II', data, pos)
    if cmd == 0x19:
        segments.append(struct.unpack_from('<QQQQ', data, pos+24))
        if data[pos+8:pos+24].rstrip(b'\0') == b'__TEXT':
            base = segments[-1][0]
    if cmd == 0x26:
        off, count = struct.unpack_from('<II', data, pos+8)
        blob = data[off:off+count]
    pos += size
starts, delta, shift = [], 0, 0
for byte in blob:
    delta |= (byte & 127) << shift
    if byte & 128:
        shift += 7
    else:
        if not delta:
            break
        base += delta
        starts.append(base)
        delta = shift = 0
symbols = {}
for line in (args.source/'symbols.txt').read_text().splitlines():
    m = re.match(r'([0-9a-f]+) [Tt] (.+)', line)
    if m:
        symbols[int(m[1], 16)] = m[2]
prefixes = ('BoundaryTracer::', 'BezierFitter::initialize(', 'BezierFitter::segmentContours(',
            'BezierFitter::followContour(', 'BezierFitter::selectKeepers(',
            'BezierFitter::initializeFragments(', 'BezierFitter::mergeAndSwapLoop(',
            'BezierFitter::fitBezierCurves(', 'ContourSmoother::punctureCorners(',
            'ContourSmoother::execute(', 'ContourSmoother::executeCurrentPhase(',
            'VectorImage::setInitialNodePositionAndType(', 'VectorImage::clearNodeFlags(',
            'VectorImage::resetNodePositionsAndFlags(', 'Segmenter::execute(',
            'VmController::segmentImage(', 'VmController::contourSmoothImage(',
            'isProbablyPuncturedNode(', 'ContourSmoother::initialize(')
selected = {a: n for a, n in symbols.items() if n.startswith(prefixes)}
blocks = {a: [] for a in selected}
refs, constants, boundary_skips = [], {}, []
for line in (args.source/'disassembly.txt').read_text().splitlines():
    m = re.match(r'([0-9a-f]+):\t([0-9a-f ]+)\t(.+)', line)
    if not m:
        continue
    address, code = int(m[1], 16), bytes.fromhex(m[2])
    index = bisect.bisect_right(starts, address)-1
    if index < 0:
        continue
    owner = starts[index]
    if index+1 < len(starts) and address+len(code) > starts[index+1]:
        if owner in selected:
            boundary_skips.append({'address': hex(address), 'reason': 'objdump instruction overlaps next LC_FUNCTION_STARTS boundary; padding decode omitted'})
        continue
    if len(code) == 5 and code[0] in (0xe8, 0xe9):
        target = address+5+struct.unpack('<i', code[1:])[0]
        if owner in selected or target in selected:
            refs.append({'site': hex(address), 'caller': symbols.get(owner, hex(owner)),
                         'target': symbols.get(target, hex(target)), 'kind': 'call' if code[0] == 0xe8 else 'jump'})
    if owner not in selected:
        continue
    rip = re.search(r'(-?0x[0-9a-f]+)\(%rip\)', line)
    if rip:
        target = address+len(code)+int(rip[1], 16)
        for vm, _, off, length in segments:
            if vm <= target and target+16 <= vm+length:
                value = data[off+target-vm:off+target-vm+16]
                entry = {'bytes': value.hex(), 'candidate_f64x2': list(struct.unpack('<2d', value))}
                constants[hex(target)] = entry
                line += f' ; @{target:#x} candidate_f64x2={entry["candidate_f64x2"]}'
                break
    blocks[owner].append(line)
args.output.mkdir(parents=True, exist_ok=True)
manifest = []
for address, lines in blocks.items():
    name = selected[address]
    filename = name.split('(')[0].replace('::', '-')+f'-{address:x}.annotated.txt'
    end = starts[bisect.bisect_left(starts, address)+1]
    (args.output/filename).write_text(f'{name}\nLC_FUNCTION_STARTS: [{address:#x}, {end:#x})\nNumeric interpretations are candidates.\n'+'\n'.join(lines)+'\n')
    manifest.append({'start': hex(address), 'end_exclusive': hex(end), 'name': name, 'file': filename})
for filename, content in [('function-boundaries.json', manifest), ('direct-references.json', refs), ('numeric-candidates.json', constants),
                          ('manifest.json', {'slice_sha256': hashlib.sha256(data).hexdigest(), 'functions': len(blocks), 'boundary_skips': boundary_skips, 'target_executed': False})]:
    (args.output/filename).write_text(json.dumps(content, indent=2)+'\n')
print(f'Extracted {len(blocks)} functions and {len(refs)} direct references')
