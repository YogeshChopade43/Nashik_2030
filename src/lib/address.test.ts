// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CityEntity } from '../types/entity.ts';
import { describePoint, landmarkLabel } from './address.ts';
import { centroid, distance, roadSegmentsByName } from './geo.ts';

const load = (n: string): CityEntity[] => JSON.parse(readFileSync(new URL(`../../public/data/${n}.geojson`, import.meta.url), 'utf8')).features;
const d = { places: load('places'), roads: load('roads'), localities: load('localities') };
const names = new Set([...d.places, ...d.roads, ...d.localities].map((e) => e.properties.name));

test('directions use only real, nearby entities', () => {
  for (const name of ['Ramkund', 'Kalaram Mandir', 'Nashik Road']) {
    const e = d.places.find((p) => p.properties.name === name)!;
    const p = e.geometry.coordinates as [number, number];
    const r = describePoint(p, d, e.properties.id);
    assert.ok(r.text.length > 10, `${name}: ${r.text}`);
    assert.ok(r.landmark, `${name} has a landmark`);
    assert.ok(names.has(r.landmark.entity.properties.name), 'landmark is a real entity');
    assert.notEqual(r.landmark.entity.properties.id, e.properties.id, 'never describes a place by itself');
    assert.ok(r.landmark.distance <= 600);
    assert.ok(Math.abs(distance(p, r.landmark.entity.geometry.coordinates as [number, number]) - r.landmark.distance) < 1);
  }
});

test('a point on College Road says so', () => {
  const seg = roadSegmentsByName('College Road', d.roads)[0];
  const r = describePoint(centroid(seg.geometry), d);
  assert.match(r.text, /^On College [Rr]oad/);
});

test('chowks outrank similar-distance banks', () => {
  const chowk = d.places.find((p) => p.properties.category === 'chowk / junction' && p.properties.name === 'Mumbai Naka')!;
  const [lng, lat] = chowk.geometry.coordinates as [number, number];
  const r = describePoint([lng + 0.0004, lat], d); // ~40 m east of Mumbai Naka
  assert.equal(r.landmark?.entity.properties.name, 'Mumbai Naka', r.text);
  assert.equal(r.landmark?.direction, 'east');
});

test('ambiguous brand names get a type word', () => {
  const hp = d.places.find((p) => p.properties.category === 'petrol pump' && p.properties.name === 'HP')!;
  assert.equal(landmarkLabel(hp), 'HP petrol pump');
});
