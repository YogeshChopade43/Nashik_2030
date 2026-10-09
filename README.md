# Nashik 2030 — City Digital Twin (Sprint 1)

An interactive digital map of Nashik, Maharashtra, built only from real, openly licensed geographic data. It is the spatial foundation that later Nashik 2030 intelligence layers will plug into.

Sprint 1 contains **no AI**: no LLMs, predictions, recommendations or generated text. Every geographic answer in the app comes from deterministic geometry over real data.

## Run it

Requires Node.js ≥ 23 (the tests use Node's built-in TypeScript type-stripping).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # geo utility tests (math + checks against the real Nashik extract)
npm run build      # type-check + production build into dist/
npm run data       # re-extract city data from OpenStreetMap (optional; data is committed)
npm run data -- --only=places   # re-fetch just one dataset, re-process the rest from data/raw
```

The base map, fonts and terrain stream from public tile servers, so the app needs an internet connection.

## What you can do

- **Explore:** pan, zoom and rotate (right-drag or two-finger twist) a flat "Light Atlas" map. The compass resets north. The URL hash (`#view=zoom/lat/lng/bearing`) makes any view shareable.
- **Search** (press `/`) across real entity names, including Marathi names and alt names. Examples:
  - places: *Panchavati*, *Ramkund*, *Kalaram Mandir*, *Sula Vineyards*
  - roads: *College Road*, *Gangapur Road*, *Trimbak Road*
  - localities: *Nashik Road*, *CIDCO*, *Satpur*
  - categories: *hospitals*, *temples*, *colleges* (turns on that whole layer)

  If nothing matches locally, pressing Enter queries OSM Nominatim, limited to the Nashik area.
- **Toggle 21 layers** in four groups: Places, Transport, Geography and Base map. Your choices are remembered per browser.
- **Inspect** any feature:
  - real OSM attributes, with "Not available" wherever a value is missing
  - geographic context: nearest locality, nearest road, taluka, and nearby places
  - provenance: OSM ID linked to openstreetmap.org, last-edit date and license
- **Click empty map** to reverse-geocode that point, showing the base-map feature under it and nearby places.
- **Right-click or long-press anywhere** for a menu: What's nearby here, Drop a pin, Share this spot, Copy coordinates.
- **What's nearby:** from your GPS location, the map centre, any place or any point. Results are sorted by straight-line distance with compass directions, and can be filtered by category and radius. Drag the circle's centre to move the search, or its edge knob to resize it (100 m to 5 km).
- **Share links:** the URL tracks the selection (`#view=…&place=<entity id>` or `&pin=<lat>,<lng>`), so a shared link reopens that exact place. The Share button uses the phone's native share sheet, or copy / WhatsApp on desktop.
- **Approximate locality areas:** OSM maps localities as points, so selecting one shades its *nearest-locality zone* (a Voronoi cell, capped at 3 km) and counts the places inside it. These areas are clearly labelled as approximate and are not official boundaries.
- **Layers fade** in and out when toggled.
- **Filters** (the funnel icon on a layer row): filter hospitals by emergency services, listed specialities or website; religious places by religion; and any place layer to those edited in the last year. Filters use real OSM tags only, so untagged places are hidden, not assumed to lack the feature. Chips with no matches are hidden, and cluster counts update.
- **Legend** (the list icon in the map controls): a key for the symbols and line styles of the layers currently shown.
- **How to find it:** every place and dropped pin gets landmark-based directions, the way people in Nashik give them. For example, *"On Mahshoba Lane, 209 m north-west of Raviwar Karanja Circle, near Sri Omkeshwar Mahadev Mandir · Gangawadi area"*. Copy or send them with the pin link, or use **Share as directions** from the right-click / long-press menu. Directions are built deterministically from real OSM roads and landmarks (`src/lib/address.ts`), preferring the chowks, nakas and circles people actually navigate by.
- **Local landmarks** layer: named chowks, nakas, circles and signals, petrol pumps, banks, pharmacies and water tanks from OSM. Petrol pumps named only "Fuel" are named by their brand, or skipped if they have none.
- **Toilets & drinking water** layer, with Free / Women's / Accessible filters wherever the OSM tags exist. Only 12 public toilets are mapped in OSM so far, so the layer links to the OpenStreetMap editor to help map more.
- **मराठी / English** (top-right button, remembered per browser; Marathi-language browsers start in Marathi). Switches all interface text, directions (*"College Road वर, … पासून 200 मी पूर्वेला"*), dates and units, and searches Marathi category words (*रुग्णालय*, *मंदिर*, *शौचालय*). Place names come only from OSM (`name:mr`, else a Devanagari `name`), never transliterated. Only about 90 features have one so far, mostly talukas, major localities, the Godavari and some temples, so most places stay in English. MapLibre can't shape Devanagari (it renders नाशिक as "नाशकि"), so Marathi map labels are drawn by the browser and placed as icons (`src/map/lang.ts`). The UI text in `src/lib/i18n.ts` is a first translation, so have a Marathi speaker review it.
- **Data sources & licenses** (bottom of the layer panel) lists every dataset, its entity count, OSM snapshot time, processing steps, and what is unavailable.

## Data sources & licenses

| Data | Source | License |
|---|---|---|
| Base map (roads, water, land use, buildings, rail, labels) | OpenStreetMap via [OpenFreeMap](https://openfreemap.org) vector tiles (OpenMapTiles schema) | ODbL 1.0 — © OpenStreetMap contributors, © OpenMapTiles |
| Terrain relief | [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen / AWS Open Data; SRTM and other open DEMs) | Open (see registry attribution) |
| City entities in `public/data/*.geojson` | OpenStreetMap via the Overpass API (`scripts/fetch-osm.mjs`) | ODbL 1.0 — © OpenStreetMap contributors |
| Search fallback | OSM [Nominatim](https://nominatim.org), on explicit submit only (per its usage policy) | ODbL 1.0 |

Coverage is the bounding box S 19.85, W 73.50, N 20.15, E 74.05. That covers Nashik city plus Trimbakeshwar, Gangapur dam, Deolali and Ozar.

The extraction from 2026-10-09 contains:

| Entity type | Count |
|---|---|
| hospitals | 261 |
| religious places | 141 |
| named road segments (419 distinct roads) | 1,102 |
| localities | 134 |
| parks | 115 |
| water features (rivers and water bodies) | 66 |
| bus stops and stations | 39 |
| schools | 35 |
| tourist / heritage places | 25 |
| colleges | 20 |
| government facilities | 20 |
| markets | 18 |
| railway stations | 5 |
| taluka boundaries | 7 |

Exact OSM snapshot timestamps per dataset are in `public/data/metadata.json`.

### Processing

1. One Overpass query per dataset. Queries are stored in `metadata.json`, and raw responses in `data/raw/` (git-ignored, regenerated by `npm run data`).
2. Relations and multipolygons are assembled with `osmtogeojson`.
3. Elements are classified into `CityEntity` types. Unnamed POIs are dropped, except bus stops, which are real infrastructure even when unnamed.
4. Coordinates are rounded to 5 decimals (~1 m). Taluka boundaries are simplified with Douglas–Peucker (3×10⁻⁴°, ~30 m).
5. Stable IDs are derived from the OSM element: `place_n1671916246` comes from `node/1671916246`.

To refresh after OSM edits, run `npm run data`. If you only changed processing code, `npm run data -- --cached` re-processes the raw files without fetching.

### Not available — left out, not faked

- **Municipal wards (NMC).** No openly licensed ward boundaries exist in OpenStreetMap or in DataMeet's Municipal_Spatial_Data. The layer appears disabled, and the inspector shows "Not available". **Taluka** boundaries (admin_level 6) are the finest administrative unit available.
- **"CBS" (Central Bus Stand).** No OSM feature is named or tagged "CBS" or "Central Bus Stand", so search returns nothing for it rather than guessing. Nearby real bus stands, such as Thakkar Bazzar Bus Stand and Mela Bus Stand, are searchable. Adding the name upstream in OSM would fix this at the source.
- **Bus routes and intersections** were not extracted in Sprint 1. City-bus route relations in OSM are incomplete.
- **Coverage is only as complete as OSM.** For example, schools are under-mapped (35). Gaps are not filled in. The source-ID links in the inspector open each feature on openstreetmap.org, where it can be improved.

## Live data (free, unlimited, self-hosted)

Live feeds are built by scheduled GitHub Actions jobs. The jobs fetch each source and write small JSON files, and GitHub Pages serves those files with the app. It costs ₹0 to run, and every user reads static files, so there's no per-user limit. No freemium or metered API is used.

| Feed | Source & license | Refresh | Needs |
|---|---|---|---|
| `live/weather.json` | ECMWF Open Data, IFS 0.25° (CC BY 4.0) | every 3 h (00/12 UTC runs, 0–144 h) | nothing |
| `live/river.json` | Copernicus GloFAS forecast via EWDS (CC BY 4.0) | daily | `EWDS_API_KEY` secret |
| `live/imd.json` | India Meteorological Department API | every 3 h | `IMD_API_KEY` secret |
| `tiles/nashik.pmtiles` | OSM (Geofabrik western India) → Planetiler, OpenMapTiles schema (ODbL) | weekly | nothing |
| `fonts/…` | Noto Sans glyphs (OFL) | each deploy | nothing |

**How the files behave:**
- **Provenance:** every feed file carries `source`, `license`, `attribution`, `fetched_at` and `valid_until`.
- **Freshness states:** the app's *Live Nashik* pill and panel show "updated X ago". A feed more than one interval past `valid_until` is shown greyed out as **Stale**. A missing or malformed file shows **Not available**. Nothing questionable is ever displayed as current.
- **Failures:** a failed feed keeps its previous file. For IMD, an auth failure is recorded as a status and shown as "IMD feed unavailable".
- **Fallbacks:** until the first tile build is deployed, the map automatically uses OpenFreeMap tiles and fonts.

**Workflows:**
- `.github/workflows/live.yml` fetches the feeds;
- `tiles.yml` builds the tiles;
- `deploy.yml` builds the app with the latest data, tiles and fonts, and publishes it to Pages.

**One-time setup:**
1. Enable GitHub Pages (Settings → Pages → Source: *GitHub Actions*).
2. Optionally add the `EWDS_API_KEY` (a free Copernicus EWDS account) and `IMD_API_KEY` (from api.imd.gov.in) repo secrets.
3. Run *tiles* once manually, then *live*.

**Run the pipeline locally:**
```bash
python -m venv pipeline/.venv && pipeline/.venv/Scripts/pip install -r pipeline/requirements.txt   # bin/ on Linux/macOS
pipeline/.venv/Scripts/python -m pipeline.run      # writes public/live/*.json (weather works with no key)
pipeline/.venv/Scripts/python -m pipeline.fonts    # self-hosted glyphs into public/fonts (~100 MB)
pipeline/.venv/Scripts/python -m pytest pipeline/tests
```
In Windows Git Bash, prefix base-path builds with `MSYS_NO_PATHCONV=1`, because Git Bash rewrites `/Nashik_2030/` into a Windows path. For example: `MSYS_NO_PATHCONV=1 PAGES_BASE=/Nashik_2030/ npm run build`.

**Honest limits:**
- **Weather** is interpolated from a 0.25° (~27 km) grid, so values are approximate for a specific street. Each run downloads ~175 MB.
- **River flow** uses the GloFAS cell with the largest forecast discharge within 0.1° of Ramkund, on a ~5 km model grid, so it's approximate. Flood-threshold levels aren't included yet.
- **IMD** may require IP whitelisting. GitHub-hosted runners don't have fixed IPs, so if IMD enforces whitelisting this feed needs a fixed-IP runner.
- **No live traffic or road closures:** no free, unlimited source exists.

## Architecture

```
scripts/fetch-osm.mjs     OSM → CityEntity GeoJSON + metadata (provenance)
public/data/              processed datasets served to the app + metadata.json
src/types/entity.ts       City entity model (stable id, type, name, geometry, source, source_id, updated_at, tags)
src/lib/geo.ts            deterministic GeoAI utilities (+ geo.test.ts)
src/data/city.ts          loads datasets, entity index by id/type, search index + Nominatim fallback
src/map/style.ts          original "Light Atlas" base-map style (OpenMapTiles schema)
src/map/icons.ts          category glyphs → map marker images + texture patterns (generated at runtime)
src/map/layers.ts         MapLayerDef registry — the layer abstraction
src/components/           SearchBar, LayerPanel (+ sources dialog), Inspector, Icon
src/App.tsx               map lifecycle, selection, interaction, responsive layout, map controls
```

**Stack:** React 18, TypeScript, Vite, Tailwind CSS 4 and MapLibre GL JS 5. Everything is open source, with no proprietary SDKs or API keys.

### Map design: "Light Atlas"

The map is styled after printed atlases and is deliberately flat (no tilt), so the website and a future app look the same:

- **Paper palette.** Warm paper land, sage woods, wheat farmland (dot texture) and green parks (hatch texture), with muted atlas-blue water.
- **Relief.** Multi-directional hillshading lights the terrain from four directions, plus a subtle elevation tint, so the Western Ghats look sculpted even top-down.
- **Engraved water.** A darker shoreline with three fading inner hairlines, like old printed maps.
- **Roads.** White streets with warm casings, amber primary roads, terracotta highways, and black-and-white dashed railways.
- **Buildings.** Flat footprints with a soft offset shadow, so they rise off the page without 3D.
- **Typography.** Wide-spaced capitals for cities and localities, italic water names, and Fraunces + Inter in the interface.
- **Markers.** Category glyphs on paper discs. `src/map/icons.ts` is the single source for both the map markers and the UI icons.

All of this is MapLibre style-spec, so it ports to MapLibre Native (iOS/Android) unchanged. The one exception is that markers and patterns are drawn at runtime in the browser; a native app would ship them as a pre-rendered sprite sheet instead.

### City entity model

Every entity is a GeoJSON Feature with this shape:

```json
{ "id": "place_n1671916246", "type": "hospital", "name": "…", "name_local": "…", "category": "…",
  "source": "openstreetmap", "source_id": "node/1671916246", "updated_at": "2012-03-12T12:41:42Z", "tags": { … } }
```

Types:

- `city`, `locality`, `admin_boundary`
- `road_segment`, `river`, `water_body`, `park`
- `hospital`, `school`, `college`, `market`, `religious`, `tourism`, `government`
- `bus_stop`, `railway_station`

A **Road** is derived rather than stored: it is all segments sharing a normalised name (`roadSegmentsByName`).

### GeoAI utility foundation (`src/lib/geo.ts`)

These are pure functions that need no network access and no model:

- `distance`, `length`, `bbox`, `centroid`
- `bboxIntersects`, `withinBBox` (spatial intersection / viewport filtering)
- `pointInPolygon`, `containing` (point-in-boundary; becomes point-in-ward once ward data exists)
- `nearestPoint`, `nearest`, `nearestRoad`, `nearby`
- `roadSegmentsByName` (road segment lookup)
- `reverseGeocode` (nearest road, nearest locality and containing boundaries, all from real entities)

The UI's inspector already uses them, and Sprint 2 agents can call the same functions.

### Adding future layers (Sprint 2+)

Every layer is a `MapLayerDef` in `src/map/layers.ts`:

```ts
{ id, group, label, color, defaultVisible, styleLayers, interactive?, types?, install?(map, data), unavailable? }
```

To add a layer such as traffic, civic issues, weather, AQI, flood risk or Kumbh:

1. Push a definition with `group: 'intelligence'`.
2. Give it an `install()` that adds its own source (GeoJSON, vector tiles or a live feed) and style layers.

The layer panel, toggling, persistence, click-to-inspect and hover all pick it up automatically.

### Migrating to PostGIS

The entity shape maps one-to-one onto a table:

```sql
CREATE TABLE city_entity (
  id text PRIMARY KEY, type text NOT NULL, name text, name_local text, category text,
  source text NOT NULL, source_id text NOT NULL, updated_at timestamptz, tags jsonb,
  geom geometry(Geometry, 4326) NOT NULL
);
CREATE INDEX ON city_entity USING gist (geom);
```

The files load with `ogr2ogr -f PostgreSQL PG:… public/data/places.geojson -nln city_entity`. Each `geo.ts` function has a direct PostGIS equivalent (`ST_DWithin`, `ST_Contains`, `ST_ClosestPoint`, `<->` KNN). That lets the API layer replace `loadCity()` without changing the UI.

### Performance

- The base map is served as vector tiles.
- City data is about 1.4 MB of GeoJSON, loaded once in parallel with the map style and rendered by WebGL. There are no DOM markers.
- POIs are clustered per layer (clusters expand on click) and labels have zoom-gated visibility.
- Boundaries are simplified, and hover and highlight use feature-state, so sources aren't re-uploaded.

If the data grows by orders of magnitude, the upgrade path is to pre-tile it with tippecanoe into PMTiles.
