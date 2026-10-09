// Run: npm test
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { MR, marathiName, setLang, t } from './i18n.ts';
import { formatDistance, roadSegmentsByName, centroid } from './geo.ts';
import { describePoint } from './address.ts';
import { ago } from '../data/live.ts';
import type { CityEntity } from '../types/entity.ts';

afterEach(() => setLang('en'));

test('t: English by default, Marathi when switched, with placeholders', () => {
  assert.equal(t('Layers'), 'Layers');
  setLang('mr');
  assert.equal(t('Layers'), 'स्तर');
  assert.equal(t('Widen to {d}', { d: '2 किमी' }), '2 किमी पर्यंत वाढवा');
  assert.equal(t('no such string'), 'no such string', 'missing strings fall back to English');
});

test('marathiName: name:mr first, then a Devanagari local name, never another script', () => {
  const p = (name_local: string | null, tags: Record<string, string> = {}) => ({ name_local, tags });
  assert.equal(marathiName(p('नाशिक डाकघर', { 'name:mr': 'नाशिक टपाल कार्यालय' })), 'नाशिक टपाल कार्यालय');
  assert.equal(marathiName(p('गोदावरी')), 'गोदावरी');
  assert.equal(marathiName(p('బస్టేషన్')), null, 'Telugu is not Marathi');
  assert.equal(marathiName(p('mandir')), null);
  assert.equal(marathiName(p(null)), null);
});

// Every literal passed to t() and every static label rendered through t() needs a Marathi entry.
const SRC = new URL('../', import.meta.url);
const files = (dir: URL): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? files(new URL(`${d.name}/`, dir)) : /\.tsx?$/.test(d.name) && !d.name.includes('.test.') ? [new URL(d.name, dir).pathname] : []);
const literals = (src: string) => [
  ...[...src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]),
  ...[...src.matchAll(/\bt\(\s*"([^"]*)"/g)].map((m) => m[1]),
  ...[...src.matchAll(/\blabel: '([A-Za-z][^']*)'/g)].map((m) => m[1]),
  ...[...src.matchAll(/\b(?:label|title)="([A-Za-z][^"]*)"/g)].map((m) => m[1]),
  // Inspector field tables: ['Label', getter]
  ...[...src.matchAll(/\[(['"])([A-Z][^'"]*)\1, (?:category|tag\(|yesNo|address|link|wiki|\(p\))/g)].map((m) => m[2]),
].map((s) => s.replace(/\\'/g, "'"));

test('every translatable string has a Marathi entry with the same placeholders', () => {
  const missing: string[] = [];
  for (const f of files(SRC)) {
    const src = readFileSync(decodeURIComponent(f.replace(/^\/(\w:)/, '$1')), 'utf8');
    for (const s of literals(src)) {
      if (!(s in MR)) { missing.push(`${f.split('/src/')[1]}: ${s}`); continue; }
      const ph = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
      assert.equal(ph(MR[s]), ph(s), `placeholders differ for "${s}"`);
    }
  }
  assert.deepEqual(missing, []);
});

test('distances and ages read in Marathi', () => {
  setLang('mr');
  assert.equal(formatDistance(450), '450 मी');
  assert.equal(formatDistance(2300), '2.3 किमी');
  assert.equal(ago(40), '40 मिनिटांपूर्वी');
  assert.equal(ago(0), 'आत्ताच');
});

const load = (n: string): CityEntity[] => JSON.parse(readFileSync(new URL(`../../public/data/${n}.geojson`, import.meta.url), 'utf8')).features;
const d = { places: load('places'), roads: load('roads'), localities: load('localities') };

test('directions in Marathi use Marathi grammar and Marathi names where OSM has them', () => {
  const seg = roadSegmentsByName('College Road', d.roads)[0];
  setLang('mr');
  const r = describePoint(centroid(seg.geometry), d);
  assert.match(r.text, /^College [Rr]oad वर/, r.text);
  // Near Trimbakeshwar temple the area is named in Marathi (Trimbak has name:mr in OSM).
  const temple = d.places.find((p) => p.properties.name === 'Trimbakeshwar Temple')!;
  const [lng, lat] = temple.geometry.coordinates as [number, number];
  const near = describePoint([lng + 0.001, lat], d);
  assert.match(near.text, /त्र्यंबक परिसर$/, near.text);
  assert.doesNotMatch(near.text, /\b(of|near|area|On)\b/, near.text);
});
