import type { ExpressionSpecification, FilterSpecification, Map as MLMap } from 'maplibre-gl';
import type { CityData } from '../data/city';
import type { Lang } from '../lib/i18n';
import { C } from './style';

// Marathi map labels. MapLibre has no complex-script shaping, so Devanagari drawn as map text breaks
// (नाशिक renders as "नाशकि", conjuncts split). Instead each Marathi name is drawn once by the browser,
// which shapes it correctly, and placed as an icon. Only features with a real OSM Marathi name
// (`name_mr`, set at load) get one; everything else keeps its English label.

interface LabelStyle { size: number; weight: number; color: string; anchor: 'top' | 'bottom' | 'center'; offset: [number, number]; line?: boolean }

const PLACE_TYPES = ['hospital', 'school', 'college', 'market', 'religious', 'tourism', 'government', 'landmark', 'toilets', 'railway_station', 'bus_stop', 'fort', 'peak'];
const STYLES: Record<string, Omit<LabelStyle, 'color'> & { color?: string }> = {
  ...Object.fromEntries(PLACE_TYPES.map((t) => [`${t}-label`, { size: 11.5, weight: 500, anchor: 'top', offset: [0, 10] }])),
  'park-label': { size: 11.5, weight: 500, color: '#4a7a3c', anchor: 'center', offset: [0, 0] },
  'locality-label': { size: 13, weight: 600, color: '#5a5145', anchor: 'bottom', offset: [0, -4] },
  'boundary-label': { size: 11, weight: 600, color: '#8a6db1', anchor: 'center', offset: [0, -12], line: true },
  'trail-label': { size: 11.5, weight: 500, color: '#8f3f1d', anchor: 'center', offset: [0, 12], line: true },
  'water-label-mr': { size: 12.5, weight: 500, color: C.waterLabel, anchor: 'center', offset: [0, 0], line: true },
};
// Base-map labels hidden for names we draw in Marathi ourselves (rivers are labelled from the tiles).
const BASE_WATER = ['base-label-waterway', 'base-label-water'];

const styles = new Map<string, LabelStyle>();
const original = new Map<string, { text: unknown; filter: unknown }>();
const ready = new WeakSet<MLMap>();
const FONT = '"Noto Sans Devanagari", "Nirmala UI", "Mangal", "Kohinoor Devanagari", sans-serif';
const RATIO = 2;

function drawLabel(map: MLMap, id: string) {
  const [, layer, text] = id.split('|');
  const s = styles.get(layer);
  if (!s || !text) return;
  const font = `${s.weight} ${s.size * RATIO}px ${FONT}`;
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = font;
  const pad = 4 * RATIO;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2, h = Math.ceil(s.size * 1.9 * RATIO);
  ctx.canvas.width = w; ctx.canvas.height = h;
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.strokeStyle = C.halo; ctx.lineWidth = 3.2 * RATIO; ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = s.color; ctx.fillText(text, w / 2, h / 2);
  map.addImage(id, ctx.getImageData(0, 0, w, h), { pixelRatio: RATIO });
}

const hasMr: ExpressionSpecification = ['to-boolean', ['get', 'name_mr']];

let seq = 0;

export async function applyMapLang(map: MLMap, data: CityData, lang: Lang) {
  const mine = ++seq;
  // Draw only once the Devanagari web font is in, so labels aren't rasterised in a fallback font.
  if (lang === 'mr') try { await document.fonts.load('600 16px "Noto Sans Devanagari"', 'नाशिक'); } catch { /* system font is fine */ }
  if (mine !== seq) return; // a newer switch won
  if (!ready.has(map)) {
    map.on('styleimagemissing', (e: { id: string }) => { if (e.id.startsWith('mr|')) drawLabel(map, e.id); });
    ready.add(map);
  }
  for (const [id, base] of Object.entries(STYLES)) {
    if (!map.getLayer(id)) continue;
    if (!original.has(id)) original.set(id, { text: map.getLayoutProperty(id, 'text-field'), filter: null });
    const paint = map.getPaintProperty(id, 'text-color');
    styles.set(id, { color: typeof paint === 'string' ? paint : C.ink, ...base } as LabelStyle);
    const s = styles.get(id)!;
    const text = original.get(id)!.text;
    if (lang === 'mr') {
      if (text != null) map.setLayoutProperty(id, 'text-field', ['case', hasMr, '', text] as unknown as ExpressionSpecification);
      map.setLayoutProperty(id, 'icon-image', ['case', hasMr, ['concat', 'mr|', id, '|', ['get', 'name_mr']], ''] as ExpressionSpecification);
      map.setLayoutProperty(id, 'icon-anchor', s.anchor);
      map.setLayoutProperty(id, 'icon-offset', s.offset);
      if (s.line) map.setLayoutProperty(id, 'icon-rotation-alignment', 'map');
    } else {
      if (text != null) map.setLayoutProperty(id, 'text-field', text as ExpressionSpecification);
      map.setLayoutProperty(id, 'icon-image', undefined);
    }
  }
  // English names whose Marathi label we draw; hide the base map's own label for them.
  const names = [...new Set(data.files.water.filter((e) => e.properties.name_mr && e.properties.name).flatMap((e) => [e.properties.name!, `${e.properties.name} River`]))];
  for (const id of BASE_WATER) {
    if (!map.getLayer(id)) continue;
    if (!original.has(id)) original.set(id, { text: null, filter: map.getFilter(id) ?? null });
    const orig = original.get(id)!.filter as FilterSpecification | null;
    const keep: FilterSpecification = ['!', ['in', ['coalesce', ['get', 'name:en'], ['get', 'name']], ['literal', names]]];
    map.setFilter(id, lang === 'mr' ? (orig ? ['all', orig, keep] as unknown as FilterSpecification : keep) : orig);
  }
}
