// Deterministic geographic utilities. No network, no models — pure geometry over
// city entities, so Sprint 2 agents (and the UI today) get reproducible answers.
import type { Geometry, Position } from 'geojson';
import type { CityEntity, EntityType } from '../types/entity.ts';
import { t } from './i18n.ts';

export type LngLat = [number, number];
/** [west, south, east, north] */
export type BBox = [number, number, number, number];

const R = 6371008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle (haversine) distance in metres. */
export function distance(a: LngLat | Position, b: LngLat | Position): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function eachPosition(g: Geometry, fn: (p: Position) => void): void {
  switch (g.type) {
    case 'Point': fn(g.coordinates); break;
    case 'MultiPoint': case 'LineString': g.coordinates.forEach(fn); break;
    case 'MultiLineString': case 'Polygon': g.coordinates.forEach((l) => l.forEach(fn)); break;
    case 'MultiPolygon': g.coordinates.forEach((p) => p.forEach((l) => l.forEach(fn))); break;
    case 'GeometryCollection': g.geometries.forEach((x) => eachPosition(x, fn)); break;
  }
}

/** Bounding box of one or more geometries. */
export function bbox(geoms: Geometry | Geometry[]): BBox {
  const b: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const g of Array.isArray(geoms) ? geoms : [geoms]) {
    eachPosition(g, ([x, y]) => {
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
    });
  }
  return b;
}

export const bboxIntersects = (a: BBox, b: BBox) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
export const bboxContains = (b: BBox, p: LngLat) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];

