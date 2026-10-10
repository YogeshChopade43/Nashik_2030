// OSM often maps one real place several times: a roundabout as a named node plus its ring split into
// named ways, a school as a point and a building outline, a fort and the peak it stands on, one route
// as two relations, one element tagged as both a locality and an attraction. These rules collapse
// each into one entity. Same name further apart (bus stops on opposite sides of a road, two branches
// of a bank) stays separate. Run `npm run dupes` to review look-alikes the rules leave alone.
import type { MultiLineString, Point } from 'geojson';
import type { CityEntity, EntityType } from '../types/entity.ts';
import { distance, nearby, normalizeName, type LngLat } from './geo.ts';
import { samplePath } from './trails.ts';

/** Same name within this distance is one place (forts and peaks are whole hilltops). */
const RADIUS_M: Partial<Record<EntityType, number>> = { fort: 500, peak: 150, locality: 500 };
const DEFAULT_RADIUS_M = 50;
/** Further apart, same name is still one place when the addresses agree, or only one copy has one. */
const ADDRESS_RADIUS_M = 300;
/** Types whose OSM category varies for one place (fort/castle, village/hamlet), so it is ignored. */
const ANY_CATEGORY = new Set<EntityType>(['fort', 'peak', 'locality']);

/** Places are always points (the extractor reduces ways to their centre). */
const pos = (e: CityEntity) => (e.geometry as Point).coordinates as LngLat;

const address = (e: CityEntity) => normalizeName(e.properties.tags['addr:full'] ?? e.properties.tags['addr:street'] ?? '');
/** "City Plaza, Opp Kalika Mandir" and "City Plaza, Opp. Kalika Mandir, Mumbai Naka" are one address. */
function addressAgrees(a: CityEntity, b: CityEntity) {
  const x = address(a), y = address(b);
  if (!x && !y) return false; // two bare "Shiv Mandir"s are two temples
  return !x || !y || x.includes(y) || y.includes(x);
}

const rank = (e: CityEntity) => {
  const [kind, id] = e.properties.source_id.split('/');
  return [kind === 'node' ? 0 : kind === 'way' ? 1 : 2, Number(id)];
};
const before = (a: CityEntity, b: CityEntity) => {
  const [ka, ia] = rank(a), [kb, ib] = rank(b);
  return ka - kb || ia - ib;
};

/** Combine duplicates into the first one's id and geometry; tags from all, keeper's winning. */
function absorb(keep: CityEntity, rest: CityEntity[], geometry = keep.geometry): CityEntity {
  const p = keep.properties;
  return {
    ...keep,
    geometry,
    properties: {
      ...p,
      name_local: p.name_local ?? rest.find((e) => e.properties.name_local)?.properties.name_local ?? null,
      tags: Object.assign({}, ...rest.map((e) => e.properties.tags).reverse(), p.tags),
      updated_at: [keep, ...rest].map((e) => e.properties.updated_at).filter((u): u is string => !!u).sort().at(-1) ?? null,
    },
  };
}

export function dedupePlaces(places: CityEntity[]): CityEntity[] {
  const groups = new Map<string, CityEntity[][]>();
  const out: (CityEntity | CityEntity[])[] = [];
  for (const e of places) {
    const p = e.properties;
    const name = p.name && normalizeName(p.name);
    if (!name) { out.push(e); continue; }
    const key = `${p.type}|${ANY_CATEGORY.has(p.type) ? '' : p.category}|${name}`;
    const radius = RADIUS_M[p.type] ?? DEFAULT_RADIUS_M;
    const at = pos(e);
    const clusters = groups.get(key) ?? [];
    // ponytail: linear scan per name; fine for a city extract (a few hundred same-name places at most).
    const hit = clusters.find((c) => c.some((x) => { const d = distance(pos(x), at); return d <= radius || (d <= ADDRESS_RADIUS_M && addressAgrees(x, e)); }));
    if (hit) { hit.push(e); continue; }
    const c = [e];
    clusters.push(c);
    groups.set(key, clusters);
    out.push(c);
  }
  return out.map((x) => (Array.isArray(x) ? merge(x) : x));
}

function merge(c: CityEntity[]): CityEntity {
  if (c.length === 1) return c[0];
  const [keep, ...rest] = [...c].sort(before);
  // A mapped node is where the mapper put the place; ways only give points on their outline or ring.
  const coords = rank(keep)[0] === 0 ? pos(keep)
    : [0, 1].map((i) => Math.round((c.reduce((s, e) => s + pos(e)[i], 0) / c.length) * 1e5) / 1e5) as LngLat;
  return absorb(keep, rest, { type: 'Point', coordinates: coords });
}

