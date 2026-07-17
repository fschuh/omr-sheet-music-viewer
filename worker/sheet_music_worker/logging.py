import sys


def worker_log(message: str) -> None:
    sys.stderr.write(f"[sheet-music-worker] {message}\n")
    sys.stderr.flush()

