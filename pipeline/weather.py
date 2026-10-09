"""Weather feed from ECMWF Open Data (IFS 0.25°, CC BY 4.0). No account or key needed.

Run: python -m pipeline.weather
"""
from __future__ import annotations

import math
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import numpy as np
import requests

from .common import LIVE_DIR, bilinear, envelope, iso, write_json_atomic

POINTS: dict[str, tuple[float, float]] = {
    "nashik": (19.9975, 73.7898),
    "trimbakeshwar": (19.9322, 73.5300),
    "gangapur_dam": (20.0436, 73.6810),
    "nashik_road": (19.9488, 73.8406),
}
PARAMS = ["2t", "tp", "10u", "10v", "tcc"]
STEPS = list(range(0, 145, 3))
# Only 00/12 UTC runs reach 144 h (06/18 stop at 90 h); the spec asks for six days.
RUN_HOURS = (0, 12)
# Crop box around the points, padded by more than one 0.25° grid cell.
BOX = {"north": 20.5, "south": 19.5, "west": 73.0, "east": 74.25}
BASE_URL = "https://data.ecmwf.int/forecasts"


def pick_run(now: datetime, is_available: Callable[[datetime], bool]) -> datetime:
    """Newest 00/12 UTC run within the last 24 h that is already published."""
    t = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    for back in range(0, 25):
        run = t - timedelta(hours=back)
        if run.hour in RUN_HOURS and is_available(run):
            return run
    raise RuntimeError("no ECMWF run published in the last 24 h")


def deaccumulate(tp_m: list[float]) -> list[float]:
    """Cumulative precipitation (m) → mm per step. Uses the running maximum, so GRIB packing noise
    that makes the total dip slightly never yields negative rain or double-counts later steps."""
    out, peak = [], 0.0
    for i, v in enumerate(tp_m):
        v = max(float(v), peak)
        out.append(0.0 if i == 0 else (v - peak) * 1000.0)
        peak = v
    return out


def wind(u: float, v: float) -> tuple[float, float]:
    """(speed km/h, meteorological direction the wind blows FROM, degrees)."""
    speed = math.hypot(u, v) * 3.6
    direction = (math.degrees(math.atan2(-u, -v)) + 360.0) % 360.0
    return speed, direction


def build(run: datetime, fields: dict) -> dict:
    steps = sorted(fields["2t"])
    points: dict[str, list[dict]] = {}
    for name, (lat, lon) in POINTS.items():
        val = lambda p, s: bilinear(*fields[p][s], lat, lon)
        rain = deaccumulate([val("tp", s) for s in steps])
        series = []
        for k, s in enumerate(steps):
            speed, direction = wind(val("10u", s), val("10v", s))
            series.append({
                "t": iso(run + timedelta(hours=s)),
                "temp_c": round(val("2t", s) - 273.15, 2),
                "rain_mm": round(rain[k], 2),
                "wind_kmh": round(speed, 1),
                "wind_dir": round(direction),
                "cloud_pct": round(min(max(val("tcc", s), 0.0), 1.0) * 100),
            })
        points[name] = series
    return {"run": iso(run), "model": "ECMWF IFS 0.25° (open data)", "points": points}


def _available(run: datetime) -> bool:
    d, h = run.strftime("%Y%m%d"), run.strftime("%H")
    url = f"{BASE_URL}/{d}/{h}z/ifs/0p25/oper/{d}{h}0000-144h-oper-fc.index"
    try:
        return requests.head(url, timeout=30).status_code == 200
    except requests.RequestException:
        return False


def _read(path: Path) -> dict:
    """GRIB → {param: {step: (lats, lons, grid)}} cropped to BOX."""
    import cfgrib  # imported lazily: heavy, and only needed for real fetches

    names = {"t2m": "2t", "tp": "tp", "u10": "10u", "v10": "10v", "tcc": "tcc"}
    fields: dict[str, dict] = {p: {} for p in PARAMS}
    for ds in cfgrib.open_datasets(str(path), backend_kwargs={"indexpath": ""}):
        lons = ds.longitude.values
        lon_mask = (lons >= BOX["west"]) & (lons <= BOX["east"])
        lat_mask = (ds.latitude.values >= BOX["south"]) & (ds.latitude.values <= BOX["north"])
        steps_h = (ds.step.values / np.timedelta64(1, "h")).astype(int) if ds.step.size > 1 else [int(ds.step.values / np.timedelta64(1, "h"))]
        for var, param in names.items():
            if var not in ds:
                continue
            arr = ds[var].values
            arr = arr if arr.ndim == 3 else arr[None, ...]
            for k, s in enumerate(steps_h):
                fields[param][int(s)] = (ds.latitude.values[lat_mask], lons[lon_mask], arr[k][np.ix_(lat_mask, lon_mask)])
    missing = [p for p in PARAMS if len(fields[p]) != len(STEPS)]
    if missing:
        raise RuntimeError(f"GRIB incomplete for {missing}")
    return fields


def fetch(out: Path = LIVE_DIR) -> Path:
    from ecmwf.opendata import Client

    run = pick_run(datetime.now(timezone.utc), _available)
    with tempfile.TemporaryDirectory() as tmp:
        grib = Path(tmp) / "ifs.grib2"
        Client(source="ecmwf").retrieve(
            date=run.strftime("%Y-%m-%d"), time=run.hour, type="fc", step=STEPS, param=PARAMS, target=str(grib),
        )
        fields = _read(grib)
    data = build(run, fields)
    path = out / "weather.json"
    write_json_atomic(path, envelope(
        "ECMWF Open Data (IFS)", "CC BY 4.0",
        "Weather forecast © ECMWF, CC BY 4.0. Interpolated from a 0.25° grid; values are approximate for a point.",
        6, data,
    ))
    return path


if __name__ == "__main__":
    print(fetch())
