// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CityEntity } from '../types/entity.ts';
import { FILTERS, applyFilters, filterCounts } from './filters.ts';

const places: CityEntity[] = JSON.parse(readFileSync(new URL('../../public/data/places.geojson', import.meta.url), 'utf8')).features;
const meta = JSON.parse(readFileSync(new URL('../../public/data/metadata.json', import.meta.url), 'utf8'));
const ctx = { asOf: Date.parse(meta.extracted_at) };
const of = (t: string) => places.filter((p) => p.properties.type === t);

test('hospital filters use real tags only', () => {
  const h = of('hospital');
  const emergency = applyFilters(h, FILTERS.hospital!, ['emergency'], ctx);
  assert.ok(emergency.length > 0 && emergency.length < h.length);
  assert.ok(emergency.every((e) => e.properties.tags.emergency === 'yes'));
  assert.equal(applyFilters(h, FILTERS.hospital!, [], ctx).length, h.length, 'no active filter = everything');
  const both = applyFilters(h, FILTERS.hospital!, ['emergency', 'website'], ctx);
  assert.ok(both.every((e) => e.properties.tags.emergency === 'yes' && e.properties.tags.website), 'different groups are AND-ed');
});

test('religion chips are OR-ed, other filters AND-ed', () => {
  const r = of('religious');
  const hinduOrJain = applyFilters(r, FILTERS.religious!, ['religion-hindu', 'religion-jain'], ctx);
  const counts = filterCounts(r, FILTERS.religious!, ctx);
  assert.equal(hinduOrJain.length, counts['religion-hindu'] + counts['religion-jain']);
  const recentHindu = applyFilters(r, FILTERS.religious!, ['religion-hindu', 'recent'], ctx);
  assert.ok(recentHindu.length <= counts['religion-hindu'] && recentHindu.length <= counts.recent);
  assert.ok(recentHindu.every((e) => e.properties.category === 'hindu' && ctx.asOf - Date.parse(e.properties.updated_at!) <= 365 * 864e5));
});
