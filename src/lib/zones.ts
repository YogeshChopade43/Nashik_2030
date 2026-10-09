// Approximate locality areas. OSM maps Nashik localities as points, not boundaries, so the
// "area" of a locality is its nearest-locality zone (Voronoi cell), capped to a radius so
// sparse rural points don't claim huge regions. Always label these as approximate.
import { Delaunay } from 'd3-delaunay';
import type { Point, Polygon, Position } from 'geojson';
import type { CityEntity } from '../types/entity.ts';
import { circle, type LngLat } from './geo.ts';

const signedArea = (r: Position[]) => r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const open = (r: Position[]) => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r);

/** Sutherland–Hodgman: clip `subject` by a convex `clip` ring. Returns a closed ring (empty if no overlap). */
export function clipConvex(subject: Position[], clip: Position[]): Position[] {
  const c = open(clip);
  const ccw = signedArea(c) > 0;
  const inside = (p: Position, a: Position, b: Position) => {
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    return ccw ? cross >= 0 : cross <= 0;
  };
  const intersect = (p: Position, q: Position, a: Position, b: Position): Position => {
    const [x1, y1] = p, [x2, y2] = q, [x3, y3] = a, [x4, y4] = b;
    const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  };
  let out = open(subject);
  for (let i = 0; i < c.length && out.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], prev = input[(j + input.length - 1) % input.length];
      if (inside(p, a, b)) {
        if (!inside(prev, a, b)) out.push(intersect(prev, p, a, b));
        out.push(p);
      } else if (inside(prev, a, b)) out.push(intersect(prev, p, a, b));
    }
  }
  return out.length ? [...out, out[0]] : [];
}

/** Nearest-locality zone for every locality point, capped at `cap` metres from the point. */
export function localityZones(localities: CityEntity[], cap = 3000): Map<string, Polygon> {
  const pts = localities.filter((l) => l.geometry.type === 'Point');
  const zones = new Map<string, Polygon>();
  if (pts.length < 2) return zones;
  const coords = pts.map((l) => (l.geometry as Point).coordinates as LngLat);
  // Scale longitude so Voronoi distances are roughly metric at Nashik's latitude.
  const lat0 = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = coords.map((c) => c[0] * k), ys = coords.map((c) => c[1]);
  const pad = 0.1;
  const voronoi = Delaunay.from(coords, (c) => c[0] * k, (c) => c[1])
    .voronoi([Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]);
  pts.forEach((l, i) => {
    const cell = voronoi.cellPolygon(i);
    if (!cell) return;
    const ring = cell.map(([x, y]) => [x / k, y] as Position);
    const capRing = (circle(coords[i], cap, 48) as Polygon).coordinates[0];
    const clipped = clipConvex(ring, capRing);
    if (clipped.length >= 4) zones.set(l.properties.id, { type: 'Polygon', coordinates: [clipped] });
  });
  return zones;
}

/** Planar area of a lon/lat ring in km² (local equirectangular projection; fine at city scale). */
export function areaKm2(poly: Polygon): number {
  const ring = poly.coordinates[0];
  const lat0 = (ring.reduce((s, p) => s + p[1], 0) / ring.length) * (Math.PI / 180);
  const m = ring.map(([x, y]) => [x * 111_320 * Math.cos(lat0), y * 110_574]);
  return Math.abs(signedArea(open(m))) / 1e6;
}
