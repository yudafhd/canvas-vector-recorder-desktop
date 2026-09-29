"""Reproduce phase-4 static evidence. Never loads or executes the target image.

Inputs: extracted universal Mach-O, `nm -C` and x86_64 objdump output.
Defaults refer to the extraction workspace used in phases 1–3.
"""
import argparse
import bisect
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import struct


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path('/private/tmp/vm-analysis-mac')
    parser.add_argument('--binary', type=Path, default=root / 'unpacked/Applications/Vector Magic/Vector Magic.app/Contents/MacOS/Vector Magic')
    parser.add_argument('--disassembly', type=Path, default=root / 'disassembly.txt')
    parser.add_argument('--symbols', type=Path, default=root / 'symbols.txt')
    parser.add_argument('--output', type=Path, default=Path('RND/vector-magic-analysis/phase4'))
    args = parser.parse_args()
    raw = args.binary.read_bytes()
    assert raw[:4] == bytes.fromhex('cafebabe'), 'Expected FAT Mach-O'
    slices = [struct.unpack_from('>IIIII', raw, 8 + 20*i)
              for i in range(struct.unpack_from('>I', raw, 4)[0])]
    _, _, offset, size, _ = next(s for s in slices if s[0] == 0x1000007)
    data = raw[offset:offset+size]
    assert data[:4] == bytes.fromhex('cffaedfe')
    segments, starts_blob, text_base = [], None, None
    pos = 32
    for _ in range(struct.unpack_from('<I', data, 16)[0]):
        cmd, length = struct.unpack_from('<II', data, pos)
        if cmd == 0x19:
            seg = struct.unpack_from('<QQQQ', data, pos+24)
            segments.append(seg)
            if data[pos+8:pos+24].rstrip(b'\0') == b'__TEXT':
                text_base = seg[0]
        elif cmd == 0x26:
            start, count = struct.unpack_from('<II', data, pos+8)
            starts_blob = data[start:start+count]
        pos += length
    assert starts_blob and text_base

    def read(address, count):
        for vm, _, fileoff, filesize in segments:
            if vm <= address and address + count <= vm + filesize:
                index = fileoff + address-vm
                return data[index:index+count]
        raise ValueError(f'Unmapped file-backed address {address:#x}')

    def cstring(address):
        for vm, _, fileoff, filesize in segments:
            if vm <= address < vm + filesize:
                return data[fileoff+address-vm:fileoff+filesize].split(b'\0', 1)[0].decode('utf-8')
        raise ValueError(hex(address))

    starts, address, value, shift = [], text_base, 0, 0
    for byte in starts_blob:
        value |= (byte & 127) << shift
        if byte & 128:
            shift += 7
        else:
            if value == 0:
                break
            address += value
            starts.append(address)
            value, shift = 0, 0
    symbols = {}
    names = {}
    for line in args.symbols.read_text().splitlines():
        match = re.match(r'^([0-9a-f]+)\s+\S\s+(.+)$', line)
        if match:
            address, name = int(match[1], 16), match[2]
            symbols[name] = address
            names.setdefault(address, name)
    instructions = []
    for line in args.disassembly.read_text().splitlines():
        match = re.match(r'^([0-9a-f]+):\t([0-9a-f ]+)\t(.+)$', line)
        if match:
            instructions.append((int(match[1], 16), bytes.fromhex(match[2]), match[3], line))
    addresses = [row[0] for row in instructions]
    out = args.output
    out.mkdir(parents=True, exist_ok=True)

    def save(name, payload):
        (out / name).write_text(json.dumps(payload, indent=2) + '\n')

    selected = {address for name, address in symbols.items() if name.startswith((
        'BezierFitter::', 'VmController::populateSettings',
        'VmVectorizationSettings::toString', 'CustomSlider::CustomSlider'))}
    selected.update([0x1000bc570, 0x1000bd0e0])
    boundaries = []
    annotated_names = ('BezierFitter::fitBezierCurve(', 'BezierFitter::findPotential(',
                       'BezierFitter::computeDataAndTime(', 'BezierFitter::findHessianAndGradient(',
                       'VmController::populateSettings(', 'VmVectorizationSettings::toString(')

    def annotate(line):
        match = re.search(r'(-?0x[0-9a-f]+)\(%rip\)', line)
        if not match:
            return line
        fields = line.split('\t')
        address = int(fields[0][:-1], 16) + len(bytes.fromhex(fields[1])) + int(match[1], 16)
        try:
            value = read(address, 16)
        except ValueError:
            return line
        # Interpretation is only a candidate; operand/data flow determines type.
        return line + f' ; @{address:#x} candidate_f64x2={struct.unpack("<2d", value)}'

    for address in sorted(selected):
        index = bisect.bisect_left(starts, address)
        assert starts[index] == address, hex(address)
        end = starts[index+1]
        lines = [r[3] for r in instructions[bisect.bisect_left(addresses, address):bisect.bisect_left(addresses, end)]]
        filename = f'{address:#x}-bounded.asm.txt'
        (out / filename).write_text('\n'.join(lines) + '\n')
        name = names.get(address, '')
        if name.startswith(annotated_names):
            annotated_file = name.split('(')[0].replace('::', '-') + '.annotated.txt'
            header = f'{name}\nLC_FUNCTION_STARTS: [{address:#x}, {end:#x})\nNumeric annotations are type candidates, not inferred semantics.\n'
            (out / annotated_file).write_text(header + '\n'.join(map(annotate, lines)) + '\n')
        boundaries.append({'start': hex(address), 'end_exclusive': hex(end), 'name': names.get(address), 'file': filename})
    save('function-boundaries.json', boundaries)

    # Decode rel32 CALL/JMP bytes; do not depend on objdump's symbolic operands.
    targets = {a for n, a in symbols.items() if n.startswith('BezierFitter::')}
    refs = []
    for address, code, text, _ in instructions:
        if len(code) == 5 and code[0] in (0xe8, 0xe9):
            target = address + 5 + struct.unpack('<i', code[1:])[0]
            if target in targets:
                index = bisect.bisect_right(starts, address)-1
                caller = starts[index] if index >= 0 else None
                refs.append({'site': hex(address), 'kind': 'call' if code[0] == 0xe8 else 'jump',
                             'caller_start': hex(caller) if caller else None,
                             'caller_name': names.get(caller), 'target': names[target]})
    save('bezier-direct-references.json', refs)

    tables = {name: list(struct.unpack('<3d', read(address, 24)))
              for name, address in symbols.items()
              if name.startswith(('_prior_strengths_', '_length_penalty_weights_'))}
    tables['curve_threshold_factors'] = list(struct.unpack('<2d', read(0x1002ec760, 16)))
    tables['curve_threshold_exp'] = struct.unpack('<d', read(0x1002ec710, 8))[0]
    save('ui-constant-tables.json', tables)
    vectors = {hex(a): list(struct.unpack('<2d', read(a, 16)))
               for a in (0x1002eba30, 0x1002eba40, 0x1002eba50, 0x1002eba60)}
    save('short-fit-constant-vectors.json', vectors)
    save('advanced-phase-flags.json', {'initial_puncture_and_enabled0': list(struct.unpack('<4i', read(0x1002ec750, 16)))})
    presets = {}
    for name, address in symbols.items():
        if name.startswith('_EP_'):
            pointer = struct.unpack('<Q', read(address, 8))[0]
            text = cstring(pointer)
            params = {}
            for line in text.splitlines():
                parts = line.split()
                if parts and '::' in parts[0]:
                    params[parts[0]] = [part for part in parts[1:] if set(part) != {'.'}]
            assert len(params) == 100, (name, len(params))
            presets[name] = {'pointer': hex(pointer), 'parameters': params}
    save('embedded-presets.json', presets)
    pointers = {int(p['pointer'], 16): n for n, p in presets.items()}
    save('basic-preset-order.json', [pointers[p] for p in struct.unpack('<9Q', read(symbols['_ep_files'], 72))])
    fields = ['ContourSmoother::measurement_types', 'ContourSmoother::is_enabled',
              'ContourSmoother::prior_types', 'ContourSmoother::do_puncture_corners',
              'BezierFitter::stat_thresh_initial', 'BezierFitter::stat_thresh_final', 'BezierFitter::max_iterations']
    with (out / 'preset-summary.csv').open('w', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(['preset'] + fields)
        for name, preset in presets.items():
            writer.writerow([name] + [' '.join(preset['parameters'][f]) for f in fields])
    f32 = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]
    with (out / 'curve-slider-thresholds.csv').open('w', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(['complexity', 'initial_threshold', 'final_threshold'])
        for complexity in range(1, 13):
            d = 12 - complexity
            writer.writerow([complexity, f32(tables['curve_threshold_factors'][0]*(d+1)),
                             f32(tables['curve_threshold_factors'][1]*math.exp(tables['curve_threshold_exp']*d))])
    # Small UI excerpts retain label strings and actual 1..12 constructor arguments.
    for label, lo, hi in [('smoothness', 0x100077c6d, 0x100077cfe), ('curve-complexity', 0x1000782ca, 0x10007835b)]:
        (out / f'ui-{label}-range.asm.txt').write_text('\n'.join(row[3] for row in instructions if lo <= row[0] < hi) + '\n')
    save('extraction-manifest.json', {'binary_sha256': hashlib.sha256(raw).hexdigest(),
         'slice_sha256': hashlib.sha256(data).hexdigest(), 'architecture': 'x86_64',
         'function_starts': len(starts), 'bounded_functions': len(boundaries),
         'presets': len(presets), 'instructions': len(instructions),
         'reference_audit_scope': 'Direct rel32 CALL/JMP only; excludes indirect calls and data pointers'})
    print(f'Extracted {len(boundaries)} bounded functions, {len(presets)} presets, {len(refs)} direct references')


if __name__ == '__main__':
    main()
