import { useMemo, useState } from 'react';
import { ago, type FeedName, type FeedState } from '../data/live';
import { fmtIST, severeWarnings, summarise, type ImdData, type WeatherEntry } from '../data/liveSummary';
import { Icon } from './Icon';
import { t } from '../lib/i18n';

interface WeatherData { run: string; points: Record<string, WeatherEntry[]> }
interface RiverData { forecast_date: string; cell: { lat: number; lon: number }; series: { date: string; discharge_m3s: number }[]; trend: 'rising' | 'falling' | 'steady' }

export type LiveFeeds = Record<FeedName, FeedState<unknown>>;

const fmt = fmtIST;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function Footer({ feed, label }: { feed: FeedState<unknown>; label: string }) {
  if (feed.state === 'missing') return null;
  return (
    <p className={`mt-1.5 text-[10.5px] ${feed.state === 'stale' ? 'font-medium text-amber-700' : 'text-muted'}`}>
      {feed.state === 'stale' ? t('Stale: last updated {ago}', { ago: ago(feed.age_min ?? 0) }) : t('{label} · updated {ago}', { label: t(label), ago: ago(feed.age_min ?? 0) })}
    </p>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3 first:border-t-0">
      <h3 className="mb-1.5 text-[10.5px] font-semibold tracking-[0.18em] text-muted uppercase">{t(title)}</h3>
      {children}
    </section>
  );
}

const NA = () => <p className="text-[13px] text-muted">{t('Not available')}</p>;

