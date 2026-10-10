import type { ReactNode } from 'react';
import { LAYERS, glyphOf } from '../map/layers';
import { C } from '../map/style';
import { Icon, Mark } from './Icon';
import { t } from '../lib/i18n';

const Line = ({ color, casing, width = 4, dash }: { color: string; casing?: string; width?: number; dash?: string }) => (
  <svg viewBox="0 0 36 12" className="h-3 w-9 shrink-0" aria-hidden="true">
    {casing && <line x1="2" y1="6" x2="34" y2="6" stroke={casing} strokeWidth={width + 2} strokeLinecap="round" />}
    <line x1="2" y1="6" x2="34" y2="6" stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={dash} />
  </svg>
);
const Rail = () => (
  <svg viewBox="0 0 36 12" className="h-3 w-9 shrink-0" aria-hidden="true">
    <line x1="2" y1="6" x2="34" y2="6" stroke={C.rail} strokeWidth="3.5" />
    <line x1="2" y1="6" x2="34" y2="6" stroke="#fbf8f1" strokeWidth="1.8" strokeDasharray="4 4" />
  </svg>
);
const Area = ({ fill, stroke, dash, inner }: { fill: string; stroke: string; dash?: string; inner?: boolean }) => (
  <svg viewBox="0 0 36 20" className="h-4 w-9 shrink-0" aria-hidden="true">
    <rect x="2" y="2" width="32" height="16" rx="4" fill={fill} stroke={stroke} strokeWidth="1.3" strokeDasharray={dash} />
    {inner && <rect x="5" y="5" width="26" height="10" rx="2.5" fill="none" stroke={stroke} strokeWidth="0.7" opacity="0.6" />}
  </svg>
);
const Ring = ({ color }: { color: string }) => (
  <svg viewBox="0 0 36 20" className="h-4 w-9 shrink-0" aria-hidden="true"><circle cx="18" cy="10" r="7" fill="none" stroke={color} strokeWidth="2.2" /></svg>
);

function Row({ swatch, label }: { swatch: ReactNode; label: string }) {
  return <li className="flex items-center gap-2.5 py-[5px] text-[12.5px] text-fg/85">{swatch}<span className="min-w-0 truncate">{t(label)}</span></li>;
}

export function Legend({ visible, onClose }: { visible: Record<string, boolean>; onClose: () => void }) {
  const on = (id: string) => !!visible[id];
  const places = LAYERS.filter((l) => (l.group === 'places' || l.id === 'railway_station' || l.id === 'bus_stop') && l.id !== 'park' && on(l.id));
  const sections: [string, ReactNode[]][] = [
    ['Places', [
      ...places.map((l) => <Row key={l.id} swatch={<span className="grid w-9 place-items-center"><Mark glyph={glyphOf(l.id)} color={l.color} className="size-5" /></span>} label={l.label} />),
      ...(places.length ? [<Row key="cluster" swatch={<span className="grid w-9 place-items-center"><span className="grid size-5 place-items-center rounded-full border-[1.5px] border-muted bg-[#fffdf8] text-[9px] font-bold text-muted">12</span></span>} label="Group of places (tap to expand)" />] : []),
      ...(on('park') ? [<Row key="park" swatch={<Area fill={C.park} stroke="#93b97f" />} label="Park or garden" />] : []),
    ]],
    ['Treks', [
      ...LAYERS.filter((l) => (l.id === 'fort' || l.id === 'peak') && on(l.id)).map((l) => <Row key={l.id} swatch={<span className="grid w-9 place-items-center"><Mark glyph={glyphOf(l.id)} color={l.color} className="size-5" /></span>} label={l.label} />),
      ...(on('trail') ? [<Row key="tr" swatch={<Line color="#b4532a" width={2.5} dash="4 2.8" />} label="Trek trail (marked route)" />] : []),
    ]],
    ['Roads & rail', [
      ...(on('major') ? [<Row key="hw" swatch={<Line color={C.highway} casing={C.highwayCasing} />} label="Highway" />, <Row key="pr" swatch={<Line color={C.primary} casing={C.primaryCasing} />} label="Main road" />] : []),
      ...(on('roads') ? [<Row key="st" swatch={<Line color="#ffffff" casing={C.casing} width={3} />} label="Street" />] : []),
      ...(on('rail') ? [<Row key="rl" swatch={<Rail />} label="Railway" />] : []),
    ]],
    ['Water & land', [
      ...(on('water') || on('water-named') ? [<Row key="rv" swatch={<Line color={C.waterway} width={3} />} label="River or stream" />, <Row key="wb" swatch={<Area fill={C.water} stroke={C.shore} inner />} label="Lake, reservoir or river" />] : []),
      ...(on('boundaries') ? [<Row key="tk" swatch={<Line color="#8a6db1" width={1.6} dash="5 2 1 2" />} label="Taluka boundary" />] : []),
      ...(on('buildings') ? [<Row key="bd" swatch={<Area fill={C.building} stroke={C.buildingEdge} />} label="Building" />] : []),
      ...(on('terrain') ? [<Row key="tr" swatch={<span className="h-4 w-9 shrink-0 rounded bg-gradient-to-r from-[#f3eee4] via-[#e0d1b2] to-[#c8b48e]" />} label="Terrain, low to high" />] : []),
    ]],
    ['Map tools', [
      <Row key="sel" swatch={<Ring color="#c26d12" />} label="Selected place or road" />,
      <Row key="nb" swatch={<Area fill="rgba(31,95,122,0.06)" stroke="#1f5f7a" dash="3 2" />} label="Nearby search area" />,
      <Row key="zn" swatch={<Area fill="rgba(107,98,85,0.08)" stroke="#5a5145" dash="2 1.5" />} label="Approximate locality area" />,
    ]],
  ];
  return (
    <div className="flex max-h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
        <h2 className="font-display text-[17px] font-semibold text-fg">{t('Legend')}</h2>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-ink/5 hover:text-fg" aria-label={t('Close legend')}><Icon name="close" /></button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {sections.filter(([, rows]) => rows.length).map(([title, rows]) => (
          <section key={title}>
            <h3 className="pt-2.5 pb-0.5 text-[10px] font-semibold tracking-[0.18em] text-muted uppercase">{t(title)}</h3>
            <ul>{rows}</ul>
          </section>
        ))}
        <p className="pt-2 text-[11px] text-muted/80">{t('Only layers currently shown are listed.')}</p>
      </div>
    </div>
  );
}
