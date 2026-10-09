import { useEffect, useMemo, useRef, useState } from 'react';
import { itemText, nominatim, search, type CityData, type NominatimHit, type SearchItem } from '../data/city';
import { getLang, t } from '../lib/i18n';
import { LAYER_BY_TYPE, glyphOf } from '../map/layers';
import { Icon, Mark } from './Icon';

type Result = { kind: 'local'; item: SearchItem } | { kind: 'nominatim'; hit: NominatimHit };

// Real names verified to exist in the OSM extract.
const SUGGESTIONS = ['Panchavati', 'College Road', 'Gangapur Road', 'Nashik Road', 'Ramkund', 'Hospitals'];
const SUGGESTIONS_MR = ['नाशिक रोड', 'त्र्यंबकेश्वर', 'गोदावरी', 'सातपूर', 'रुग्णालय', 'शौचालय'];

const typeOf = (item: SearchItem) => (item.kind === 'entity' ? item.entity.properties.type : item.kind === 'road' ? 'road_segment' : item.type);
const colorOf = (item: SearchItem) => LAYER_BY_TYPE[typeOf(item)]?.color ?? '#8a8072';

export function SearchBar({ data, onPick, onPickNominatim }: {
  data: CityData | null;
  onPick: (item: SearchItem) => void;
  onPickNominatim: (hit: NominatimHit) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<{ q: string; hits: NominatimHit[] | 'loading' | 'error' } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const local = useMemo(() => (data ? search(data.search, q) : []), [data, q]);
  const results: Result[] = useMemo(() => {
    const r: Result[] = local.map((item) => ({ kind: 'local', item }));
    if (remote?.q === q && Array.isArray(remote.hits)) r.push(...remote.hits.map((hit) => ({ kind: 'nominatim' as const, hit })));
    return r;
  }, [local, remote, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const text = (item: SearchItem) => itemText(item, (type) => data?.byType[type]?.length ?? 0);

  function choose(r: Result) {
    if (r.kind === 'local') { onPick(r.item); setQ(text(r.item).label); }
    else { onPickNominatim(r.hit); setQ(r.hit.label); }
    setOpen(false);
    input.current?.blur();
  }

  async function lookupRemote() {
    if (!data || q.trim().length < 2) return;
    setRemote({ q, hits: 'loading' });
    try { setRemote({ q, hits: await nominatim(q, data.meta.bbox) }); }
    catch { setRemote({ q, hits: 'error' }); }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
    else if (e.key === 'Enter') {
      if (results[active]) choose(results[active]);
      else lookupRemote();
    }
  }

  const showPanel = open && !!data;

  return (
    <div className="relative w-full">
      <div className="glass flex h-12 items-center gap-3 rounded-2xl px-4 transition focus-within:border-accent/35">
        <Icon name="search" className="size-[18px] shrink-0 text-muted" />
        <input
          ref={input}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder={data ? t('Search Nashik…') : t('Loading city data…')}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-fg placeholder:text-muted focus:outline-none"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="search-results"
          aria-label={t('Search Nashik')}
        />
        {q ? (
          <button onClick={() => { setQ(''); input.current?.focus(); }} className="rounded-md p-1 text-muted hover:text-fg" aria-label={t('Clear search')}>
            <Icon name="close" />
          </button>
        ) : (
          <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 font-sans text-[11px] text-muted md:block">/</kbd>
        )}
      </div>

      {showPanel && (
        <div id="search-results" role="listbox" className="glass scroll-thin absolute inset-x-0 top-14 z-30 max-h-[60vh] overflow-y-auto rounded-2xl p-1.5">
          {q.length < 2 ? (
            <div className="p-3">
              <p className="mb-2.5 text-[11px] font-medium tracking-[0.14em] text-muted uppercase">{t('Try')}</p>
              <div className="flex flex-wrap gap-1.5">
                {(getLang() === 'mr' ? SUGGESTIONS_MR : SUGGESTIONS).map((s) => (
                  <button key={s} onMouseDown={(e) => e.preventDefault()} onClick={() => setQ(s)} className="rounded-full border border-line bg-ink/[0.03] px-3 py-1 text-[13px] text-fg/90 hover:border-accent/30 hover:bg-accent/[0.06]">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {results.map((r, i) => {
                const { label, sub } = r.kind === 'local' ? text(r.item) : { label: r.hit.label, sub: `Nominatim · ${r.hit.kind}` };
                return (
                  <button
                    key={r.kind === 'local' ? r.item.label + r.item.sub + i : r.hit.source_id}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(r)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${i === active ? 'bg-ink/[0.05]' : ''}`}
                  >
                    {r.kind === 'local' && r.item.kind === 'category' ? (
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: colorOf(r.item) + '1a', color: colorOf(r.item) }}><Icon name="layers" className="size-3.5" /></span>
                    ) : r.kind === 'local' ? (
                      <Mark glyph={glyphOf(typeOf(r.item))} color={colorOf(r.item)} />
                    ) : (
                      <span className="grid size-7 shrink-0 place-items-center text-muted"><Icon name="pin" /></span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-fg">{label}</span>
                      <span className="block truncate text-[12px] text-muted">{sub}</span>
                    </span>
                  </button>
                );
              })}
              {local.length === 0 && remote?.q !== q && (
                <div className="px-3 py-3 text-[13px] text-muted">
                  {t('No match in the Nashik extract.')}{' '}
                  <button onMouseDown={(e) => e.preventDefault()} onClick={lookupRemote} className="text-accent hover:underline">{t('Search OpenStreetMap (Nominatim)')}</button>
                </div>
              )}
              {remote?.q === q && remote.hits === 'loading' && <div className="px-3 py-3 text-[13px] text-muted">{t('Searching OpenStreetMap…')}</div>}
              {remote?.q === q && remote.hits === 'error' && <div className="px-3 py-3 text-[13px] text-rose-700">{t('Nominatim is unreachable right now.')}</div>}
              {remote?.q === q && Array.isArray(remote.hits) && results.length === 0 && (
                <div className="px-3 py-3 text-[13px] text-muted">{t('Nothing named “{q}” exists in OpenStreetMap within Nashik.', { q })}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
