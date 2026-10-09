// Live feeds built by the scheduled pipeline (pipeline/) and served as static JSON.
// A feed is `ok`, `stale` (past valid_until by more than one update interval) or `missing`;
// malformed files count as missing, so nothing questionable is ever shown as current.

import { t } from '../lib/i18n.ts';

export type FeedName = 'weather' | 'river' | 'imd';

export interface Envelope<T> {
  source: string;
  license: string;
  attribution: string;
  fetched_at: string;
  valid_until: string;
  data: T;
}

export interface FeedState<T> {
  state: 'ok' | 'stale' | 'missing';
  envelope?: Envelope<T>;
  /** Minutes since the data was fetched. */
  age_min?: number;
}

/** Update interval per feed, hours (matches the pipeline's valid_hours). */
export const INTERVAL_H: Record<FeedName, number> = { weather: 6, river: 24, imd: 3 };

const FUTURE_TOLERANCE_MS = 5 * 60_000; // allow small clock skew, reject anything clearly in the future

/** Minimal shape each feed's UI relies on; anything else is treated as missing rather than rendered. */
const SHAPE: Record<FeedName, (d: Record<string, unknown>) => boolean> = {
  weather: (d) => {
    const p = d.points as Record<string, unknown> | undefined;
    return !!p && typeof p === 'object' && Array.isArray(p.nashik) && p.nashik.length > 0;
  },
  river: (d) => Array.isArray(d.series) && !!d.cell && typeof d.cell === 'object' && typeof d.trend === 'string',
  imd: (d) => typeof d.status === 'string' && Array.isArray(d.warnings),
};

export function classify<T>(json: unknown, feed: FeedName, now: number): FeedState<T> {
  if (!json || typeof json !== 'object') return { state: 'missing' };
  const e = json as Partial<Envelope<T>>;
  const fetched = Date.parse(e.fetched_at ?? '');
  const valid = Date.parse(e.valid_until ?? '');
  if (!Number.isFinite(fetched) || !Number.isFinite(valid)) return { state: 'missing' };
  if (fetched > now + FUTURE_TOLERANCE_MS) return { state: 'missing' };
  if (!e.data || typeof e.data !== 'object' || typeof e.source !== 'string') return { state: 'missing' };
  if (!SHAPE[feed](e.data as Record<string, unknown>)) return { state: 'missing' };
  const age_min = Math.max(0, Math.round((now - fetched) / 60_000));
  const stale = now > valid + INTERVAL_H[feed] * 3600_000;
  return { state: stale ? 'stale' : 'ok', envelope: e as Envelope<T>, age_min };
}

const FEEDS: FeedName[] = ['weather', 'river', 'imd'];

export async function loadLive(base: string = import.meta.env.BASE_URL): Promise<Record<FeedName, FeedState<unknown>>> {
  const now = Date.now();
  const entries = await Promise.all(FEEDS.map(async (feed) => {
    try {
      const r = await fetch(`${base}live/${feed}.json`, { cache: 'no-cache' });
      return [feed, r.ok ? classify(await r.json(), feed, now) : { state: 'missing' }] as const;
    } catch {
      return [feed, { state: 'missing' }] as const;
    }
  }));
  return Object.fromEntries(entries) as Record<FeedName, FeedState<unknown>>;
}

/** "40 min ago", "3 h ago", "2 days ago". */
export function ago(min: number): string {
  if (min < 1) return t('just now');
  if (min < 60) return t('{n} min ago', { n: min });
  const h = Math.round(min / 60);
  return h < 48 ? t('{n} h ago', { n: h }) : t('{n} days ago', { n: Math.round(h / 24) });
}
