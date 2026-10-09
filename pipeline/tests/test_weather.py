from datetime import datetime, timezone

import numpy as np

from pipeline.weather import POINTS, build, deaccumulate, pick_run, wind

UTC = timezone.utc


def test_pick_run_falls_back():
    now = datetime(2026, 10, 9, 10, tzinfo=UTC)
    got = pick_run(now, lambda r: r == datetime(2026, 10, 9, 0, tzinfo=UTC))
    assert got == datetime(2026, 10, 9, 0, tzinfo=UTC)


def test_pick_run_none_available_raises():
    try:
        pick_run(datetime(2026, 10, 9, 10, tzinfo=UTC), lambda r: False)
    except RuntimeError:
        return
    raise AssertionError("expected RuntimeError")


def test_deaccumulate_clamps_negative():
    got = deaccumulate([0, 0.002, 0.001999, 0.005])
    assert all(abs(a - b) < 1e-6 for a, b in zip(got, [0.0, 2.0, 0.0, 3.0])), got


def test_wind():
    speed, direction = wind(0.0, -10.0)
    assert abs(speed - 36.0) < 1e-9
    assert abs(direction - 0.0) < 1e-9


def test_build_shapes():
    lats, lons = np.array([20.25, 19.75]), np.array([73.5, 74.0])
    g = lambda v: (lats, lons, np.full((2, 2), v))
    fields = {
        "2t": {s: g(300.0) for s in (0, 3, 6)},
        "tp": {0: g(0.0), 3: g(0.001), 6: g(0.003)},
        "10u": {s: g(0.0) for s in (0, 3, 6)},
        "10v": {s: g(-10.0) for s in (0, 3, 6)},
        "tcc": {s: g(0.5) for s in (0, 3, 6)},
    }
    out = build(datetime(2026, 10, 9, 0, tzinfo=UTC), fields)
    assert out["run"] == "2026-10-09T00:00:00Z"
    assert set(out["points"]) == set(POINTS)
    for series in out["points"].values():
        assert len(series) == 3
        assert set(series[0]) == {"t", "temp_c", "rain_mm", "wind_kmh", "wind_dir", "cloud_pct"}
        assert abs(series[0]["temp_c"] - 26.85) < 1e-6
        assert [round(e["rain_mm"], 6) for e in series] == [0.0, 1.0, 2.0]
        assert series[1]["t"] == "2026-10-09T03:00:00Z"
        assert series[0]["cloud_pct"] == 50
