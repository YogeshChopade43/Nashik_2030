from pipeline import fonts
from pipeline.fonts import STACKS, ranges


def test_any_failure_removes_partial_fonts(tmp_path, monkeypatch):
    # A partial set would pass the app's probe (Regular 0-255 present) while other ranges 404.
    def fake_get(stack, rng, out):
        if rng == "256-511":
            raise RuntimeError("timeout")
        p = out / stack / f"{rng}.pbf"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")
        return "ok"

    monkeypatch.setattr(fonts, "_get", fake_get)
    summary = fonts.main(tmp_path / "fonts")
    assert summary["failed"] > 0
    assert not (tmp_path / "fonts").exists(), "partial glyph set must be removed so the app falls back"


def test_ranges_cover_full_unicode_bmp():
    r = ranges()
    assert len(r) == 256 and r[0] == "0-255" and r[-1] == "65280-65535"


def test_stacks_match_style():
    assert STACKS == ["Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"]
