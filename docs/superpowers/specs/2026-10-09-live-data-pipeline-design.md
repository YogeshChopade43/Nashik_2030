# Live data pipeline: free, unlimited, self-hosted

**Date:** 2026-10-09 · **Status:** approved in chat, awaiting written-spec review

## Goal

Give Nashik 2030 live weather, river-flow and official-warning data, plus self-hosted map tiles. The constraints are:

- **₹0 running cost.**
- **No metered or freemium APIs.** No TomTom, no Open-Meteo's hosted free tier.
- **Unlimited users,** because every user reads static files.

## Decisions (agreed)

| Decision | Choice | Why |
|---|---|---|
| Hosting model | **Scheduled pipeline + static hosting** (option B) | No server, ₹0/month. Users read static files, so usage is unlimited. |
| Scheduler | **GitHub Actions** | The repo `YogeshChopade43/Nashik_2030` is public, so Actions minutes are free and unlimited. |
| Static host | **GitHub Pages** | Free for public repos. It serves both the app and the data. |
| Tiles | **Planetiler (OpenMapTiles profile) → PMTiles** | Same schema as today's OpenFreeMap tiles, so the Light Atlas style keeps working unchanged. |
| Pipeline language | **Python** | ECMWF and GloFAS tooling (`ecmwf-opendata`, `cdsapi`, eccodes) is Python-native. |

## Architecture

```
GitHub Actions
 ├─ live.yml   (cron: every 3 h, + manual)  → pipeline/run.py → public/live/*.json ─┐
 ├─ tiles.yml  (cron: weekly, + manual)     → Planetiler → nashik.pmtiles (artifact) ─┤
 └─ deploy.yml (after either, + on push)    → npm build + live JSON + tiles + fonts ──┴→ GitHub Pages
App → fetch /live/*.json (no-cache) · MapLibre pmtiles:// protocol → /tiles/nashik.pmtiles
```

- **Live JSON is not committed to `main`,** so the history doesn't churn. Each `live.yml` run hands its JSON to `deploy.yml` as an artifact.
- **Tile builds are cached:** the newest successful `tiles.yml` artifact is reused by every deploy until the next weekly build.

## Feeds

Every output file shares a common envelope:

```json
{ "source": "...", "license": "...", "attribution": "...", "fetched_at": "ISO", "valid_until": "ISO", "data": { ... } }
```

### `weather.json`: ECMWF Open Data (CC BY 4.0), no account

- **Model:** IFS 0.25°, latest run (00/06/12/18 UTC).
- **Steps:** 0–144 h at 3-hourly intervals.
- **Parameters:**
  - `2t`: temperature, converted to °C;
  - `tp`: total precipitation, de-accumulated into mm per 3 h;
  - `10u`/`10v`: wind, converted to speed (km/h) and direction;
  - `tcc`: cloud cover, as a percentage.
- **Points:**
  - Nashik city (19.9975, 73.7898);
  - Trimbakeshwar (19.9322, 73.5300);
  - Gangapur dam (20.0436, 73.6810);
  - Nashik Road (19.9488, 73.8406).
- **Interpolation:** bilinear on the 0.25° grid. Documented as an approximation; there is no point-level downscaling.
- **`valid_until`:** fetch time + 6 h.

### `river.json`: GloFAS (Copernicus EWDS, CC BY 4.0), free account

- **Dataset:** `cems-glofas-forecast`, control forecast, variable `river_discharge_in_the_last_24_hours`, lead times 24–240 h, `area` subset around Nashik.
- **Cell selection:** the Godavari main-stem cell is the one with the **largest upstream area** within ±0.1° of Ramkund (20.0073, 73.7925). The upstream-area auxiliary file is fetched once and cached. This avoids the tributary-cell mistake seen in testing, where a nearby cell returned 0.46 m³/s.
- **Output:** a daily discharge series (m³/s), a trend (rising / steady / falling), and the selected cell's coordinates and upstream area, for transparency.
- **Return-period flood thresholds:** a stretch goal, not part of this spec.
- **`valid_until`:** fetch time + 24 h.
- **Secret:** `EWDS_API_KEY`. Without it, the feed is skipped and the app shows "not configured" rather than old data.

### `imd.json`: IMD API (free, registration)

- **Endpoints:**
  - `districtwarning` and `districtnowcast` for Nashik district;
  - `districtrainfall`;
  - `cityforecast` for station 43025.
