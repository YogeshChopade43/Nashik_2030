import type { ExpressionSpecification, StyleSpecification, VectorSourceSpecification } from 'maplibre-gl';

// "Light Atlas": an original Nashik 2030 basemap over OpenFreeMap's OpenMapTiles-schema
// vector tiles (OSM data). Everything here is style-spec only, so it renders identically in
// MapLibre GL JS (web) and MapLibre Native (iOS/Android).
export const C = {
  land: '#f3eee4',
  residential: '#ece5d8',
  industrial: '#e8e3da',
  wood: '#d6e1c6',
  grass: '#e3e8cf',
  farm: '#eeedd6',
  park: '#d4e4c1',
  water: '#a9cadb',
  shore: '#7ea8c0',
  waterway: '#8ab6cd',
  building: '#e3d9c9',
  buildingEdge: '#d3c5ae',
  casing: '#d0c3ac',
  road: '#ffffff',
  primary: '#fbe2a6',
  primaryCasing: '#d6ad66',
  highway: '#f2b48e',
  highwayCasing: '#c88259',
  rail: '#8a8277',
  ink: '#2b2620',
  label: '#5e5548',
  labelDim: '#8a8072',
  waterLabel: '#3b6c89',
  halo: '#f8f5ee',
  /** Panel/paper colour, used as marker fill. */
  paper: '#fffdf8',
};

const name: ExpressionSpecification = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
const cls = (...v: string[]): ExpressionSpecification => ['match', ['get', 'class'], v, true, false];
// Zoom interpolation must be the outermost expression; data expressions go in the stop values.
const w = (...stops: unknown[]) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops] as ExpressionSpecification;
const byClass = (match: string, a: number, b: number) => ['match', ['get', 'class'], match, a, b];
const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];
const FONT_ITALIC = ['Noto Sans Italic'];

const ROAD_LAYOUT = { 'line-cap': 'round', 'line-join': 'round' } as const;
const MINOR = cls('minor', 'service', 'track');
const SECONDARY = cls('secondary', 'tertiary');
const PRIMARY = cls('primary');
const HIGHWAY = cls('motorway', 'trunk');
// Casing widths; each fill layer below is drawn slightly narrower on top.
const minorW = w(12, byClass('minor', 0.6, 0.3), 18, byClass('minor', 12, 6));
const primaryW = w(7, 0.7, 18, 22);
const highwayW = w(6, 0.9, 18, 26);

// Engraved shoreline: concentric hairlines inside water polygons, like a printed atlas.
const waterLine = (i: number) => ({
  id: `base-water-line-${i}`, type: 'line' as const, source: 'omt', 'source-layer': 'water', minzoom: 11.5,
  paint: { 'line-color': C.shore, 'line-width': 0.75, 'line-offset': w(12, 1.6 * i, 17, 3.8 * i), 'line-opacity': 0.6 - i * 0.14 },
});

export const NASHIK_CENTER: [number, number] = [73.7898, 19.9975];

export const OPENFREEMAP_TILES = 'https://tiles.openfreemap.org/planet';
export const OPENFREEMAP_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const OSM_ATTRIBUTION = '<a href="https://www.openmaptiles.org/" target="_blank">© OpenMapTiles</a> Data <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>';

/** Self-hosted Nashik PMTiles (OpenMapTiles schema) when deployed; OpenFreeMap otherwise. */
export function tileSource(available: boolean, base: string): VectorSourceSpecification {
  return available
    ? { type: 'vector', url: `pmtiles://${base}tiles/nashik.pmtiles`, attribution: OSM_ATTRIBUTION }
    : { type: 'vector', url: OPENFREEMAP_TILES, attribution: `<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ${OSM_ATTRIBUTION}` };
}

