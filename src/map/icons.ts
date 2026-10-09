import type { Map as MLMap } from 'maplibre-gl';
import type { EntityType } from '../types/entity';

/**
 * Category glyphs on a 24×24 grid (stroke-drawn). One source of truth: rasterised into map
 * marker images here, and rendered as inline SVG in the UI (search, layer list, inspector).
 * For MapLibre Native the same drawing can be exported once into a sprite sheet.
 */
export const GLYPHS: Partial<Record<EntityType | 'roads' | 'major' | 'rail' | 'localities' | 'water-named' | 'boundaries', string>> = {
  hospital: 'M12 6.5v11M6.5 12h11',
  school: 'M4 6.5c2.5-1 5.5-1 8 .8 2.5-1.8 5.5-1.8 8-.8V18c-2.5-1-5.5-1-8 .8-2.5-1.8-5.5-1.8-8-.8zM12 7.3v11.5',
  college: 'M2.5 9.5 12 5l9.5 4.5L12 14zM6.5 11.6v4.2c3.2 2.2 7.8 2.2 11 0v-4.2M21 9.8v5',
  market: 'M5.5 8.5h13l-1.2 11h-10.6zM9 8.5a3 3 0 0 1 6 0',
  park: 'M12 3.5 6.5 12h3L6 17h12l-3.5-5h3zM12 17v3.5',
  religious: 'M12 3v2.5M8 10.5a4 4 0 0 1 8 0M6 10.5h12M7 10.5V20h10v-9.5M10.5 20v-4h3v4',
  tourism: 'M12 4.2l2.3 4.8 5.2.7-3.8 3.6.9 5.2L12 16l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z',
  government: 'M4 9.5 12 5l8 4.5M5 19.5h14M7 11.5v6M12 11.5v6M17 11.5v6',
  railway_station: 'M7.5 4h9a2.5 2.5 0 0 1 2.5 2.5V14a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6.5A2.5 2.5 0 0 1 7.5 4zM5 10.5h14M8.5 20.5l2-3.5M15.5 20.5l-2-3.5',
  bus_stop: 'M6.5 4.5h11a1.5 1.5 0 0 1 1.5 1.5v10.5H5V6a1.5 1.5 0 0 1 1.5-1.5zM5 11h14M7.5 19.5v-3M16.5 19.5v-3',
  landmark: 'M6 21V4M6 4.5h11l-2.5 3.5L17 11.5H6',
  toilets: 'M8 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM16 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM8 9v11M6 9h4v5H6zM16 9l-2.5 6h5L16 9zM16 15v5M12 3v18',
  drinking_water: 'M12 3.5s-5.5 6.3-5.5 10.2a5.5 5.5 0 0 0 11 0C17.5 9.8 12 3.5 12 3.5z',
  roads: 'M8 3 5 21M16 3l3 18M12 4v3M12 10.5v3M12 17v3',
  major: 'M4 20 10 4M20 20 14 4M12 17.5v2.5M12 11v3',
  rail: 'M8 3v18M16 3v18M8 7h8M8 12h8M8 17h8',
  localities: 'M12 21s6.5-5.8 6.5-11.3a6.5 6.5 0 0 0-13 0C5.5 15.2 12 21 12 21zM12 7.5a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z',
  'water-named': 'M3 9c3-2 6 2 9 0s6-2 9 0M3 15c3-2 6 2 9 0s6-2 9 0',
  boundaries: 'M4 6h3M10 6h4M17 6h3v3M20 12v4M20 19v1h-3M14 20h-4M7 20H4v-3M4 14v-4',
};

const PX = 2; // render at 2× for crisp markers on high-DPI screens

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size * PX;
  const ctx = c.getContext('2d')!;
  ctx.scale(PX, PX);
  return { c, ctx };
}

/** Atlas marker: paper disc with soft drop shadow, coloured ring, coloured glyph. */
function markerImage(glyph: string, color: string) {
  const size = 34, r = 12.5, cx = size / 2, cy = size / 2 - 1;
  const { ctx } = canvas(size);
  ctx.shadowColor = 'rgba(70, 50, 25, 0.28)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fffdf8'; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.8; ctx.strokeStyle = color; ctx.stroke();
  const s = 0.62;
  ctx.translate(cx - 12 * s, cy - 12 * s); ctx.scale(s, s);
  ctx.lineWidth = 2.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color;
  ctx.stroke(new Path2D(glyph));
  return ctx.getImageData(0, 0, size * PX, size * PX);
}

function patternImage(kind: 'hatch' | 'dots') {
  const size = kind === 'hatch' ? 8 : 10;
  const { ctx } = canvas(size);
  if (kind === 'hatch') {
    ctx.strokeStyle = 'rgba(86, 128, 70, 0.32)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(0, size); ctx.lineTo(size, 0); ctx.moveTo(-2, 2); ctx.lineTo(2, -2); ctx.moveTo(size - 2, size + 2); ctx.lineTo(size + 2, size - 2); ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(150, 135, 85, 0.35)';
    for (const [x, y] of [[2.5, 2.5], [7.5, 7.5]]) { ctx.beginPath(); ctx.arc(x, y, 0.7, 0, Math.PI * 2); ctx.fill(); }
  }
  return ctx.getImageData(0, 0, size * PX, size * PX);
}

/** Lazily supplies every runtime image the style asks for (`marker-<type>-<hex>`, `pattern-*`). */
export function registerImages(map: MLMap) {
  map.on('styleimagemissing', ({ id }) => {
    if (map.hasImage(id)) return;
    const m = /^marker-(.+)-([0-9a-f]{6})$/.exec(id);
    if (m && GLYPHS[m[1] as EntityType]) return map.addImage(id, markerImage(GLYPHS[m[1] as EntityType]!, `#${m[2]}`), { pixelRatio: PX });
    if (id === 'pattern-hatch' || id === 'pattern-dots') map.addImage(id, patternImage(id === 'pattern-hatch' ? 'hatch' : 'dots'), { pixelRatio: PX });
  });
}

export const markerId = (type: string, color: string) => `marker-${type}-${color.replace('#', '').toLowerCase()}`;
