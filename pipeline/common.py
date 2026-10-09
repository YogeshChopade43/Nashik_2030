"""Shared helpers for live feeds: the JSON envelope, atomic writes and grid interpolation."""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

LIVE_DIR = Path(__file__).parent.parent / "public" / "live"


def iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def envelope(source: str, license: str, attribution: str, valid_hours: float, data: dict, now: datetime | None = None) -> dict:
    """Every feed file shares this shape so the app can show provenance and staleness."""
    now = now or datetime.now(timezone.utc)
    return {
        "source": source,
        "license": license,
        "attribution": attribution,
        "fetched_at": iso(now),
        "valid_until": iso(now + timedelta(hours=valid_hours)),
        "data": data,
    }


def write_json_atomic(path: Path, obj: dict) -> None:
    """Write to a temp file then rename, so a crash never leaves a half-written feed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    os.replace(tmp, path)


def _frac(axis: np.ndarray, v: float) -> tuple[int, float]:
    """Index of the cell's lower edge along a 1-D axis (ascending or descending) and the 0..1 offset in it."""
    a = axis if axis[0] < axis[-1] else axis[::-1]
    i = int(np.clip(np.searchsorted(a, v) - 1, 0, len(a) - 2))
    t = float((v - a[i]) / (a[i + 1] - a[i]))
    if axis[0] > axis[-1]:  # map back to the original (descending) order
        return len(a) - 2 - i, 1 - t
    return i, t


def bilinear(lats: np.ndarray, lons: np.ndarray, grid: np.ndarray, lat: float, lon: float) -> float:
    i, ty = _frac(lats, lat)
    j, tx = _frac(lons, lon)
    g = grid
    return float(
        g[i, j] * (1 - ty) * (1 - tx) + g[i, j + 1] * (1 - ty) * tx
        + g[i + 1, j] * ty * (1 - tx) + g[i + 1, j + 1] * ty * tx
    )
