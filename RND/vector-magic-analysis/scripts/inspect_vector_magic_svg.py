#!/usr/bin/env python3
"""Summarize an exported SVG for the diagonal fixture runtime comparison."""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET


DRAWABLE = {"path", "polygon", "polyline", "rect", "circle", "ellipse", "line"}
COMMANDS = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]")


def local_name(tag):
    return tag.rsplit("}", 1)[-1]


def inspect(path):
    payload = path.read_bytes()
    root = ET.fromstring(payload)
    elements = Counter()
    fills = Counter()
    strokes = Counter()
    commands = Counter()
    drawables = []
    for element in root.iter():
        tag = local_name(element.tag)
        elements[tag] += 1
        if tag not in DRAWABLE:
            continue
        style = {}
        for declaration in element.attrib.get("style", "").split(";"):
            if ":" in declaration:
                key, value = declaration.split(":", 1)
                style[key.strip()] = value.strip()
        fill = element.attrib.get("fill", style.get("fill", "inherited"))
        stroke = element.attrib.get("stroke", style.get("stroke", "inherited"))
        fills[fill] += 1
        strokes[stroke] += 1
        path_commands = Counter(COMMANDS.findall(element.attrib.get("d", "")))
        commands.update(path_commands)
        drawables.append({"tag": tag, "fill": fill, "stroke": stroke,
                          "path_commands": dict(path_commands),
                          "path_characters": len(element.attrib.get("d", ""))})
    return {"file": str(path.resolve()), "sha256": hashlib.sha256(payload).hexdigest(),
            "bytes": len(payload), "svg_attributes": dict(root.attrib),
            "elements": dict(elements), "fills": dict(fills), "strokes": dict(strokes),
            "path_commands": dict(commands), "drawables": drawables}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("svg", type=Path)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    result = inspect(args.svg)
    formatted = json.dumps(result, indent=2, ensure_ascii=False)
    if args.json:
        args.json.write_text(formatted + "\n", encoding="utf-8")
    print(formatted)


if __name__ == "__main__":
    main()
