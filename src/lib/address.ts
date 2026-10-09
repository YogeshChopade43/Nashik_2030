// "Directions for visitors": describe a point the way Nashikkars give directions —
// road, a well-known landmark with distance and direction, and the area. Deterministic and
// built only from real OSM entities.
import type { CityEntity, EntityType } from '../types/entity.ts';
import { bearing, compass, distance, formatDistance, nearby, nearest, nearestRoad, type LngLat } from './geo.ts';
import { getLang, localName } from './i18n.ts';

/** How strongly people navigate by a type (lower = better reference). Distance is multiplied by this. */
const WEIGHT: Partial<Record<EntityType, number>> = {
  railway_station: 0.8, tourism: 1, religious: 1.15, hospital: 1.35, college: 1.35,
  school: 1.5, market: 1.4, government: 1.5, park: 1.7, bus_stop: 1.8,
};
// Landmark subcategories: chowks/nakas/circles are how Nashik gives directions.
const LANDMARK_WEIGHT: Record<string, number> = { 'chowk / junction': 0.7, 'petrol pump': 1.3, bank: 1.5, cinema: 1.2, pharmacy: 1.9, 'water tank': 1.6 };

const weightOf = (e: CityEntity) =>
  e.properties.type === 'landmark' ? LANDMARK_WEIGHT[e.properties.category ?? ''] ?? 1.6 : WEIGHT[e.properties.type] ?? Infinity;

const DIRECTION: Record<string, string> = { N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west' };
// Marathi "to the <direction>" (उत्तरेला = to the north).
const DIRECTION_MR: Record<string, string> = { north: 'उत्तरेला', 'north-east': 'ईशान्येला', east: 'पूर्वेला', 'south-east': 'आग्नेयेला', south: 'दक्षिणेला', 'south-west': 'नैऋत्येला', west: 'पश्चिमेला', 'north-west': 'वायव्येला' };

/** Display label for a reference place; adds a type word where the name alone is ambiguous ("HP" → "HP petrol pump"). */
export function landmarkLabel(e: CityEntity): string {
  const name = localName(e.properties)!;
  const mr = getLang() === 'mr';
  if (e.properties.category === 'petrol pump' && !/petrol|pump|fuel|petroleum|पेट्रोल|पंप/i.test(name)) return `${name} ${mr ? 'पेट्रोल पंप' : 'petrol pump'}`;
  if (e.properties.category === 'bank' && !/bank|atm|बँक/i.test(name)) return `${name} ${mr ? 'बँक' : 'bank'}`;
  return name;
}

export interface Directions {
  text: string;
  road?: { name: string; distance: number };
  landmark?: { entity: CityEntity; distance: number; direction: string };
  also?: CityEntity;
  locality?: CityEntity;
}

const MAX_LANDMARK_M = 600;

export function describePoint(p: LngLat, d: { places: CityEntity[]; roads: CityEntity[]; localities: CityEntity[] }, exclude?: string): Directions {
  const out: Directions = { text: '' };
  const roadHit = nearestRoad(p, d.roads, 250);
  // A road more than ~120 m away isn't a useful reference.
  if (roadHit?.entity.properties.name && roadHit.distance <= 120) out.road = { name: roadHit.entity.properties.name, distance: roadHit.distance };

  const candidates = nearby(p, d.places, MAX_LANDMARK_M, { exclude })
    .filter((h) => h.entity.properties.name && Number.isFinite(weightOf(h.entity)))
    // Score: weighted distance, with a floor so "right here" doesn't always beat a famous place 30 m away.
    .map((h) => ({ ...h, score: Math.max(h.distance, 25) * weightOf(h.entity) }))
    .sort((a, b) => a.score - b.score);
  const best = candidates[0];
  if (best) {
    out.landmark = { entity: best.entity, distance: best.distance, direction: DIRECTION[compass(bearing(best.point, p))] };
    // Second reference: close, distinct, and preferably a different kind of place.
    const others = candidates.filter((c) => c.entity !== best.entity && c.distance <= 350 && landmarkLabel(c.entity) !== landmarkLabel(best.entity)
      && distance(c.point, best.point) > 60);
    const kind = (e: CityEntity) => `${e.properties.type}/${e.properties.type === 'landmark' ? e.properties.category : ''}`;
    out.also = (others.find((c) => kind(c.entity) !== kind(best.entity)) ?? others[0])?.entity;
  }
  const loc = nearest(p, d.localities.filter((l) => l.properties.type === 'locality'), { maxDistance: 2500 });
  if (loc) out.locality = loc.entity;

  const mr = getLang() === 'mr';
  const name = (e: CityEntity) => localName(e.properties);
  const parts: string[] = [];
  if (out.road) {
    const road = mr ? localName(roadHit!.entity.properties)! : out.road.name;
    if (mr) parts.push(out.road.distance <= 60 ? `${road} वर` : `${road} पासून ${formatDistance(out.road.distance)} अंतरावर`);
    else parts.push(out.road.distance <= 60 ? `On ${road}` : `${formatDistance(out.road.distance)} off ${road}`);
  }
  if (out.landmark) {
    const { entity, distance: dist, direction } = out.landmark;
    if (mr) parts.push(dist < 30 ? `${landmarkLabel(entity)} येथे` : `${landmarkLabel(entity)} पासून ${formatDistance(dist)} ${DIRECTION_MR[direction]}`);
    else parts.push(dist < 30 ? `at ${landmarkLabel(entity)}` : `${formatDistance(dist)} ${direction} of ${landmarkLabel(entity)}`);
  }
  if (out.also) parts.push(mr ? `${landmarkLabel(out.also)} जवळ` : `near ${landmarkLabel(out.also)}`);
  let text = parts.join(', ');
  if (text) text = text[0].toUpperCase() + text.slice(1);
  const shown = [out.landmark?.entity, out.also].map((e) => e?.properties.name?.toLowerCase());
  if (out.locality && shown.includes(out.locality.properties.name?.toLowerCase())) out.locality = undefined;
  if (out.locality) {
    const area = name(out.locality);
    text = mr ? (text ? `${text} · ${area} परिसर` : `${area} परिसरात`) : text ? `${text} · ${area} area` : `In the ${area} area`;
  }
  out.text = text || (mr ? 'जवळपास नकाशावर रस्ता किंवा ओळखीचे ठिकाण नाही' : 'No mapped road or landmark nearby');
  return out;
}
