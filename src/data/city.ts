import type { CityEntity, EntityType, Metadata } from '../types/entity';
import { bbox, normalizeName, type BBox } from '../lib/geo';

const FILES = ['places', 'roads', 'parks', 'water', 'localities', 'boundaries'] as const;
type FileName = (typeof FILES)[number];

export interface CityData {
  files: Record<FileName, CityEntity[]>;
  all: CityEntity[];
  byId: Map<string, CityEntity>;
  byType: Partial<Record<EntityType, CityEntity[]>>;
  meta: Metadata;
  search: SearchItem[];
}

export async function loadCity(): Promise<CityData> {
  const get = (p: string) => fetch(`/data/${p}`).then((r) => {
    if (!r.ok) throw new Error(`Failed to load ${p}: ${r.status}`);
    return r.json();
  });
  const [meta, ...collections] = await Promise.all([get('metadata.json'), ...FILES.map((f) => get(`${f}.geojson`))]);
  const files = Object.fromEntries(FILES.map((f, i) => [f, collections[i].features])) as CityData['files'];
  const all = FILES.flatMap((f) => files[f]);
  const byType: CityData['byType'] = {};
  for (const e of all) (byType[e.properties.type] ??= []).push(e);
  return { files, all, byId: new Map(all.map((e) => [e.properties.id, e])), byType, meta, search: buildIndex(all) };
}

// ---------------- search ----------------

export const TYPE_LABEL: Record<EntityType, string> = {
  city: 'City', locality: 'Locality', admin_boundary: 'Administrative boundary', road_segment: 'Road',
  river: 'River', water_body: 'Water body', park: 'Park', hospital: 'Hospital', school: 'School',
  college: 'College', market: 'Market', religious: 'Religious place', tourism: 'Tourist place',
  government: 'Government facility', bus_stop: 'Bus stop', railway_station: 'Railway station',
};

/** Category keywords → layer id. Lets "hospitals" or "temples" search for a whole layer. */
const CATEGORY_WORDS: Record<string, string[]> = {
  hospital: ['hospital', 'hospitals', 'clinic', 'medical', 'health'],
  school: ['school', 'schools'],
  college: ['college', 'colleges', 'university', 'universities'],
  market: ['market', 'markets', 'mall', 'malls', 'bazaar', 'shopping'],
  park: ['park', 'parks', 'garden', 'gardens'],
  religious: ['temple', 'temples', 'mandir', 'mosque', 'masjid', 'church', 'religious', 'worship'],
  tourism: ['tourist', 'tourism', 'attraction', 'attractions', 'museum', 'landmark', 'landmarks', 'sightseeing'],
  government: ['government', 'police', 'post office', 'court', 'fire station', 'office'],
  bus_stop: ['bus', 'bus stop', 'bus stops', 'bus station', 'transit'],
  railway_station: ['railway', 'railway station', 'train', 'station'],
  locality: ['locality', 'localities', 'neighbourhood', 'neighborhood', 'area'],
};

export type SearchItem =
  | { kind: 'entity'; keys: string[]; label: string; sub: string; entity: CityEntity; rank: number }
  | { kind: 'road'; keys: string[]; label: string; sub: string; segments: CityEntity[]; bbox: BBox; rank: number }
  | { kind: 'category'; keys: string[]; label: string; sub: string; layer: string; type: EntityType; rank: number };

const TYPE_RANK: Partial<Record<EntityType, number>> = {
  city: 14, locality: 10, railway_station: 10, tourism: 11, road_segment: 8, river: 8, water_body: 7,
  college: 6, hospital: 6, admin_boundary: 5, market: 5, park: 4, government: 4, religious: 4, school: 4, bus_stop: 2,
};

