// OSM often maps one real place several times: a roundabout as a named node plus its ring split into
// named ways, a school as a point and a building outline. Same type + category + name within 50 m is
// one place. Further apart (bus stops on opposite sides of a road, two branches of a bank) stays separate.
import type { Point } from 'geojson';
import type { CityEntity } from '../types/entity.ts';
import { distance, normalizeName, type LngLat } from './geo.ts';

const SAME_PLACE_M = 50;
/** Places are always points (the extractor reduces ways to their centre). */
const pos = (e: CityEntity) => (e.geometry as Point).coordinates as LngLat;

const rank = (e: CityEntity) => {
  const [kind, id] = e.properties.source_id.split('/');
  return [kind === 'node' ? 0 : kind === 'way' ? 1 : 2, Number(id)];
};
const before = (a: CityEntity, b: CityEntity) => {
  const [ka, ia] = rank(a), [kb, ib] = rank(b);
  return ka - kb || ia - ib;
};

export function dedupePlaces(places: CityEntity[]): CityEntity[] {
  const groups = new Map<string, CityEntity[][]>();
  const out: (CityEntity | CityEntity[])[] = [];
  for (const e of places) {
    const p = e.properties;
    const name = p.name && normalizeName(p.name);
    if (!name) { out.push(e); continue; }
    const key = `${p.type}|${p.category}|${name}`;
    const at = pos(e);
    const clusters = groups.get(key) ?? [];
    // ponytail: linear scan per name; fine for a city extract (a few hundred same-name places at most).
    const hit = clusters.find((c) => c.some((x) => distance(pos(x), at) <= SAME_PLACE_M));
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
  const p = keep.properties;
  return {
    ...keep,
    geometry: { type: 'Point', coordinates: coords },
    properties: {
      ...p,
      name_local: p.name_local ?? rest.find((e) => e.properties.name_local)?.properties.name_local ?? null,
      tags: Object.assign({}, ...rest.map((e) => e.properties.tags).reverse(), p.tags),
      updated_at: c.map((e) => e.properties.updated_at).filter((u): u is string => !!u).sort().at(-1) ?? null,
    },
  };
}
