// Run: npm test  (Node ≥ 23 strips TypeScript types natively)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CityEntity } from '../types/entity.ts';
import { bbox, bearing, circle, compass, containing, distance, length, nearest, nearestPoint, nearby, normalizeName, pointInPolygon, reverseGeocode, roadSegmentsByName } from './geo.ts';

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('geometry primitives', () => {
  near(distance([73.8, 20], [73.8, 21]), 111_195, 5); // 1° of latitude
  assert.deepEqual(bbox({ type: 'LineString', coordinates: [[1, 2], [3, -1], [0, 5]] }), [0, -1, 3, 5]);

  const square = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]]] };
  assert.equal(pointInPolygon([0.2, 0.2], square), true);
  assert.equal(pointInPolygon([0.5, 0.5], square), false, 'inside hole');
  assert.equal(pointInPolygon([1.5, 0.5], square), false);

  const line = { type: 'LineString' as const, coordinates: [[73.78, 20.0], [73.80, 20.0]] };
  const n = nearestPoint([73.79, 20.001], line);
  near(n.point[0], 73.79, 1e-9);
  near(n.distance, 111.2, 0.5); // 0.001° north of the line
  near(length(line), 2091, 5);
  near(bearing([73.8, 20], [73.8, 21]), 0, 1e-9);
  near(bearing([73.8, 20], [74.8, 20]), 90, 0.2);
  near(bearing([73.8, 20], [73.8, 19]), 180, 1e-9);
  near(bearing([73.8, 20], [72.8, 20]), 270, 0.2);
  assert.deepEqual([0, 44, 46, 180, 300, 359].map(compass), ['N', 'NE', 'NE', 'S', 'NW', 'N']);
  const ring = (circle([73.8, 20], 1000).coordinates as number[][][])[0];
  assert.ok(ring.every((p) => Math.abs(distance([73.8, 20], p) - 1000) < 5), 'circle points are ~1 km from centre');
  assert.equal(normalizeName('  College  road '), 'college road');
  assert.equal(normalizeName('नाशिक'), 'नाशिक', 'Devanagari marks preserved');
});

test('real Nashik data', () => {
  const load = (n: string): CityEntity[] => JSON.parse(readFileSync(new URL(`../../public/data/${n}.geojson`, import.meta.url), 'utf8')).features;
  const [places, roads, localities, boundaries] = ['places', 'roads', 'localities', 'boundaries'].map(load);
  const ramkund = places.find((p) => p.properties.name === 'Ramkund');
  assert.ok(ramkund, 'Ramkund exists in OSM extract');
  const p = ramkund.geometry.coordinates as [number, number];

  assert.deepEqual(containing(p, boundaries).map((b) => b.properties.name), ['Nashik Subdistrict']);
  const geo = reverseGeocode(p, { roads, localities, boundaries });
  assert.ok(geo.locality && geo.locality.distance < 2000, 'a locality within 2 km of Ramkund');
  assert.ok(geo.road && geo.road.distance < 250);

  const hospitals = nearby(p, places, 2000, { types: ['hospital'] });
  assert.ok(hospitals.length > 0);
  assert.ok(hospitals.every((h, i) => i === 0 || h.distance >= hospitals[i - 1].distance), 'sorted by distance');
  assert.equal(nearest(p, places, { types: ['hospital'] })?.entity.properties.id, hospitals[0].entity.properties.id);

  const college = roadSegmentsByName('college road', roads);
  assert.ok(college.length > 1, 'College Road is split into several OSM ways');
  assert.ok(college.every((r) => r.properties.type === 'road_segment'));
});
