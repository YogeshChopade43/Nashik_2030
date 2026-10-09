// Pure summaries of live feeds for the UI (kept out of the component so they can be unit-tested).
import type { FeedState } from './live';
import { locale } from '../lib/i18n.ts';

export interface WeatherEntry { t: string; temp_c: number; rain_mm: number; wind_kmh: number; wind_dir: number; cloud_pct: number }
export interface ImdData { status: string; warnings: Record<string, unknown>[]; nowcast: Record<string, unknown>[]; rainfall: Record<string, unknown> | null; forecast: Record<string, unknown> | null }

const TZ = 'Asia/Kolkata';
export const fmtIST = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(), { timeZone: TZ, ...opts }).format(new Date(iso));
const dayKey = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const SEVERE = /\b(orange|red)\b/i;

/** Current reading (a step within ±90 min of now, else none), rain in the next 24 h (null when the forecast
 * has run out — never claim "no rain" from expired data), next rain, and a 3-day strip from now on. */
export function summarise(series: WeatherEntry[], now = Date.now()) {
  const recent = series.filter((e) => Date.parse(e.t) >= now - 90 * 60_000);
  const upcoming = series.filter((e) => Date.parse(e.t) >= now);
  const current: WeatherEntry | undefined = recent[0] && Date.parse(recent[0].t) <= now + 90 * 60_000 ? recent[0] : undefined;
  const rain24 = upcoming.length ? upcoming.filter((e) => Date.parse(e.t) <= now + 24 * 3600_000).reduce((s, e) => s + e.rain_mm, 0) : null;
  const nextRain = upcoming.find((e) => e.rain_mm >= 0.2);
  const days = new Map<string, { label: string; min: number; max: number; rain: number }>();
  for (const e of upcoming) {
    const k = dayKey(e.t);
    const d = days.get(k) ?? { label: fmtIST(e.t, { weekday: 'short' }), min: Infinity, max: -Infinity, rain: 0 };
    d.min = Math.min(d.min, e.temp_c); d.max = Math.max(d.max, e.temp_c); d.rain += e.rain_mm;
    days.set(k, d);
  }
  return { current, rain24, nextRain, days: [...days.values()].slice(0, 3) };
}

/** IMD warnings worth a banner: orange/red values in a Nashik warning row, only from a current (ok) feed. */
export const severeWarnings = (imd: FeedState<unknown>) =>
  imd.state === 'ok'
    ? ((imd.envelope!.data as ImdData).warnings ?? []).filter((w) => Object.values(w).some((v) => typeof v === 'string' && SEVERE.test(v)))
    : [];
