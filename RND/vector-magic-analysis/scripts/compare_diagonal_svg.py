#!/usr/bin/env python3
"""Measure the two colored regions in a Vector Magic diagonal fixture export."""

import argparse
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET


TOKEN = re.compile(r"[MCZ]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?")
EXPECTED_YELLOW_PIXELS = 62128
EXPECTED_SIZE = 353


def parse_path(data):
    tokens = TOKEN.findall(data)
    segments = []
    position = None
    start = None
    i = 0
    while i < len(tokens):
        command = tokens[i]
        i += 1
        if command == "M":
            position = (float(tokens[i]), float(tokens[i + 1]))
            start = position
            i += 2
        elif command == "C":
            values = [float(value) for value in tokens[i:i + 6]]
            if len(values) != 6 or position is None:
                raise ValueError("incomplete cubic path")
            end = (values[4], values[5])
            segments.append((position, tuple(values[:2]), tuple(values[2:4]), end))
            position = end
            i += 6
        elif command == "Z":
            if position != start:
                segments.append((position, position, start, start))
            position = start
        else:
            raise ValueError(f"unsupported SVG command {command!r}")
    return segments


def point_on_cubic(segment, t):
    weights = ((1 - t) ** 3, 3 * (1 - t) ** 2 * t,
               3 * (1 - t) * t ** 2, t ** 3)
    return tuple(sum(weight * point[axis] for weight, point in zip(weights, segment))
                 for axis in (0, 1))


def sample_path(segments, steps=500):
    return [point_on_cubic(segment, i / steps)
            for segment in segments for i in range(steps)]


def polygon_area(points):
    return abs(sum(x * points[(i + 1) % len(points)][1]
                   - points[(i + 1) % len(points)][0] * y
                   for i, (x, y) in enumerate(points))) / 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("svg", type=Path)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    root = ET.fromstring(args.svg.read_bytes())
    ns = {"svg": "http://www.w3.org/2000/svg"}
    paths = {node.attrib.get("id"): node for node in root.findall(".//svg:path", ns)}
    measured = {}
    for name in ("shape-5", "shape-6"):
        node = paths[name]
        segments = parse_path(node.attrib["d"])
        points = sample_path(segments)
        candidates = [segment for segment in segments
                      if abs(segment[3][0] - segment[0][0]) > 300
                      and abs(segment[3][1] - segment[0][1]) > 300]
        diagonal = candidates[0]
        samples = [point_on_cubic(diagonal, i / 1000) for i in range(1001)]
        offsets = [x + y - (EXPECTED_SIZE - 1) for x, y in samples]
        measured[name] = {
            "fill": node.attrib.get("fill"),
            "cubic_segments": len(segments),
            "area_local_square_pixels": polygon_area(points),
            "diagonal_endpoints_local": [diagonal[0], diagonal[3]],
            "diagonal_offset_from_x_plus_y_352": {
                "min": min(offsets), "max": max(offsets),
                "mean": sum(offsets) / len(offsets),
                "max_absolute": max(map(abs, offsets))},
        }
    result = {
        "source": str(args.svg.resolve()),
        "fixture_size": [EXPECTED_SIZE, EXPECTED_SIZE],
        "expected_yellow_pixel_count": EXPECTED_YELLOW_PIXELS,
        "colored_regions": measured,
        "yellow_area_delta_from_raster_pixel_count":
            measured["shape-5"]["area_local_square_pixels"] - EXPECTED_YELLOW_PIXELS,
        "colored_region_area_sum": sum(x["area_local_square_pixels"] for x in measured.values()),
        "full_image_area": EXPECTED_SIZE ** 2,
    }
    output = json.dumps(result, indent=2)
    if args.json:
        args.json.write_text(output + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
