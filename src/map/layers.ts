import type { ExpressionSpecification, Map as MLMap } from 'maplibre-gl';
import type { CityData } from '../data/city';
import type { EntityType } from '../types/entity';
import { GLYPHS, markerId } from './icons';
import { C } from './style';

/**
 * A toggleable map layer. Two flavours share one contract:
 *  - basemap-backed: only `styleLayers` (ids already in the style)
 *  - data overlays: `install()` adds their own sources + style layers
 *
 * Sprint 2 intelligence layers (traffic, civic issues, weather, AQI, flood risk, Kumbh…)
 * register here with e.g. `group: 'intelligence'` and an `install()` that adds a GeoJSON,
 * vector-tile or live source. Panel, toggling, persistence and click inspection pick them up
 * automatically — no frontend rewrite needed.
 */
export interface MapLayerDef {
  id: string;
  group: string;
  label: string;
  color: string;
  defaultVisible: boolean;
  /** Style layer ids whose visibility this toggle controls. */
  styleLayers: string[];
  /** Style layers whose features open the inspector on click. */
  interactive?: string[];
  /** Entity types backing the layer (for counts in the panel). */
  types?: EntityType[];
  install?(map: MLMap, data: CityData): void;
  /** Set when the layer cannot be shown honestly (no open data). */
  unavailable?: string;
}

export const GROUPS: { id: string; label: string }[] = [
  { id: 'places', label: 'Places' },
  { id: 'transport', label: 'Transport' },
  { id: 'geography', label: 'Geography' },
  { id: 'outdoors', label: 'Treks & forts' },
  { id: 'base', label: 'Base map' },
];

// Zoom interpolation must be the outermost expression; data/hover expressions go in the stop values.
const w = (...stops: unknown[]) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops] as ExpressionSpecification;
const hover = (on: unknown, off: unknown) => ['case', ['boolean', ['feature-state', 'hover'], false], on, off] as ExpressionSpecification;
const fc = (features: CityData['all']) => ({ type: 'FeatureCollection' as const, features });
const LABEL_FONT = ['Noto Sans Regular'];
const FADE = { duration: 150 };

/** Clustered layer for one place type: paper clusters → atlas icon markers → labels. */
function placeLayer(type: EntityType, label: string, color: string, defaultVisible: boolean, group = 'places', types: EntityType[] = [type]): MapLayerDef {
  const src = `src-${type}`;
  const ids = { shadow: `${type}-cluster-shadow`, cluster: `${type}-cluster`, count: `${type}-cluster-count`, halo: `${type}-halo`, point: `${type}-point`, label: `${type}-label` };
  return {
    id: type, group, label, color, defaultVisible, types,
    styleLayers: Object.values(ids),
    interactive: [ids.point, ids.label, ids.cluster],
    install(map, data) {
      map.addSource(src, { type: 'geojson', data: fc(types.flatMap((t) => data.byType[t] ?? [])), cluster: true, clusterMaxZoom: 14, clusterRadius: 44, promoteId: 'id' });
      const clustered: ExpressionSpecification = ['has', 'point_count'];
      const radius: ExpressionSpecification = ['step', ['get', 'point_count'], 11, 10, 13.5, 40, 16.5];
      map.addLayer({
        id: ids.shadow, type: 'circle', source: src, filter: clustered,
        paint: { 'circle-color': 'rgba(70,50,25,0.22)', 'circle-radius': ['+', radius, 1.5], 'circle-blur': 0.7, 'circle-translate': [0, 1.5] },
      });
      map.addLayer({
        id: ids.cluster, type: 'circle', source: src, filter: clustered,
        paint: { 'circle-color': C.paper, 'circle-radius': radius, 'circle-stroke-color': color, 'circle-stroke-width': hover(2.6, 1.6) },
      });
      map.addLayer({
        id: ids.count, type: 'symbol', source: src, filter: clustered,
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-allow-overlap': true },
        paint: { 'text-color': color },
      });
      map.addLayer({
        id: ids.halo, type: 'circle', source: src, filter: ['!', clustered],
        paint: { 'circle-color': color, 'circle-radius': w(11, 9, 17, 19), 'circle-blur': 0.6, 'circle-opacity': hover(0.28, 0), 'circle-opacity-transition': FADE },
      });
      map.addLayer({
        id: ids.point, type: 'symbol', source: src, filter: ['!', clustered],
        layout: { 'icon-image': types.length > 1 ? ['concat', 'marker-', ['get', 'type'], '-', color.slice(1).toLowerCase()] : markerId(type, color), 'icon-size': w(11, 0.55, 15, 0.8, 17, 1), 'icon-allow-overlap': true },
      });
      map.addLayer({
        id: ids.label, type: 'symbol', source: src, filter: ['!', clustered], minzoom: 14.5,
        layout: {
          'text-field': ['get', 'name'], 'text-font': LABEL_FONT, 'text-size': 11, 'text-anchor': 'top',
          'text-offset': [0, 1.15], 'text-max-width': 9, 'text-optional': true,
        },
        paint: { 'text-color': color, 'text-halo-color': C.halo, 'text-halo-width': 1.6 },
      });
    },
  };
}

