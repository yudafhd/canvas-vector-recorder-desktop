#!/usr/bin/env python3
"""Record Vector Magic process and exported SVG events during a manual run."""

import hashlib
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "phase8" / "diagonal-yellow-white-353-vm.svg"
EVENTS = ROOT / "phase8" / "runtime-monitor.jsonl"
POLL_SECONDS = 1
MAX_SECONDS = 15 * 60


def record(kind, **fields):
    entry = {"time_utc": datetime.now(timezone.utc).isoformat(), "event": kind, **fields}
    line = json.dumps(entry, ensure_ascii=False)
    with EVENTS.open("a", encoding="utf-8") as stream:
        stream.write(line + "\n")
    print(line, flush=True)


def app_processes():
    try:
        result = subprocess.run(
            ["ps", "-axo", "pid=,comm="], capture_output=True, text=True, timeout=3, check=True
        )
    except (OSError, subprocess.SubprocessError) as error:
        return None, str(error)
    matches = []
    for line in result.stdout.splitlines():
        if "/Vector Magic.app/Contents/MacOS/" in line:
            matches.append(line.strip())
    return matches, None


def output_state():
    try:
        info = OUTPUT.stat()
    except FileNotFoundError:
        return None
    except OSError as error:
        return {"error": str(error)}
    state = {"size": info.st_size, "mtime_ns": info.st_mtime_ns}
    try:
        state["sha256"] = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
    except OSError as error:
        state["read_error"] = str(error)
    return state


def main():
    EVENTS.parent.mkdir(parents=True, exist_ok=True)
    record("monitor_start", output=str(OUTPUT), max_seconds=MAX_SECONDS)
    last_processes = object()
    last_output = object()
    last_error = None
    deadline = time.monotonic() + MAX_SECONDS
    try:
        while time.monotonic() < deadline:
            processes, error = app_processes()
            if error != last_error:
                if error:
                    record("process_read_error", message=error)
                last_error = error
            if processes is not None and processes != last_processes:
                record("app_processes", processes=processes)
                last_processes = processes
            state = output_state()
            if state != last_output:
                record("svg_output", state=state)
                last_output = state
            time.sleep(POLL_SECONDS)
    except KeyboardInterrupt:
        record("monitor_stop", reason="interrupted")
        return 0
    record("monitor_stop", reason="timeout")
    return 0


if __name__ == "__main__":
    sys.exit(main())
