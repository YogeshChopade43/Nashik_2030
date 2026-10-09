"""Download the map's glyph PBFs (Noto Sans, OFL) so fonts are self-hosted with the site.

Run: python -m pipeline.fonts   (idempotent: existing files are skipped)
"""
from __future__ import annotations

import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

import requests

STACKS = ["Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"]
SOURCE = "https://tiles.openfreemap.org/fonts"
OUT = Path(__file__).parent.parent / "public" / "fonts"


def ranges() -> list[str]:
    return [f"{s}-{s + 255}" for s in range(0, 65536, 256)]


def _get(stack: str, rng: str, out: Path) -> str:
    path = out / stack / f"{rng}.pbf"
    if path.exists():
        return "skip"
    r = requests.get(f"{SOURCE}/{quote(stack)}/{rng}.pbf", timeout=60)
    if r.status_code == 404:
        return "missing"  # MapLibre tolerates absent ranges (no glyphs in that block)
    r.raise_for_status()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(r.content)
    return "ok"


def _safe_get(stack: str, rng: str, out: Path) -> str:
    try:
        return _get(stack, rng, out)
    except Exception as e:  # noqa: BLE001 — any failure invalidates the whole set (see main)
        print(f"glyph {stack} {rng}: {e}")
        return "failed"


def main(out: Path = OUT) -> dict[str, int]:
    """Never raises: on any failure the folder is removed, so the app's probe fails and it
    falls back to OpenFreeMap glyphs (a partial set would pass the probe but miss ranges)."""
    jobs = [(s, r) for s in STACKS for r in ranges()]
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda j: _safe_get(j[0], j[1], out), jobs))
    summary = {k: results.count(k) for k in ("ok", "skip", "missing", "failed")}
    if summary["failed"]:
        shutil.rmtree(out, ignore_errors=True)
    print(summary)
    return summary


if __name__ == "__main__":
    main()
