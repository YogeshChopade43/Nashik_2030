import { useMemo, useState } from 'react';
import type { CityEntity, EntityType } from '../types/entity';
import { TYPE_LABEL, type CityData } from '../data/city';
import { bearing, compass, formatDistance, nearby, type LngLat } from '../lib/geo';
import { LAYER_BY_TYPE, glyphOf } from '../map/layers';
import { Icon, Mark } from './Icon';

export interface NearbyOrigin {
  point: LngLat;
  label: string;
  /** Entity the search starts from (excluded from results). */
  fromId?: string;
}

export const RADII = [500, 1000, 2000, 5000];

const CATEGORIES: { id: string; label: string; types: EntityType[] }[] = [
  { id: 'all', label: 'All', types: ['hospital', 'college', 'school', 'bus_stop', 'railway_station', 'market', 'religious', 'tourism', 'government', 'park'] },
  { id: 'hospital', label: 'Hospitals', types: ['hospital'] },
  { id: 'college', label: 'Colleges', types: ['college'] },
  { id: 'school', label: 'Schools', types: ['school'] },
  { id: 'transit', label: 'Transit', types: ['bus_stop', 'railway_station'] },
  { id: 'market', label: 'Markets', types: ['market'] },
  { id: 'religious', label: 'Religious', types: ['religious'] },
  { id: 'tourism', label: 'Tourism', types: ['tourism'] },
  { id: 'government', label: 'Government', types: ['government'] },
  { id: 'park', label: 'Parks', types: ['park'] },
];

const LIMIT = 60;

export function Nearby({ origin, radius, onRadius, data, onSelect, onClose }: {
  origin: NearbyOrigin;
  radius: number;
  onRadius: (r: number) => void;
  data: CityData;
  onSelect: (e: CityEntity) => void;
  onClose: () => void;
}) {
  const [cat, setCat] = useState('all');
  const all = useMemo(() => nearby(origin.point, data.all, radius, { types: CATEGORIES[0].types, exclude: origin.fromId }), [origin, data, radius]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const k of CATEGORIES) c[k.id] = k.id === 'all' ? all.length : all.filter((h) => k.types.includes(h.entity.properties.type)).length;
    return c;
  }, [all]);
  const types = CATEGORIES.find((c) => c.id === cat)!.types;
  const hits = all.filter((h) => types.includes(h.entity.properties.type));

  return (
    <div className="flex max-h-full min-h-0 flex-col">
      <header className="px-5 pt-5 pb-3">
        <div className="flex items-start gap-3.5">
          <Mark glyph="M10 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0M6 12a6 6 0 1 0 12 0 6 6 0 1 0-12 0M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5" color="#1f5f7a" className="mt-0.5 size-11" />
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[10.5px] font-semibold tracking-[0.18em] text-accent uppercase">Nearby <span className="font-medium tracking-normal normal-case text-muted">· drag the circle to adjust</span></p>
            <h2 className="font-display text-[23px] leading-[1.15] font-semibold tracking-[-0.01em] text-balance text-fg">{origin.label}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-ink/5 hover:text-fg" aria-label="Close nearby"><Icon name="close" /></button>
        </div>

        <div className="mt-4 flex items-center gap-1 rounded-xl bg-ink/[0.05] p-1" role="radiogroup" aria-label="Search radius">
          {(RADII.includes(radius) ? RADII : [...RADII, radius].sort((x, y) => x - y)).map((r) => (
            <button
              key={r}
              role="radio"
              aria-checked={r === radius}
              onClick={() => onRadius(r)}
              className={`flex-1 rounded-lg py-1.5 text-[12.5px] font-medium tabular-nums transition ${r === radius ? 'bg-[#fffdf8] text-fg shadow-[0_1px_2px_rgb(60_40_20/0.15)]' : 'text-muted hover:text-fg'}`}
            >
              {formatDistance(r)}
            </button>
          ))}
        </div>

        <div className="no-scrollbar -mx-5 mt-3 flex gap-1.5 overflow-x-auto px-5 pb-1" role="tablist" aria-label="Category">
          {CATEGORIES.map((c) => {
            const active = c.id === cat;
            const n = counts[c.id];
            return (
              <button
                key={c.id}
                role="tab"
                aria-selected={active}
                disabled={!n && !active}
                onClick={() => setCat(c.id)}
                className={`shrink-0 rounded-full border px-3 py-1 text-[12.5px] transition disabled:opacity-40 ${active ? 'border-accent bg-accent text-white' : 'border-line bg-[#fffdf8] text-fg/80 hover:border-accent/30'}`}
              >
                {c.label} <span className={`tabular-nums ${active ? 'text-white/75' : 'text-muted'}`}>{n}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto border-t border-line px-3 py-2">
        {hits.length ? (
          <ul>
            {hits.slice(0, LIMIT).map((h) => {
              const p = h.entity.properties;
              const color = LAYER_BY_TYPE[p.type]?.color ?? '#8a8072';
              return (
                <li key={p.id}>
                  <button onClick={() => onSelect(h.entity)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none">
                    <Mark glyph={glyphOf(p.type)} color={color} className="size-8" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-fg">{p.name ?? `Unnamed ${TYPE_LABEL[p.type].toLowerCase()}`}</span>
                      <span className="block truncate text-[12px] text-muted">{TYPE_LABEL[p.type]}{p.category && p.category !== p.type ? ` · ${p.category.replace(/_/g, ' ')}` : ''}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[13px] font-medium tabular-nums text-fg">{formatDistance(h.distance)}</span>
                      <span className="block text-[11px] tracking-wide text-muted">{h.distance < 15 ? 'here' : compass(bearing(origin.point, h.point))}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-2 py-6 text-center text-[13px] text-muted">
            No mapped {cat === 'all' ? 'public places' : CATEGORIES.find((c) => c.id === cat)!.label.toLowerCase()} within {formatDistance(radius)}.
            {radius < RADII[RADII.length - 1] && <button onClick={() => onRadius(RADII[RADII.indexOf(radius) + 1])} className="ml-1 text-accent hover:underline">Widen to {formatDistance(RADII[RADII.indexOf(radius) + 1])}</button>}
          </p>
        )}
        {hits.length > LIMIT && <p className="px-2 py-2 text-center text-[12px] text-muted">Showing nearest {LIMIT} of {hits.length}. Narrow the radius or pick a category.</p>}
        <p className="px-2 pt-2 pb-1 text-[11px] text-muted/80">Straight-line distances from OpenStreetMap data, not travel routes.</p>
      </div>
    </div>
  );
}
