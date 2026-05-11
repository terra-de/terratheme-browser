#!/usr/bin/env python3
"""
Native messaging host for terratheme-browser Firefox extension.

Protocol: Firefox Native Messaging (4-byte uint32 length prefix + JSON UTF-8)
Reads ~/.config/terra/palette.json and pushes updates to the extension
when the file changes, polling every 2 seconds.
"""

import json
import pathlib
import struct
import sys
import threading
import time


PALETTE_PATH = pathlib.Path.home() / ".config" / "terra" / "palette.json"
POLL_INTERVAL = 2.0


def read_message() -> dict | None:
    """Read a message from stdin (Firefox Native Messaging protocol)."""
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length or len(raw_length) < 4:
        return None
    length = struct.unpack("@I", raw_length)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode("utf-8"))


def send_message(message: dict) -> None:
    """Send a message to stdout (Firefox Native Messaging protocol)."""
    data = json.dumps(message).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("@I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def read_stdin_loop():
    """Read messages from extension in a background thread."""
    while True:
        try:
            msg = read_message()
            if msg is None:
                break
            action = msg.get("action")

            if action == "get_palette":
                palette = load_palette()
                if palette:
                    send_palette_message(palette)

            elif action == "ping":
                send_message({"type": "pong"})

        except Exception as e:
            print(f"terratheme-browser: stdin error: {e}", file=sys.stderr)
            break

    print("terratheme-browser: stdin reader exiting", file=sys.stderr)


def load_palette() -> dict | None:
    """Read and parse palette.json. Returns None on failure."""
    try:
        if PALETTE_PATH.exists():
            raw = PALETTE_PATH.read_text(encoding="utf-8")
            return json.loads(raw)
    except (json.JSONDecodeError, OSError) as e:
        print(f"terratheme-browser: error reading palette: {e}", file=sys.stderr)
    return None


def send_palette_message(palette: dict) -> None:
    """Build and send a palette update message to the extension."""
    message = {
        "type": "palette_update",
        "palette": palette,
        "light": palette.get("light", {}),
        "dark": palette.get("dark", {}),
        "mode": palette.get("mode", "dark"),
    }
    send_message(message)


def main():
    print("terratheme-browser: host started", file=sys.stderr)

    # Start stdin reader thread
    stdin_thread = threading.Thread(target=read_stdin_loop, daemon=True)
    stdin_thread.start()

    # Initial palette push
    palette = load_palette()
    if palette:
        send_palette_message(palette)
    else:
        print("terratheme-browser: no palette.json found yet", file=sys.stderr)

    # Poll for changes
    last_mtime = PALETTE_PATH.stat().st_mtime if PALETTE_PATH.exists() else 0
    last_content = json.dumps(palette) if palette else ""

    try:
        while True:
            time.sleep(POLL_INTERVAL)

            if not PALETTE_PATH.exists():
                continue

            current_mtime = PALETTE_PATH.stat().st_mtime
            if current_mtime == last_mtime:
                continue

            palette = load_palette()
            if palette is None:
                continue

            current_content = json.dumps(palette, sort_keys=True)
            if current_content == last_content:
                # mtime changed but content didn't (rare edge case)
                last_mtime = current_mtime
                continue

            last_mtime = current_mtime
            last_content = current_content
            send_palette_message(palette)
            print(
                f"terratheme-browser: pushed update ({palette.get('mode', '?')})",
                file=sys.stderr,
            )
    except (BrokenPipeError, OSError):
        # Firefox closed the native messaging connection — exit cleanly
        print("terratheme-browser: connection closed, exiting", file=sys.stderr)


if __name__ == "__main__":
    main()
