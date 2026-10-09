// Tag-based place filters. Only real OSM tags are used, and a place without a tag is
// excluded (not assumed to lack the feature); the UI says so.
import type { CityEntity } from '../types/entity.ts';

export interface PlaceFilter {
  id: string;
  label: string;
  /** Filters sharing a group are OR-ed (e.g. religions); different groups are AND-ed. */
  group?: string;
  test: (e: CityEntity, ctx: FilterContext) => boolean;
}
export interface FilterContext {
  /** Reference time for recency (the data extraction date, so results are reproducible). */
  asOf: number;
}

const YEAR_MS = 365 * 24 * 3600 * 1000;
const has = (k: string) => (e: CityEntity) => !!e.properties.tags[k];
const recent: PlaceFilter = {
  id: 'recent', label: 'Edited in the last year',
  test: (e, c) => !!e.properties.updated_at && c.asOf - Date.parse(e.properties.updated_at) <= YEAR_MS,
};
const religion = (r: string, label: string): PlaceFilter => ({ id: `religion-${r}`, label, group: 'religion', test: (e) => e.properties.category === r });
const website: PlaceFilter = { id: 'website', label: 'Has website', test: has('website') };

/** Filters per layer id. Layers not listed have no filters. */
export const FILTERS: Partial<Record<string, PlaceFilter[]>> = {
  hospital: [
    { id: 'emergency', label: 'Emergency services', test: (e) => e.properties.tags.emergency === 'yes' },
    { id: 'speciality', label: 'Specialities listed', test: (e) => !!e.properties.category },
    website,
    recent,
  ],
  religious: [
    religion('hindu', 'Hindu'), religion('muslim', 'Muslim'), religion('christian', 'Christian'),
    religion('buddhist', 'Buddhist'), religion('jain', 'Jain'), religion('sikh', 'Sikh'),
    recent,
  ],
  landmark: [
    { id: 'kind-chowk', label: 'Chowks & circles', group: 'kind', test: (e) => e.properties.category === 'chowk / junction' },
    { id: 'kind-fuel', label: 'Petrol pumps', group: 'kind', test: (e) => e.properties.category === 'petrol pump' },
    { id: 'kind-bank', label: 'Banks', group: 'kind', test: (e) => e.properties.category === 'bank' },
    { id: 'kind-pharmacy', label: 'Pharmacies', group: 'kind', test: (e) => e.properties.category === 'pharmacy' },
    { id: 'kind-cinema', label: 'Cinemas', group: 'kind', test: (e) => e.properties.category === 'cinema' },
    { id: 'kind-tank', label: 'Water tanks', group: 'kind', test: (e) => e.properties.category === 'water tank' },
  ],
  toilets: [
    { id: 'kind-toilets', label: 'Toilets', group: 'kind', test: (e) => e.properties.type === 'toilets' },
    { id: 'kind-water', label: 'Drinking water', group: 'kind', test: (e) => e.properties.type === 'drinking_water' },
    { id: 'free', label: 'Free', test: (e) => e.properties.tags.fee === 'no' },
    { id: 'female', label: "Women's", test: (e) => e.properties.tags.female === 'yes' || e.properties.tags.unisex === 'yes' },
    { id: 'wheelchair', label: 'Accessible', test: (e) => e.properties.tags.wheelchair === 'yes' },
  ],
  school: [recent],
  college: [website, recent],
  market: [recent],
  tourism: [website, recent],
  government: [recent],
  railway_station: [recent],
  bus_stop: [recent],
};

/** Entities passing all active filters (OR within a group, AND across groups). */
export function applyFilters(entities: CityEntity[], filters: PlaceFilter[], active: string[], ctx: FilterContext): CityEntity[] {
  const on = filters.filter((f) => active.includes(f.id));
  if (!on.length) return entities;
  const groups = new Map<string, PlaceFilter[]>();
  for (const f of on) groups.set(f.group ?? f.id, [...(groups.get(f.group ?? f.id) ?? []), f]);
  return entities.filter((e) => [...groups.values()].every((g) => g.some((f) => f.test(e, ctx))));
}

/** Matching count per filter, so the UI can hide filters that match nothing. */
export const filterCounts = (entities: CityEntity[], filters: PlaceFilter[], ctx: FilterContext) =>
  Object.fromEntries(filters.map((f) => [f.id, entities.filter((e) => f.test(e, ctx)).length]));
