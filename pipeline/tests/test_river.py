import numpy as np

from pipeline import river
from pipeline.river import select_cell, trend


def test_select_cell_prefers_main_stem():
    lats = np.array([20.10, 20.05, 20.00, 19.95, 19.90])
    lons = np.array([73.70, 73.75, 73.80, 73.85, 73.90])
    weight = np.ones((5, 5))
    weight[2, 2] = 5.0    # tributary cell right at Ramkund
    weight[1, 2] = 50.0   # main stem 0.05° north: ten times the flow
    assert select_cell(lats, lons, weight, lat=20.0073, lon=73.7925) == (1, 2)


def test_select_cell_ignores_outside_radius():
    lats = np.array([20.30, 20.00])
    lons = np.array([73.80, 74.20])
    weight = np.array([[1000.0, 1.0], [2.0, 1.0]])  # huge value is 0.3° away → ignored
    assert select_cell(lats, lons, weight, lat=20.0073, lon=73.7925) == (1, 0)


def test_trend():
    assert trend([100, 130]) == "rising"
    assert trend([100, 95]) == "steady"
    assert trend([100, 60]) == "falling"
    assert trend([0, 0]) == "steady"


def test_fetch_skips_without_key(tmp_path, monkeypatch):
    monkeypatch.delenv("EWDS_API_KEY", raising=False)
    assert river.fetch(tmp_path) is None
    assert not list(tmp_path.iterdir())
