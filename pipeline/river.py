"""River-flow feed: GloFAS forecast (Copernicus EWDS, CC BY 4.0) for the Godavari at Nashik.

Needs a free EWDS account: set EWDS_API_KEY. Without it the feed is skipped (nothing written).
Run: python -m pipeline.river
"""
from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from .common import LIVE_DIR, envelope, write_json_atomic

RAMKUND = (20.0073, 73.7925)
AREA = [20.2, 73.6, 19.8, 74.0]  # N, W, S, E
LEADTIMES = [str(h) for h in range(24, 241, 24)]
EWDS_URL = "https://ewds.climate.copernicus.eu/api"


def select_cell(lats: np.ndarray, lons: np.ndarray, weight: np.ndarray, lat: float = RAMKUND[0], lon: float = RAMKUND[1], radius: float = 0.1) -> tuple[int, int]:
    """Cell with the largest weight (forecast discharge) within ±radius° of the point.
    On a single river the largest flow is the main stem, so tributary cells next to Ramkund lose."""
    best, best_w = None, -np.inf
    for i, la in enumerate(lats):
        for j, lo in enumerate(lons):
            if abs(la - lat) <= radius and abs(lo - lon) <= radius and weight[i, j] > best_w:
                best, best_w = (i, j), weight[i, j]
    if best is None:
        raise RuntimeError("no GloFAS cell within radius of Ramkund")
    return best


def trend(series: list[float]) -> str:
    first, last = float(series[0]), float(series[-1])
    if first <= 0:
        return "rising" if last > 0 else "steady"
    change = (last - first) / first
    return "rising" if change > 0.10 else "falling" if change < -0.10 else "steady"


def _forecast_date(now: datetime) -> datetime:
    # GloFAS publishes the 00 UTC forecast during the same day; use yesterday's to be safe before ~10 UTC.
    return (now - timedelta(hours=10)).replace(hour=0, minute=0, second=0, microsecond=0)


def fetch(out: Path = LIVE_DIR) -> Path | None:
    key = os.environ.get("EWDS_API_KEY")
    if not key:
        return None
    import cdsapi
    import xarray as xr

    day = _forecast_date(datetime.now(timezone.utc))
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "glofas.grib2"
        cdsapi.Client(url=EWDS_URL, key=key, quiet=True).retrieve("cems-glofas-forecast", {
            "system_version": ["operational"],
            "hydrological_model": ["lisflood"],
            "product_type": ["control_forecast"],
            "variable": "river_discharge_in_the_last_24_hours",
            "year": [day.strftime("%Y")], "month": [day.strftime("%m")], "day": [day.strftime("%d")],
            "leadtime_hour": LEADTIMES,
            "data_format": "grib2",
            "download_format": "unarchived",
            "area": AREA,
        }, str(target))
        ds = xr.open_dataset(target, engine="cfgrib", backend_kwargs={"indexpath": ""})
        var = next(iter(ds.data_vars))
        q = ds[var].values  # (step, lat, lon)
        lats, lons = ds.latitude.values, ds.longitude.values
        steps = ds.step.values
    i, j = select_cell(lats, lons, np.nanmean(q, axis=0))
    values = [float(v) for v in q[:, i, j]]
    series = [{"date": (day + timedelta(hours=int(s / np.timedelta64(1, "h")))).strftime("%Y-%m-%d"), "discharge_m3s": round(v, 1)}
              for s, v in zip(steps, values)]
    data = {
        "forecast_date": day.strftime("%Y-%m-%d"),
        "cell": {"lat": float(lats[i]), "lon": float(lons[j]), "selection": "largest forecast discharge within 0.1° of Ramkund"},
        "series": series,
        "trend": trend(values),
    }
    path = out / "river.json"
    write_json_atomic(path, envelope(
        "Copernicus GloFAS forecast", "CC BY 4.0",
        "River discharge © Copernicus Emergency Management Service (GloFAS), CC BY 4.0. Modelled on a ~5 km grid; approximate.",
        24, data,
    ))
    return path


if __name__ == "__main__":
    print(fetch() or "skipped: EWDS_API_KEY not set")