function inRing(p: LngLat, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ray-casting point-in-polygon, honouring holes. Non-polygon geometries → false. */
export function pointInPolygon(p: LngLat, g: Geometry): boolean {
  const poly = (rings: Position[][]) => inRing(p, rings[0]) && !rings.slice(1).some((h) => inRing(p, h));
  if (g.type === 'Polygon') return poly(g.coordinates);
  if (g.type === 'MultiPolygon') return g.coordinates.some(poly);
  return false;
}

/**
 * Closest point on a segment, using a local equirectangular projection
 * (accurate to well under 1% at city scale).
 */
function nearestOnSegment(p: LngLat, a: Position, b: Position): { point: LngLat; distance: number } {
  const k = Math.cos(rad(p[1]));
  const ax = (a[0] - p[0]) * k, ay = a[1] - p[1];
  const bx = (b[0] - p[0]) * k, by = b[1] - p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  const point: LngLat = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  return { point, distance: distance(p, point) };
}

function lines(g: Geometry): Position[][] {
  switch (g.type) {
    case 'LineString': return [g.coordinates];
    case 'MultiLineString': case 'Polygon': return g.coordinates;
    case 'MultiPolygon': return g.coordinates.flat();
    default: return [];
  }
}

/** Closest point on any geometry. Inside a polygon → distance 0. */
export function nearestPoint(p: LngLat, g: Geometry): { point: LngLat; distance: number } {
  if (g.type === 'Point') return { point: g.coordinates as LngLat, distance: distance(p, g.coordinates) };
  if (pointInPolygon(p, g)) return { point: p, distance: 0 };
  let best = { point: p, distance: Infinity };
  for (const line of lines(g)) {
    for (let i = 1; i < line.length; i++) {
      const c = nearestOnSegment(p, line[i - 1], line[i]);
      if (c.distance < best.distance) best = c;
    }
  }
  return best;
}

/** Length of a (multi)line in metres. */
export function length(g: Geometry): number {
  let total = 0;
  for (const line of lines(g)) for (let i = 1; i < line.length; i++) total += distance(line[i - 1], line[i]);
  return total;
}

/** Representative point: the point itself, otherwise the bbox centre. */
export function centroid(g: Geometry): LngLat {
  if (g.type === 'Point') return g.coordinates as LngLat;
  const b = bbox(g);
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

export interface Hit { entity: CityEntity; distance: number; point: LngLat }
interface Query { types?: EntityType[]; maxDistance?: number; exclude?: string }

/** All entities within `radius` metres of `p`, nearest first. */
export function nearby(p: LngLat, entities: CityEntity[], radius: number, q: Query = {}): Hit[] {
  // Cheap degree-box prefilter before exact distance (1° lat ≈ 111 km).
  const dLat = radius / 111_000, dLon = dLat / Math.cos(rad(p[1]));
  const box: BBox = [p[0] - dLon, p[1] - dLat, p[0] + dLon, p[1] + dLat];
  const hits: Hit[] = [];
  for (const e of entities) {
    if (q.types && !q.types.includes(e.properties.type)) continue;
    if (e.properties.id === q.exclude) continue;
    if (!bboxIntersects(box, bbox(e.geometry))) continue;
    const n = nearestPoint(p, e.geometry);
    if (n.distance <= radius) hits.push({ entity: e, ...n });
  }
  return hits.sort((a, b) => a.distance - b.distance);
}

/** Single nearest entity, optionally filtered by type and capped by distance. */
export function nearest(p: LngLat, entities: CityEntity[], q: Query = {}): Hit | null {
  let best: Hit | null = null;
  for (const e of entities) {
    if (q.types && !q.types.includes(e.properties.type)) continue;
    if (e.properties.id === q.exclude) continue;
    const n = nearestPoint(p, e.geometry);
    if (n.distance <= (q.maxDistance ?? Infinity) && (!best || n.distance < best.distance)) best = { entity: e, ...n };
  }
  return best;
}

export const nearestRoad = (p: LngLat, roads: CityEntity[], maxDistance = 250) =>
  nearest(p, roads, { types: ['road_segment'], maxDistance });

/** Polygons containing `p` (point-in-ward / point-in-boundary). */
export const containing = (p: LngLat, polygons: CityEntity[]) =>
  polygons.filter((e) => bboxContains(bbox(e.geometry), p) && pointInPolygon(p, e.geometry));

/** Entities whose bbox intersects `box` (viewport / spatial-intersection prefilter). */
export const withinBBox = (box: BBox, entities: CityEntity[]) => entities.filter((e) => bboxIntersects(box, bbox(e.geometry)));

export const normalizeName = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

/** All segments forming a named road (OSM splits roads into many ways). */
export const roadSegmentsByName = (name: string, roads: CityEntity[]) => {
  const key = normalizeName(name);
  return roads.filter((r) => r.properties.name && normalizeName(r.properties.name) === key);
};

export interface ReverseGeocode {
  point: LngLat;
  road: Hit | null;
  locality: Hit | null;
  boundaries: CityEntity[];
}

/** Describe a coordinate using real entities only: nearest road, nearest locality, containing boundaries. */
export function reverseGeocode(p: LngLat, d: { roads: CityEntity[]; localities: CityEntity[]; boundaries: CityEntity[] }, exclude?: string): ReverseGeocode {
  return {
    point: p,
    road: nearestRoad(p, d.roads),
    locality: nearest(p, d.localities, { maxDistance: 5000, exclude }),
    boundaries: containing(p, d.boundaries),
  };
}

export function formatDistance(m: number): string {
  return m < 1000 ? t('{n} m', { n: Math.round(m) }) : t('{n} km', { n: (m / 1000).toFixed(m < 10_000 ? 1 : 0) });
}

/** Initial great-circle bearing from a to b, degrees clockwise from north [0, 360). */
export function bearing(a: LngLat | Position, b: LngLat | Position): number {
  const φ1 = rad(a[1]), φ2 = rad(b[1]), Δλ = rad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** 8-point compass label for a bearing. */
export const compass = (deg: number) => POINTS[Math.round(deg / 45) % 8];

/** Approximate circle polygon (for drawing a search radius). */
export function circle(center: LngLat, radius: number, steps = 64): Geometry {
  const dLat = radius / 111_195, dLon = dLat / Math.cos(rad(center[1]));
  const ring: Position[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    ring.push([center[0] + dLon * Math.cos(t), center[1] + dLat * Math.sin(t)]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}