// Category colours: saturated enough to read on paper, muted enough to sit calmly together.
export const LAYERS: MapLayerDef[] = [
  // ---------- treks (installed first, so trail lines sit beneath the city's markers) ----------
  {
    id: 'trail', group: 'outdoors', label: 'Trek trails', color: '#b4532a', defaultVisible: true, types: ['trail'],
    styleLayers: ['trail-casing', 'trail-line', 'trail-hit', 'trail-label'],
    interactive: ['trail-hit', 'trail-label'],
    install(map, data) {
      map.addSource('src-trail', { type: 'geojson', data: fc(data.byType.trail ?? []), promoteId: 'id' });
      map.addLayer({ id: 'trail-casing', type: 'line', source: 'src-trail', minzoom: 9, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.halo, 'line-width': w(9, 2.5, 16, 7), 'line-opacity': 0.85 } });
      map.addLayer({
        id: 'trail-line', type: 'line', source: 'src-trail', minzoom: 9, layout: { 'line-join': 'round' },
        paint: { 'line-color': '#b4532a', 'line-width': w(9, hover(2.4, 1.3), 16, hover(5, 3)), 'line-dasharray': [2, 1.4] },
      });
      map.addLayer({ id: 'trail-hit', type: 'line', source: 'src-trail', minzoom: 9, paint: { 'line-color': '#000', 'line-width': 14, 'line-opacity': 0 } });
      map.addLayer({
        id: 'trail-label', type: 'symbol', source: 'src-trail', minzoom: 12,
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 500, 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'], 'text-size': 11, 'text-offset': [0, 0.9] },
        paint: { 'text-color': '#8f3f1d', 'text-halo-color': C.halo, 'text-halo-width': 1.6 },
      });
    },
  },
  placeLayer('fort', 'Forts', '#8a4b2a', true, 'outdoors'),
  placeLayer('peak', 'Peaks', '#6d5f4b', false, 'outdoors'),

  // ---------- places ----------
  placeLayer('hospital', 'Hospitals', '#cf3f57', true),
  placeLayer('school', 'Schools', '#c27c0e', false),
  placeLayer('college', 'Colleges & universities', '#7356bd', true),
  placeLayer('market', 'Markets & malls', '#bb4580', false),
  {
    id: 'park', group: 'places', label: 'Parks & gardens', color: '#4b8f55', defaultVisible: true, types: ['park'],
    styleLayers: ['base-park', 'base-park-texture', 'park-fill', 'park-line', 'park-label'],
    interactive: ['park-fill'],
    install(map, data) {
      map.addSource('src-park', { type: 'geojson', data: fc(data.files.parks), promoteId: 'id' });
      map.addLayer({ id: 'park-fill', type: 'fill', source: 'src-park', paint: { 'fill-color': '#9cc489', 'fill-opacity': hover(0.45, 0), 'fill-opacity-transition': FADE } }, 'base-hillshade');
      map.addLayer({ id: 'park-line', type: 'line', source: 'src-park', minzoom: 13, paint: { 'line-color': '#93b97f', 'line-width': 0.8 } }, 'base-hillshade');
      map.addLayer({
        id: 'park-label', type: 'symbol', source: 'src-park', minzoom: 15,
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'], 'text-size': 11, 'text-max-width': 8, 'text-letter-spacing': 0.04 },
        paint: { 'text-color': '#4a7a3c', 'text-halo-color': C.halo, 'text-halo-width': 1.4 },
      });
    },
  },
  placeLayer('religious', 'Religious places', '#c96a1c', false),
  placeLayer('tourism', 'Tourist places & heritage', '#0d8495', true),
  placeLayer('government', 'Government facilities', '#3a6cb3', false),
  placeLayer('landmark', 'Local landmarks', '#8a5a2b', false),
  placeLayer('toilets', 'Toilets & drinking water', '#2a7fb8', false, 'places', ['toilets', 'drinking_water']),

  // ---------- transport ----------
  {
    id: 'roads', group: 'transport', label: 'Streets & roads', color: '#8f8576', defaultVisible: true, types: ['road_segment'],
    styleLayers: ['base-road-minor-casing', 'base-road-secondary-casing', 'base-road-minor', 'base-road-secondary', 'roads-hover', 'roads-hit', 'base-label-road'],
    interactive: ['roads-hit'],
    install(map, data) {
      map.addSource('src-roads', { type: 'geojson', data: fc(data.files.roads), promoteId: 'id' });
      map.addLayer({
        id: 'roads-hover', type: 'line', source: 'src-roads', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#1f5f7a', 'line-width': w(10, 3, 18, 20), 'line-opacity': hover(0.22, 0), 'line-opacity-transition': FADE },
      }, 'base-rail');
      map.addLayer({ id: 'roads-hit', type: 'line', source: 'src-roads', paint: { 'line-color': '#000', 'line-width': w(10, 8, 18, 24), 'line-opacity': 0 } }, 'base-rail');
    },
  },
  { id: 'major', group: 'transport', label: 'Highways & major roads', color: '#d0814d', defaultVisible: true, styleLayers: ['base-road-primary-casing', 'base-road-highway-casing', 'base-road-primary', 'base-road-highway'] },
  { id: 'rail', group: 'transport', label: 'Railway lines', color: '#6f685e', defaultVisible: true, styleLayers: ['base-rail', 'base-rail-dash'] },
  placeLayer('railway_station', 'Railway stations', '#3b3f4a', true, 'transport'),
  placeLayer('bus_stop', 'Bus stops & stations', '#118a78', false, 'transport'),

  // ---------- geography ----------
  {
    id: 'localities', group: 'geography', label: 'Localities & villages', color: '#6b6255', defaultVisible: true, types: ['locality', 'city'],
    styleLayers: ['locality-dot', 'locality-label'],
    interactive: ['locality-label', 'locality-dot'],
    install(map, data) {
      map.addSource('src-localities', { type: 'geojson', data: fc(data.files.localities), promoteId: 'id' });
      const major: ExpressionSpecification = ['match', ['get', 'category'], ['city', 'town', 'suburb'], true, false];
      const notCity: ExpressionSpecification = ['!=', ['get', 'type'], 'city'];
      map.addLayer({ id: 'locality-dot', type: 'circle', source: 'src-localities', minzoom: 12, filter: notCity, paint: { 'circle-radius': 1.8, 'circle-color': C.labelDim, 'circle-stroke-color': C.halo, 'circle-stroke-width': 1 } });
      map.addLayer({
        id: 'locality-label', type: 'symbol', source: 'src-localities', filter: notCity, minzoom: 10,
        layout: {
          'text-field': ['get', 'name'], 'text-font': ['case', major, ['literal', ['Noto Sans Bold']], ['literal', LABEL_FONT]],
          'text-size': w(10, ['case', major, 10.5, 9.5], 15, ['case', major, 13.5, 11.5]),
          'text-transform': 'uppercase', 'text-letter-spacing': ['case', major, 0.2, 0.14],
          'text-variable-anchor': ['bottom', 'top', 'left', 'right'], 'text-radial-offset': 0.45, 'text-max-width': 8,
        },
        paint: { 'text-color': hover(C.ink, ['case', major, '#5a5145', '#8a8072']), 'text-halo-color': C.halo, 'text-halo-width': 1.8 },
      });
    },
  },
  {
    id: 'water-named', group: 'geography', label: 'Rivers & water bodies', color: '#3f86b0', defaultVisible: true, types: ['river', 'water_body'],
    styleLayers: ['water-body-fill', 'water-river-line', 'water-river-hit', 'water-label-mr'],
    interactive: ['water-river-hit', 'water-body-fill'],
    install(map, data) {
      map.addSource('src-water', { type: 'geojson', data: fc(data.files.water), promoteId: 'id' });
      const isLine: ExpressionSpecification = ['==', ['get', 'type'], 'river'];
      map.addLayer({ id: 'water-body-fill', type: 'fill', source: 'src-water', filter: ['!', isLine], paint: { 'fill-color': '#5f9fc4', 'fill-opacity': hover(0.3, 0), 'fill-opacity-transition': FADE } }, 'base-waterway');
      map.addLayer({
        id: 'water-river-line', type: 'line', source: 'src-water', filter: isLine, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#6fa6c5', 'line-width': w(9, hover(2.2, 0.9), 16, hover(8, 4)), 'line-opacity': hover(1, 0.75) },
      }, 'base-road-minor-casing');
      map.addLayer({ id: 'water-river-hit', type: 'line', source: 'src-water', filter: isLine, paint: { 'line-color': '#000', 'line-width': 14, 'line-opacity': 0 } }, 'base-road-minor-casing');
      // Marathi river names (drawn only in Marathi mode, see map/lang.ts).
      map.addLayer({ id: 'water-label-mr', type: 'symbol', source: 'src-water', filter: ['all', isLine, ['has', 'name_mr']], layout: { 'symbol-placement': 'line', 'symbol-spacing': 420 } });
    },
  },
  {
    id: 'boundaries', group: 'geography', label: 'Talukas (sub-districts)', color: '#8a6db1', defaultVisible: true, types: ['admin_boundary'],
    styleLayers: ['boundary-casing', 'boundary-line', 'boundary-label'],
    interactive: ['boundary-line', 'boundary-label'],
    install(map, data) {
      map.addSource('src-boundaries', { type: 'geojson', data: fc(data.files.boundaries), promoteId: 'id' });
      // Soft lilac band under a fine dash-dot line: the classic atlas boundary.
      map.addLayer({ id: 'boundary-casing', type: 'line', source: 'src-boundaries', paint: { 'line-color': '#b8a5d6', 'line-width': w(8, 3, 14, 7), 'line-opacity': 0.28 } }, 'base-label-water');
      map.addLayer({ id: 'boundary-line', type: 'line', source: 'src-boundaries', paint: { 'line-color': '#8a6db1', 'line-width': hover(2, 1.1), 'line-dasharray': [5, 2, 1, 2] } }, 'base-label-water');
      map.addLayer({
        id: 'boundary-label', type: 'symbol', source: 'src-boundaries',
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 700, 'text-field': ['upcase', ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': 9.5, 'text-letter-spacing': 0.32, 'text-offset': [0, -1] },
        paint: { 'text-color': '#8a6db1', 'text-halo-color': C.halo, 'text-halo-width': 1.6 },
      });
    },
  },
  { id: 'wards', group: 'geography', label: 'Municipal wards', color: '#9a9183', defaultVisible: false, styleLayers: [], unavailable: 'No openly licensed NMC ward boundaries exist (not in OSM or DataMeet). Not fabricated.' },

  // ---------- base ----------
  { id: 'terrain', group: 'base', label: 'Terrain relief', color: '#a08f73', defaultVisible: true, styleLayers: ['base-hillshade', 'base-relief-tint'] },
  { id: 'water', group: 'base', label: 'Water', color: C.waterway, defaultVisible: true, styleLayers: ['base-water', 'base-water-shore', 'base-water-line-1', 'base-water-line-2', 'base-water-line-3', 'base-waterway', 'base-label-water', 'base-label-waterway'] },
  { id: 'buildings', group: 'base', label: 'Buildings', color: '#c2b294', defaultVisible: true, styleLayers: ['base-building-shadow', 'base-building'] },
  { id: 'landuse', group: 'base', label: 'Land use & cover', color: '#a8b98a', defaultVisible: true, styleLayers: ['base-landcover-wood', 'base-landcover-grass', 'base-landcover-farm', 'base-landcover-farm-texture', 'base-landuse-residential', 'base-landuse-other'] },
  { id: 'labels', group: 'base', label: 'City & town labels', color: C.ink, defaultVisible: true, styleLayers: ['base-label-place'] },
];

