"""Run every live feed independently: one failing feed never blocks the others.

Run: python -m pipeline.run   (exit code 1 only if every configured feed failed)
"""
from __future__ import annotations

import sys
import time
import traceback
from pathlib import Path

from . import imd, river, weather
from .common import LIVE_DIR

FEEDS = {"weather": weather.fetch, "river": river.fetch, "imd": imd.fetch}
BACKOFF_S = (10, 30)


def main(out: Path = LIVE_DIR) -> dict[str, str]:
    result: dict[str, str] = {}
    for name, fetch in FEEDS.items():
        for attempt in range(3):
            try:
                result[name] = "ok" if fetch(out) is not None else "skipped"
                break
            except Exception:  # noqa: BLE001 — isolate feeds; the traceback goes to the Actions log
                traceback.print_exc()
                if attempt == 2:
                    result[name] = "failed"
                else:
                    time.sleep(BACKOFF_S[attempt])
    print(" · ".join(f"{k}: {v}" for k, v in result.items()))
    return result


def exit_code(result: dict[str, str]) -> int:
    configured = [v for v in result.values() if v != "skipped"]
    return 1 if configured and all(v == "failed" for v in configured) else 0


if __name__ == "__main__":
    sys.exit(exit_code(main()))
