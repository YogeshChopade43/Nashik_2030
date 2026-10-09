import json
from datetime import datetime, timezone

import numpy as np

from pipeline.common import bilinear, envelope, write_json_atomic


def test_envelope_fields():
    e = envelope("ECMWF", "CC BY 4.0", "x", 6, {"a": 1}, now=datetime(2026, 10, 9, 12, tzinfo=timezone.utc))
    assert e["source"] == "ECMWF" and e["license"] == "CC BY 4.0" and e["attribution"] == "x"
    assert e["fetched_at"] == "2026-10-09T12:00:00Z"
    assert e["valid_until"] == "2026-10-09T18:00:00Z"
    assert e["data"] == {"a": 1}


def test_bilinear_exact_and_mid():
    grid = np.array([[0.0, 1.0], [2.0, 3.0]])
    lats, lons = np.array([20.0, 19.75]), np.array([73.75, 74.0])
    assert bilinear(lats, lons, grid, 20.0, 73.75) == 0.0
    assert abs(bilinear(lats, lons, grid, 19.875, 73.875) - 1.5) < 1e-9


def test_atomic_write_no_tmp_left(tmp_path):
    p = tmp_path / "live" / "x.json"
    write_json_atomic(p, {"ok": True})
    assert json.loads(p.read_text(encoding="utf8")) == {"ok": True}
    assert not list(p.parent.glob("*.tmp"))
