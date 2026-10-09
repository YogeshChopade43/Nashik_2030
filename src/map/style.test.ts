// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPENFREEMAP_GLYPHS, OPENFREEMAP_TILES, buildStyle, tileSource } from './style.ts';

test('tileSource falls back when pmtiles 404s', () => {
  assert.equal(tileSource(false, '/Nashik_2030/').url, OPENFREEMAP_TILES);
});

test('tileSource uses pmtiles with base', () => {
  assert.equal(tileSource(true, '/Nashik_2030/').url, 'pmtiles:///Nashik_2030/tiles/nashik.pmtiles');
});

test('buildStyle wires self-hosted fonts and keeps every layer', () => {
  const own = buildStyle({ pmtiles: true, base: 'https://x.github.io/Nashik_2030/', ownFonts: true });
  assert.equal(own.glyphs, 'https://x.github.io/Nashik_2030/fonts/{fontstack}/{range}.pbf');
  const fallback = buildStyle({ pmtiles: false, base: '/', ownFonts: false });
  assert.equal(fallback.glyphs, OPENFREEMAP_GLYPHS);
  assert.equal(own.layers.length, fallback.layers.length);
  assert.match(String((own.sources.omt as { attribution?: string }).attribution), /OpenMapTiles/);
});
