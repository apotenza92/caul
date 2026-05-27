#!/usr/bin/env python3
import subprocess
import sys


def main() -> int:
    args = sys.argv[1:]

    if not args:
        print("missing pi arguments", file=sys.stderr)
        return 2

    process = subprocess.Popen(
        ["pi", *args],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    assert process.stdout is not None
    assert process.stderr is not None

    for line in process.stdout:
        print(line, end="", flush=True)

    errors = process.stderr.read()

    if errors:
        print(errors, end="", file=sys.stderr, flush=True)

    return process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
