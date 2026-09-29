"""Extract bounded phase-10 raster/gradient evidence. Never loads or executes the target image.

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
    parser.add_argument('--output', type=Path, default=Path('RND/vector-magic-analysis/phase10'))
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

    prefixes = ('GenerativeModel::computePixelColor(', 'GenerativeModel::computePartialGradients(',
                'GenerativeModel::findPixelGradient(', 'GenerativeModel::findGradient(',
                'GenerativeModel::findPotential(', 'GenerativeModel::closePixel(',
                'ContourSmoother::findAngularPriorPotential(', 'ContourSmoother::findAngularPriorGradient(')
    entries = []
    for name, address in sorted(symbols.items(), key=lambda row: row[1]):
        if not name.startswith(prefixes):
            continue
        index = bisect.bisect_left(starts, address)
        assert starts[index] == address
        end = starts[index+1]
        lines = []
        for site, code, instruction, line in instructions[bisect.bisect_left(addresses,address):bisect.bisect_left(addresses,end)]:
            match = re.search(r'(-?0x[0-9a-f]+)\(%rip\)', line)
            if match:
                target = site + len(code) + int(match[1],16)
                try:
                    line += f' ; @{target:#x} candidate_f64x2={struct.unpack("<2d",read(target,16))}'
                except ValueError:
                    pass
            lines.append(line)
        filename = name.split('(')[0].replace('::','-') + '.annotated.txt'
        (out/filename).write_text(f'{name}\nLC_FUNCTION_STARTS: [{address:#x}, {end:#x})\nNumeric annotations are candidates.\n'+'\n'.join(lines)+'\n')
        entries.append({'name':name,'start':hex(address),'end_exclusive':hex(end),'file':filename})
    save('manifest.json', {'slice_sha256':hashlib.sha256(data).hexdigest(),'target_executed':False,'functions':entries})
    print(json.dumps({'functions':len(entries),'output':str(out)}))

if __name__ == '__main__':
    main()
