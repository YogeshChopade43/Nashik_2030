// Lists look-alike places the automatic merge rules (src/lib/dedupe.ts) leave alone, for a person
// to check: fix the data in OpenStreetMap, or add a rule if a pattern keeps coming back.
// Run: npm run dupes   (reads public/data, changes nothing)
import fs from 'node:fs';
import { distance, normalizeName } from '../src/lib/geo.ts';

const FILES = ['places', 'localities', 'parks', 'water', 'treks'];
const REVIEWED = JSON.parse(fs.readFileSync(new URL('./duplicates-reviewed.json', import.meta.url), 'utf8'));
const pairKey = (a, b) => [a, b].sort().join('|');
const reviewed = new Map(Object.entries(REVIEWED).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [pairKey(...k.split('|')), v]));
const MAX_M = 400;
const centre = (g) => {
  if (g.type === 'Point') return g.coordinates;
  const pts = [];
  const walk = (c) => (typeof c[0] === 'number' ? pts.push(c) : c.forEach(walk));
  walk(g.coordinates);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
};
const GENERIC = /\b(fort|killa|mandir|temple|devasthan|hospital|school|college|chowk|circle|peak|lake|talav|river|shri|shree|sri|the)\b/g;
const core = (s) => normalizeName(s).replace(GENERIC, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => normalizeName(s).split(' ').sort().join(' ');
const oneEdit = (a, b) => {
  if (Math.abs(a.length - b.length) > 1 || a.length < 5) return false;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
};
// Same name, different kind of thing, usually both real: a bus stop named after its area, a fort
// and the trail up to it. Shown separately so the likely mistakes stand out.
const EXPECTED = new Set(['bus_stop|locality', 'fort|trail', 'peak|trail', 'landmark|religious', 'hospital|landmark', 'bus_stop|landmark']);

const all = FILES.flatMap((f) => JSON.parse(fs.readFileSync(`public/data/${f}.geojson`, 'utf8')).features)
  .filter((e) => e.properties.name && e.properties.type !== 'river')
  .map((e) => ({ e, c: centre(e.geometry), n: normalizeName(e.properties.name), k: core(e.properties.name), w: words(e.properties.name) }));

const likely = [], expected = [], todo = [];
let hidden = 0;
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
  const a = all[i], b = all[j];
  const why = a.n === b.n ? 'same name' : a.w === b.w ? 'same words' : a.k && a.k === b.k ? 'same core name' : oneEdit(a.k, b.k) ? 'one-letter spelling' : null;
  if (!why) continue;
  const d = distance(a.c, b.c);
  if (d > MAX_M) continue;
  const pa = a.e.properties, pb = b.e.properties;
  const row = `${Math.round(d).toString().padStart(4)} m  ${why.padEnd(19)} ${pa.name} [${pa.type}] ${pa.source_id}  ↔  ${pb.name} [${pb.type}] ${pb.source_id}`;
  const r = reviewed.get(pairKey(pa.source_id, pb.source_id));
  if (r?.verdict === 'distinct') { hidden++; continue; }
  if (r) { todo.push([d, `${row}\n${' '.repeat(28)}${r.verdict}: ${r.note}`]); continue; }
  (EXPECTED.has([pa.type, pb.type].sort().join('|')) ? expected : likely).push([d, row]);
}
const show = (title, rows) => {
  console.log(`\n${title} (${rows.length})`);
  for (const [, r] of rows.sort((x, y) => x[0] - y[0])) console.log('  ' + r);
};
show('New, worth checking: same or similar name within 400 m', likely);
show('Reviewed, waiting for an OSM fix or a local check', todo);
show('Probably fine: same name, different kind of place', expected);
console.log(`\n${hidden} reviewed pairs hidden as distinct places (scripts/duplicates-reviewed.json).`);
console.log('\nFix real duplicates in OpenStreetMap (https://www.openstreetmap.org/<source id>), then `npm run data`.');
