# Live Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Free, unlimited live weather, river and IMD data plus self-hosted PMTiles. GitHub Actions builds static JSON, GitHub Pages serves it, and the app reads it.

**Architecture:** Python feed scripts in `pipeline/` write enveloped JSON into `public/live/`. Three workflows run on a schedule: they fetch the feeds, build Nashik PMTiles with Planetiler, and deploy everything to Pages. The React app reads the JSON through `src/data/live.ts` and renders `LiveCard`. The map uses `pmtiles://`, with OpenFreeMap as the fallback.

**Tech Stack:**
- Python 3.9+ (`ecmwf-opendata`, `eccodes`, `cfgrib`, `xarray`, `numpy`, `cdsapi`, `requests`, `pytest`);
- GitHub Actions;
- Planetiler (Java 21);
- `pmtiles` npm 4.x;
- the existing React / MapLibre / Vite stack.

**Spec:** `docs/superpowers/specs/2026-10-09-live-data-pipeline-design.md`

## Global Constraints

- **Never `git push`.** Workflows run only after the user pushes. Local commits are allowed.
- **No metered or freemium APIs.** The only sources are ECMWF Open Data, Copernicus EWDS (GloFAS), IMD and Geofabrik/OSM.
- **Envelope on every feed file:** `{source, license, attribution, fetched_at, valid_until, data}`, with ISO-8601 UTC timestamps.
- **`valid_until` per feed:** weather = fetch + 6 h; river = fetch + 24 h; IMD = fetch + 3 h.
- **Weather points:**
  - `nashik` (19.9975, 73.7898)
  - `trimbakeshwar` (19.9322, 73.5300)
  - `gangapur_dam` (20.0436, 73.6810)
  - `nashik_road` (19.9488, 73.8406)
- **Weather steps:** 0–144 h every 3 h. Parameters: `2t`, `tp`, `10u`, `10v`, `tcc`.
- **River cell selection:** the cell with the largest upstream area within ±0.1° of Ramkund (20.0073, 73.7925).
- **Tile bounds:** `72.9,19.4,74.7,20.6`, zoom 0–14. Source: Geofabrik `asia/india/western-zone`.
- **Fonts:** Noto Sans Regular, Bold and Italic, all 256 ranges.
- **Failures:** a failed feed writes nothing, and the app never shows fabricated or empty data as current.
- **Stale rule:** `now > valid_until + interval`, where interval = 6 h / 24 h / 3 h.

## Review Focus

1. **The latest ECMWF run isn't published yet** (a run appears about 7–9 h after its nominal time). Expect a fall back to the previous run, not a failure. Test: `test_pick_run_falls_back`, Task 2.
2. **Accumulated `tp` packing noise produces tiny negative increments.** These must clamp to 0 mm. Test: `test_deaccumulate_clamps_negative`, Task 2.
3. **A JSON file with no or unparseable `valid_until`, or a `fetched_at` in the future,** must be treated as `missing`, not `ok`. Test: `classify rejects malformed envelopes`, Task 6.
4. **GitHub Pages serves under `/Nashik_2030/`.** Every runtime fetch (`/data`, `/live`, `/tiles`, `/fonts`) must use `import.meta.env.BASE_URL`. Test: the build check in Task 8 (grep `dist/` for absolute `"/data/` fetches).
5. **The PMTiles file is absent** (the first deploy happens before the first tile build). The map must fall back to OpenFreeMap without breaking. Test: `tileSource falls back when pmtiles 404s`, Task 8.

---

### Task 1: Pipeline foundation (envelope, atomic write, interpolation)

**Files:**
- Create: `pipeline/requirements.txt`, `pipeline/common.py`, `pipeline/tests/test_common.py`, `pipeline/__init__.py`, `pipeline/tests/__init__.py`
- Modify: `.gitignore` (add `pipeline/.venv`, `__pycache__`, `public/live/`, `public/tiles/`, `public/fonts/`)

