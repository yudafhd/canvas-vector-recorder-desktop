"""Extract BoundaryTracer's six static cleanup patterns from both installers.

This reads data sections only; it never loads or executes the target binaries.
Addresses/RVAs are specific to Vector Magic 1.21, not a general symbol lookup.
"""

import argparse
import hashlib
import json
from pathlib import Path
import struct


MAC_ADDRESS = 0x100302EC0  # _expanded_patterns in the x86_64 Mach-O slice
WIN_RVA = 0x90020       # expanded_patterns export in engine_project.dll
RECORDS = 6
RECORD_BYTES = 256


def mac_table(path):
    raw = path.read_bytes()
    assert raw[:4] == bytes.fromhex("cafebabe")
    slices = [struct.unpack_from(">IIIII", raw, 8 + i * 20)
              for i in range(struct.unpack_from(">I", raw, 4)[0])]
    _, _, offset, size, _ = next(row for row in slices if row[0] == 0x1000007)
    image = raw[offset:offset + size]
    cursor = 32
    for _ in range(struct.unpack_from("<I", image, 16)[0]):
        command, command_size = struct.unpack_from("<II", image, cursor)
        if command == 0x19:  # LC_SEGMENT_64
            address, virtual_size, file_offset, file_size = struct.unpack_from(
                "<QQQQ", image, cursor + 24)
            if address <= MAC_ADDRESS and MAC_ADDRESS + RECORDS * RECORD_BYTES <= address + file_size:
                start = file_offset + MAC_ADDRESS - address
                return image[start:start + RECORDS * RECORD_BYTES], hashlib.sha256(image).hexdigest()
        cursor += command_size
    raise ValueError("Mach-O pattern table is outside file-backed segments")


def windows_table(path):
    image = path.read_bytes()
    assert image[:2] == b"MZ"
    pe = struct.unpack_from("<I", image, 0x3C)[0]
    assert image[pe:pe + 4] == b"PE\0\0"
    count = struct.unpack_from("<H", image, pe + 6)[0]
    optional_size = struct.unpack_from("<H", image, pe + 20)[0]
    sections = pe + 24 + optional_size
    for index in range(count):
        section = sections + index * 40
        _, rva, raw_size, raw_offset = struct.unpack_from("<IIII", image, section + 8)
        if rva <= WIN_RVA and WIN_RVA + RECORDS * RECORD_BYTES <= rva + raw_size:
            start = raw_offset + WIN_RVA - rva
            return image[start:start + RECORDS * RECORD_BYTES], hashlib.sha256(image).hexdigest()
    raise ValueError("PE pattern table is outside file-backed sections")


def decode(blob):
    output = []
    for index in range(RECORDS):
        words = struct.unpack_from("<64i", blob, index * RECORD_BYTES)
        length = words[0]
        assert 5 <= length <= 31
        match = words[1:1 + length]
        keep = words[32:32 + length + 1]
        assert set(match) <= {0, 1} and set(keep) <= {0, 1}
        packed = lambda sequence: sum(bit << position for position, bit in enumerate(reversed(sequence)))
        output.append({
            "priority": index,
            "length": length,
            "match_bits_old_to_new": "".join(map(str, match)),
            "match_value": f"0x{packed(match):x}",
            "keep_bits_old_to_new": "".join(map(str, keep)),
            "keep_value": f"0x{packed(keep):x}",
        })
    return output


def pattern_match(x_bits, y_bits, available, patterns):
    """Reference for the integer decision at Mach-O 0x1000c15e0..0x1000c16b9."""
    for pattern in patterns:
        length = pattern["length"]
        if available < length:
            continue
        mask = (1 << length) - 1
        value = int(pattern["match_value"], 16)
        if x_bits & mask == value or y_bits & mask == value:
            return length, int(pattern["keep_value"], 16), pattern["priority"]
    return 0, None, None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mac", type=Path, default=Path(
        "/private/tmp/vm-analysis-mac/unpacked/Applications/Vector Magic/Vector Magic.app/Contents/MacOS/Vector Magic"))
    parser.add_argument("--windows", type=Path, default=Path(
        "/private/tmp/vm-analysis-windows/unpacked/flspRShS48._AE72tYVNfmG6ehA9u0"))
    parser.add_argument("--output", type=Path, default=Path(
        "RND/vector-magic-analysis/phase6/expanded-patterns.json"))
    args = parser.parse_args()
    mac_blob, mac_hash = mac_table(args.mac)
    win_blob, win_hash = windows_table(args.windows)
    mac_patterns = decode(mac_blob)
    win_patterns = decode(win_blob)
    assert mac_patterns == win_patterns, "macOS and Windows cleanup patterns differ"
    assert mac_blob == win_blob, "macOS and Windows raw pattern records differ"
    checks = 0
    for pattern in mac_patterns:
        n = pattern["length"]
        value = int(pattern["match_value"], 16)
        keep = int(pattern["keep_value"], 16)
        expected = (n, keep, pattern["priority"])
        assert pattern_match(value, 0xFFFFFFFF, n, mac_patterns) == expected
        assert pattern_match(0xFFFFFFFF, value, n, mac_patterns) == expected
        checks += 2
    assert pattern_match(0, 0xAA, 9, mac_patterns) == (5, 0x21, 0)
    assert pattern_match(0, 0, 4, mac_patterns) == (0, None, None)
    assert pattern_match(0xFFFFFFFF, 0xFFFFFFFF, 31, mac_patterns) == (0, None, None)
    checks += 3
    result = {
        "target_executed": False,
        "mac_slice_sha256": mac_hash,
        "windows_engine_sha256": win_hash,
        "mac_table_address": hex(MAC_ADDRESS),
        "windows_table_rva": hex(WIN_RVA),
        "tables_byte_identical": True,
        "pattern_priority": "first matching record wins",
        "match_axes": "x OR y",
        "keep_mask": "1 preserves node; 0 marks node for removal",
        "reference_matcher_checks": checks,
        "patterns": mac_patterns,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Verified {len(mac_patterns)} byte-identical macOS/Windows patterns")


if __name__ == "__main__":
    main()
