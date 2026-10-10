// Extracts real Nashik geography from OpenStreetMap (Overpass API) into
// provenance-tagged city entities under public/data/.
//
//   npm run data            # fetch from Overpass, then process
//   npm run data -- --cached  # re-process data/raw/*.json without fetching
//
// Every output feature follows the CityEntity model in src/types/entity.ts.
import fs from 'node:fs/promises';
import path from 'node:path';
import osmtogeojson from 'osmtogeojson';
import { dedupePlaces, dedupeTrails, mergeSummits, resolveSharedElements } from '../src/lib/dedupe.ts';
import { chainLines } from '../src/lib/trails.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'public/data');

// Nashik urban area + surroundings (Trimbakeshwar, Gangapur dam, Deolali, Ozar).
// Overpass order: south, west, north, east.
export const BBOX = [19.85, 73.5, 20.15, 74.05];
const B = BBOX.join(',');
// Treks reach well beyond the city: the whole map region (matches the app's maxBounds).
const REGION = '19.4,72.9,20.6,74.7';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const QUERIES = {
  places: `[out:json][timeout:180][bbox:${B}];
(
  nwr[amenity~"^(hospital|school|college|university|marketplace|place_of_worship|townhall|courthouse|police|fire_station|post_office|bus_station)$"];
  nwr[healthcare=hospital];
  nwr[shop=mall];
  nwr[tourism~"^(attraction|museum|viewpoint|zoo|theme_park|gallery)$"];
  nwr[historic~"^(monument|memorial|fort|castle|archaeological_site|ruins)$"];
  nwr[office=government];
  node[highway=bus_stop];
  nwr[railway~"^(station|halt)$"];
  nwr[amenity~"^(toilets|drinking_water|fuel|cinema)$"];
  nwr[amenity~"^(bank|pharmacy)$"][name];
  node[highway~"^(traffic_signals|mini_roundabout)$"][name];
  nwr[junction][name];
  nwr[place=square][name];
  nwr[man_made=water_tower][name];
);
out center meta;`,
  roads: `[out:json][timeout:180][bbox:${B}];
way[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"][name];
out meta geom;`,
  parks: `[out:json][timeout:180][bbox:${B}];
(way[leisure~"^(park|garden)$"];rel[leisure~"^(park|garden)$"];);
out meta geom;`,
  water: `[out:json][timeout:180][bbox:${B}];
(
  way[waterway~"^(river|stream|canal)$"][name];
  way[natural=water][name]; rel[natural=water][name];
  way[landuse=reservoir][name]; rel[landuse=reservoir][name];
);
out meta geom;`,
  localities: `[out:json][timeout:120][bbox:${B}];
node[place~"^(city|town|suburb|neighbourhood|quarter|village|hamlet|locality)$"];
out meta;`,
  // Forts, named peaks and marked hiking routes across the region.
  treks: `[out:json][timeout:180][bbox:${REGION}];
(
  nwr[historic~"^(fort|castle)$"];
  nwr[historic=archaeological_site][site_type=fortification];
  node[natural=peak][name];
);
out meta center;
rel[route=hiking];
out meta geom;`,
  // Taluka (sub-district) boundaries. OSM has no Nashik municipal ward boundaries.
  boundaries: `[out:json][timeout:180];
rel[boundary=administrative][admin_level=6](${B});
out meta geom;`,
};

async function overpass(name, query) {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': 'Nashik2030-DigitalTwin/0.1 (open data extraction)', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(240_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        console.log(`  ${name}: ${json.elements.length} elements from ${new URL(url).host}`);
        return json;
      } catch (e) {
        console.warn(`  ${name}: ${new URL(url).host} failed (${e.message})`);
      }
    }
    await new Promise((r) => setTimeout(r, 10_000 * (attempt + 1)));
  }
  throw new Error(`All Overpass endpoints failed for ${name}`);
}

// ---------- classification ----------
const JUNCTION_NAME = /chowk|chauk|circle|naka|phata|point|square|signal|stambh|corner|junction|चौक|सर्कल|नाका|फाटा/i;
function placeType(t) {
  if (t.amenity === 'toilets') return 'toilets';
  if (t.amenity === 'drinking_water') return 'drinking_water';
  if (['fuel', 'bank', 'pharmacy', 'cinema'].includes(t.amenity) || ['traffic_signals', 'mini_roundabout'].includes(t.highway)
    || t.junction || t.place === 'square' || t.man_made === 'water_tower') return 'landmark';
  if (t.amenity === 'hospital' || t.healthcare === 'hospital') return 'hospital';
  if (t.amenity === 'school') return 'school';
  if (t.amenity === 'college' || t.amenity === 'university') return 'college';
  if (t.amenity === 'marketplace' || t.shop === 'mall') return 'market';
  if (t.railway === 'station' || t.railway === 'halt') return 'railway_station';
  if (t.amenity === 'bus_station' || t.highway === 'bus_stop') return 'bus_stop';
  if (t.amenity === 'place_of_worship') return 'religious';
  if (t.tourism || t.historic) return 'tourism';
  if (['townhall', 'courthouse', 'police', 'fire_station', 'post_office'].includes(t.amenity) || t.office === 'government') return 'government';
  return null;
}