// ---------- forts on peaks ----------

/** Name without the words that only say what kind of place it is ("Ramshej Fort" → "ramshej"). */
const core = (name: string) => normalizeName(name).replace(/\b(fort|killa|qila|peak|castle|fortress|durg)\b/g, ' ').replace(/\s+/g, ' ').trim();

function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// One-letter spelling variants (Ravlya / Rawlya) only for names long enough not to collide by chance.
const sameName = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && editDistance(a, b) <= 1);
const SUMMIT_M = 400;

/** A peak named like a fort within 400 m is that fort's hill: one place, the fort, with the peak's height. */
export function mergeSummits(points: CityEntity[]): CityEntity[] {
  const forts = points.filter((e) => e.properties.type === 'fort');
  const extra = new Map<CityEntity, CityEntity[]>();
  const absorbed = new Set<CityEntity>();
  for (const peak of points.filter((e) => e.properties.type === 'peak' && e.properties.name)) {
    const k = core(peak.properties.name!);
    const fort = forts
      .filter((f) => f.properties.name && k && sameName(core(f.properties.name), k))
      .map((f) => ({ f, d: distance(pos(f), pos(peak)) }))
      .filter((x) => x.d <= SUMMIT_M)
      .sort((a, b) => a.d - b.d)[0]?.f;
    if (!fort) continue;
    absorbed.add(peak);
    extra.set(fort, [...(extra.get(fort) ?? []), peak]);
  }
  return points.filter((e) => !absorbed.has(e)).map((e) => (extra.has(e) ? absorb(e, extra.get(e)!) : e));
}

// ---------- trails mapped twice ----------

const nameKey = (name: string) => [...new Set(normalizeName(name).split(' ').filter((w) => w.length > 2))].sort().join(' ');
const OVERLAP_M = 100;
const OVERLAP_SHARE = 0.6;

/** Share of a's route lying within 100 m of b's. */
function overlap(a: CityEntity, b: CityEntity) {
  const line = (a.geometry as MultiLineString).coordinates[0] as LngLat[];
  const pts = samplePath(line, 30);
  return pts.filter(({ p }) => nearby(p, [b], OVERLAP_M).length).length / pts.length;
}

/** Same words in the name (any order) and mostly the same ground → one route, the older relation. */
export function dedupeTrails(trails: CityEntity[]): CityEntity[] {
  const sorted = [...trails].sort(before);
  const out: CityEntity[] = [];
  const merged = new Map<CityEntity, CityEntity[]>();
  for (const t of sorted) {
    const k = nameKey(t.properties.name ?? '');
    const twin = k && out.find((o) => nameKey(o.properties.name ?? '') === k && (overlap(t, o) >= OVERLAP_SHARE || overlap(o, t) >= OVERLAP_SHARE));
    if (twin) merged.set(twin, [...(merged.get(twin) ?? []), t]);
    else out.push(t);
  }
  const order = new Map(trails.map((t, i) => [t, i]));
  return out.sort((a, b) => order.get(a)! - order.get(b)!).map((t) => (merged.has(t) ? absorb(t, merged.get(t)!) : t));
}

// ---------- one OSM element, several datasets ----------

/** Locality categories that are areas people live in; a POI copy of these is dropped, not the locality. */
const AREA = new Set(['city', 'town', 'suburb', 'neighbourhood', 'quarter', 'village']);

/**
 * An element tagged both as a place and as an attraction ends up in two datasets. Keep one:
 * a park keeps its outline; an area (suburb, village) stays a locality; a named spot (Ramkund)
 * stays the more useful POI.
 */
export function resolveSharedElements<T extends Record<string, CityEntity[]>>(files: T): T {
  const ids = (k: string) => new Set((files[k] ?? []).map((e) => e.properties.source_id));
  const parks = ids('parks');
  const areaLocalities = new Set((files.localities ?? []).filter((e) => AREA.has(e.properties.category ?? '')).map((e) => e.properties.source_id));
  const poi = ids('places');
  return {
    ...files,
    ...(files.places && { places: files.places.filter((e) => !parks.has(e.properties.source_id) && !areaLocalities.has(e.properties.source_id)) }),
    ...(files.localities && { localities: files.localities.filter((e) => areaLocalities.has(e.properties.source_id) || !poi.has(e.properties.source_id)) }),
  };
}
