"""Guards for the GitHub Actions workflows (structure only; they run in CI)."""
import re
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


def _uses():
    for f in WF.glob("*.yml"):
        wf = yaml.safe_load(f.read_text(encoding="utf8"))
        for job in wf["jobs"].values():
            for step in job.get("steps", []):
                if "uses" in step:
                    yield f.name, step["uses"]


# First major versions that run on Node 24 (Node 20 is being removed from GitHub runners).
NODE24 = {
    "actions/checkout": 5, "actions/setup-node": 5, "actions/setup-python": 6, "actions/setup-java": 5,
    "actions/cache": 5, "actions/upload-artifact": 6, "actions/download-artifact": 7,
    "actions/upload-pages-artifact": 4, "actions/deploy-pages": 5,
}


def test_actions_run_on_node24():
    old = [f"{f}: {u}" for f, u in _uses() if u.split("@")[0] in NODE24 and int(u.split("@v")[1].split(".")[0]) < NODE24[u.split("@")[0]]]
    assert old == []


def test_third_party_actions_are_pinned_to_a_commit():
    # A moving tag on someone else's repo can change what runs with our Pages token.
    loose = [f"{f}: {u}" for f, u in _uses() if not u.startswith(("actions/", "./")) and len(u.split("@")[1]) != 40]
    assert loose == []


def test_planetiler_is_pinned():
    tiles = (WF / "tiles.yml").read_text(encoding="utf8")
    assert "releases/latest" not in tiles
    assert re.search(r"PLANETILER: v\d+\.\d+\.\d+", tiles)