function categoryOf(type, t) {
  switch (type) {
    case 'hospital': return t['healthcare:speciality'] ?? t.operator_type ?? null;
    case 'school': return t['isced:level'] ? `ISCED ${t['isced:level']}` : t['school:type'] ?? null;
    case 'college': return t.amenity === 'university' ? 'university' : 'college';
    case 'market': return t.shop === 'mall' ? 'mall' : 'marketplace';
    case 'bus_stop': return t.amenity === 'bus_station' ? 'bus station' : 'bus stop';
    case 'railway_station': return t.railway;
    case 'religious': return t.religion ?? null;
    case 'tourism': return t.tourism ?? (t.historic ? `historic ${t.historic}` : null);
    case 'government': return t.amenity ?? (t.government ? `government ${t.government}` : 'government office');
    case 'landmark':
      if (t.amenity === 'fuel') return 'petrol pump';
      if (t.amenity) return t.amenity;
      if (t.man_made === 'water_tower') return 'water tank';
      return 'chowk / junction';
    case 'toilets': return t.fee === 'no' ? 'public toilet · free' : 'public toilet';
    case 'drinking_water': return 'drinking water';
    default: return null;
  }
}

const PREFIX = { node: 'n', way: 'w', relation: 'r' };
const KEEP_TAGS = ['name:en', 'name:mr', 'alt_name', 'short_name', 'old_name', 'official_name', 'operator', 'operator:type', 'addr:full', 'addr:street', 'addr:city', 'addr:postcode', 'phone', 'website', 'opening_hours', 'wikipedia', 'wikidata', 'ref', 'lanes', 'maxspeed', 'surface', 'oneway', 'bridge', 'religion', 'denomination', 'beds', 'emergency', 'isced:level', 'population', 'heritage', 'brand', 'fee', 'female', 'male', 'unisex', 'wheelchair', 'access', 'ele', 'distance', 'from', 'to', 'description', 'sac_scale', 'network'];

const round = (n) => Math.round(n * 1e5) / 1e5;
function roundCoords(c) { return typeof c[0] === 'number' ? [round(c[0]), round(c[1])] : c.map(roundCoords); }

// Douglas–Peucker on a coordinate ring/line (tolerance in degrees).
function simplifyLine(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i];
      const t = len2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2)) : 0;
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function simplifyGeom(g, tol) {
  const s = (ring) => { const r = simplifyLine(ring, tol); return r.length >= 4 || g.type.includes('Line') ? r : ring; };
  if (g.type === 'LineString') return { ...g, coordinates: s(g.coordinates) };
  if (g.type === 'MultiLineString' || g.type === 'Polygon') return { ...g, coordinates: g.coordinates.map(s) };
  if (g.type === 'MultiPolygon') return { ...g, coordinates: g.coordinates.map((p) => p.map(s)) };
  return g;
}

function entity(prefix, type, el, geometry, extra = {}) {
  const t = el.tags ?? {};
  const tags = Object.fromEntries(KEEP_TAGS.filter((k) => t[k] != null).map((k) => [k, t[k]]));
  return {
    type: 'Feature',
    geometry: { ...geometry, coordinates: roundCoords(geometry.coordinates) },
    properties: {
      id: `${prefix}_${PREFIX[el.type]}${el.id}`,
      type,
      name: t['name:en'] ?? t.name ?? null,
      name_local: t['name:en'] && t.name !== t['name:en'] ? t.name ?? null : t['name:mr'] ?? null,
      category: null,
      source: 'openstreetmap',
      source_id: `${el.type}/${el.id}`,
      updated_at: el.timestamp ?? null,
      tags,
      ...extra,
    },
  };
}

// osmtogeojson output → raw element shape (type/id/tags/timestamp) for entity().
const fromGeojson = (f) => {
  const [type, id] = f.id.split('/');
  return { type, id: Number(id), tags: f.properties.tags ?? f.properties, timestamp: f.properties.meta?.timestamp ?? f.properties.timestamp };
};
const toGeojson = (raw) => osmtogeojson(raw, { flatProperties: false }).features;

