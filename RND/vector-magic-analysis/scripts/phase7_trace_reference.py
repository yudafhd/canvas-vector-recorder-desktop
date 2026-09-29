"""Static BoundaryTracer direction extraction and local small-grid checks.

This models only local candidate selection in macOS 1.21, not complete cycles.
It does not load or execute Vector Magic, and is not a replacement rasterizer.
"""

import argparse
import hashlib
import json
from pathlib import Path
import struct


def mach_image_and_segments(path):
    raw = path.read_bytes()
    assert raw[:4] == bytes.fromhex("cafebabe")
    slices = [struct.unpack_from(">IIIII", raw, 8 + i * 20)
              for i in range(struct.unpack_from(">I", raw, 4)[0])]
    _, _, offset, size, _ = next(row for row in slices if row[0] == 0x1000007)
    image = raw[offset:offset + size]
    segments = []
    cursor = 32
    for _ in range(struct.unpack_from("<I", image, 16)[0]):
        command, length = struct.unpack_from("<II", image, cursor)
        if command == 0x19:
            segments.append(struct.unpack_from("<QQQQ", image, cursor + 24))
        cursor += length
    return image, segments


def bytes_at(image, segments, address, length):
    segment = next(row for row in segments
                   if row[0] <= address and address + length <= row[0] + row[3])
    offset = segment[2] + address - segment[0]
    return image[offset:offset + length]


def words_at(image, segments, address, count):
    return list(struct.unpack(f"<{count}i", bytes_at(image, segments, address, count * 4)))


def extract_directions(image, segments):
    # Constructor stores raw 16-byte vectors at +0x6c, +0x7c; MOVSD from
    # memory at +0x8c clears the upper 64 bits. Then it writes +0x9c and +0xa4.
    x_side = words_at(image, segments, 0x1002EBAB0 + 12, 1) + words_at(
        image, segments, 0x1002EBAC0, 3)
    y_side = words_at(image, segments, 0x1002EBAC0 + 12, 1) + words_at(
        image, segments, 0x100160600, 3)
    dx = words_at(image, segments, 0x100160600 + 12, 1) + words_at(
        image, segments, 0x1002EBAD0, 2) + [0]
    assert bytes_at(image, segments, 0x1000BF29D, 11) == bytes.fromhex(
        "48c7879c00000001000000")  # qword 1 at +0x9c
    assert bytes_at(image, segments, 0x1000BF2A8, 10) == bytes.fromhex(
        "c787a4000000ffffffff")  # int -1 at +0xa4
    dy = [0, 1, 0, -1]  # +0x98 cleared by MOVSD, then two immediates above
    # The first side is at +0x68/+0x78; the second is entry (d+1)&3.
    assert x_side == [-1, -1, 0, 0]
    assert y_side == [-1, 0, 0, -1]
    assert dx == [-1, 0, 1, 0]
    assert dy == [0, 1, 0, -1]
    return [
        {"direction": name, "dx": dx[d], "dy": dy[d],
         "first_side": [x_side[d], y_side[d]],
         "second_side": [x_side[(d + 1) & 3], y_side[(d + 1) & 3]]}
        for d, name in enumerate(("west", "south", "east", "north"))
    ]


def pixel(image, x, y):
    if y < 0 or y >= len(image) or x < 0 or x >= len(image[0]):
        return -1
    return image[y][x]


def candidates(image, node, region, visited, directions):
    x, y = node
    width, height = len(image[0]), len(image)
    result = []
    for item in directions:
        nx, ny = x + item["dx"], y + item["dy"]
        if not (0 <= nx <= width and 0 <= ny <= height):
            continue
        first = (x + item["first_side"][0], y + item["first_side"][1])
        second = (x + item["second_side"][0], y + item["second_side"][1])
        neighbor = pixel(image, *second)
        if (pixel(image, *first) == region and neighbor != region
                and (region, nx, ny) not in visited):
            result.append({**item, "next": [nx, ny], "first_pixel": list(first),
                           "other_region": neighbor})
    return result


def select(options, previous_first_pixel):
    """Recover branches 0x1000c05b0..0x1000c0800 for 1..4 candidates."""
    if not options or len(options) > 4:
        raise ValueError("trace requires 1..4 candidates")
    if len(options) == 1 or previous_first_pixel is None:
        return options[0], True
    for option in options[:-1]:
        if option["first_pixel"] == list(previous_first_pixel):
            return option, False
    return options[-1], False


def validate(directions):
    checks = 0
    from itertools import product
    for values in product((0, 1, 2), repeat=4):
        image = [list(values[:2]), list(values[2:])]
        for region in (0, 1, 2):
            options = candidates(image, (1, 1), region, set(), directions)
            assert len(options) <= 2
            if options:
                assert select(options, None)[0] == options[0]
                if len(options) == 2:
                    assert select(options, options[0]["first_pixel"])[0] == options[0]
                    assert select(options, options[1]["first_pixel"])[0] == options[1]
                    assert select(options, (-9, -9))[0] == options[1]
            checks += 1
    checker = [[1, 2], [2, 1]]
    junction = candidates(checker, (1, 1), 1, set(), directions)
    assert [item["direction"] for item in junction] == ["west", "east"]
    decisions = {
        "no_previous_cell": select(junction, None)[0]["direction"],
        "previous_northwest_cell": select(junction, (0, 0))[0]["direction"],
        "previous_southeast_cell": select(junction, (1, 1))[0]["direction"],
        "previous_unmatched_cell": select(junction, (9, 9))[0]["direction"],
    }
    assert decisions == {"no_previous_cell": "west", "previous_northwest_cell": "west",
                         "previous_southeast_cell": "east", "previous_unmatched_cell": "east"}
    edge = candidates([[1]], (0, 0), 1, set(), directions)
    assert [item["direction"] for item in edge] == ["east"]
    visited_junction = candidates(checker, (1, 1), 1, {(1, 0, 1)}, directions)
    assert [item["direction"] for item in visited_junction] == ["east"]
    other_region_junction = candidates(checker, (1, 1), 2, set(), directions)
    assert [item["direction"] for item in other_region_junction] == ["south", "north"]
    checks += 4
    return checks, {"checkerboard_junction": junction,
                    "checkerboard_decisions": decisions, "single_pixel_corner": edge,
                    "visited_west_suppressed": visited_junction,
                    "other_region_junction": other_region_junction}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mac", type=Path, default=Path(
        "/private/tmp/vm-analysis-mac/unpacked/Applications/Vector Magic/Vector Magic.app/Contents/MacOS/Vector Magic"))
    parser.add_argument("--output", type=Path, default=Path(
        "RND/vector-magic-analysis/phase7/trace-reference.json"))
    args = parser.parse_args()
    image, segments = mach_image_and_segments(args.mac)
    directions = extract_directions(image, segments)
    checks, examples = validate(directions)
    output = {"target_executed": False, "mac_slice_sha256": hashlib.sha256(image).hexdigest(),
              "candidate_cases_checked": checks, "directions": directions,
              "examples": examples}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n")
    print(f"Validated {checks} local reference cases")


if __name__ == "__main__":
    main()