export function LivePill({ feeds, open, onToggle }: { feeds: LiveFeeds; open: boolean; onToggle: () => void }) {
  const w = feeds.weather;
  const s = useMemo(() => (w.state !== 'missing' ? summarise((w.envelope!.data as WeatherData).points.nashik ?? []) : null), [w]);
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      aria-label={t('Live Nashik weather, river and warnings')}
      className={`glass flex h-12 shrink-0 items-center gap-2 rounded-2xl px-3.5 text-[13.5px] font-medium text-fg hover:border-accent/30 ${w.state === 'stale' ? 'opacity-70' : ''}`}
    >
      <span className="relative flex size-2.5">
        {w.state === 'ok' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-40 motion-reduce:hidden" />}
        <span className={`relative inline-flex size-2.5 rounded-full ${w.state === 'ok' ? 'bg-emerald-600' : w.state === 'stale' ? 'bg-amber-500' : 'bg-ink/30'}`} />
      </span>
      {s?.current ? (
        <span className="tabular-nums">
          {Math.round(s.current.temp_c)}°C
          <span className="ml-1.5 font-normal text-muted">{s.rain24 == null ? t('no forecast') : s.rain24 >= 0.2 ? t('{mm} mm rain 24 h', { mm: s.rain24.toFixed(1) }) : t('no rain 24 h')}</span>
        </span>
      ) : <span>{t('Live Nashik')}</span>}
      {w.state === 'stale' && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide text-amber-800 uppercase">{t('Stale')}</span>}
      <Icon name="chevron" className={`size-3.5 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
    </button>
  );
}

export function LiveCard({ feeds, onClose }: { feeds: LiveFeeds; onClose: () => void }) {
  const [now] = useState(() => Date.now());
  const w = feeds.weather, r = feeds.river, imd = feeds.imd;
  const weather = w.state !== 'missing' ? summarise((w.envelope!.data as WeatherData).points.nashik ?? [], now) : null;
  const river = r.state !== 'missing' ? (r.envelope!.data as RiverData) : null;
  const imdData = imd.state !== 'missing' ? (imd.envelope!.data as ImdData) : null;
  return (
    <div className="flex max-h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
        <h2 className="font-display text-[18px] font-semibold text-fg">{t('Live Nashik')}</h2>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-ink/5 hover:text-fg" aria-label={t('Close live panel')}><Icon name="close" /></button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-1">
        <Section title="Weather · Nashik city">
          {weather?.current ? (
            <div className={w.state === 'stale' ? 'opacity-60' : ''}>
              <p className="font-display text-[30px] leading-none font-semibold tabular-nums text-fg">{Math.round(weather.current.temp_c)}°C</p>
              <p className="mt-1.5 text-[13px] text-fg/85">
                {t('Wind {v} km/h from {dir} · cloud {c}%', { v: Math.round(weather.current.wind_kmh), dir: t(COMPASS[Math.round(weather.current.wind_dir / 45) % 8]), c: weather.current.cloud_pct })}
              </p>
              <p className="text-[13px] text-fg/85">
                {weather.nextRain ? t('Next rain: {when}', { when: fmt(weather.nextRain.t, { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) }) : t('No rain expected in the forecast window')}
              </p>
              <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                {weather.days.map((d) => (
                  <div key={d.label} className="rounded-lg bg-ink/[0.04] px-2 py-1.5 text-center">
                    <p className="text-[11px] font-semibold text-muted uppercase">{d.label}</p>
                    <p className="text-[13px] tabular-nums text-fg">{Math.round(d.min)}–{Math.round(d.max)}°</p>
                    <p className="text-[11px] tabular-nums text-river">{d.rain >= 0.2 ? t('{mm} mm', { mm: d.rain.toFixed(1) }) : t('dry')}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : <NA />}
          <Footer feed={w} label="ECMWF forecast" />
        </Section>

        <Section title="River · Godavari at Nashik">
          {river && river.series.length ? (
            <div className={r.state === 'stale' ? 'opacity-60' : ''}>
              <p className="text-[13px] text-fg/85">
                <span className="font-display text-[20px] font-semibold tabular-nums text-fg">{Math.round(river.series[0].discharge_m3s).toLocaleString()} m³/s</span>{' '}
                {river.trend === 'rising' ? t('↗ rising') : river.trend === 'falling' ? t('↘ falling') : t('→ steady')} {t('over {n} days', { n: river.series.length })}
              </p>
              <p className="text-[11px] text-muted">{t('GloFAS cell, approx. ({lat}, {lon})', { lat: river.cell.lat.toFixed(3), lon: river.cell.lon.toFixed(3) })}</p>
            </div>
          ) : <NA />}
          <Footer feed={r} label="Copernicus GloFAS" />
        </Section>

        <Section title="IMD warnings · Nashik district">
          {!imdData ? <NA /> : imdData.status !== 'ok' ? (
            <p className="text-[13px] text-muted">{t('IMD feed unavailable ({s})', { s: imdData.status.replace('_', ' ') })}</p>
          ) : imdData.warnings.length ? (
            <ul className="space-y-1">
              {imdData.warnings.map((row, i) => (
                <li key={i} className="rounded-lg bg-ink/[0.04] px-2 py-1.5 text-[12.5px] text-fg/85">
                  {Object.entries(row).filter(([k]) => !/district|lat|lon|id/i.test(k)).slice(0, 4).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`).join(' · ')}
                </li>
              ))}
            </ul>
          ) : <p className="text-[13px] text-fg/85">{t('No district warnings issued.')}</p>}
          <Footer feed={imd} label="India Meteorological Department" />
        </Section>
        <p className="px-4 pb-2 text-[10.5px] leading-snug text-muted">{t('Forecasts are modelled on coarse grids (weather 0.25°, river ~5 km) and are approximate for a specific spot.')}</p>
      </div>
    </div>
  );
}

export function WarningBanner({ imd, onDismiss }: { imd: FeedState<unknown>; onDismiss: () => void }) {
  const severe = severeWarnings(imd);
  if (!severe.length) return null;
  const level = severe.some((w) => Object.values(w).some((v) => typeof v === 'string' && /\bred\b/i.test(v))) ? 'red' : 'orange';
  return (
    <div role="alert" className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2 text-[13px] font-medium text-white shadow-lg ${level === 'red' ? 'bg-rose-700' : 'bg-orange-600'}`}>
      <span className="font-semibold tracking-wide uppercase">{level === 'red' ? t('IMD red alert') : t('IMD orange alert')}</span>
      <span className="font-normal opacity-90">{t('Nashik district · see Live panel')}</span>
      <button onClick={onDismiss} className="ml-auto rounded p-0.5 hover:bg-white/15" aria-label={t('Dismiss alert')}><Icon name="close" className="size-3.5" /></button>
    </div>
  );
}