- **Secret:** `IMD_API_KEY`. Off until the key works.
- **Known risk:** IMD may require IP whitelisting. GitHub-hosted runner IPs aren't fixed, so if whitelisting is enforced this feed needs a fixed-IP runner later. The pipeline records the HTTP error in `imd.json.status`, so the app can say "unavailable" honestly.
- **`valid_until`:** fetch time + 3 h.

### Tiles and fonts

- **Tiles:** Geofabrik `asia/india/western-zone` PBF (Maharashtra lives in that zone) → Planetiler `--bounds=72.9,19.4,74.7,20.6` (matches the app's `maxBounds`) → `nashik.pmtiles`, z0–14 (MapLibre overzooms beyond 14). The expected size, about 30–80 MB, gets measured on the first build.
- **Glyphs:** the 3 fontstacks the style uses (Noto Sans Regular, Bold, Italic), all 256 ranges, downloaded from OpenFreeMap's open font build (OFL) during deploy into `/fonts/`.
- **Terrain:** stays on AWS Terrain Tiles, which is open data with no key and no limits.

## App changes

- **`src/data/live.ts`:**
  - fetches `/live/{weather,river,imd}.json` with `cache: 'no-cache'`;
  - validates the envelope;
  - computes `stale` as `now > valid_until + grace`, where grace is one interval;
  - returns `missing`, `stale` or `ok` per feed.
- **`src/components/LiveCard.tsx`:** a compact "Live Nashik" card, collapsed by default.
  - **Shows:** now and the next 24 h (temperature, rain, wind), then the next rain window.
  - **Expands to:** a 3-day strip, the river discharge series with its trend, and IMD warnings.
  - **Labelling:** every item shows its source and "updated X ago".
  - **States:** stale feeds render greyed with "Stale: last updated …"; missing ones show "Not available". Nothing fabricated.
- **IMD warning banner:** a slim banner under the search bar when an IMD district warning is orange or red.
- **`src/map/style.ts`:**
  - the vector source becomes `pmtiles://<base>/tiles/nashik.pmtiles` (via the `pmtiles` npm package), with a fallback to OpenFreeMap if the file 404s;
  - glyphs come from `<base>/fonts/{fontstack}/{range}.pbf`, with the same fallback.
- **Vite `base`:** set for GitHub Pages (`/Nashik_2030/`).
- **Attribution additions:**
  - "Weather: ECMWF (CC BY 4.0)"
  - "River: Copernicus GloFAS (CC BY 4.0)"
  - "Warnings: India Meteorological Department"
  - "Tiles: OpenMapTiles schema © OSM contributors"

## Code layout

```
pipeline/
  requirements.txt      ecmwf-opendata, eccodes, cdsapi, xarray, cfgrib, numpy, requests
  common.py             envelope, atomic write, interpolation helpers
  weather.py            ECMWF fetch + point extraction
  river.py              GloFAS fetch + cell selection
  imd.py                IMD fetch (key-gated)
  run.py                runs all feeds; one failing feed never blocks the others
  tests/                pytest on small saved fixtures (no network)
.github/workflows/live.yml, tiles.yml, deploy.yml
src/data/live.ts, src/components/LiveCard.tsx
```

## Error handling

- **Each feed is independent.** On failure the pipeline writes nothing for that feed, so the previous deploy's file stays in place and the app marks it stale once `valid_until` passes. A failure never produces an empty or fake payload.
- **Network retries:** three attempts with backoff. Failures show up in the Actions logs.
- **App fallbacks:** a malformed file is treated as missing. Missing tiles fall back to OpenFreeMap; missing fonts fall back to OpenFreeMap glyphs.

## Testing

- **Pipeline:** unit tests for de-accumulation, wind conversion, bilinear interpolation, cell selection and the envelope, using fixtures. A local run of `weather.py` against real ECMWF data, which needs no account.
- **App:** unit tests for the `live.ts` staleness logic. Playwright checks of the card with sample JSON for the ok, stale and missing states. Build, tests and a clean console.
- **Tiles and deploy:** verified in GitHub Actions after you push. They can't run on this machine (no Java, 10 GB free disk).

## Out of scope

- Citizen reporting and the backend (Sprint 2).
- Live traffic and closures (no free unlimited source exists).
- Flood return-period thresholds.
- Offline / PWA caching. The self-hosted PMTiles file is its prerequisite.
- Routing.

## Actions only you can take

1. Create a free Copernicus EWDS account and add `EWDS_API_KEY` as a repo secret.
2. Register on api.imd.gov.in and add `IMD_API_KEY`.
3. Enable GitHub Pages (Source: GitHub Actions).
4. Push the commits. I won't push without your go-ahead.
