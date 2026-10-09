// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTERVAL_H, classify } from './live.ts';

const H = 3600_000;
const now = Date.parse('2026-10-10T12:00:00Z');
const WEATHER = { points: { nashik: [{ t: '2026-10-10T12:00:00Z', temp_c: 25 }] } };
const env = (over: Record<string, unknown> = {}) => ({
  source: 'ECMWF', license: 'CC BY 4.0', attribution: 'x',
  fetched_at: '2026-10-10T11:00:00Z', valid_until: '2026-10-10T13:00:00Z', data: WEATHER, ...over,
});

test('classify ok', () => {
  const s = classify(env(), 'weather', now);
  assert.equal(s.state, 'ok');
  assert.equal(s.age_min, 60);
  assert.deepEqual(s.envelope?.data, WEATHER);
});

test('classify stale after valid_until + one interval', () => {
  const validUntil = new Date(now - (INTERVAL_H.weather + 1) * H).toISOString();
  assert.equal(classify(env({ valid_until: validUntil, fetched_at: new Date(now - 20 * H).toISOString() }), 'weather', now).state, 'stale');
  // still within the grace interval → ok
  const recent = new Date(now - (INTERVAL_H.weather - 1) * H).toISOString();
  assert.equal(classify(env({ valid_until: recent, fetched_at: new Date(now - 10 * H).toISOString() }), 'weather', now).state, 'ok');
});

test('classify rejects malformed envelopes', () => {
  assert.equal(classify(null, 'weather', now).state, 'missing');
  assert.equal(classify(env({ valid_until: undefined }), 'weather', now).state, 'missing');
  assert.equal(classify(env({ valid_until: 'not a date' }), 'weather', now).state, 'missing');
  assert.equal(classify(env({ fetched_at: new Date(now + 10 * 60_000).toISOString() }), 'weather', now).state, 'missing');
  assert.equal(classify(env({ data: 'oops' }), 'weather', now).state, 'missing');
});

test('wrong-shaped data counts as missing instead of crashing the UI', () => {
  assert.equal(classify(env({ data: {} }), 'weather', now).state, 'missing');
  assert.equal(classify(env({ data: { points: { nashik: [] } } }), 'weather', now).state, 'missing');
  assert.equal(classify(env({ data: { trend: 'rising' } }), 'river', now).state, 'missing');
  assert.equal(classify(env({ data: { warnings: [] } }), 'imd', now).state, 'missing');
  assert.equal(classify(env({ data: { points: { nashik: [{ t: '2026-10-10T12:00:00Z' }] } } }), 'weather', now).state, 'ok');
  assert.equal(classify(env({ data: { series: [], cell: { lat: 20, lon: 73.8 }, trend: 'steady' } }), 'river', now).state, 'ok');
  assert.equal(classify(env({ data: { status: 'http_403', warnings: [] } }), 'imd', now).state, 'ok');
});

test('intervals match the pipeline valid_hours', () => {
  assert.deepEqual(INTERVAL_H, { weather: 6, river: 24, imd: 3 });
});
