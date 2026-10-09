from pipeline import run


def test_run_one_failure_does_not_block(tmp_path, monkeypatch):
    calls = {"weather": 0}

    def boom(out):
        calls["weather"] += 1
        raise RuntimeError("ECMWF down")

    monkeypatch.setattr(run, "FEEDS", {
        "weather": boom,
        "river": lambda out: out / "river.json",
        "imd": lambda out: None,
    })
    monkeypatch.setattr(run.time, "sleep", lambda s: None)
    result = run.main(out=tmp_path)
    assert result == {"weather": "failed", "river": "ok", "imd": "skipped"}
    assert calls["weather"] == 3, "retried three times"


def test_run_exit_code_only_fails_when_all_configured_fail(tmp_path, monkeypatch):
    def boom(out):
        raise RuntimeError("down")

    monkeypatch.setattr(run.time, "sleep", lambda s: None)
    monkeypatch.setattr(run, "FEEDS", {"weather": boom, "river": lambda out: None, "imd": lambda out: None})
    assert run.exit_code(run.main(out=tmp_path)) == 1
    monkeypatch.setattr(run, "FEEDS", {"weather": boom, "river": lambda out: out / "r.json", "imd": lambda out: None})
    assert run.exit_code(run.main(out=tmp_path)) == 0
