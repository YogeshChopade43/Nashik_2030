// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainLines, climb, samplePath, terrarium, tileOf } from './trails.ts';
import type { LngLat } from './geo.ts';

test('chainLines joins unordered, partly reversed ways into one path', () => {
  const a: LngLat[] = [[0, 0], [1, 0]];
  const b: LngLat[] = [[2, 0], [1, 0]]; // reversed
  const c: LngLat[] = [[2, 0], [3, 0]];
  const out = chainLines([c, a, b]);
  assert.equal(out.length, 1);
  const p = out[0];
  assert.deepEqual([p[0], p[p.length - 1]].map((x) => x[0]).sort(), [0, 3]);
  assert.equal(p.length, 4, 'shared endpoints are not duplicated');
});

test('chainLines keeps disconnected pieces separate, longest first', () => {
  const out = chainLines([[[0, 0], [0.001, 0]], [[5, 5], [5, 6], [5, 7]]]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0][0], [5, 5]);
});

test('samplePath spaces points evenly and tracks distance', () => {
  const s = samplePath([[73.0, 20.0], [73.01, 20.0]], 11); // ~1045 m
  assert.equal(s.length, 11);
  assert.ok(Math.abs(s[10].d - 1045) < 5, String(s[10].d));
  assert.ok(Math.abs(s[5].p[0] - 73.005) < 1e-9);
});

test('climb sums real ascent, ignoring metre-level DEM noise', () => {
  assert.deepEqual(climb([500, 502, 501, 503, 600, 700, 650, 660]), { up: 210, down: 50, min: 500, max: 700 });
  assert.equal(climb([500, 501, 500, 501, 500]).up, 0);
});

test('terrarium decoding and tile lookup', () => {
  assert.equal(terrarium(128, 0, 0), 0);
  assert.equal(terrarium(130, 196, 128), 708.5); // 2*256 + 196 + 0.5
  const t = tileOf(73.7898, 19.9975, 12);
  assert.deepEqual([t.x, t.y], [2887, 1815]);
  assert.ok(t.px >= 0 && t.px < 256 && t.py >= 0 && t.py < 256);
});
