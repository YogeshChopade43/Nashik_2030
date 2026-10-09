import { useEffect, useMemo, useState } from 'react';
import type { CityData } from '../data/city';
import { GROUPS, LAYERS, glyphOf, type MapLayerDef } from '../map/layers';
import { FILTERS, applyFilters, filterCounts } from '../map/filters';
import { Icon, Mark } from './Icon';

function count(def: MapLayerDef, data: CityData | null) {
  if (!data || !def.types) return null;
  return def.types.reduce((n, t) => n + (data.byType[t]?.length ?? 0), 0);
}

function FilterChips({ layer, data, active, onChange }: { layer: MapLayerDef; data: CityData; active: string[]; onChange: (ids: string[]) => void }) {
  const filters = FILTERS[layer.id]!;
  const entities = useMemo(() => (layer.types ?? []).flatMap((t) => data.byType[t] ?? []), [layer, data]);
  const ctx = useMemo(() => ({ asOf: Date.parse(data.meta.extracted_at) }), [data]);
  const counts = useMemo(() => filterCounts(entities, filters, ctx), [entities, filters, ctx]);
  return (
    <div className="mb-1.5 ml-[44px] mr-2 rounded-xl bg-ink/[0.03] px-2.5 py-2">
      <div className="flex flex-wrap gap-1.5">
        {filters.filter((f) => counts[f.id] > 0).map((f) => {
          const on = active.includes(f.id);
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? active.filter((x) => x !== f.id) : [...active, f.id])}
              className={`rounded-full border px-2.5 py-[3px] text-[12px] transition ${on ? 'border-accent bg-accent text-white' : 'border-line bg-[#fffdf8] text-fg/80 hover:border-accent/30'}`}
            >
              {f.label} <span className={`tabular-nums ${on ? 'text-white/75' : 'text-muted'}`}>{counts[f.id]}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10.5px] leading-snug text-muted">Based on OpenStreetMap tags. Places without the tag are hidden, not confirmed to lack it.</p>
      {layer.id === 'toilets' && (
        <a
          href={(() => { const v = location.hash.match(/view=([\d.]+)\/([\d.-]+)\/([\d.-]+)/); return `https://www.openstreetmap.org/edit${v ? `#map=${Math.round(+v[1]) + 1}/${v[2]}/${v[3]}` : ''}`; })()}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline"
        >
          Only {entities.filter((e) => e.properties.type === 'toilets').length} toilets mapped so far. Help map more on OpenStreetMap <Icon name="external" className="size-3" />
        </a>
      )}
      {active.length > 0 && (
        <button type="button" onClick={() => onChange([])} className="mt-1 text-[11.5px] font-medium text-accent hover:underline">Clear filters · {applyFilters(entities, filters, active, ctx).length} of {entities.length} shown</button>
      )}
    </div>
  );
}

export function LayerPanel({ visible, onToggle, data, onShowSources, onClose, filters, onFilters }: {
  visible: Record<string, boolean>;
  onToggle: (id: string, on: boolean) => void;
  data: CityData | null;
  onShowSources: () => void;
  onClose: () => void;
  filters: Record<string, string[]>;
  onFilters: (layerId: string, ids: string[]) => void;
}) {
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const groups = [...GROUPS, ...[...new Set(LAYERS.map((l) => l.group))].filter((g) => !GROUPS.some((x) => x.id === g)).map((id) => ({ id, label: id }))];
  return (
    <div className="flex max-h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <h2 className="font-display text-[19px] font-semibold tracking-[-0.01em] text-fg">Map layers</h2>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-ink/5 hover:text-fg" aria-label="Close layers"><Icon name="close" /></button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.map((g) => {
          const layers = LAYERS.filter((l) => l.group === g.id);
          const toggleable = layers.filter((l) => !l.unavailable);
          const allOn = toggleable.every((l) => visible[l.id]);
          return (
            <section key={g.id} className="mb-1" aria-label={g.label}>
              <div className="flex items-baseline justify-between px-2 pt-3.5 pb-1">
                <h3 className="text-[10.5px] font-semibold tracking-[0.18em] text-muted uppercase">{g.label}</h3>
                <button
                  type="button"
                  onClick={() => toggleable.forEach((l) => onToggle(l.id, !allOn))}
                  className="rounded px-1 text-[11.5px] font-medium text-accent/80 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
                >
                  {allOn ? 'Hide all' : 'Show all'}
                </button>
              </div>
              {layers.map((l) => {
                const on = !l.unavailable && !!visible[l.id];
                const n = count(l, data);
                const active = filters[l.id] ?? [];
                const shown = data && active.length && FILTERS[l.id]
                  ? applyFilters((l.types ?? []).flatMap((t) => data.byType[t] ?? []), FILTERS[l.id]!, active, { asOf: Date.parse(data.meta.extracted_at) }).length
                  : null;
                return (
                  <div key={l.id}>
                  <div className="flex items-center">
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={!!l.unavailable}
                    title={l.unavailable ?? (on ? `Hide ${l.label}` : `Show ${l.label}`)}
                    onClick={() => onToggle(l.id, !on)}
                    className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-[7px] text-left transition-colors hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none active:bg-ink/[0.07] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <Mark glyph={glyphOf(l.id)} color={l.color} className={`size-6 transition ${on ? '' : 'opacity-40 grayscale'}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13.5px] transition-colors ${on ? 'font-medium text-fg' : 'text-muted'}`}>{l.label}</span>
                      {l.unavailable && <span className="block text-[11px] leading-snug text-muted">No open data available</span>}
                    </span>
                    {n != null && <span className={`text-[11px] tabular-nums ${shown != null ? 'font-medium text-accent' : on ? 'text-muted' : 'text-muted/60'}`}>{shown != null ? `${shown} of ${n.toLocaleString()}` : n.toLocaleString()}</span>}
                    {!l.unavailable && (
                      <Icon name={on ? 'eye' : 'eyeOff'} className={`size-[17px] shrink-0 transition-colors ${on ? 'text-accent' : 'text-muted/50 group-hover:text-muted'}`} />
                    )}
                  </button>
                  {FILTERS[l.id] && data && (
                    <button
                      type="button"
                      aria-expanded={openFilter === l.id}
                      aria-label={`Filter ${l.label}`}
                      title={`Filter ${l.label}`}
                      onClick={() => setOpenFilter(openFilter === l.id ? null : l.id)}
                      className={`ml-0.5 grid size-8 shrink-0 place-items-center rounded-lg transition hover:bg-ink/[0.05] focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none ${active.length ? 'text-accent' : 'text-muted/60 hover:text-muted'}`}
                    >
                      <Icon name="filter" className="size-[15px]" />
                    </button>
                  )}
                  </div>
                  {openFilter === l.id && data && <FilterChips layer={l} data={data} active={active} onChange={(ids) => { onFilters(l.id, ids); if (ids.length && !on) onToggle(l.id, true); }} />}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <button onClick={onShowSources} className="flex items-center gap-2 border-t border-line px-4 py-3 text-left text-[12.5px] text-muted hover:text-fg">
        <Icon name="database" className="size-3.5" />
        Data sources & licenses
        <Icon name="chevron" className="ml-auto size-3.5" />
      </button>
    </div>
  );
}

export function SourcesDialog({ data, onClose }: { data: CityData | null; onClose: () => void }) {
  const meta = data?.meta;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/25 backdrop-blur-[2px] p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="sources-title">
      <div className="glass scroll-thin max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="sources-title" className="font-display text-xl font-semibold">Data sources & provenance</h2>
            <p className="mt-1 text-[13px] text-muted">Every feature on this map comes from an openly licensed source. Nothing is invented.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-ink/5 hover:text-fg" aria-label="Close"><Icon name="close" /></button>
        </div>

        <h3 className="mb-2 text-[11px] font-semibold tracking-[0.16em] text-muted uppercase">Base map</h3>
        <ul className="mb-5 space-y-2 text-[13px]">
          <li className="rounded-xl border border-line p-3"><b className="font-medium">Vector tiles</b> — OpenStreetMap data in the OpenMapTiles schema, served by OpenFreeMap. Data © OpenStreetMap contributors, ODbL 1.0.</li>
          <li className="rounded-xl border border-line p-3"><b className="font-medium">Live data</b> — weather: ECMWF Open Data (CC BY 4.0) · river flow: Copernicus GloFAS (CC BY 4.0) · warnings: India Meteorological Department. Refreshed by a scheduled pipeline; each feed shows when it was updated.</li>
          <li className="rounded-xl border border-line p-3"><b className="font-medium">Terrain relief</b> — Terrain Tiles (Mapzen / AWS Open Data; SRTM and other public-domain/open DEMs).</li>
        </ul>

        <h3 className="mb-2 text-[11px] font-semibold tracking-[0.16em] text-muted uppercase">City entity datasets {meta && <span className="normal-case tracking-normal">· extracted {new Date(meta.extracted_at).toLocaleDateString()}</span>}</h3>
        {meta ? (
          <div className="mb-5 overflow-hidden rounded-xl border border-line">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-ink/[0.03] text-muted"><tr><th className="px-3 py-2 font-medium">Dataset</th><th className="px-3 py-2 font-medium">Entities</th><th className="px-3 py-2 font-medium">License</th></tr></thead>
              <tbody>
                {Object.entries(meta.datasets).map(([k, d]) => (
                  <tr key={k} className="border-t border-line align-top">
                    <td className="px-3 py-2"><div className="font-medium text-fg">{k}</div><div className="text-muted">{d.description}</div>{d.osm_data_timestamp && <div className="text-muted/80">OSM snapshot {d.osm_data_timestamp}</div>}</td>
                    <td className="px-3 py-2 tabular-nums">{d.features.toLocaleString()}</td>
                    <td className="px-3 py-2 text-muted">ODbL 1.0</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="mb-5 text-[13px] text-muted">Loading…</p>}

        {meta && (
          <>
            <h3 className="mb-2 text-[11px] font-semibold tracking-[0.16em] text-muted uppercase">Not available (left out, not faked)</h3>
            <ul className="mb-5 space-y-2 text-[13px]">
              {meta.unavailable.map((u) => <li key={u.layer} className="rounded-xl border border-amber-600/25 bg-amber-500/[0.06] p-3"><b className="font-medium">{u.layer}</b> — <span className="text-muted">{u.reason}</span></li>)}
            </ul>
            <h3 className="mb-2 text-[11px] font-semibold tracking-[0.16em] text-muted uppercase">Processing</h3>
            <ol className="list-decimal space-y-1 pl-5 text-[12.5px] text-muted">{meta.processing.map((p) => <li key={p}>{p}</li>)}</ol>
          </>
        )}
      </div>
    </div>
  );
}