**Interfaces:**
- Produces:
  - `envelope(source: str, license: str, attribution: str, valid_hours: float, data: dict, now: datetime | None = None) -> dict`
  - `write_json_atomic(path: Path, obj: dict) -> None` (writes `path.tmp`, then `os.replace`)
  - `bilinear(lats: np.ndarray, lons: np.ndarray, grid: np.ndarray, lat: float, lon: float) -> float` (1-D ascending or descending coordinate axes; `grid[lat_i, lon_j]`)
  - `LIVE_DIR = Path(__file__).parent.parent / "public" / "live"`

- [ ] **Step 1:** Create a venv: `python -m venv pipeline/.venv`, then `pipeline/.venv/Scripts/pip install -r pipeline/requirements.txt`. The requirements file pins `numpy`, `requests`, `pytest`, `ecmwf-opendata`, `eccodes`, `cfgrib`, `xarray` and `cdsapi`.
- [ ] **Step 2: Write the failing tests** in `test_common.py`:
  - `test_envelope_fields`: `envelope("ECMWF", "CC BY 4.0", "x", 6, {"a": 1}, now=datetime(2026,10,9,12,tzinfo=UTC))` gives `fetched_at == "2026-10-09T12:00:00Z"` and `valid_until == "2026-10-09T18:00:00Z"`, with `data == {"a": 1}`.
  - `test_bilinear_exact_and_mid`: on the grid `[[0,1],[2,3]]` with lats `[20,19.75]` and lons `[73.75,74]`, point (20, 73.75) gives 0; point (19.875, 73.875) gives 1.5.
  - `test_atomic_write_no_tmp_left`: after writing, the file parses and no `.tmp` file remains.
- [ ] **Step 3:** Run `pipeline/.venv/Scripts/python -m pytest pipeline/tests -q`. Expected: failures (import errors).
- [ ] **Step 4:** Implement `common.py`. Timestamps use the `Z` suffix and drop microseconds.
- [ ] **Step 5:** Run the tests. Expected: 3 passed.
- [ ] **Step 6:** Commit: `feat(pipeline): envelope, atomic write, bilinear helpers`.

### Task 2: Weather feed (ECMWF Open Data)

