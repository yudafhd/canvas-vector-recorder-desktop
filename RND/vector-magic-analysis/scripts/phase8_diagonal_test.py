"""Generate a deterministic yellow/white diagonal and test the static tracer rule.

The PNG is a procedural stand-in for the chat image, not a copy of its pixels.
No Vector Magic binary is loaded or executed by this script.
"""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import struct
import zlib

from phase7_trace_reference import candidates, extract_directions, mach_image_and_segments


YELLOW = (255, 193, 7)
WHITE = (255, 255, 255)


def chunk(kind, body):
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))


def png_rgb(rows):
    size = len(rows)
    raw = b"".join(b"\0" + bytes(channel for pixel in row for channel in pixel)
                   for row in rows)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def make_fixture(size):
    assert size >= 4
    labels = [[1 if x + y < size - 1 else 2 for x in range(size)] for y in range(size)]
    rows = [[YELLOW if label == 1 else WHITE for label in row] for row in labels]
    return labels, png_rgb(rows)


def analyze(labels, directions):
    size = len(labels)
    counts = Counter(label for row in labels for label in row)
    horizontal = sum(labels[y][x] != labels[y][x + 1]
                     for y in range(size) for x in range(size - 1))
    vertical = sum(labels[y][x] != labels[y + 1][x]
                   for y in range(size - 1) for x in range(size))
    assert counts[1] == size * (size - 1) // 2
    assert counts[2] == size * (size + 1) // 2
    assert horizontal == vertical == size - 1
    # Count only internal nodes touching both colors. Each has exactly one
    # admissible outgoing direction for each region in this non-junction case.
    interface_nodes = 0
    candidates_by_region = Counter()
    ambiguous = []
    for y in range(1, size):
        for x in range(1, size):
            local = {labels[y - 1][x - 1], labels[y - 1][x],
                     labels[y][x - 1], labels[y][x]}
            if len(local) < 2:
                continue
            interface_nodes += 1
            for region in (1, 2):
                options = candidates(labels, (x, y), region, set(), directions)
                candidates_by_region[region] += len(options)
                if len(options) > 1:
                    ambiguous.append([x, y, region, len(options)])
    assert not ambiguous
    return {"size": [size, size], "yellow_pixels": counts[1],
            "white_pixels": counts[2], "horizontal_color_transitions": horizontal,
            "vertical_color_transitions": vertical,
            "interface_length_grid_edges": horizontal + vertical,
            "internal_interface_nodes": interface_nodes,
            "local_candidates_on_interface": {str(k): v for k, v in sorted(candidates_by_region.items())},
            "ambiguous_internal_nodes": ambiguous}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mac", type=Path, default=Path(
        "/private/tmp/vm-analysis-mac/unpacked/Applications/Vector Magic/Vector Magic.app/Contents/MacOS/Vector Magic"))
    parser.add_argument("--output", type=Path, default=Path("RND/vector-magic-analysis/phase8"))
    args = parser.parse_args()
    mach, segments = mach_image_and_segments(args.mac)
    directions = extract_directions(mach, segments)
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    for size in (32, 353):
        labels, data = make_fixture(size)
        filename = f"diagonal-yellow-white-{size}.png"
        (args.output / filename).write_bytes(data)
        results.append({"filename": filename, "sha256": hashlib.sha256(data).hexdigest(),
                        **analyze(labels, directions)})
    summary = {"source_image": "procedural approximation of chat image",
               "target_executed": False, "mac_slice_sha256": hashlib.sha256(mach).hexdigest(),
               "colors_rgb": {"yellow": YELLOW, "white": WHITE}, "fixtures": results}
    (args.output / "diagonal-test.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