function buildIndex(all: CityEntity[]): SearchItem[] {
  const items: SearchItem[] = [];
  const roads = new Map<string, CityEntity[]>();
  for (const e of all) {
    const p = e.properties;
    if (!p.name) continue;
    const names = [p.name, p.name_local, p.tags['alt_name'], p.tags['short_name'], p.tags['old_name'], p.tags['official_name'], p.tags['name:mr']];
    const keys = [...new Set(names.filter((n): n is string => !!n).flatMap((n) => n.split(';')).map(normalizeName))];
    if (p.type === 'road_segment') {
      const k = normalizeName(p.name);
      roads.set(k, [...(roads.get(k) ?? []), e]);
      continue;
    }
    const sub = [TYPE_LABEL[p.type], p.category && p.category !== p.type ? p.category : null].filter(Boolean).join(' · ');
    items.push({ kind: 'entity', keys, label: p.name, sub, entity: e, rank: TYPE_RANK[p.type] ?? 0 });
  }
  for (const segments of roads.values()) {
    const p = segments[0].properties;
    // Segments may differ in casing ("College road" vs "College Road"): show the most common, capitalised spelling.
    const freq = new Map<string, number>();
    for (const s of segments) freq.set(s.properties.name!, (freq.get(s.properties.name!) ?? 0) + 1 + (/^\p{Lu}[^ ]* \p{Lu}/u.test(s.properties.name!) ? 0.5 : 0));
    const label = [...freq].sort((a, b) => b[1] - a[1])[0][0];
    const keys = [...new Set(segments.flatMap((s) => [s.properties.name, s.properties.name_local, s.properties.tags.ref]).filter((n): n is string => !!n).map(normalizeName))];
    const sub = `Road · ${p.category?.replace(/_/g, ' ')} · ${segments.length} segment${segments.length > 1 ? 's' : ''}`;
    items.push({ kind: 'road', keys, label, sub, segments, bbox: bbox(segments.map((s) => s.geometry)), rank: TYPE_RANK.road_segment! });
  }
  const counts: Partial<Record<EntityType, number>> = {};
  for (const e of all) counts[e.properties.type] = (counts[e.properties.type] ?? 0) + 1;
  for (const [type, words] of Object.entries(CATEGORY_WORDS) as [EntityType, string[]][]) {
    if (!counts[type]) continue;
    items.push({ kind: 'category', keys: words, label: `All ${TYPE_LABEL[type].toLowerCase().replace(/y$/, 'ie')}s`, sub: `${counts[type]} mapped in OpenStreetMap · show layer`, layer: type, type, rank: 20 });
  }
  return items;
}

/** Deterministic prefix/substring ranking over real entity names. */
export function search(index: SearchItem[], query: string, limit = 8): SearchItem[] {
  const q = normalizeName(query);
  if (q.length < 2) return [];
  const scored: [number, SearchItem][] = [];
  for (const item of index) {
    let best = 0;
    for (const k of item.keys) {
      const s = k === q ? 100 : k.startsWith(q) ? 80 : k.includes(' ' + q) ? 60 : k.includes(q) ? 35 : 0;
      if (s > best) best = s;
    }
    if (item.kind === 'category' && best < 80) continue; // categories only on strong keyword match
    if (best) scored.push([best + item.rank - item.label.length / 40, item]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, i]) => i);
}

/** Free-text fallback via OSM Nominatim, bounded to the Nashik extract. Only on explicit submit (Nominatim policy: no autocomplete). */
export async function nominatim(query: string, b: Metadata['bbox']) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', bounded: '1', viewbox: `${b.west},${b.north},${b.east},${b.south}` }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const rows: { osm_type: string; osm_id: number; display_name: string; name: string; lat: string; lon: string; type: string; category: string }[] = await res.json();
  return rows.map((r) => ({ label: r.name || r.display_name.split(',')[0], sub: r.display_name, lngLat: [Number(r.lon), Number(r.lat)] as [number, number], source_id: `${r.osm_type}/${r.osm_id}`, kind: `${r.category} · ${r.type}` }));
}
export type NominatimHit = Awaited<ReturnType<typeof nominatim>>[number];