**Files:**
- Create: `pipeline/weather.py`, `pipeline/tests/test_weather.py`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces:
  - `POINTS: dict[str, tuple[float, float]]` (the spec's four points)
  - `pick_run(now: datetime, is_available: Callable[[datetime], bool]) -> datetime`: the newest 00/06/12/18 UTC run, up to 24 h back, for which `is_available` is true
  - `deaccumulate(tp_m: list[float]) -> list[float]`: metres, cumulative → mm per step, clamped at ≥ 0
  - `wind(u: float, v: float) -> tuple[float, float]`: (speed km/h, direction in degrees the wind comes *from*)
  - `build(run: datetime, fields: dict[str, dict[int, tuple[lats, lons, grid]]]) -> dict`: returns `{"run": iso, "points": {name: [{"t": iso, "temp_c", "rain_mm", "wind_kmh", "wind_dir", "cloud_pct"}...]}}`
  - `fetch(out: Path) -> Path`: downloads with `ecmwf.opendata.Client(source="ecmwf")` (`type="fc"`), reads with cfgrib, and writes `weather.json` via `envelope(...valid_hours=6)`

- [ ] **Step 1: Write the failing tests:**
  - `test_pick_run_falls_back`: now = 2026-10-09 10:00Z; availability is true only for the 00Z run → returns 00Z.
  - `test_deaccumulate_clamps_negative`: `[0, 0.002, 0.001999, 0.005]` → `[0.0, 2.0, 0.0, 3.0]` (±1e-6).
  - `test_wind`: `(0, -10 m/s)` → speed 36 km/h, direction 0° (a northerly).
  - `test_build_shapes`: with synthetic 2×2 grids at 3 steps (`2t` at 300 K → `temp_c` 26.85), each point has 3 entries, and the keys match.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. `tcc` 0–1 maps to a percentage, and the first step's `rain_mm` is 0.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Run against real data: `python -m pipeline.weather`. Expected: `public/live/weather.json` exists, with 49 entries for each of the 4 points and a plausible Nashik temperature (15–40 °C).
- [ ] **Step 6:** Commit: `feat(pipeline): ECMWF weather feed`.

### Task 3: River feed (GloFAS via EWDS)

**Files:**
- Create: `pipeline/river.py`, `pipeline/tests/test_river.py`

**Interfaces:**
- Produces:
  - `select_cell(lats, lons, upstream_area: np.ndarray, lat=20.0073, lon=73.7925, radius=0.1) -> tuple[int, int]`
  - `trend(series: list[float]) -> str`: `"rising"` / `"falling"` / `"steady"`, comparing the last value with the first (±10 %)
  - `fetch(out: Path) -> Path | None`: returns `None` and writes nothing when `EWDS_API_KEY` is unset. It uses `cdsapi.Client(url="https://ewds.climate.copernicus.eu/api", key=...)` with dataset `cems-glofas-forecast` (control forecast, `river_discharge_in_the_last_24_hours`, lead times 24–240, area `[20.2, 73.6, 19.8, 74.0]`). The upstream-area auxiliary file is cached at `pipeline/.cache/uparea.nc`.
  - The output `data` is `{"cell": {"lat","lon","upstream_km2"}, "series": [{"date","discharge_m3s"}], "trend"}`, with `valid_hours=24`.

- [ ] **Step 1: Write the failing tests:**
  - `test_select_cell_prefers_main_stem`: on a 5×5 grid where a tributary cell sits closer but the cell 0.05° away has 10× the upstream area → the larger cell is chosen.
  - `test_select_cell_ignores_outside_radius`.
  - `test_trend`: `[100, 130]` → rising; `[100, 95]` → steady; `[100, 60]` → falling.
  - `test_fetch_skips_without_key`: with the env var unset, `fetch` returns `None` and no file is created.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(pipeline): GloFAS river feed (key-gated)`.

### Task 4: IMD feed and the orchestrator

**Files:**
- Create: `pipeline/imd.py`, `pipeline/run.py`, `pipeline/tests/test_imd.py`, `pipeline/tests/test_run.py`

**Interfaces:**
- Produces:
  - `imd.fetch(out: Path, session=requests) -> Path | None`. Without `IMD_API_KEY` it returns `None`.
    - It calls `https://api.imd.gov.in/api/v1/{districtwarning,districtnowcast,districtrainfall}` and `cityforecast?id=43025` with an `Authorization: Bearer <key>` header (sent as both header and `key` parameter, since the auth style isn't documented). It filters district responses to entries whose district name is Nashik (case-insensitive).
    - It writes `data = {"status": "ok" | "http_<code>" | "error", "warnings": [...], "nowcast": [...], "rainfall": {...}, "forecast": {...}}` with `valid_hours=3`.
    - On HTTP 401/403 it **still** writes the status, with empty lists, so the app can say "unavailable".
  - `run.main(feeds=("weather", "river", "imd")) -> dict[str, str]`: runs each feed with 3 attempts (10 s / 30 s backoff), catches per-feed exceptions, prints a summary, and returns `{feed: "ok"|"skipped"|"failed"}`. The exit code is 0 unless *all* configured feeds failed.
- [ ] **Step 1: Write the failing tests:**
  - `test_imd_skips_without_key`.
  - `test_imd_records_403`: a fake session returning 403 → the file has `status == "http_403"` and `warnings == []`.
  - `test_imd_filters_nashik`.
  - `test_run_one_failure_does_not_block`: monkeypatched weather raises, river returns a path → `{"weather": "failed", "river": "ok", ...}`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS (all pipeline tests).
- [ ] **Step 5:** Commit: `feat(pipeline): IMD feed and resilient runner`.

### Task 5: Fonts download script

**Files:**
- Create: `pipeline/fonts.py`

**Interfaces:**
- Produces: `fonts.main(out=Path("public/fonts"))`: downloads `https://tiles.openfreemap.org/fonts/{stack}/{start}-{start+255}.pbf` for the 3 stacks × 256 ranges, skips files already present, and keeps 404s as missing (MapLibre tolerates missing ranges).
- [ ] **Step 1:** Run `python -m pipeline.fonts`. Expected: `public/fonts/Noto Sans Regular/0-255.pbf` exists and is larger than 1 KB.
- [ ] **Step 2:** Commit: `feat(pipeline): self-hosted glyph download`.

### Task 6: App data layer (`live.ts`)

**Files:**
- Create: `src/data/live.ts`, `src/data/live.test.ts`
- Modify: `package.json` (add `src/data/*.test.ts` to `test`)

**Interfaces:**
- Produces:
  - types `FeedName = 'weather' | 'river' | 'imd'`, `FeedState<T> = { state: 'ok' | 'stale' | 'missing'; envelope?: Envelope<T>; age_min?: number }`
  - `INTERVAL_H: Record<FeedName, number> = { weather: 6, river: 24, imd: 3 }`
  - `classify<T>(json: unknown, feed: FeedName, now: number): FeedState<T>` (pure)
  - `loadLive(base = import.meta.env.BASE_URL): Promise<Record<FeedName, FeedState<unknown>>>` (fetches `${base}live/${feed}.json` with `cache: 'no-cache'`; a network error or 404 gives `missing`)
- [ ] **Step 1: Write the failing tests** (node:test):
  - `classify ok`: valid_until 1 h ahead → ok.
  - `classify stale`: now = valid_until + 7 h, feed weather → stale.
  - `classify rejects malformed envelopes`: no `valid_until`, an unparseable date, a `fetched_at` 10 minutes in the future, or `data` not an object → missing.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL. **Step 3:** Implement. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit: `feat(app): live feed loader with staleness`.

### Task 7: Live UI (`LiveCard` + IMD banner)

**Files:**
- Create: `src/components/LiveCard.tsx`, `public/live/` sample files for development only (git-ignored; generated by Task 2 or copied from fixtures)
- Modify: `src/App.tsx` (load the feeds after the map loads, refresh every 15 min; render the card bottom-left above the scale on desktop and as a pill on mobile; render the banner when a warning colour is orange or red)

**Interfaces:**
- Consumes: `loadLive`, `FeedState` (Task 6).
- Produces:
  - `<LiveCard feeds={Record<FeedName, FeedState>} />`;
  - `<WarningBanner imd={FeedState} />`.
- **Display rules (from the spec):**
  - **Collapsed:** the Nashik point's current temperature, the rain in the next 24 h, wind, and "next rain: Thu 15:00".
  - **Expanded:** a 3-day strip (daily min/max, total rain); river discharge with its trend arrow and "Godavari at Nashik (GloFAS cell, approx.)"; IMD warnings.
  - **Footer** on each section: "Source · updated X ago".
  - **Stale:** greyed out, with "Stale: last updated {age}".
  - **Missing:** "Not available".
  - **IMD with status `http_*`:** "IMD feed unavailable".
- [ ] **Step 1:** Playwright with real `weather.json` and no river/IMD files → the card shows a temperature, and river/IMD show "Not available".
- [ ] **Step 2:** Playwright with `weather.json` rewritten so that `valid_until` is 2 days old → it shows "Stale".
- [ ] **Step 3:** Playwright with `imd.json` containing an orange Nashik warning → the banner is visible; on a 390 px viewport, the card is a pill that doesn't overlap the Layers button.
- [ ] **Step 4:** `npx tsc`, then `npm run build`. Expected: clean.
- [ ] **Step 5:** Commit: `feat(app): Live Nashik card and IMD warning banner`.

### Task 8: Self-hosted tiles and fonts in the style, Pages base path

**Files:**
- Modify: `src/map/style.ts` (export `buildStyle(opts: { pmtiles: boolean; base: string; ownFonts: boolean }): StyleSpecification`), `src/App.tsx` (probe for the files, then build the style), `src/data/city.ts` (prefix the data fetch with `BASE_URL`), `vite.config.ts` (`base: process.env.PAGES_BASE ?? '/'`), `package.json` (add the `pmtiles@4` dependency), `src/map/style.test.ts`
- Modify: attribution strings (ECMWF, GloFAS, IMD, OpenMapTiles schema)

**Interfaces:**
- Produces:
  - `tileSource(available: boolean, base: string): VectorSourceSpecification`: `url: 'pmtiles://' + base + 'tiles/nashik.pmtiles'` when available, otherwise the OpenFreeMap URL;
  - `probe(url: string): Promise<boolean>`: a HEAD request; true on 200.
- [ ] **Step 1: Write the failing tests:**
  - `tileSource falls back when pmtiles 404s` (`available=false` → the OpenFreeMap URL);
  - `tileSource uses pmtiles with base` (base `/Nashik_2030/` → `pmtiles:///Nashik_2030/tiles/nashik.pmtiles`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement: register `maplibregl.addProtocol('pmtiles', new Protocol().tile)` once; glyphs come from `${base}fonts/{fontstack}/{range}.pbf` when `ownFonts`. **Step 4:** Run → PASS.
- [ ] **Step 5:** `PAGES_BASE=/Nashik_2030/ npm run build`, then `grep -rl '"/data/' dist/assets` → no matches. Playwright on `vite preview --base /Nashik_2030/` → the map loads (falling back to OpenFreeMap, since there's no PMTiles file locally) with no console errors.
- [ ] **Step 6:** Commit: `feat(app): self-hosted pmtiles/fonts with fallback; Pages base path`.

### Task 9: GitHub Actions workflows

**Files:**
- Create: `.github/workflows/live.yml`, `.github/workflows/tiles.yml`, `.github/workflows/deploy.yml`

**Interfaces:**
- **`live.yml`:**
  - triggers: `schedule: '15 */3 * * *'` + `workflow_dispatch`;
  - steps: setup Python 3.11, `pip install -r pipeline/requirements.txt`, `python -m pipeline.run` with env `EWDS_API_KEY` and `IMD_API_KEY` from secrets, upload artifact `live` (`public/live`), then trigger deploy via `workflow_call`.
- **`tiles.yml`:**
  - triggers: `schedule: '0 2 * * 1'` + `workflow_dispatch`;
  - steps: setup Java 21, download the Planetiler release jar, run `java -Xmx6g -jar planetiler.jar --download --osm-url=https://download.geofabrik.de/asia/india/western-zone-latest.osm.pbf --bounds=72.9,19.4,74.7,20.6 --maxzoom=14 --output=nashik.pmtiles`, upload artifact `tiles` with 90-day retention.
- **`deploy.yml`:**
  - triggers: `workflow_call`, `workflow_dispatch`, `push: main`;
  - steps: npm ci, download the latest `live` and `tiles` artifacts (via `dawidd6/action-download-artifact` by workflow name; `if_no_artifact_found: warn`), `python -m pipeline.fonts`, `PAGES_BASE=/Nashik_2030/ npm run build`, copy into `dist/`, `actions/upload-pages-artifact` + `actions/deploy-pages`;
  - permissions: `pages: write`, `id-token: write`;
  - concurrency group `pages`.
- [ ] **Step 1:** Validate the YAML locally (`python -c "import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml`). Expected: no error.
- [ ] **Step 2:** Commit: `ci: live data, tile build and Pages deploy workflows`.
- [ ] **Step 3 (user):** Push, enable Pages (Source: GitHub Actions), add the `EWDS_API_KEY` / `IMD_API_KEY` secrets, then run `tiles` and `live` manually. Expected: the site serves `/Nashik_2030/live/weather.json` and the map loads from PMTiles.

### Task 10: Docs

**Files:**
- Modify: `README.md` (a "Live data" section covering the sources, licences, refresh cadence, staleness rule, required secrets, the local run `python -m pipeline.run`, and the honest limits: 0.25° weather grid, approximate river cell, IMD whitelisting risk)
- [ ] **Step 1:** `npm test`, the pipeline pytest suite and `npm run build` all pass.
- [ ] **Step 2:** Commit: `docs: live data pipeline`.