/** True when a static file exists (a 404 or an HTML fallback page counts as missing). */
export async function probe(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

export function buildStyle(opts: { pmtiles: boolean; base: string; ownFonts: boolean }): StyleSpecification {
  return {
    ...baseStyle,
    glyphs: opts.ownFonts ? `${opts.base}fonts/{fontstack}/{range}.pbf` : OPENFREEMAP_GLYPHS,
    sources: { ...baseStyle.sources, omt: tileSource(opts.pmtiles, opts.base) },
  };
}

export const baseStyle: StyleSpecification = {
  version: 8,
  glyphs: OPENFREEMAP_GLYPHS,
  sources: {
    omt: {
      type: 'vector',
      url: OPENFREEMAP_TILES,
      attribution: `<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ${OSM_ATTRIBUTION}`,
    },
    dem: {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 14,
      attribution: '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">Terrain Tiles (Mapzen, AWS Open Data)</a>',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': C.land } },
    // Elevation tint: warm parchment deepening toward the Western Ghats crests.
    {
      id: 'base-relief-tint', type: 'color-relief', source: 'dem',
      paint: {
        'color-relief-color': ['interpolate', ['linear'], ['elevation'],
          300, 'rgba(243,238,228,0)', 600, 'rgba(236,228,210,0.35)', 900, 'rgba(222,208,178,0.6)', 1200, 'rgba(205,186,148,0.75)', 1600, 'rgba(190,168,128,0.85)'],
        'color-relief-opacity': 0.9,
      },
    },
    { id: 'base-landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('wood', 'forest'), paint: { 'fill-color': C.wood, 'fill-opacity': 0.85 } },
    { id: 'base-landcover-grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('grass', 'scrub', 'wetland'), paint: { 'fill-color': C.grass, 'fill-opacity': 0.7 } },
    { id: 'base-landcover-farm', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('farmland'), paint: { 'fill-color': C.farm, 'fill-opacity': 0.75 } },
    { id: 'base-landcover-farm-texture', type: 'fill', source: 'omt', 'source-layer': 'landcover', minzoom: 12, filter: cls('farmland'), paint: { 'fill-pattern': 'pattern-dots', 'fill-opacity': 0.5 } },
    { id: 'base-landuse-residential', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: cls('residential', 'suburb', 'neighbourhood'), paint: { 'fill-color': C.residential, 'fill-opacity': w(10, 0.5, 14, 1) } },
    { id: 'base-landuse-other', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: cls('industrial', 'commercial', 'retail', 'railway', 'military', 'hospital', 'school', 'university', 'college'), paint: { 'fill-color': C.industrial } },
    { id: 'base-park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': C.park } },
    { id: 'base-park-texture', type: 'fill', source: 'omt', 'source-layer': 'park', minzoom: 13, paint: { 'fill-pattern': 'pattern-hatch', 'fill-opacity': 0.55 } },
    // Swiss-style relief: several light sources so ridges read as sculpted, not flat-lit.
    {
      id: 'base-hillshade', type: 'hillshade', source: 'dem',
      paint: {
        'hillshade-method': 'multidirectional',
        'hillshade-illumination-direction': [315, 270, 0, 45],
        'hillshade-illumination-altitude': [45, 40, 40, 30],
        'hillshade-highlight-color': ['rgba(255,252,244,0.5)', 'rgba(255,250,240,0.3)', 'rgba(255,250,240,0.25)', 'rgba(255,250,240,0.2)'],
        'hillshade-shadow-color': ['rgba(92,70,44,0.45)', 'rgba(92,70,44,0.28)', 'rgba(70,62,84,0.22)', 'rgba(70,62,84,0.16)'],
        'hillshade-exaggeration': 0.8,
      },
    },
    { id: 'base-water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': C.water } },
    { id: 'base-water-shore', type: 'line', source: 'omt', 'source-layer': 'water', minzoom: 10, paint: { 'line-color': C.shore, 'line-width': w(10, 0.4, 16, 1.1), 'line-opacity': 0.8 } },
    waterLine(1), waterLine(2), waterLine(3),
    {
      id: 'base-waterway', type: 'line', source: 'omt', 'source-layer': 'waterway',
      layout: ROAD_LAYOUT,
      paint: { 'line-color': C.waterway, 'line-width': w(9, byClass('river', 1, 0.3), 16, byClass('river', 6, 2)) },
    },
    { id: 'base-aeroway', type: 'line', source: 'omt', 'source-layer': 'aeroway', filter: cls('runway', 'taxiway'), paint: { 'line-color': '#e2dbcf', 'line-width': w(11, 1, 16, 20) } },

    // ----- roads: all casings first, then fills, so junctions merge cleanly -----
    { id: 'base-road-minor-casing', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13.5, filter: MINOR, layout: ROAD_LAYOUT, paint: { 'line-color': C.casing, 'line-width': minorW, 'line-opacity': w(13.5, 0, 14.5, 1) } },
    { id: 'base-road-secondary-casing', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11, filter: SECONDARY, layout: ROAD_LAYOUT, paint: { 'line-color': C.casing, 'line-width': w(9, 0.6, 18, 18) } },
    { id: 'base-road-primary-casing', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9, filter: PRIMARY, layout: ROAD_LAYOUT, paint: { 'line-color': C.primaryCasing, 'line-width': primaryW } },
    { id: 'base-road-highway-casing', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: HIGHWAY, layout: ROAD_LAYOUT, paint: { 'line-color': C.highwayCasing, 'line-width': highwayW } },
    {
      id: 'base-road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: MINOR, layout: ROAD_LAYOUT,
      paint: { 'line-color': C.road, 'line-width': w(12, byClass('minor', 0.4, 0.2), 18, byClass('minor', 10, 4.5)) },
    },
    { id: 'base-road-secondary', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9, filter: SECONDARY, layout: ROAD_LAYOUT, paint: { 'line-color': C.road, 'line-width': w(9, 0.5, 11, 0.9, 18, 15) } },
    { id: 'base-road-primary', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: PRIMARY, layout: ROAD_LAYOUT, paint: { 'line-color': C.primary, 'line-width': w(7, 0.5, 9, 0.6, 18, 19) } },
    { id: 'base-road-highway', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: HIGHWAY, layout: ROAD_LAYOUT, paint: { 'line-color': C.highway, 'line-width': w(6, 0.7, 18, 22.5) } },
    // Railway: classic black-and-white dashes.
    { id: 'base-rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('rail', 'transit'), paint: { 'line-color': C.rail, 'line-width': w(9, 1, 18, 4.5) } },
    { id: 'base-rail-dash', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11, filter: cls('rail', 'transit'), paint: { 'line-color': '#fbf8f1', 'line-width': w(9, 0.4, 18, 2.6), 'line-dasharray': [3, 3] } },

    // Buildings: flat footprints with a soft offset shadow, so they rise off the page with no tilt.
    {
      id: 'base-building-shadow', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14,
      paint: { 'fill-color': 'rgba(105,84,56,0.2)', 'fill-translate': ['interpolate', ['linear'], ['zoom'], 14, ['literal', [0.4, 0.6]], 18, ['literal', [2.5, 3.5]]], 'fill-opacity': w(14, 0, 15, 1) },
    },
    {
      id: 'base-building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14,
      paint: { 'fill-color': C.building, 'fill-outline-color': C.buildingEdge, 'fill-opacity': w(14, 0, 15, 1) },
    },
    { id: 'base-boundary', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['<=', ['get', 'admin_level'], 4], paint: { 'line-color': '#b9a9c8', 'line-width': 1.2, 'line-dasharray': [5, 2, 1, 2] } },

    // ----- labels -----
    {
      id: 'base-label-water', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
      layout: { 'text-field': name, 'text-font': FONT_ITALIC, 'text-size': 12.5, 'text-letter-spacing': 0.12, 'text-max-width': 8 },
      paint: { 'text-color': C.waterLabel, 'text-halo-color': 'rgba(233,242,246,0.85)', 'text-halo-width': 1.4 },
    },
    {
      id: 'base-label-waterway', type: 'symbol', source: 'omt', 'source-layer': 'waterway', minzoom: 11,
      filter: cls('river', 'canal', 'stream'),
      layout: { 'text-field': name, 'text-font': FONT_ITALIC, 'text-size': w(11, 11, 16, 14), 'symbol-placement': 'line', 'text-letter-spacing': 0.22, 'symbol-spacing': 400 },
      paint: { 'text-color': C.waterLabel, 'text-halo-color': C.halo, 'text-halo-width': 1.6 },
    },
    {
      id: 'base-label-road', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13,
      layout: { 'text-field': name, 'text-font': FONT, 'text-size': w(13, 10, 18, 13.5), 'symbol-placement': 'line', 'text-max-angle': 28, 'text-letter-spacing': 0.03, 'symbol-spacing': 320 },
      paint: { 'text-color': C.label, 'text-halo-color': C.halo, 'text-halo-width': 1.8 },
    },
    {
      id: 'base-label-place', type: 'symbol', source: 'omt', 'source-layer': 'place',
      filter: cls('city', 'town', 'village'),
      layout: {
        'text-field': name,
        'text-font': ['match', ['get', 'class'], 'village', ['literal', FONT], ['literal', FONT_BOLD]],
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, ['match', ['get', 'class'], 'city', 13, 'town', 11, 10], 13, ['match', ['get', 'class'], 'city', 24, 'town', 15, 12]],
        'text-transform': ['match', ['get', 'class'], 'village', 'none', 'uppercase'],
        'text-letter-spacing': ['match', ['get', 'class'], 'city', 0.42, 'town', 0.2, 0.04],
      },
      paint: { 'text-color': ['match', ['get', 'class'], 'city', C.ink, 'town', '#463e34', C.labelDim], 'text-halo-color': C.halo, 'text-halo-width': 2 },
    },
  ],
};
