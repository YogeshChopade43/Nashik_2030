import { useMemo, useState, type ReactNode } from 'react';
import type { CityEntity, EntityProps, EntityType } from '../types/entity';
import { TYPE_LABEL, displayName, type CityData, type NominatimHit } from '../data/city';
import { centroid, formatDistance, length, nearby, pointInPolygon, reverseGeocode, type LngLat } from '../lib/geo';
import { areaKm2 } from '../lib/zones';
import { describePoint } from '../lib/address';
import type { Polygon } from 'geojson';
import { LAYER_BY_TYPE, glyphOf } from '../map/layers';
import { Icon, Mark, type IconName } from './Icon';
import { getLang, locale, localName, t } from '../lib/i18n';

export type Selection =
  | { kind: 'entity'; entity: CityEntity; segments?: CityEntity[] }
  | { kind: 'location'; lngLat: LngLat; basemap?: { layer: string; props: Record<string, unknown> }; nominatim?: NominatimHit };

type Field = [label: string, get: (p: EntityProps) => ReactNode];

const tag = (k: string) => (p: EntityProps) => p.tags[k];
const yesNo = (k: string) => (p: EntityProps) => (p.tags[k] ? (p.tags[k] === 'yes' ? t('Yes') : p.tags[k] === 'no' ? t('No') : p.tags[k]) : null);
const address = (p: EntityProps) => p.tags['addr:full'] ?? ([p.tags['addr:street'], p.tags['addr:city'], p.tags['addr:postcode']].filter(Boolean).join(', ') || null);
const link = (k: string) => (p: EntityProps) => p.tags[k] ? <a href={p.tags[k]} target="_blank" rel="noreferrer" className="text-accent hover:underline break-all">{p.tags[k].replace(/^https?:\/\//, '')}</a> : null;
const wiki = (p: EntityProps) => {
  const v = p.tags.wikipedia; if (!v) return null;
  const [lang, ...title] = v.split(':');
  return <a href={`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.join(':'))}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">{title.join(':')}</a>;
};
const category = (p: EntityProps) => p.category?.replace(/_/g, ' ');

const CONTACT: Field[] = [['Address', address], ['Phone', tag('phone')], ['Website', link('website')]];
const FIELDS: Partial<Record<EntityType, Field[]>> = {
  hospital: [['Category', category], ['Operator', tag('operator')], ['Emergency', yesNo('emergency')], ['Beds', tag('beds')], ...CONTACT],
  school: [['Type', category], ['Operator', tag('operator')], ...CONTACT],
  college: [['Type', category], ['Operator', tag('operator')], ...CONTACT],
  market: [['Category', category], ['Opening hours', tag('opening_hours')], ...CONTACT],
  religious: [['Religion', category], ['Denomination', tag('denomination')], ['Address', address]],
  tourism: [['Category', category], ['Heritage', tag('heritage')], ['Opening hours', tag('opening_hours')], ['Wikipedia', wiki], ['Website', link('website')]],
  government: [['Category', category], ['Operator', tag('operator')], ...CONTACT],
  bus_stop: [['Category', category], ['Operator', tag('operator')]],
  railway_station: [['Category', category], ['Operator', tag('operator')], ['Wikipedia', wiki]],
  landmark: [['Kind', category], ['Brand', tag('brand')], ['Operator', tag('operator')], ['Opening hours', tag('opening_hours')], ['Address', address]],
  toilets: [['Kind', category], ['Free to use', (p) => (p.tags.fee === 'no' ? t('Yes') : p.tags.fee === 'yes' ? t('No (paid)') : null)], ["Women's", yesNo('female')], ["Men's", yesNo('male')], ['Wheelchair accessible', yesNo('wheelchair')], ['Access', tag('access')], ['Operator', tag('operator')]],
  drinking_water: [['Kind', category], ['Access', tag('access')]],
  road_segment: [['Road class', category], ['Reference', tag('ref')], ['Lanes', tag('lanes')], ['Max speed', tag('maxspeed')], ['Surface', tag('surface')], ['One-way', yesNo('oneway')], ['Bridge', yesNo('bridge')]],
  river: [['Waterway type', category], ['Wikipedia', wiki]],
  water_body: [['Water type', category], ['Wikipedia', wiki]],
  park: [['Category', category], ['Opening hours', tag('opening_hours')]],
  locality: [['Place class', category], ['Population', tag('population')], ['Wikipedia', wiki]],
  city: [['Place class', category], ['Population', tag('population')], ['Wikipedia', wiki]],
  admin_boundary: [['Level', category], ['Wikipedia', wiki]],
};

const PLACE_TYPES: EntityType[] = ['hospital', 'school', 'college', 'market', 'religious', 'tourism', 'government', 'bus_stop', 'railway_station', 'park', 'landmark', 'toilets', 'drinking_water'];
const NA = () => <span className="text-muted/70">{t('Not available')}</span>;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 py-[7px] text-[13px]">
      <dt className="text-muted">{t(label)}</dt>
      <dd className="min-w-0 text-fg">{children ?? <NA />}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line px-5 py-3">
      <h3 className="mb-1 text-[10.5px] font-semibold tracking-[0.18em] text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

const fmtCoord = ([lng, lat]: LngLat) => `${lat.toFixed(5)}° N, ${lng.toFixed(5)}° E`;

function Context({ point, data, exclude, onSelect, radius, isRoad }: { point: LngLat; data: CityData; exclude?: string; onSelect: (e: CityEntity) => void; radius: number; isRoad?: boolean }) {
  const ctx = useMemo(() => {
    const geo = reverseGeocode(point, { roads: data.files.roads, localities: data.files.localities, boundaries: data.files.boundaries }, exclude);
    const near = nearby(point, data.all, radius, { types: PLACE_TYPES, exclude }).slice(0, 6);
    return { geo, near };
  }, [point, data, exclude, radius]);
  const { geo, near } = ctx;
  const entityLink = (e: CityEntity, extra?: string) => (
    <button onClick={() => onSelect(e)} className="text-left text-accent hover:underline">{localName(e.properties)}{extra && <span className="text-muted"> · {extra}</span>}</button>
  );
  return (
    <>
      <Section title={t('Geographic context')}>
        <dl>
          <Row label="Coordinates"><span className="font-mono text-[12px]">{fmtCoord(point)}</span></Row>
          <Row label="Nearest locality">{geo.locality && entityLink(geo.locality.entity, formatDistance(geo.locality.distance))}</Row>
          {!isRoad && <Row label="Nearest road">{geo.road && entityLink(geo.road.entity, formatDistance(geo.road.distance))}</Row>}
          <Row label="Taluka">{geo.boundaries[0] && entityLink(geo.boundaries[0])}</Row>
          <Row label="Ward"><span className="text-muted/70">{t('Not available (no open ward data)')}</span></Row>
        </dl>
      </Section>
      <Section title={t('Nearby · within {d}', { d: formatDistance(radius) })}>
        {near.length ? (
          <ul className="space-y-0.5 py-1">
            {near.map((h) => (
              <li key={h.entity.properties.id}>
                <button onClick={() => onSelect(h.entity)} className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-ink/[0.04]">
                  <Mark glyph={glyphOf(h.entity.properties.type)} color={LAYER_BY_TYPE[h.entity.properties.type]?.color ?? '#8a8072'} className="size-5" />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{displayName(h.entity.properties)}</span>
                  <span className="text-[11.5px] tabular-nums text-muted">{formatDistance(h.distance)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="py-1.5 text-[13px] text-muted">{t('No mapped public places within {d}.', { d: formatDistance(radius) })}</p>}
      </Section>
    </>
  );
}

function Provenance({ p }: { p: EntityProps }) {
  const [copied, setCopied] = useState(false);
  return (
    <Section title={t('Provenance')}>
      <dl>
        <Row label="Source">OpenStreetMap</Row>
        <Row label="Source ID"><a href={`https://www.openstreetmap.org/${p.source_id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-accent hover:underline">{p.source_id}<Icon name="external" className="size-3" /></a></Row>
        <Row label="Last edited">{p.updated_at && new Date(p.updated_at).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' })}</Row>
        <Row label="License">ODbL 1.0</Row>
        <Row label="Entity ID">
          <button onClick={() => navigator.clipboard?.writeText(p.id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })} className="inline-flex items-center gap-1.5 font-mono text-[12px] text-fg/90 hover:text-fg" title={t('Copy entity ID')}>
            {p.id}<Icon name="copy" className="size-3 text-muted" />{copied && <span className="font-sans text-[11px] text-emerald-700">{t('copied')}</span>}
          </button>
        </Row>
      </dl>
    </Section>
  );
}

/** "How to find it": landmark-based directions people can read out or send. */
function DirectionsCard({ point, data, exclude, title }: { point: LngLat; data: CityData; exclude?: string; title: string }) {
  const dir = useMemo(() => describePoint(point, { places: data.files.places, roads: data.files.roads, localities: data.files.localities }, exclude), [point[0], point[1], data, exclude, getLang()]);
  const [copied, setCopied] = useState(false);
  const message = () => `${title}\n${dir.text}\n${location.href}`;
  async function copy() {
    try { await navigator.clipboard.writeText(message()); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  }
  async function share() {
    if (navigator.share) { try { await navigator.share({ title, text: `${dir.text}`, url: location.href }); } catch { /* cancelled */ } }
    else window.open(`https://wa.me/?text=${encodeURIComponent(message())}`, '_blank', 'noopener');
  }
  return (
    <section className="mx-4 mb-3 rounded-xl border border-saffron/25 bg-saffron/[0.05] px-3.5 py-3">
      <h3 className="mb-1 text-[10.5px] font-semibold tracking-[0.18em] text-saffron uppercase">{t('How to find it')}</h3>
      <p className="font-display text-[15.5px] leading-snug text-fg">{dir.text}</p>
      <div className="mt-2.5 flex gap-2">
        <button onClick={copy} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-[#fffdf8] px-3 text-[12.5px] font-medium text-fg/85 hover:border-accent/30 hover:text-fg">
          <Icon name="copy" className="size-3.5 text-accent" />{copied ? t('Copied with link') : t('Copy directions')}
        </button>
        <button onClick={share} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-[#fffdf8] px-3 text-[12.5px] font-medium text-fg/85 hover:border-accent/30 hover:text-fg">
          <Icon name="share" className="size-3.5 text-accent" />{t('Send')}
        </button>
      </div>
      <p className="mt-2 text-[10.5px] leading-snug text-muted">{t('Built from OpenStreetMap roads and landmarks. Distances are straight-line.')}</p>
    </section>
  );
}

function ShareButton({ title }: { title: string }) {
  const [state, setState] = useState<'idle' | 'menu' | 'copied'>('idle');
  const url = () => location.href; // App keeps the URL in sync with the selection
  async function share() {
    if (navigator.share) {
      try { await navigator.share({ title: `${title} · Nashik 2030`, url: url() }); } catch { /* user cancelled */ }
      return;
    }
    setState(state === 'idle' ? 'menu' : 'idle');
  }
  async function copy() {
    try { await navigator.clipboard.writeText(url()); setState('copied'); setTimeout(() => setState('idle'), 1500); }
    catch { setState('idle'); }
  }
  return (
    <div className="relative">
      <ActionButton icon="share" label={state === 'copied' ? t('Link copied') : t('Share')} onClick={share} />
      {state === 'menu' && (
        <div className="glass absolute top-10 right-0 z-10 w-48 rounded-xl p-1" role="menu">
          <button role="menuitem" onClick={copy} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-ink/[0.05]"><Icon name="copy" className="size-3.5 text-muted" />{t('Copy link')}</button>
          <a role="menuitem" href={`https://wa.me/?text=${encodeURIComponent(`${title} — ${url()}`)}`} target="_blank" rel="noreferrer" onClick={() => setState('idle')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] hover:bg-ink/[0.05]"><Icon name="external" className="size-3.5 text-muted" />{t('Send on WhatsApp')}</a>
        </div>
      )}
    </div>
  );
}

function ActionButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-[#fffdf8] px-3.5 text-[13px] font-medium text-fg/85 shadow-[0_1px_1px_rgb(60_40_20/0.05)] transition hover:border-accent/30 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none active:bg-ink/[0.04]">
      <Icon name={icon} className="size-4 text-accent" />{label}
    </button>
  );
}

const ZONE_TYPES: EntityType[] = ['hospital', 'school', 'college', 'market', 'religious', 'tourism', 'government', 'park', 'bus_stop', 'railway_station', 'landmark', 'toilets', 'drinking_water'];

function ZoneSummary({ zone, data, name }: { zone: Polygon; data: CityData; name: string }) {
  const counts = useMemo(() => {
    const c = new Map<EntityType, number>();
    for (const e of data.all) {
      if (!ZONE_TYPES.includes(e.properties.type) || !pointInPolygon(centroid(e.geometry), zone)) continue;
      c.set(e.properties.type, (c.get(e.properties.type) ?? 0) + 1);
    }
    return ZONE_TYPES.filter((ty) => c.get(ty)).map((ty) => [ty, c.get(ty)!] as const);
  }, [zone, data]);
  return (
    <Section title={t('Within this area · approximate')}>
      <p className="pb-2 text-[12px] leading-relaxed text-muted">
        {t('OpenStreetMap maps {name} as a point, not a boundary. The shaded area is everywhere closer to {name} than to any other mapped locality (max 3 km), about {area} km².', { name, area: areaKm2(zone).toFixed(1) })}
      </p>
      {counts.length ? (
        <div className="grid grid-cols-2 gap-1.5 pb-1">
          {counts.map(([ty, n]) => (
            <div key={ty} className="flex items-center gap-2 rounded-lg bg-ink/[0.03] px-2 py-1.5">
              <Mark glyph={glyphOf(ty)} color={LAYER_BY_TYPE[ty]?.color ?? '#8a8072'} className="size-5" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg/85">{t(TYPE_LABEL[ty])}</span>
              <span className="text-[13px] font-semibold tabular-nums text-fg">{n}</span>
            </div>
          ))}
        </div>
      ) : <p className="pb-1 text-[13px] text-muted">{t('No mapped public places inside this area.')}</p>}
    </Section>
  );
}

export function Inspector({ selection, data, onSelect, onClose, onNearby, onBack, zone }: {
  selection: Selection;
  /** Approximate area for a selected locality. */
  zone?: Polygon;
  data: CityData;
  onSelect: (e: CityEntity) => void;
  onClose: () => void;
  onNearby: (point: LngLat, label: string, fromId?: string) => void;
  /** Present when opened from a Nearby list. */
  onBack?: () => void;
}) {
  let header: { color: string; glyph?: string; kicker: string; title: string; local?: string | null };
  let origin: { point: LngLat; label: string; fromId?: string };
  let body: ReactNode;

  if (selection.kind === 'entity') {
    const p = selection.entity.properties;
    const segs = selection.segments ?? [selection.entity];
    const isRoad = p.type === 'road_segment';
    const point = centroid(selection.entity.geometry);
    origin = { point, label: localName(p) ?? t(TYPE_LABEL[p.type]), fromId: p.id };
    const title = displayName(p);
    // The other language's name as a subtitle: Marathi under English, English under Marathi.
    const other = getLang() === 'mr' ? p.name : p.name_local;
    header = { color: LAYER_BY_TYPE[p.type]?.color ?? '#8a8072', glyph: glyphOf(p.type), kicker: t(TYPE_LABEL[p.type]), title, local: other !== title ? other : null };
    body = (
      <>
        {!isRoad && !['admin_boundary', 'river', 'water_body', 'city'].includes(p.type) && <DirectionsCard point={point} data={data} exclude={p.id} title={displayName(p)} />}
        {isRoad && (
          <Section title={t('Whole road')}>
            <dl>
              <Row label="Mapped length">{formatDistance(segs.reduce((n, s) => n + length(s.geometry), 0))}</Row>
              <Row label="OSM segments">{segs.length}</Row>
              <Row label="Road classes">{[...new Set(segs.map((s) => s.properties.category?.replace(/_/g, ' ')))].join(', ')}</Row>
            </dl>
          </Section>
        )}
        <Section title={isRoad ? t('Selected segment') : t('Details')}>
          <dl>
            {p.type === 'river' && <Row label="Mapped length">{formatDistance(length(selection.entity.geometry))}</Row>}
            {(FIELDS[p.type] ?? [['Category', category]]).map(([label, get]) => <Row key={label} label={label}>{get(p) || null}</Row>)}
          </dl>
        </Section>
        {zone && <ZoneSummary zone={zone} data={data} name={localName(p) ?? t('this locality')} />}
        <Context point={point} data={data} exclude={p.id} onSelect={onSelect} isRoad={isRoad} radius={isRoad || p.type === 'admin_boundary' ? 600 : 1000} />
        <Provenance p={p} />
      </>
    );
  } else {
    const b = selection.basemap;
    const cls = b && [b.props.class, b.props.subclass].filter(Boolean).join(' · ');
    origin = { point: selection.lngLat, label: selection.nominatim?.label ?? 'this point' };
    header = { color: '#1f5f7a', glyph: glyphOf('localities'), kicker: selection.nominatim ? t('Search result · Nominatim') : t('Dropped pin'), title: selection.nominatim?.label ?? fmtCoord(selection.lngLat) };
    body = (
      <>
        <DirectionsCard point={selection.lngLat} data={data} title={selection.nominatim?.label ?? t('A spot in Nashik')} />
        {(b || selection.nominatim) && (
          <Section title={t('At this point')}>
            <dl>
              {selection.nominatim && <Row label="OSM address">{selection.nominatim.sub}</Row>}
              {selection.nominatim && <Row label="Source ID"><a href={`https://www.openstreetmap.org/${selection.nominatim.source_id}`} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-accent hover:underline">{selection.nominatim.source_id}</a></Row>}
              {b && <Row label="Base-map feature">{b.layer.replace(/_/g, ' ')}{cls ? <span className="text-muted"> · {String(cls).replace(/_/g, ' ')}</span> : null}</Row>}
              {b && <Row label="Source">OpenStreetMap via OpenMapTiles</Row>}
            </dl>
          </Section>
        )}
        <Context point={selection.lngLat} data={data} onSelect={onSelect} radius={500} />
      </>
    );
  }

  return (
    <div className="flex max-h-full min-h-0 flex-col">
      {onBack && (
        <button onClick={onBack} className="mx-3 mt-3 inline-flex items-center gap-1 self-start rounded-lg px-2 py-1 text-[12.5px] font-medium text-accent hover:bg-accent/[0.06]">
          <Icon name="back" className="size-3.5" />{t('Nearby results')}
        </button>
      )}
      <header className={`relative px-5 pb-4 ${onBack ? 'pt-2' : 'pt-5'}`}>
        <div className="relative flex items-start gap-3.5">
          <Mark glyph={header.glyph} color={header.color} className="mt-0.5 size-11" />
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[10.5px] font-semibold tracking-[0.18em] uppercase" style={{ color: header.color }}>{header.kicker}</p>
            <h2 className="font-display text-[23px] leading-[1.15] font-semibold tracking-[-0.01em] text-balance text-fg">{header.title}</h2>
            {header.local && <p className="mt-1 font-display text-[15px] text-muted italic">{header.local}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-ink/5 hover:text-fg" aria-label={t('Close details')}><Icon name="close" /></button>
        </div>
        <div className="mt-3.5 flex flex-wrap gap-2 pl-[58px]">
          <ActionButton icon="nearby" label={t("What's nearby")} onClick={() => onNearby(origin.point, origin.label === 'this point' ? t('Around this point') : t('Around {name}', { name: origin.label }), origin.fromId)} />
          <ShareButton title={header.title} />
        </div>
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-2">{body}</div>
    </div>
  );
}
