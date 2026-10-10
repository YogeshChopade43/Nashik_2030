import { useEffect, useMemo, useState } from 'react';
import type { MultiLineString, Point } from 'geojson';
import type { CityEntity } from '../types/entity';
import type { CityData } from '../data/city';
import { displayName } from '../data/city';
import { formatDistance, length, nearby, type LngLat } from '../lib/geo';
import { climb, elevations, samplePath } from '../lib/trails';
import { LAYER_BY_TYPE, glyphOf } from '../map/layers';
import { t } from '../lib/i18n';
import { Mark } from './Icon';

const SAMPLES = 160;
const ON_TRAIL_M = 400;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-ink/[0.04] px-2 py-1.5">
      <p className="text-[10.5px] text-muted">{t(label)}</p>
      <p className="text-[14px] font-semibold tabular-nums text-fg">{value}</p>
    </div>
  );
}

function EntityList({ items, onSelect }: { items: { e: CityEntity; extra: string }[]; onSelect: (e: CityEntity) => void }) {
  return (
    <ul className="space-y-0.5 py-1">
      {items.map(({ e, extra }) => (
        <li key={e.properties.id}>
          <button onClick={() => onSelect(e)} className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-ink/[0.04]">
            <Mark glyph={glyphOf(e.properties.type)} color={LAYER_BY_TYPE[e.properties.type]?.color ?? '#8a8072'} className="size-5" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{displayName(e.properties)}</span>
            <span className="text-[11.5px] tabular-nums text-muted">{extra}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Elevation profile, distance and climb for a trail, plus the forts and peaks along it. */
export function TrailDetails({ trail, data, onSelect }: { trail: CityEntity; data: CityData; onSelect: (e: CityEntity) => void }) {
  const line = (trail.geometry as MultiLineString).coordinates[0] as LngLat[];
  const pieces = (trail.geometry as MultiLineString).coordinates.length;
  const samples = useMemo(() => samplePath(line, SAMPLES), [trail]);
  const [elev, setElev] = useState<number[] | 'error' | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    elevations(samples.map((s) => s.p)).then((e) => alive && setElev(e), () => alive && setElev('error'));
    return () => { alive = false; };
  }, [samples]);
  const along = useMemo(() => {
    const pts = [...(data.byType.fort ?? []), ...(data.byType.peak ?? [])];
    return pts
      .map((e) => ({ e, hit: nearby((e.geometry as Point).coordinates as LngLat, [trail], ON_TRAIL_M)[0] }))
      .filter((x) => x.hit)
      .map(({ e, hit }) => ({ e, extra: formatDistance(hit.distance) }));
  }, [trail, data]);

  const total = length(trail.geometry);
  const stats = Array.isArray(elev) ? climb(elev) : null;
  const W = 320, H = 110, pad = 4;
  const path = stats && Array.isArray(elev) ? (() => {
    const span = Math.max(stats.max - stats.min, 100); // flat trails stay flat
    const xy = elev.map((v, i) => [pad + (i / (elev.length - 1)) * (W - pad * 2), H - pad - ((v - stats.min) / span) * (H - pad * 2 - 14)] as const);
    return { line: xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(''), xy };
  })() : null;

  return (
    <>
      <section className="border-t border-line px-5 py-3">
        <h3 className="mb-1.5 text-[10.5px] font-semibold tracking-[0.18em] text-muted uppercase">{t('Elevation profile')}</h3>
        {elev === 'error' ? <p className="text-[13px] text-muted">{t('Elevation data could not be loaded.')}</p>
          : !path || !stats ? <div className="h-[110px] animate-pulse rounded-lg bg-ink/[0.04]" />
          : (
            <div className="relative">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none" role="img" aria-label={t('Elevation profile')}
                onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.round(((e.clientX - r.left) / r.width) * (SAMPLES - 1))); }}
                onPointerLeave={() => setHover(null)}>
                <path d={`${path.line}L${W - pad},${H - pad}L${pad},${H - pad}Z`} fill="#b4532a" opacity="0.12" />
                <path d={path.line} fill="none" stroke="#b4532a" strokeWidth="1.8" strokeLinejoin="round" />
                {hover != null && path.xy[hover] && <>
                  <line x1={path.xy[hover][0]} x2={path.xy[hover][0]} y1={pad} y2={H - pad} stroke="#2b2620" strokeOpacity="0.35" strokeDasharray="2 2" />
                  <circle cx={path.xy[hover][0]} cy={path.xy[hover][1]} r="3" fill="#b4532a" />
                </>}
              </svg>
              <p className="flex justify-between text-[11px] tabular-nums text-muted">
                <span>{hover != null && Array.isArray(elev) ? t('{d} · {m} m', { d: formatDistance(samples[hover].d), m: Math.round(elev[hover]) }) : t('{m} m', { m: stats.min })}</span>
                <span>{formatDistance(samples[samples.length - 1].d)}</span>
              </p>
            </div>
          )}
        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          <Stat label="Length" value={formatDistance(total)} />
          <Stat label="Total climb" value={stats ? t('{m} m', { m: stats.up }) : '…'} />
          <Stat label="Highest point" value={stats ? t('{m} m', { m: stats.max }) : '…'} />
        </div>
        <p className="mt-2 text-[10.5px] leading-snug text-muted">
          {t('Mapped route from OpenStreetMap. Elevation from open Terrain Tiles (~30 m DEM), approximate.')}
          {pieces > 1 && ` ${t('This route is mapped in {n} separate pieces; the profile shows the longest.', { n: pieces })}`}
        </p>
      </section>
      <section className="border-t border-line px-5 py-3">
        <h3 className="mb-1 text-[10.5px] font-semibold tracking-[0.18em] text-muted uppercase">{t('Forts & peaks on this trail')}</h3>
        {along.length ? <EntityList items={along} onSelect={onSelect} /> : <p className="py-1.5 text-[13px] text-muted">{t('None mapped within {d} of the route.', { d: formatDistance(ON_TRAIL_M) })}</p>}
      </section>
    </>
  );
}

/** Ground elevation and the mapped trails that reach a fort or peak. */
export function SummitDetails({ place, data, onSelect }: { place: CityEntity; data: CityData; onSelect: (e: CityEntity) => void }) {
  const p = (place.geometry as Point).coordinates as LngLat;
  const [ground, setGround] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    elevations([p]).then(([e]) => alive && setGround(Math.round(e)), () => {});
    return () => { alive = false; };
  }, [place]);
  const trails = useMemo(() => nearby(p, data.byType.trail ?? [], 1500).map((h) => ({ e: h.entity, extra: formatDistance(length(h.entity.geometry)) })), [place, data]);
  const ele = Number(place.properties.tags.ele);
  return (
    <>
      <section className="border-t border-line px-5 py-3">
        <h3 className="mb-1.5 text-[10.5px] font-semibold tracking-[0.18em] text-muted uppercase">{t('Height')}</h3>
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Mapped height (OSM)" value={Number.isFinite(ele) && ele > 0 ? t('{m} m', { m: Math.round(ele) }) : t('Not available')} />
          <Stat label="Ground at the marker (DEM)" value={ground != null ? t('≈ {m} m', { m: ground }) : '…'} />
        </div>
      </section>
      <section className="border-t border-line px-5 py-3">
        <h3 className="mb-1 text-[10.5px] font-semibold tracking-[0.18em] text-muted uppercase">{t('Trek trails here')}</h3>
        {trails.length ? <EntityList items={trails} onSelect={onSelect} /> : <p className="py-1.5 text-[13px] text-muted">{t('No marked trail is mapped in OpenStreetMap yet.')}</p>}
      </section>
    </>
  );
}