const processors = {
  places(raw) {
    const out = [];
    for (let el of raw.elements) {
      let t = el.tags ?? {};
      const type = placeType(t);
      const lon = el.lon ?? el.center?.lon, lat = el.lat ?? el.center?.lat;
      if (!type || lon == null) continue;
      if (['fort', 'castle'].includes(t.historic)) continue; // forts live in the treks dataset
      // Petrol pumps named just "Fuel" are named by brand ("Indian Oil petrol pump"), or skipped — never invented.
      if (type === 'landmark' && t.amenity === 'fuel' && (!t.name || /^fuel$/i.test(t.name.trim()))) {
        const brand = t.brand?.trim();
        if (!brand || /^(fuel|petrol pump|petrol|gas station)$/i.test(brand)) continue; // generic brand = no real name
        t = { ...t, name: /petrol|pump|fuel/i.test(brand) ? brand : `${brand} petrol pump` };
        el = { ...el, tags: t };
      }
      // A roundabout's ring ways often carry the street's name ("Trimbak Road"), not the junction's: not a chowk.
      if (el.type === 'way' && t.junction && !JUNCTION_NAME.test(t['name:en'] ?? t.name ?? '')) continue;
      // Unnamed bus stops, toilets and water points are still real infrastructure; other unnamed POIs are noise.
      if (!t.name && !t['name:en'] && !['bus_stop', 'toilets', 'drinking_water'].includes(type)) continue;
      const f = entity('place', type, el, { type: 'Point', coordinates: [lon, lat] });
      f.properties.category = categoryOf(type, t);
      out.push(f);
    }
    return dedupePlaces(out);
  },
  treks(raw) {
    const out = [];
    for (const el of raw.elements) {
      const t = el.tags ?? {};
      if (el.type === 'relation' && t.route === 'hiking') {
        const ways = (el.members ?? []).filter((m) => m.type === 'way' && m.geometry?.length > 1).map((m) => m.geometry.map((p) => [p.lon, p.lat]));
        const lines = chainLines(ways);
        if (!lines.length || !(t.name || t.ref)) continue;
        const f = entity('trail', 'trail', { ...el, tags: { ...t, name: t.name ?? t.ref } }, { type: 'MultiLineString', coordinates: lines });
        const NETWORK = { iwn: 'international', nwn: 'national', rwn: 'regional', lwn: 'local' };
        f.properties.category = t.network ? `${NETWORK[t.network] ?? t.network} hiking route` : 'hiking route';
        out.push(f);
        continue;
      }
      const lon = el.lon ?? el.center?.lon, lat = el.lat ?? el.center?.lat;
      if (lon == null || !(t.name || t['name:en'])) continue;
      const isFort = ['fort', 'castle'].includes(t.historic) || t.site_type === 'fortification';
      // Same "place_" id prefix the forts had in the places dataset, so shared links keep working.
      const f = entity('place', isFort ? 'fort' : 'peak', el, { type: 'Point', coordinates: [lon, lat] });
      f.properties.category = isFort ? (t.historic === 'castle' ? 'castle' : 'fort') : 'peak';
      out.push(f);
    }
    const points = mergeSummits(dedupePlaces(out.filter((f) => f.properties.type !== 'trail')));
    return [...points, ...dedupeTrails(out.filter((f) => f.properties.type === 'trail'))];
  },
  roads(raw) {
    return raw.elements.filter((el) => el.geometry?.length > 1).map((el) => {
      const f = entity('road', 'road_segment', el, { type: 'LineString', coordinates: el.geometry.map((p) => [p.lon, p.lat]) });
      f.properties.category = el.tags.highway;
      return f;
    });
  },
  parks(raw) {
    return toGeojson(raw).filter((f) => f.geometry.type.endsWith('Polygon')).map((f) => {
      const el = fromGeojson(f);
      const g = entity('park', 'park', el, f.geometry);
      g.properties.category = el.tags.leisure;
      return g;
    });
  },
  water(raw) {
    return toGeojson(raw).filter((f) => f.geometry.type !== 'Point').map((f) => {
      const el = fromGeojson(f);
      const isLine = f.geometry.type.includes('Line');
      const g = entity('water', isLine ? 'river' : 'water_body', el, f.geometry);
      g.properties.category = el.tags.waterway ?? el.tags.water ?? el.tags.landuse ?? el.tags.natural;
      return g;
    });
  },
  localities(raw) {
    return dedupePlaces(raw.elements.filter((el) => el.tags?.name).map((el) => {
      const isCity = el.tags.place === 'city';
      const f = entity(isCity ? 'city' : 'locality', isCity ? 'city' : 'locality', el, { type: 'Point', coordinates: [el.lon, el.lat] });
      f.properties.category = el.tags.place;
      return f;
    }));
  },
  boundaries(raw) {
    return toGeojson(raw).filter((f) => f.geometry.type.endsWith('Polygon')).map((f) => {
      const el = fromGeojson(f);
      const g = entity('boundary', 'admin_boundary', el, simplifyGeom(f.geometry, 0.0003));
      g.properties.category = `admin_level ${el.tags.admin_level}`;
      return g;
    });
  },
};

