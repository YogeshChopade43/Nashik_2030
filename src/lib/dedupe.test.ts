// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dedupePlaces } from './dedupe.ts';
import type { CityEntity } from '../types/entity.ts';

const place = (source_id: string, name: string, lng: number, lat: number, type = 'landmark', category: string | null = 'chowk / junction', tags: Record<string, string> = {}) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { id: `place_${source_id[0]}${source_id.split('/')[1]}`, type, name, name_local: null, category, source: 'openstreetmap', source_id, updated_at: null, tags },
}) as CityEntity;

test('one roundabout mapped as a node and several ring ways becomes one place', () => {
  const out = dedupePlaces([
    place('way/51686488', 'Dwarka Circle', 73.7971, 19.99408),
    place('node/13446959144', 'Dwarka Circle', 73.79708, 19.99411, 'landmark', 'chowk / junction', { 'name:mr': 'द्वारका सर्कल' }),
    place('way/480878616', 'Dwarka circle', 73.79715, 19.99389),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].properties.source_id, 'node/13446959144', 'keeps the node: a stable id for shared links');
  assert.equal(out[0].properties.tags['name:mr'], 'द्वारका सर्कल', 'keeps tags from every duplicate');
});

test('same-name places that are really different stay separate', () => {
  const out = dedupePlaces([
    place('node/1', 'HP', 73.79125, 20.0095, 'landmark', 'petrol pump'),
    place('node/2', 'HP', 73.79242, 20.00996, 'landmark', 'petrol pump'), // ~130 m away: another pump
    place('node/3', 'Satpur Colony', 73.75, 20.0, 'bus_stop', 'bus stop'),
    place('node/4', 'Satpur Colony', 73.7502, 20.0, 'school', null), // different type
    place('node/5', null as unknown as string, 73.76, 20.0, 'toilets', 'public toilet'),
    place('node/6', null as unknown as string, 73.76, 20.0, 'toilets', 'public toilet'), // unnamed: never merged
  ]);
  assert.equal(out.length, 6);
});

test('the shipped extract has no same-name duplicates within 50 m', () => {
  const places: CityEntity[] = JSON.parse(readFileSync(new URL('../../public/data/places.geojson', import.meta.url), 'utf8')).features;
  assert.equal(dedupePlaces(places).length, places.length);
});

test('roundabout ring pieces named after their street are not listed as chowks', () => {
  const places: CityEntity[] = JSON.parse(readFileSync(new URL('../../public/data/places.geojson', import.meta.url), 'utf8')).features;
  const fake = places.filter((e) => e.properties.category === 'chowk / junction' && /\b(road|marg|rasta|highway)$/i.test(e.properties.name ?? ''));
  assert.deepEqual(fake.map((e) => e.properties.name), []);
});
