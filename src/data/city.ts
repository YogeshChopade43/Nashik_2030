import type { CityEntity, EntityType, Metadata } from '../types/entity';
import { bbox, normalizeName, type BBox } from '../lib/geo';
import { getLang, localName, marathiName, t } from '../lib/i18n';
import { LAYER_BY_TYPE } from '../map/layers';

const FILES = ['places', 'roads', 'parks', 'water', 'localities', 'boundaries', 'treks'] as const;
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
  const get = (p: string) => fetch(`${import.meta.env.BASE_URL}data/${p}`).then((r) => {
    if (!r.ok) throw new Error(`Failed to load ${p}: ${r.status}`);
    return r.json();
  });
  const [meta, ...collections] = await Promise.all([get('metadata.json'), ...FILES.map((f) => get(`${f}.geojson`))]);
  const files = Object.fromEntries(FILES.map((f, i) => [f, collections[i].features])) as CityData['files'];
  const all = FILES.flatMap((f) => files[f]);
  const byType: CityData['byType'] = {};
  for (const e of all) {
    (byType[e.properties.type] ??= []).push(e);
    e.properties.name_mr = marathiName(e.properties); // read by the Marathi map labels
  }
  return { files, all, byId: new Map(all.map((e) => [e.properties.id, e])), byType, meta, search: buildIndex(all) };
}

// ---------------- search ----------------

export const TYPE_LABEL: Record<EntityType, string> = {
  city: 'City', locality: 'Locality', admin_boundary: 'Administrative boundary', road_segment: 'Road',
  river: 'River', water_body: 'Water body', park: 'Park', hospital: 'Hospital', school: 'School',
  college: 'College', market: 'Market', religious: 'Religious place', tourism: 'Tourist place',
  government: 'Government facility', bus_stop: 'Bus stop', railway_station: 'Railway station',
  landmark: 'Landmark', toilets: 'Public toilet', drinking_water: 'Drinking water',
  fort: 'Fort', peak: 'Peak', trail: 'Trek trail',
};

/** Name to show; unnamed infrastructure (bus stops, toilets, water points) is labelled by its type. */
export const displayName = (p: { name: string | null; name_local: string | null; tags: Record<string, string>; type: EntityType }) =>
  localName(p) ?? (['bus_stop', 'toilets', 'drinking_water'].includes(p.type) ? t(TYPE_LABEL[p.type]) : t('Unnamed {type}', { type: t(TYPE_LABEL[p.type]).toLowerCase() }));

/** Category keywords → layer id. Lets "hospitals" or "temples" search for a whole layer. */
const CATEGORY_WORDS: Record<string, string[]> = {
  hospital: ['hospital', 'hospitals', 'clinic', 'medical', 'health', 'रुग्णालय', 'दवाखाना', 'हॉस्पिटल'],
  school: ['school', 'schools', 'शाळा'],
  college: ['college', 'colleges', 'university', 'universities', 'महाविद्यालय', 'कॉलेज', 'विद्यापीठ'],
  market: ['market', 'markets', 'mall', 'malls', 'bazaar', 'shopping', 'बाजार', 'मंडई', 'मॉल'],
  park: ['park', 'parks', 'garden', 'gardens', 'उद्यान', 'बाग'],
  religious: ['temple', 'temples', 'mandir', 'mosque', 'masjid', 'church', 'religious', 'worship', 'मंदिर', 'देऊळ', 'मशीद', 'चर्च', 'गुरुद्वारा'],
  tourism: ['tourist', 'tourism', 'attraction', 'attractions', 'museum', 'landmark', 'landmarks', 'sightseeing', 'पर्यटन', 'संग्रहालय'],
  government: ['government', 'police', 'post office', 'court', 'fire station', 'office', 'सरकारी', 'पोलीस', 'पोस्ट', 'न्यायालय', 'कार्यालय'],
  bus_stop: ['bus', 'bus stop', 'bus stops', 'bus station', 'transit', 'बस', 'बस थांबा', 'बस स्थानक'],
  railway_station: ['railway', 'railway station', 'train', 'station', 'रेल्वे', 'रेल्वे स्थानक', 'स्टेशन'],
  landmark: ['landmark', 'landmarks', 'chowk', 'circle', 'naka', 'signal', 'petrol pump', 'petrol', 'bank', 'atm', 'pharmacy', 'medical store', 'चौक', 'नाका', 'पेट्रोल पंप', 'बँक', 'एटीएम', 'मेडिकल'],
  toilets: ['toilet', 'toilets', 'washroom', 'restroom', 'public toilet', 'urinal', 'शौचालय', 'स्वच्छतागृह', 'मुतारी'],
  drinking_water: ['drinking water', 'water point', 'water tap', 'पिण्याचे पाणी', 'पाणपोई'],
  locality: ['locality', 'localities', 'neighbourhood', 'neighborhood', 'area', 'परिसर'],
  fort: ['fort', 'forts', 'killa', 'gad', 'durg', 'किल्ला', 'किल्ले', 'गड'],
  peak: ['peak', 'peaks', 'mountain', 'hill', 'शिखर', 'डोंगर'],
  trail: ['trek', 'treks', 'trekking', 'trail', 'trails', 'hike', 'hiking', 'ट्रेक', 'ट्रेकिंग', 'पायवाट'],
};