const DESCRIPTIONS = {
  places: 'Public POIs: hospitals, schools, colleges, markets, religious places, tourist places, government facilities, bus stops, railway stations, public toilets, drinking water, and local landmarks (named chowks/nakas/circles/signals, petrol pumps, banks, pharmacies, cinemas, water tanks)',
  roads: 'Named road segments (OSM ways), motorway through living_street',
  parks: 'Parks and gardens (leisure=park|garden) as polygons',
  treks: 'Forts (historic=fort|castle, fortification sites), named peaks and marked hiking routes (route=hiking relations, ways joined into continuous paths) across the wider Nashik region',
  water: 'Named rivers, streams, canals, lakes and reservoirs',
  localities: 'Settlement and locality points (place=city|town|suburb|neighbourhood|village|…)',
  boundaries: 'Taluka / sub-district administrative boundaries (admin_level=6), simplified ~30 m',
};

const cached = process.argv.includes('--cached');
// --only=places,roads → fetch just these; re-process the rest from data/raw.
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
await fs.mkdir(RAW, { recursive: true });
await fs.mkdir(OUT, { recursive: true });
const datasets = {};
const outputs = {};

for (const [name, query] of Object.entries(QUERIES)) {
  const rawPath = path.join(RAW, `${name}.json`);
  let raw;
  if (cached || (only && !only.includes(name))) raw = JSON.parse(await fs.readFile(rawPath, 'utf8'));
  else {
    console.log(`Fetching ${name}…`);
    raw = await overpass(name, query);
    await fs.writeFile(rawPath, JSON.stringify(raw));
  }
  outputs[name] = processors[name](raw);
  datasets[name] = {
    file: `data/${name}.geojson`,
    fetched_at: cached || (only && !only.includes(name)) ? null : new Date().toISOString(),
    description: DESCRIPTIONS[name],
    features: 0, // set after cross-dataset resolution below
    source: 'OpenStreetMap contributors via Overpass API',
    license: 'ODbL 1.0 (https://opendatacommons.org/licenses/odbl/)',
    osm_data_timestamp: raw.osm3s?.timestamp_osm_base ?? null,
    overpass_query: query,
  };
}

// One OSM element can match two datasets (a suburb also tagged as an attraction): keep one copy.
const resolved = resolveSharedElements(outputs);
for (const [name, features] of Object.entries(resolved)) {
  await fs.writeFile(path.join(OUT, `${name}.geojson`), JSON.stringify({ type: 'FeatureCollection', features }));
  datasets[name].features = features.length;
  console.log(`  ${name} → ${features.length} entities`);
}

const metaPath = path.join(OUT, 'metadata.json');
const prev = JSON.parse(await fs.readFile(metaPath, 'utf8').catch(() => '{}'));
for (const [name, d] of Object.entries(datasets)) d.fetched_at ??= prev.datasets?.[name]?.fetched_at ?? prev.extracted_at ?? null;
await fs.writeFile(metaPath, JSON.stringify({
  extracted_at: cached && prev.extracted_at ? prev.extracted_at : new Date().toISOString(),
  // Per-dataset fetch times (an --only run re-fetches some datasets and re-processes the rest).
  bbox: { south: BBOX[0], west: BBOX[1], north: BBOX[2], east: BBOX[3] },
  processing: [
    'Overpass API query per dataset (raw responses in data/raw/, git-ignored)',
    'Multipolygon/relation assembly via osmtogeojson',
    'Classification into CityEntity types; unnamed POIs dropped except bus stops; roundabout ways named after their street skipped',
    'Duplicates merged: same type and name within 50 m (forts 500 m, peaks 150 m; e.g. a roundabout mapped as a node plus ring ways); a peak named like a fort within 400 m merged into the fort; the same hiking route mapped twice merged',
    'One OSM element in two datasets kept once: parks keep their outline, areas (suburb, village) stay localities, named spots stay POIs',
    'Coordinates rounded to 5 decimals (~1 m); boundaries simplified with Douglas–Peucker (3e-4°)',
    'Stable IDs derived from OSM element type + id',
  ],
  unavailable: [
    { layer: 'Municipal wards (NMC)', reason: 'No openly licensed ward boundary dataset found: absent from OpenStreetMap and DataMeet Municipal_Spatial_Data. Not fabricated.' },
    { layer: 'Bus routes', reason: 'Not extracted in Sprint 1; OSM route relations for Nashik city buses are incomplete.' },
  ],
  datasets,
}, null, 2));
console.log('Wrote', metaPath);
