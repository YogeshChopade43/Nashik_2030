"""Official IMD feed: district warnings, nowcast and rainfall for Nashik, plus the city forecast.

Needs IMD_API_KEY (register at api.imd.gov.in). Without it the feed is skipped.
An HTTP error (e.g. 401/403 when IP whitelisting is enforced) is still written as a status,
so the app can say "IMD feed unavailable" instead of showing nothing or old data as current.
Run: python -m pipeline.imd
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import requests

from .common import LIVE_DIR, envelope, write_json_atomic

BASE = "https://api.imd.gov.in/api/v1"
NASHIK_STATION_ID = "43025"


NASHIK = re.compile(r"^\s*nas(h)?ik\s*$", re.IGNORECASE)  # IMD uses both "Nashik" and "Nasik"


class Unrecognised(Exception):
    pass


def _is_nashik(row) -> bool:
    return isinstance(row, dict) and any(isinstance(v, str) and NASHIK.match(v) for v in row.values())


def _rows(payload) -> list:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for v in payload.values():  # some IMD endpoints wrap the list, e.g. {"data": [...]}
            if isinstance(v, list):
                return v
    return []


def fetch(out: Path = LIVE_DIR, session=requests) -> Path | None:
    key = os.environ.get("IMD_API_KEY")
    if not key:
        return None
    # IMD's auth style isn't documented publicly: send the key both as a bearer token and a parameter.
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
    data = {"status": "ok", "warnings": [], "nowcast": [], "rainfall": None, "forecast": None}

    def get(endpoint: str, **params):
        r = session.get(f"{BASE}/{endpoint}", params={"key": key, **params}, headers=headers, timeout=60)
        if r.status_code != 200:
            raise PermissionError(f"http_{r.status_code}")
        return r.json()

    try:
        # districtwarning lists every district daily, so zero Nashik rows means we couldn't parse the
        # response — never report that as "no warnings".
        warnings = [r for r in _rows(get("districtwarning")) if _is_nashik(r)]
        if not warnings:
            raise Unrecognised()
        data["warnings"] = warnings
        data["nowcast"] = [r for r in _rows(get("districtnowcast")) if _is_nashik(r)]
        data["rainfall"] = next((r for r in _rows(get("districtrainfall")) if _is_nashik(r)), None)
        data["forecast"] = next(iter(_rows(get("cityforecast", id=NASHIK_STATION_ID))), None)
    except PermissionError as e:
        data = {"status": str(e), "warnings": [], "nowcast": [], "rainfall": None, "forecast": None}
    except Unrecognised:
        data = {"status": "unrecognised_response", "warnings": [], "nowcast": [], "rainfall": None, "forecast": None}
    except (requests.RequestException, ValueError):
        data = {"status": "error", "warnings": [], "nowcast": [], "rainfall": None, "forecast": None}
    path = out / "imd.json"
    write_json_atomic(path, envelope(
        "India Meteorological Department API", "Government of India (IMD terms of use)",
        "Warnings, nowcast and rainfall: India Meteorological Department.", 3, data,
    ))
    return path


if __name__ == "__main__":
    print(fetch() or "skipped: IMD_API_KEY not set")