export type SearchItem =
  | { kind: 'entity'; keys: string[]; label: string; sub: string; entity: CityEntity; rank: number }
  | { kind: 'road'; keys: string[]; label: string; sub: string; segments: CityEntity[]; bbox: BBox; rank: number }
  | { kind: 'category'; keys: string[]; label: string; sub: string; layer: string; type: EntityType; rank: number };

const TYPE_RANK: Partial<Record<EntityType, number>> = {
  city: 14, locality: 10, railway_station: 10, tourism: 11, landmark: 9, road_segment: 8, river: 8, water_body: 7,
  fort: 11, trail: 9, peak: 7,
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

/** Result title and subtitle in the current language (the index itself is built once, in English). */
export function itemText(item: SearchItem, count: (type: EntityType) => number): { label: string; sub: string } {
  if (getLang() !== 'mr') return { label: item.label, sub: item.sub };
  if (item.kind === 'category') return { label: t('All {layer}', { layer: t(LAYER_BY_TYPE[item.type]?.label ?? TYPE_LABEL[item.type]) }), sub: t('{n} mapped in OpenStreetMap · show layer', { n: count(item.type) }) };
  if (item.kind === 'road') {
    const p = item.segments.map((s) => s.properties).find((p) => marathiName(p)) ?? item.segments[0].properties;
    return { label: marathiName(p) ?? item.label, sub: t('Road · {cls} · {n} segments', { cls: item.segments[0].properties.category?.replace(/_/g, ' ') ?? '', n: item.segments.length }) };
  }
  const p = item.entity.properties;
  return { label: localName(p) ?? item.label, sub: [t(TYPE_LABEL[p.type]), p.category && p.category !== p.type ? p.category : null].filter(Boolean).join(' · ') };
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
  // accept-language: Nominatim returns name:mr where OSM has it.
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', bounded: '1', 'accept-language': getLang() === 'mr' ? 'mr,en' : 'en', viewbox: `${b.west},${b.north},${b.east},${b.south}` }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const rows: { osm_type: string; osm_id: number; display_name: string; name: string; lat: string; lon: string; type: string; category: string }[] = await res.json();
  return rows.map((r) => ({ label: r.name || r.display_name.split(',')[0], sub: r.display_name, lngLat: [Number(r.lon), Number(r.lat)] as [number, number], source_id: `${r.osm_type}/${r.osm_id}`, kind: `${r.category} · ${r.type}` }));
}
export type NominatimHit = Awaited<ReturnType<typeof nominatim>>[number];
