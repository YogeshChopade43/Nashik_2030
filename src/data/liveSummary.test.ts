// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { severeWarnings, summarise } from './liveSummary.ts';

const e = (t: string, temp_c: number, rain_mm = 0) => ({ t, temp_c, rain_mm, wind_kmh: 5, wind_dir: 0, cloud_pct: 0 });

test('day strip starts from now, not from the last past step', () => {
  // now = Sat 00:15 IST (Fri 18:45Z); the 18:00Z step is Fri 23:30 IST and must not create a "Fri" day
  const now = Date.parse('2026-10-09T18:45:00Z');
  const series = [e('2026-10-09T18:00:00Z', 24), e('2026-10-09T21:00:00Z', 22), e('2026-10-10T06:00:00Z', 32), e('2026-10-10T21:00:00Z', 21)];
  const s = summarise(series, now);
  assert.equal(s.current.t, '2026-10-09T18:00:00Z', 'current reading may be the latest past step');
  assert.deepEqual(s.days.map((d) => d.label), ['Sat', 'Sun']);
  assert.equal(s.days[0].max, 32);
});

test('an expired forecast gives no current reading and no rain claim', () => {
  // the whole series is 19 days old: never show its last step as "now" or claim "no rain"
  const series = [e('2026-09-20T00:00:00Z', 30), e('2026-09-26T00:00:00Z', 44)];
  const s = summarise(series, Date.parse('2026-10-09T18:45:00Z'));
  assert.equal(s.current, undefined);
  assert.equal(s.rain24, null);
  assert.deepEqual(s.days, []);
});

test('rain in the next 24 h and next rain step', () => {
  const now = Date.parse('2026-10-10T00:00:00Z');
  const s = summarise([e('2026-10-10T00:00:00Z', 25), e('2026-10-10T03:00:00Z', 25, 1.5), e('2026-10-11T03:00:00Z', 25, 4)], now);
  assert.equal(s.rain24, 1.5);
  assert.equal(s.nextRain?.t, '2026-10-10T03:00:00Z');
});

test('severe warnings only for orange/red values on an ok feed', () => {
  const feed = (warnings: Record<string, unknown>[], state: 'ok' | 'stale' = 'ok') =>
    ({ state, envelope: { source: 's', license: 'l', attribution: 'a', fetched_at: '', valid_until: '', data: { status: 'ok', warnings } } });
  assert.equal(severeWarnings(feed([{ District: 'Nashik', Day_1_Color: 'Orange' }])).length, 1);
  assert.equal(severeWarnings(feed([{ District: 'Nashik', Day_1_Color: 'Yellow' }])).length, 0);
  assert.equal(severeWarnings(feed([{ District: 'Nashik', Day_1_Color: 'Red' }], 'stale')).length, 0, 'stale warnings never raise a banner');
});
