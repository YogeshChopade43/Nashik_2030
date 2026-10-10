// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dedupePlaces, dedupeTrails, mergeSummits, resolveSharedElements } from './dedupe.ts';
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

test('a fort and the peak it stands on become one place, keeping the peak height', () => {
  const out = mergeSummits([
    place('node/1', 'Ramshej Fort', 73.7, 20.1, 'fort', 'fort'),
    place('node/2', 'Ramshej', 73.7003, 20.1, 'peak', 'peak', { ele: '1083' }),
    place('node/3', 'Ravlya peak', 73.8, 20.2, 'peak', 'peak', { ele: '1300' }),
    place('node/4', 'Rawlya fort', 73.8007, 20.2, 'fort', 'fort'), // one-letter spelling variant, 75 m
    place('node/5', 'Saptashrungi', 74.0, 20.4, 'peak', 'peak'), // no fort nearby: stays a peak
    place('node/6', 'Ramshej', 73.75, 20.1, 'peak', 'peak'), // same name but 5 km away: stays
  ]);
  assert.deepEqual(out.map((e) => e.properties.source_id).sort(), ['node/1', 'node/4', 'node/5', 'node/6']);
  assert.equal(out.find((e) => e.properties.source_id === 'node/1')!.properties.tags.ele, '1083');
});

test('forts and localities merge across category differences; forts over a wider radius', () => {
  const out = dedupePlaces([
    place('node/1', 'Kavnai Fort', 73.6, 19.8, 'fort', 'fort'),
    place('node/2', 'Kavnai fort', 73.6002, 19.8, 'fort', 'castle'), // 21 m
    place('node/3', 'Kohoj Fort', 73.0, 19.6, 'fort', 'fort'),
    place('node/4', 'Kohoj Fort', 73.0028, 19.6, 'fort', 'fort'), // ~290 m: one hilltop
    place('node/5', 'Muthaiwadi', 73.9, 20.0, 'locality', 'village'),
    place('node/6', 'Muthaiwadi', 73.90024, 20.0, 'locality', 'hamlet'), // 25 m
    place('node/7', 'SBI', 73.7, 20.0, 'landmark', 'bank'),
    place('node/8', 'SBI', 73.7001, 20.0, 'landmark', 'atm'), // other place types keep categories apart
  ]);
  assert.deepEqual(out.map((e) => e.properties.source_id), ['node/1', 'node/3', 'node/5', 'node/7', 'node/8']);
});

const line = (source_id: string, name: string, coords: [number, number][]) => ({
  type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [coords] },
  properties: { id: `trail_r${source_id.split('/')[1]}`, type: 'trail', name, name_local: null, category: 'hiking route', source: 'openstreetmap', source_id, updated_at: null, tags: {} },
}) as CityEntity;

test('the same trail mapped twice (reversed name) merges; different trails with similar names do not', () => {
  const path: [number, number][] = [[73.7, 20.3], [73.71, 20.31], [73.72, 20.32]];
  const out = dedupeTrails([
    line('relation/1', 'Koldher-Rajdher-Indrai', path),
    line('relation/2', 'Indrai - Rajdher - Koldher', [...path].reverse()),
    line('relation/3', 'EST 01', [[73.5, 19.9], [73.51, 19.91]]),
    line('relation/4', 'EST 02', [[73.6, 19.9], [73.61, 19.91]]),
  ]);
  assert.deepEqual(out.map((e) => e.properties.source_id), ['relation/1', 'relation/3', 'relation/4']);
});

