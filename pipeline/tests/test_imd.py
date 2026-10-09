import json

from pipeline import imd


class FakeResp:
    def __init__(self, status, payload=None):
        self.status_code, self._payload = status, payload

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, responder):
        self.responder, self.calls = responder, []

    def get(self, url, **kw):
        self.calls.append((url, kw))
        return self.responder(url)


def _data(tmp_path, monkeypatch, responder):
    monkeypatch.setenv("IMD_API_KEY", "k")
    return json.loads(imd.fetch(tmp_path, session=FakeSession(responder)).read_text(encoding="utf8"))["data"]


def test_imd_no_nashik_row_is_unrecognised_not_all_clear(tmp_path, monkeypatch):
    # districtwarning lists every district daily: zero Nashik rows means parsing failed, not "no warnings"
    data = _data(tmp_path, monkeypatch, lambda url: FakeResp(200, [{"District": "Pune", "Day_1": "Red"}]))
    assert data["status"] == "unrecognised_response"


def test_imd_error_payload_is_unrecognised(tmp_path, monkeypatch):
    data = _data(tmp_path, monkeypatch, lambda url: FakeResp(200, {"error": "invalid key"}))
    assert data["status"] == "unrecognised_response"


def test_imd_matches_nasik_spelling(tmp_path, monkeypatch):
    data = _data(tmp_path, monkeypatch, lambda url: FakeResp(200, [{"District": "NASIK", "Day_1": "Orange"}]))
    assert data["status"] == "ok" and data["warnings"] == [{"District": "NASIK", "Day_1": "Orange"}]


def test_imd_skips_without_key(tmp_path, monkeypatch):
    monkeypatch.delenv("IMD_API_KEY", raising=False)
    assert imd.fetch(tmp_path) is None
    assert not list(tmp_path.iterdir())


def test_imd_records_403(tmp_path, monkeypatch):
    monkeypatch.setenv("IMD_API_KEY", "k")
    path = imd.fetch(tmp_path, session=FakeSession(lambda url: FakeResp(403)))
    data = json.loads(path.read_text(encoding="utf8"))["data"]
    assert data["status"] == "http_403"
    assert data["warnings"] == [] and data["nowcast"] == []


def test_imd_filters_nashik(tmp_path, monkeypatch):
    monkeypatch.setenv("IMD_API_KEY", "k")
    rows = [{"District": "NASHIK", "Day_1": "Orange"}, {"District": "Pune", "Day_1": "Green"}]

    def responder(url):
        if "cityforecast" in url:
            return FakeResp(200, [{"Station_Name": "Nashik", "Todays_Forecast_Max_Temp": "31"}])
        if "districtrainfall" in url:
            return FakeResp(200, [{"District": "Nashik", "Daily Actual": "2.1"}, {"District": "Thane", "Daily Actual": "9"}])
        return FakeResp(200, rows)

    session = FakeSession(responder)
    data = json.loads(imd.fetch(tmp_path, session=session).read_text(encoding="utf8"))["data"]
    assert data["status"] == "ok"
    assert data["warnings"] == [rows[0]] and data["nowcast"] == [rows[0]]
    assert data["rainfall"] == {"District": "Nashik", "Daily Actual": "2.1"}
    assert data["forecast"]["Station_Name"] == "Nashik"
    assert any("43025" in str(kw.get("params")) or "43025" in url for url, kw in session.calls)
