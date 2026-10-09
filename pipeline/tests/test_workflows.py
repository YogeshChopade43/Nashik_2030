"""Guards for the GitHub Actions workflows (structure only; they run in CI)."""
from pathlib import Path

import yaml

WF = Path(__file__).parent.parent.parent / ".github" / "workflows"


def test_pages_base_survives_scheduled_runs():
    # On `schedule` events github.event has no `repository`, so the base must come from GITHUB_REPOSITORY.
    deploy = yaml.safe_load((WF / "deploy.yml").read_text(encoding="utf8"))
    build = next(s for s in deploy["jobs"]["build"]["steps"] if s.get("name") == "Build")
    text = str(build)
    assert "github.event.repository" not in text
    assert "GITHUB_REPOSITORY" in text


def test_fonts_are_cached_between_deploys():
    deploy = yaml.safe_load((WF / "deploy.yml").read_text(encoding="utf8"))
    uses = [s.get("uses", "") for s in deploy["jobs"]["build"]["steps"]]
    assert any(u.startswith("actions/cache@") for u in uses)
