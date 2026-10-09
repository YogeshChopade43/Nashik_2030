// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CityEntity } from '../types/entity.ts';
import { distance, pointInPolygon } from './geo.ts';
import { areaKm2, clipConvex, localityZones } from './zones.ts';

test('clipConvex', () => {
  const big = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
  const small = [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]];
  const area = (r: number[][]) => Math.abs(r.slice(0, -1).reduce((a, p, i) => a + p[0] * r[i + 1][1] - r[i + 1][0] * p[1], 0) / 2);
  assert.equal(area(clipConvex(big, small)), 4, 'big ∩ small = small');
  assert.equal(area(clipConvex(big, [...small].reverse())), 4, 'clip orientation does not matter');
  assert.equal(area(clipConvex([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], small)), 1, 'partial overlap');
  assert.deepEqual(clipConvex([[10, 10], [11, 10], [11, 11], [10, 10]], small), [], 'disjoint');
  // 0.01° × 0.01° at 20°N ≈ 1.046 km × 1.106 km
  const sq = { type: 'Polygon' as const, coordinates: [[[73.8, 20], [73.81, 20], [73.81, 20.01], [73.8, 20.01], [73.8, 20]]] };
  assert.ok(Math.abs(areaKm2(sq) - 1.157) < 0.01, `areaKm2 ${areaKm2(sq)}`);
});

test('locality zones on real Nashik data', () => {
  const localities: CityEntity[] = JSON.parse(readFileSync(new URL('../../public/data/localities.geojson', import.meta.url), 'utf8')).features
    .filter((f: CityEntity) => f.properties.type === 'locality');
  const zones = localityZones(localities, 3000);
  assert.ok(zones.size > localities.length * 0.9, 'nearly every locality gets a zone');
  for (const l of localities.slice(0, 40)) {
    const z = zones.get(l.properties.id);
    if (!z) continue;
    const p = l.geometry.coordinates as [number, number];
    assert.ok(pointInPolygon(p, z), `${l.properties.name} lies inside its own zone`);
    assert.ok(z.coordinates[0].every((v) => distance(p, v) <= 3030), `${l.properties.name} zone respects the 3 km cap`);
  }
  // A zone is the nearest-locality region: its vertices are never closer to another locality's point.
  const panch = localities.find((l) => l.properties.name === 'Panchavati')!;
  const others = localities.filter((l) => l !== panch).map((l) => l.geometry.coordinates as [number, number]);
  const own = panch.geometry.coordinates as [number, number];
  for (const v of zones.get(panch.properties.id)!.coordinates[0]) {
    const dOwn = distance(own, v);
    assert.ok(others.every((o) => distance(o, v) >= dOwn - 25), 'vertex is (approximately) nearest to Panchavati');
  }
});