export const LAYER_BY_TYPE = Object.fromEntries(LAYERS.flatMap((l) => (l.types ?? []).map((t) => [t, l]))) as Partial<Record<EntityType, MapLayerDef>>;

/** Glyph for an entity type or layer id (entity types fall back to their layer's glyph). */
export const glyphOf = (key: string): string | undefined =>
  (GLYPHS as Record<string, string>)[key] ?? (GLYPHS as Record<string, string>)[LAYER_BY_TYPE[key as EntityType]?.id ?? ''];

// Opacity paint properties per layer type, animated on toggle. Hillshade has none and switches instantly.
const OPACITY: Record<string, string[]> = {
  fill: ['fill-opacity'], line: ['line-opacity'], circle: ['circle-opacity', 'circle-stroke-opacity'],
  symbol: ['icon-opacity', 'text-opacity'], raster: ['raster-opacity'], 'color-relief': ['color-relief-opacity'],
};
const FADE_MS = 260;
const original = new Map<string, Record<string, unknown>>();
const hideTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Shows/hides a layer's style layers with a short opacity fade (MapLibre paint transitions). */
export function setLayerVisibility(map: MLMap, def: MapLayerDef, visible: boolean) {
  for (const id of def.styleLayers) {
    const layer = map.getLayer(id);
    if (!layer) continue;
    const props = OPACITY[layer.type] ?? [];
    if (!original.has(id)) original.set(id, Object.fromEntries(props.map((p) => [p, map.getPaintProperty(id, p) ?? 1])));
    const orig = original.get(id)!;
    const shown = map.getLayoutProperty(id, 'visibility') !== 'none';
    clearTimeout(hideTimers.get(id));
    if (visible) {
      if (!shown) {
        props.forEach((p) => map.setPaintProperty(id, p, 0));
        map.setLayoutProperty(id, 'visibility', 'visible');
      }
      // Next frame, so the 0 → original change is rendered as a transition.
      requestAnimationFrame(() => map.getLayer(id) && props.forEach((p) => map.setPaintProperty(id, p, orig[p])));
    } else if (shown) {
      if (!props.length) { map.setLayoutProperty(id, 'visibility', 'none'); continue; }
      props.forEach((p) => map.setPaintProperty(id, p, 0));
      hideTimers.set(id, setTimeout(() => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', 'none'), FADE_MS));
    }
  }
}