test('one OSM element becomes one entity across datasets', () => {
  const tourism = (id: string, n: string) => place(id, n, 73.79, 20.0, 'tourism', 'attraction');
  const loc = (id: string, n: string, cat: string) => ({ ...place(id, n, 73.79, 20.0, 'locality', cat), properties: { ...place(id, n, 73.79, 20.0, 'locality', cat).properties, id: `locality_${id[0]}${id.split('/')[1]}` } }) as CityEntity;
  const files = {
    places: [tourism('node/1', 'Panchavati'), tourism('node/2', 'Ramkund'), tourism('way/3', 'Phalke Smarak')],
    localities: [loc('node/1', 'Panchavati', 'suburb'), loc('node/2', 'Ramkund', 'locality')],
    parks: [{ ...place('way/3', 'Phalke Smarak', 73.79, 20.0, 'park', 'park'), geometry: { type: 'Polygon', coordinates: [[[73.79, 20], [73.8, 20], [73.8, 20.01], [73.79, 20]]] } } as CityEntity],
  };
  const out = resolveSharedElements(files);
  assert.deepEqual(out.places.map((e) => e.properties.name), ['Ramkund'], 'areas win over their POI copy; spots keep the POI');
  assert.deepEqual(out.localities.map((e) => e.properties.name), ['Panchavati']);
  assert.equal(out.parks.length, 1);
});

const shipped = (n: string): CityEntity[] => JSON.parse(readFileSync(new URL(`../../public/data/${n}.geojson`, import.meta.url), 'utf8')).features;

test('shipped data: no OSM element appears twice, no fort-peak or trail duplicates left', () => {
  const all = ['places', 'localities', 'parks', 'water', 'roads', 'boundaries', 'treks'].flatMap(shipped);
  const seen = new Map<string, number>();
  for (const e of all) if (e.properties.type !== 'road_segment' && e.properties.type !== 'river') seen.set(e.properties.source_id, (seen.get(e.properties.source_id) ?? 0) + 1);
  assert.deepEqual([...seen].filter(([, n]) => n > 1).map(([id]) => id), []);
  const treks = shipped('treks');
  assert.equal(mergeSummits(treks.filter((e) => e.properties.type !== 'trail')).length, treks.filter((e) => e.properties.type !== 'trail').length);
  assert.equal(dedupeTrails(treks.filter((e) => e.properties.type === 'trail')).length, treks.filter((e) => e.properties.type === 'trail').length);
});

test('same name within 300 m merges when the address matches or only one has an address', () => {
  const addr = (a: string) => ({ 'addr:full': a });
  const out = dedupePlaces([
    place('node/7048172476', 'Sudarshan Hospital', 73.79, 20.0, 'hospital', null, addr('City Plaza, Opp Kalika Mandir, Old Agra Road')),
    place('way/1466135595', 'Sudarshan Hospital', 73.7912, 20.0, 'hospital', null, addr('City Plaza, Opp. Kalika Mandir, Old Agra Road, Mumbai Naka, Nashik')), // ~125 m
    place('node/4849889623', 'Dhadiwal Hospital', 73.78, 20.0, 'hospital', null), // bare copy
    place('node/7655439030', 'Dhadiwal Hospital', 73.781, 20.0, 'hospital', null, addr('Trambakeshwar Road, Opp. New CBS')), // ~105 m
    place('way/1', 'Shiv Mandir', 73.70, 20.0, 'religious', 'hindu'),
    place('way/2', 'Shiv Mandir', 73.7008, 20.0, 'religious', 'hindu'), // ~84 m, neither has an address: two temples
    place('node/3', 'City Hospital', 73.60, 20.0, 'hospital', null, addr('MG Road')),
    place('node/4', 'City Hospital', 73.601, 20.0, 'hospital', null, addr('College Road')), // different addresses: two hospitals
  ]);
  assert.deepEqual(out.map((e) => e.properties.source_id), ['node/7048172476', 'node/4849889623', 'way/1', 'way/2', 'node/3', 'node/4']);
  assert.equal(out[1].properties.tags['addr:full'], 'Trambakeshwar Road, Opp. New CBS', 'the merged place keeps the address');
});

test('villages with the same name within 500 m are one village', () => {
  const out = dedupePlaces([
    place('node/3062514231', 'Lakhalgaon', 73.90, 20.05, 'locality', 'village'),
    place('node/3635085746', 'Lakhalgaon', 73.9018, 20.05, 'locality', 'village'), // ~190 m
  ]);
  assert.equal(out.length, 1);
});
