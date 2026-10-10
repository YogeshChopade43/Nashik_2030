import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type FilterSpecification, type GeoJSONSource, type Map as MLMap, type PaddingOptions } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { itemText, loadCity, type CityData, type NominatimHit, type SearchItem } from './data/city';
import { setLang, t, type Lang } from './lib/i18n';
import { applyMapLang } from './map/lang';
import { bbox, circle, distance, roadSegmentsByName, type LngLat } from './lib/geo';
import { localityZones } from './lib/zones';
import { describePoint } from './lib/address';
import { registerImages } from './map/icons';
import { LAYERS, LAYER_BY_TYPE, setLayerVisibility } from './map/layers';
import { buildStyle, NASHIK_CENTER, probe } from './map/style';
import { Protocol } from 'pmtiles';
import type { CityEntity } from './types/entity';
import { Icon, type IconName } from './components/Icon';
import { Inspector, type Selection } from './components/Inspector';
import { LayerPanel, SourcesDialog } from './components/LayerPanel';
import { Nearby, type NearbyOrigin } from './components/Nearby';
import { Legend } from './components/Legend';
import { LiveCard, LivePill, WarningBanner, type LiveFeeds } from './components/LiveCard';
import { loadLive } from './data/live';
import { FILTERS, applyFilters } from './map/filters';
import { SearchBar } from './components/SearchBar';

const STORAGE_KEY = 'n2030.layers.v1';
const FILTER_KEY = 'n2030.filters.v1';
const LANG_KEY = 'n2030.lang';
const DEFAULT_VISIBLE = Object.fromEntries(LAYERS.map((l) => [l.id, l.defaultVisible]));
const EMPTY = { type: 'FeatureCollection' as const, features: [] };
const REGION: [[number, number], [number, number]] = [[72.9, 19.4], [74.7, 20.6]];
const inRegion = (p: LngLat) => p[0] > REGION[0][0] && p[0] < REGION[1][0] && p[1] > REGION[0][1] && p[1] < REGION[1][1];

// Deep links share the URL hash with MapLibre's `view=` param (it preserves other keys).
const getHashParam = (key: string, hash = location.hash) => hash.slice(1).split('&').find((p) => p.startsWith(`${key}=`))?.slice(key.length + 1);
// Captured before MapLibre rewrites the hash with its own `view=` on load.
const INITIAL_HASH = location.hash;
function setSelectionParam(param: string | null) {
  const parts = location.hash.slice(1).split('&').filter((p) => p && !p.startsWith('place=') && !p.startsWith('pin='));
  if (param) parts.push(param);
  history.replaceState(history.state, '', `${location.pathname}${location.search}${parts.length ? `#${parts.join('&')}` : ''}`);
}

function loadVisible(): Record<string, boolean> {
  try { return { ...DEFAULT_VISIBLE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }; }
  catch { return DEFAULT_VISIBLE; }
}

function loadFilters(): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}'); }
  catch { return {}; }
}

/** Saved choice, else Marathi for Marathi-language browsers. */
function loadLang(): Lang {
  let saved: string | null = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch { /* storage unavailable */ }
  const l: Lang = saved === 'mr' || saved === 'en' ? saved : navigator.language.toLowerCase().startsWith('mr') ? 'mr' : 'en';
  setLang(l);
  return l;
}

/** A map that map.remove() hasn't torn down. On hot reload React re-runs effects with the old map
 * right after the cleanup removed it; those effects must treat it as no map. */
const alive = (m: MLMap | null): m is MLMap => !!m?.style;

let pmtilesRegistered = false;
function registerPmtiles() {
  if (pmtilesRegistered) return;
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  pmtilesRegistered = true;
}

function useMediaQuery(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export default function App() {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MLMap | null>(null);
  const [data, setData] = useState<CityData | null>(null);
  const [installed, setInstalled] = useState(false);
  const [visible, setVisible] = useState(loadVisible);
  const [selection, setSelection] = useState<Selection | null>(null);
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [layersOpen, setLayersOpen] = useState(() => !window.matchMedia('(max-width: 767px)').matches);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [near, setNear] = useState<{ origin: NearbyOrigin; radius: number } | null>(null);
  const [filters, setFilters] = useState(loadFilters);
  const [legendOpen, setLegendOpen] = useState(false);
  const [live, setLive] = useState<LiveFeeds | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [lang, setLangState] = useState(loadLang);
  const restored = useRef(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; lngLat: LngLat } | null>(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const zones = useMemo(() => (data ? localityZones(data.files.localities.filter((l) => l.properties.type === 'locality')) : null), [data]);
  const zoneOf = (e?: CityEntity) => (e?.properties.type === 'locality' ? zones?.get(e.properties.id) : undefined);

  // ---- map + data bootstrap ----
  useEffect(() => {
    let m: MLMap | undefined;
    let cancelled = false;
    (async () => {
      // Self-hosted tiles/fonts when deployed (absolute base: MapLibre resolves pmtiles:// and glyph URLs as-is).
      const base = new URL(import.meta.env.BASE_URL, location.href).href;
      const [pmtiles, ownFonts] = await Promise.all([probe(`${base}tiles/nashik.pmtiles`), probe(`${base}fonts/Noto Sans Regular/0-255.pbf`)]);
      if (cancelled) return;
      if (pmtiles) registerPmtiles();
      m = new maplibregl.Map({
        container: container.current!,
        style: buildStyle({ pmtiles, base, ownFonts }),
        center: NASHIK_CENTER,
        zoom: 12.4,
        minZoom: 8,
        maxZoom: 19,
        maxBounds: REGION,
        hash: 'view',
        attributionControl: { compact: true },
        maxPitch: 0, // flat atlas on web and app alike; rotation stays
        touchPitch: false,
      });
      const map = m;
      registerImages(map);
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 110 }), 'bottom-left');
      map.on('load', () => {
        // Start the attribution collapsed on phones so it doesn't cover controls (the ⓘ button reopens it).
        if (window.matchMedia('(max-width: 767px)').matches) map.getContainer().querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
        setMap(map);
      });
      if (import.meta.env.DEV) Object.assign(window, { map }); // debugging aid
    })();
    loadCity().then(setData).catch((e) => setToast(t('Could not load city data: {msg}', { msg: e.message })));
    return () => {
      cancelled = true;
      // map.remove() strips the URL hash; keep the deep link across StrictMode/HMR remounts.
      const hash = location.hash;
      m?.remove();
      if (hash) history.replaceState(history.state, '', hash);
      setMap(null); setInstalled(false);
    };
  }, []);

  // Live feeds (static JSON from the scheduled pipeline): load now, refresh every 15 min.
  useEffect(() => {
    let alive = true;
    const load = () => loadLive().then((f) => alive && setLive(f)).catch(() => {});
    load();
    const id = setInterval(load, 15 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(visible)); } catch { /* storage unavailable */ }
  }, [visible]);

  useEffect(() => {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch { /* storage unavailable */ }
  }, [filters]);

  // Filters replace the layer's source data, so cluster counts reflect only matching places.
  useEffect(() => {
    if (!alive(map) || !data || !installed) return;
    const ctx = { asOf: Date.parse(data.meta.extracted_at) };
    for (const def of LAYERS) {
      const defs = FILTERS[def.id];
      if (!defs) continue;
      const all = (def.types ?? []).flatMap((t) => data.byType[t] ?? []);
      map.getSource<GeoJSONSource>(`src-${def.id}`)?.setData({ type: 'FeatureCollection', features: applyFilters(all, defs, filters[def.id] ?? [], ctx) });
    }
  }, [map, data, installed, filters]);

  // ---- install overlay layers once both are ready ----
  useEffect(() => {
    if (!alive(map) || !data || installed) return;
    for (const def of LAYERS) def.install?.(map, data);
    // Nearby search area: soft wash + dashed rim + origin dot.
    map.addSource('nearby', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'nearby-fill', type: 'fill', source: 'nearby', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#1f5f7a', 'fill-opacity': 0.05 } }, 'base-label-water');
    map.addLayer({ id: 'nearby-rim', type: 'line', source: 'nearby', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': '#1f5f7a', 'line-width': 1.4, 'line-opacity': 0.55, 'line-dasharray': [3, 2] } }, 'base-label-water');
    // Approximate locality area (nearest-locality zone).
    map.addSource('zone', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'zone-fill', type: 'fill', source: 'zone', paint: { 'fill-color': '#6b6255', 'fill-opacity': 0.07 } }, 'base-label-water');
    map.addLayer({ id: 'zone-line', type: 'line', source: 'zone', paint: { 'line-color': '#5a5145', 'line-width': 1.6, 'line-opacity': 0.7, 'line-dasharray': [2, 1.5] } }, 'base-label-water');
    map.addSource('selection', { type: 'geojson', data: EMPTY });
    const notPoint: FilterSpecification = ['!=', ['geometry-type'], 'Point'];
    // Selection: saffron ink with a soft wash, drawn beneath the place markers.
    const SEL = '#c26d12';
    const isPoint: FilterSpecification = ['==', ['geometry-type'], 'Point'];
    const below = map.getLayer('hospital-cluster-shadow') ? 'hospital-cluster-shadow' : undefined;
    map.addLayer({ id: 'sel-fill', type: 'fill', source: 'selection', filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false], paint: { 'fill-color': SEL, 'fill-opacity': 0.08 } }, below);
    map.addLayer({ id: 'sel-glow', type: 'line', source: 'selection', filter: notPoint, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#f0a64a', 'line-width': 12, 'line-blur': 6, 'line-opacity': 0.45 } }, below);
    map.addLayer({ id: 'sel-line', type: 'line', source: 'selection', filter: notPoint, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': SEL, 'line-width': 3.2 } }, below);
    map.addLayer({ id: 'sel-point-halo', type: 'circle', source: 'selection', filter: isPoint, paint: { 'circle-radius': 26, 'circle-color': SEL, 'circle-opacity': 0.14, 'circle-blur': 0.5 } }, below);
    map.addLayer({ id: 'sel-point', type: 'circle', source: 'selection', filter: isPoint, paint: { 'circle-radius': 17, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': SEL, 'circle-stroke-width': 2.4 } }, below);
    setInstalled(true);
  }, [map, data, installed]);

  useEffect(() => {
    if (alive(map)) for (const def of LAYERS) setLayerVisibility(map, def, !def.unavailable && !!visible[def.id]);
  }, [map, visible, installed]);

  function switchLang() {
    const next: Lang = lang === 'mr' ? 'en' : 'mr';
    setLang(next);
    setLangState(next);
    try { localStorage.setItem(LANG_KEY, next); } catch { /* storage unavailable */ }
  }

  useEffect(() => {
    if (alive(map) && data && installed) applyMapLang(map, data, lang);
  }, [map, data, installed, lang]);

  useEffect(() => {
    if (!alive(map) || !installed) return;
    const src = map.getSource<GeoJSONSource>('selection');
    if (!selection) src?.setData(EMPTY);
    else if (selection.kind === 'entity') src?.setData({ type: 'FeatureCollection', features: selection.segments ?? [selection.entity] });
    else src?.setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: selection.lngLat } });
    const zone = selection?.kind === 'entity' ? zoneOf(selection.entity) : undefined;
    map.getSource<GeoJSONSource>('zone')?.setData(zone ? { type: 'Feature', properties: {}, geometry: zone } : EMPTY);
  }, [map, installed, selection, zones]);

  // Keep the URL pointing at the current selection so it can be shared.
  useEffect(() => {
    if (!installed || !restored.current) return;
    if (!selection) setSelectionParam(null);
    else if (selection.kind === 'entity') setSelectionParam(`place=${selection.entity.properties.id}`);
    else setSelectionParam(`pin=${selection.lngLat[1].toFixed(5)},${selection.lngLat[0].toFixed(5)}`);
  }, [installed, selection]);

  // ---- selection helpers ----
  const padding = useCallback((): PaddingOptions => (isMobile
    ? { top: 80, bottom: Math.round(window.innerHeight * 0.55), left: 30, right: 30 }
    : { top: 90, bottom: 50, left: layersOpen ? 360 : 50, right: 420 }), [isMobile, layersOpen]);

  const selectEntity = useCallback((e: CityEntity, fly = true) => {
    if (!alive(map) || !data) return;
    const p = e.properties;
    const segments = p.type === 'road_segment' && p.name ? roadSegmentsByName(p.name, data.files.roads) : undefined;
    const layer = LAYER_BY_TYPE[p.type];
    if (layer) setVisible((v) => (v[layer.id] ? v : { ...v, [layer.id]: true }));
    setSelection({ kind: 'entity', entity: e, segments });
    if (isMobile) setLayersOpen(false);
    if (!fly) return;
    const zone = zoneOf(e);
    if (zone) map.fitBounds(bbox(zone) as [number, number, number, number], { padding: padding(), maxZoom: 16, duration: 1400 });
    else if (e.geometry.type === 'Point') map.flyTo({ center: e.geometry.coordinates as LngLat, zoom: Math.max(map.getZoom(), 16), padding: padding(), duration: 1400 });
    else map.fitBounds(bbox((segments ?? [e]).map((s) => s.geometry)) as [number, number, number, number], { padding: padding(), maxZoom: 16.5, duration: 1400 });
  }, [map, data, padding, isMobile, zones]);

  const selectRef = useRef(selectEntity);
  selectRef.current = selectEntity;

  // Open a shared link (#…&place=<id> or &pin=<lat>,<lng>) once the city is installed.
  useEffect(() => {
    if (!installed || !data || restored.current) return;
    restored.current = true;
    const hasView = !!getHashParam('view', INITIAL_HASH);
    const id = getHashParam('place', INITIAL_HASH);
    const pin = getHashParam('pin', INITIAL_HASH)?.split(',').map(Number);
    const e = id ? data.byId.get(decodeURIComponent(id)) : undefined;
    if (e) selectRef.current(e, !hasView);
    else if (pin?.length === 2 && pin.every(Number.isFinite) && inRegion([pin[1], pin[0]])) {
      setSelection({ kind: 'location', lngLat: [pin[1], pin[0]] });
      if (!hasView) map?.jumpTo({ center: [pin[1], pin[0]], zoom: 16 });
    } else if (id) setToast(t('That shared place is no longer in the map data'));
  }, [installed, data, map]);

  // ---- nearby ----
  const fitNearby = useCallback((p: LngLat, radius: number) => {
    map?.fitBounds(bbox(circle(p, radius)) as [number, number, number, number], { padding: padding(), duration: 900 });
  }, [map, padding]);

  const openNearby = useCallback((point: LngLat, label: string, fromId?: string) => {
    const radius = near?.radius ?? 1000;
    setNear({ origin: { point, label, fromId }, radius });
    setSelection(null);
    if (isMobile) setLayersOpen(false);
    fitNearby(point, radius);
  }, [near, isMobile, fitNearby]);

  function nearbyHere() {
    if (!alive(map)) return;
    const centre = () => { const c = map.getCenter(); openNearby([c.lng, c.lat], t('Around map centre')); };
    if (!navigator.geolocation) return centre();
    // The browser's own timeout only starts after permission is granted, so guard an unanswered prompt.
    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(fallback); fn(); } };
    const fallback = setTimeout(() => settle(centre), 7000);
    setToast(t('Finding your location…'));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => settle(() => {
        const p: LngLat = [coords.longitude, coords.latitude];
        if (inRegion(p)) { setToast(null); openNearby(p, t('Around you')); }
        else { setToast(t('You are outside Nashik — showing around the map centre')); centre(); }
      }),
      () => settle(() => { setToast(null); centre(); }),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60_000 },
    );
  }

  useEffect(() => {
    if (!alive(map) || !installed) return;
    const src = map.getSource<GeoJSONSource>('nearby');
    src?.setData(near ? { type: 'Feature', properties: {}, geometry: circle(near.origin.point, near.radius) } : EMPTY);
  }, [map, installed, near]);

  // Draggable handles: centre moves the search, edge knob resizes it. Dragging uses pointer
  // capture (not Marker's built-in drag, which misses a release over panels or off the map).
  const handles = useRef<{ c: maplibregl.Marker; e: maplibregl.Marker; dragging: { c: boolean; e: boolean } } | null>(null);
  const nearRef = useRef(near);
  nearRef.current = near;
  useEffect(() => () => { handles.current?.c.remove(); handles.current?.e.remove(); handles.current = null; }, [map]);
  useEffect(() => {
    if (!alive(map)) return;
    if (!near) { handles.current?.c.remove(); handles.current?.e.remove(); handles.current = null; return; }
    const edgeOf = (p: LngLat, r: number): LngLat => [p[0] + r / (111_195 * Math.cos((p[1] * Math.PI) / 180)), p[1]];
    if (!handles.current) {
      const dragging = { c: false, e: false };
      let raf = 0;
      const handle = (cls: string, label: string, which: 'c' | 'e', onMove: (ll: LngLat) => void, onEnd: () => void) => {
        const el = document.createElement('div');
        el.className = cls; el.title = label; el.setAttribute('aria-label', label); el.setAttribute('role', 'slider');
        el.addEventListener('pointerdown', (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          el.setPointerCapture(ev.pointerId);
          map.dragPan.disable();
          dragging[which] = true;
          const move = (m: PointerEvent) => {
            const r = map.getCanvasContainer().getBoundingClientRect();
            const ll = map.unproject([m.clientX - r.left, m.clientY - r.top]);
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => onMove([ll.lng, ll.lat]));
          };
          const up = () => {
            el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
            map.dragPan.enable();
            dragging[which] = false;
            onEnd();
          };
          el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
        });
        return new maplibregl.Marker({ element: el });
      };
      const c = handle('nearby-handle', t('Drag to move the search'), 'c', (p) => {
        const n = nearRef.current; if (!n) return;
        c.setLngLat(p); e.setLngLat(edgeOf(p, n.radius));
        setNear({ origin: { point: p, label: t('Around this point') }, radius: n.radius });
      }, () => {});
      const e = handle('nearby-handle nearby-handle-edge', t('Drag to resize the search'), 'e', (p) => {
        const n = nearRef.current; if (!n) return;
        e.setLngLat(p);
        const d = Math.min(5000, Math.max(100, distance(n.origin.point, p)));
        setNear({ ...n, radius: d < 1000 ? Math.round(d / 10) * 10 : Math.round(d / 50) * 50 });
      }, () => { const n = nearRef.current; if (n) e.setLngLat(edgeOf(n.origin.point, n.radius)); });
      c.setLngLat(near.origin.point).addTo(map);
      e.setLngLat(edgeOf(near.origin.point, near.radius)).addTo(map);
      handles.current = { c, e, dragging };
    }
    const h = handles.current;
    if (!h.dragging.c) h.c.setLngLat(near.origin.point);
    if (!h.dragging.e && !h.dragging.c) h.e.setLngLat(edgeOf(near.origin.point, near.radius));
  }, [map, near]);

  // ---- hover + click (registered once; uses refs for fresh callbacks) ----
  useEffect(() => {
    if (!alive(map) || !data || !installed) return;
    const interactive = LAYERS.flatMap((l) => l.interactive ?? []);
    let hovered: { source: string; id: string | number } | null = null;
    const query = (pt: maplibregl.Point, pad: number) =>
      map.queryRenderedFeatures([[pt.x - pad, pt.y - pad], [pt.x + pad, pt.y + pad]], { layers: interactive.filter((id) => map.getLayer(id)) });

    const onMove = (ev: maplibregl.MapMouseEvent) => {
      const f = query(ev.point, 4)[0];
      if (hovered && (!f || f.id !== hovered.id || f.source !== hovered.source)) { map.setFeatureState(hovered, { hover: false }); hovered = null; }
      if (f && f.id != null && !hovered) { hovered = { source: f.source, id: f.id }; map.setFeatureState(hovered, { hover: true }); }
      map.getCanvas().style.cursor = f ? 'pointer' : '';
    };
    // Right-click / long-press menu. Nearby drag handles are excluded from map clicks and presses.
    const onHandle = (ev: { originalEvent: Event }) => !!(ev.originalEvent.target as HTMLElement | null)?.closest?.('.nearby-handle');
    let press: ReturnType<typeof setTimeout> | undefined;
    let pressAt: maplibregl.Point | null = null;
    let suppressClick = false;
    const openMenu = (pt: maplibregl.Point, ll: maplibregl.LngLat) => setCtx({ x: pt.x, y: pt.y, lngLat: [ll.lng, ll.lat] });
    const onContext = (ev: maplibregl.MapMouseEvent) => { ev.preventDefault(); openMenu(ev.point, ev.lngLat); };
    const onTouchStart = (ev: maplibregl.MapTouchEvent) => {
      clearTimeout(press);
      if (ev.points.length !== 1 || onHandle(ev)) return;
      pressAt = ev.point;
      press = setTimeout(() => { suppressClick = true; openMenu(ev.point, ev.lngLat); navigator.vibrate?.(10); }, 550);
    };
    const onTouchMove = (ev: maplibregl.MapTouchEvent) => { if (pressAt && ev.point.dist(pressAt) > 8) clearTimeout(press); };
    const cancelPress = () => clearTimeout(press);
    const onMoveStart = () => { cancelPress(); if (ctxRef.current) setCtx(null); };

    const onClick = async (ev: maplibregl.MapMouseEvent) => {
      if (suppressClick) { suppressClick = false; return; }
      if (onHandle(ev)) return;
      if (ctxRef.current) { setCtx(null); return; }
      const f = query(ev.point, 6)[0];
      if (f?.properties.cluster) {
        const zoom = await map.getSource<GeoJSONSource>(f.source)!.getClusterExpansionZoom(f.properties.cluster_id);
        map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as LngLat, zoom: zoom + 0.3 });
        return;
      }
      const e = f && data.byId.get(f.properties.id);
      if (e) return selectRef.current(e, false);
      const base = map.queryRenderedFeatures(ev.point).find((x) => x.source === 'omt');
      setSelection({ kind: 'location', lngLat: [ev.lngLat.lng, ev.lngLat.lat], basemap: base && { layer: base.sourceLayer ?? base.layer.id, props: base.properties } });
    };
    map.on('mousemove', onMove);
    map.on('click', onClick);
    map.on('contextmenu', onContext);
    map.on('touchstart', onTouchStart);
    map.on('touchmove', onTouchMove);
    map.on('touchend', cancelPress);
    map.on('movestart', onMoveStart);
    return () => {
      cancelPress();
      map.off('mousemove', onMove); map.off('click', onClick); map.off('contextmenu', onContext);
      map.off('touchstart', onTouchStart); map.off('touchmove', onTouchMove); map.off('touchend', cancelPress); map.off('movestart', onMoveStart);
    };
  }, [map, data, installed]);

  function onPick(item: SearchItem) {
    if (!alive(map) || !data) return;
    setNear(null);
    if (item.kind === 'entity') selectEntity(item.entity);
    else if (item.kind === 'road') selectEntity(item.segments[0]);
    else {
      setVisible((v) => ({ ...v, [item.layer]: true }));
      setSelection(null);
      map.fitBounds(bbox((data.byType[item.type] ?? []).map((e) => e.geometry)) as [number, number, number, number], { padding: padding(), duration: 1400 });
      setToast(t('Showing {layer} layer', { layer: itemText(item, (type) => data.byType[type]?.length ?? 0).label.replace(/^(All|सर्व) /, '') }));
    }
  }

  function onPickNominatim(hit: NominatimHit) {
    setNear(null);
    map?.flyTo({ center: hit.lngLat, zoom: 16, padding: padding(), duration: 1400 });
    setSelection({ kind: 'location', lngLat: hit.lngLat, nominatim: hit });
  }

  const panelOpen = !!selection || !!near;
  const showLayers = layersOpen && !(isMobile && panelOpen);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* inline style: maplibre-gl.css (unlayered) would override Tailwind's layered `absolute` */}
      <div ref={container} style={{ position: 'absolute', inset: 0 }} aria-label={t('Interactive map of Nashik')} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-paper/70 to-transparent" />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start gap-2.5 p-3 md:gap-3 md:p-4">
        <div className="glass pointer-events-auto flex h-12 shrink-0 items-center gap-3 rounded-2xl px-3.5 md:px-4">
          <Logo />
          <div className="hidden leading-none sm:block">
            <div className="font-display text-[19px] font-semibold tracking-[-0.01em] text-fg">Nashik <span className="text-saffron italic">2030</span></div>
            <div className="mt-1 text-[9px] font-semibold tracking-[0.32em] text-muted uppercase">{t('City atlas · digital twin')}</div>
          </div>
        </div>
        <div className="pointer-events-auto min-w-0 flex-1 md:max-w-[440px] md:flex-none md:basis-[440px]">
          <SearchBar data={data} onPick={onPick} onPickNominatim={onPickNominatim} />
        </div>
        <button
          onClick={switchLang}
          lang={lang === 'mr' ? 'en' : 'mr'}
          aria-label={lang === 'mr' ? t('Switch to English') : t('Switch to Marathi')}
          title={lang === 'mr' ? t('Switch to English') : t('Switch to Marathi')}
          className="glass pointer-events-auto order-last flex h-12 shrink-0 items-center rounded-2xl px-3.5 text-[14px] font-semibold text-fg hover:border-accent/30 md:ml-auto"
        >
          {lang === 'mr' ? 'EN' : 'मराठी'}
        </button>
        {live && !isMobile && (
          <div className="pointer-events-auto relative">
            <LivePill feeds={live} open={liveOpen} onToggle={() => setLiveOpen((o) => !o)} />
            {liveOpen && (
              <aside className="glass rise absolute top-14 left-0 z-30 flex max-h-[calc(100vh-110px)] w-[340px] flex-col rounded-2xl" aria-label={t('Live Nashik')}>
                <LiveCard feeds={live} onClose={() => setLiveOpen(false)} />
              </aside>
            )}
          </div>
        )}
      </div>

      {/* Layer manager: left panel on desktop, bottom sheet on mobile */}
      {showLayers ? (
        <aside className="glass rise absolute z-20 flex flex-col max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[68vh] max-md:rounded-t-3xl max-md:pb-[env(safe-area-inset-bottom)] md:top-[84px] md:left-4 md:max-h-[calc(100%-124px)] md:w-[320px] md:rounded-2xl">
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-ink/15 md:hidden" />
          <LayerPanel
            visible={visible}
            onToggle={(id, on) => setVisible((v) => ({ ...v, [id]: on }))}
            data={data}
            onShowSources={() => setSourcesOpen(true)}
            onClose={() => setLayersOpen(false)}
            filters={filters}
            onFilters={(id, ids) => setFilters((f) => ({ ...f, [id]: ids }))}
          />
        </aside>
      ) : (
        <button
          onClick={() => { setLayersOpen(true); if (isMobile) { setSelection(null); setNear(null); } }}
          className="glass absolute z-20 flex h-11 items-center gap-2 rounded-2xl px-4 text-[13.5px] font-medium text-fg hover:border-accent/30 max-md:bottom-[max(1rem,env(safe-area-inset-bottom))] max-md:left-3 md:top-[84px] md:left-4"
          style={isMobile && panelOpen ? { display: 'none' } : undefined}
        >
          <Icon name="layers" /> {t('Layers')}
        </button>
      )}

      {/* Inspector: right panel on desktop, bottom sheet on mobile */}
      {selection && data && (
        <aside key={selection.kind === 'entity' ? selection.entity.properties.id : selection.lngLat.join()} className="glass rise absolute z-20 flex flex-col max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[55vh] max-md:rounded-t-3xl max-md:pb-[env(safe-area-inset-bottom)] md:top-[84px] md:right-4 md:max-h-[calc(100%-124px)] md:w-[380px] md:rounded-2xl" aria-label={t('Feature details')}>
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-ink/15 md:hidden" />
          <Inspector
            selection={selection}
            data={data}
            onSelect={(e) => selectEntity(e)}
            onClose={() => { setSelection(null); setNear(null); }}
            onNearby={openNearby}
            zone={selection.kind === 'entity' ? zoneOf(selection.entity) : undefined}
            onBack={near ? () => { setSelection(null); fitNearby(near.origin.point, near.radius); } : undefined}
          />
        </aside>
      )}
      {!selection && near && data && (
        <aside key="nearby" className="glass rise absolute z-20 flex flex-col max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[60vh] max-md:rounded-t-3xl max-md:pb-[env(safe-area-inset-bottom)] md:top-[84px] md:right-4 md:max-h-[calc(100%-124px)] md:w-[380px] md:rounded-2xl" aria-label={t('Nearby places')}>
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-ink/15 md:hidden" />
          <Nearby
            origin={near.origin}
            radius={near.radius}
            onRadius={(radius) => { setNear({ ...near, radius }); fitNearby(near.origin.point, radius); }}
            data={data}
            onSelect={(e) => selectEntity(e)}
            onClose={() => setNear(null)}
          />
        </aside>
      )}

      {map && <MapControls map={map} hidden={isMobile && (panelOpen || showLayers || legendOpen)} raised={!isMobile && panelOpen} onToast={setToast} onNearby={nearbyHere} onLegend={() => setLegendOpen((o) => !o)} legendOpen={legendOpen} />}
      {legendOpen && (
        <aside
          className={`glass rise absolute z-20 flex flex-col max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[55vh] max-md:rounded-t-3xl max-md:pb-[env(safe-area-inset-bottom)] md:bottom-10 md:max-h-[calc(100%-160px)] md:w-[260px] md:rounded-2xl ${panelOpen ? 'md:right-[468px]' : 'md:right-[72px]'}`}
          aria-label={t('Map legend')}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-ink/15 md:hidden" />
          <Legend visible={visible} onClose={() => setLegendOpen(false)} />
        </aside>
      )}
      {map && !isMobile && <CursorReadout map={map} />}

      {!data && !toast && (
        <div className="glass absolute top-[84px] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2.5 rounded-full px-4 py-2 text-[12.5px] text-muted max-md:top-[72px]">
          <span className="size-3 animate-spin rounded-full border-2 border-accent/25 border-t-accent" /> {t('Loading Nashik city data…')}
        </div>
      )}
      {toast && (
        <div role="status" className="glass absolute top-[84px] left-1/2 z-40 -translate-x-1/2 rounded-full px-4 py-2 text-[13px] text-fg max-md:top-[72px] max-md:w-[calc(100%-24px)] max-md:text-center">
          {toast}
        </div>
      )}
      {ctx && map && (
        <MapMenu
          ctx={ctx}
          onClose={() => setCtx(null)}
          onNearby={() => openNearby(ctx.lngLat, t('Around this point'))}
          onPin={() => {
            const pt = map.project(ctx.lngLat);
            const base = map.queryRenderedFeatures(pt).find((x) => x.source === 'omt');
            setNear(null);
            setSelection({ kind: 'location', lngLat: ctx.lngLat, basemap: base && { layer: base.sourceLayer ?? base.layer.id, props: base.properties } });
          }}
          onToast={setToast}
          describe={(p) => (data ? describePoint(p, { places: data.files.places, roads: data.files.roads, localities: data.files.localities }).text : '')}
        />
      )}
      {live && !bannerDismissed && (
        <div className="pointer-events-auto absolute top-[76px] left-1/2 z-30 w-[min(560px,calc(100%-24px))] -translate-x-1/2 max-md:top-[68px]">
          <WarningBanner imd={live.imd} onDismiss={() => setBannerDismissed(true)} />
        </div>
      )}
      {live && isMobile && !panelOpen && !showLayers && !legendOpen && !liveOpen && (
        <div className="absolute bottom-[max(4.25rem,calc(env(safe-area-inset-bottom)+3.25rem))] left-3 z-20">
          <LivePill feeds={live} open={false} onToggle={() => setLiveOpen(true)} />
        </div>
      )}
      {live && isMobile && liveOpen && (
        <aside className="glass rise absolute inset-x-0 bottom-0 z-30 flex max-h-[65vh] flex-col rounded-t-3xl pb-[env(safe-area-inset-bottom)]" aria-label={t('Live Nashik')}>
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-ink/15" />
          <LiveCard feeds={live} onClose={() => setLiveOpen(false)} />
        </aside>
      )}
      {sourcesOpen && <SourcesDialog data={data} onClose={() => setSourcesOpen(false)} />}
    </div>
  );
}

function MapMenu({ ctx, onClose, onNearby, onPin, onToast, describe }: {
  ctx: { x: number; y: number; lngLat: LngLat };
  onClose: () => void;
  onNearby: () => void;
  onPin: () => void;
  onToast: (m: string) => void;
  describe: (p: LngLat) => string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Ignore the synthetic click some browsers send when the long-press finger lifts.
  const openedAt = useRef(performance.now());
  const dismiss = () => { if (performance.now() - openedAt.current > 400) onClose(); };
  const [lng, lat] = ctx.lngLat;
  const coords = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const copy = async (text: string, done: string) => {
    try { await navigator.clipboard.writeText(text); onToast(done); } catch { onToast(t('Copying is not available here')); }
  };
  const view = location.hash.slice(1).split('&').find((p) => p.startsWith('view='));
  const url = `${location.origin}${location.pathname}#${[view, `pin=${coords.replace(' ', '')}`].filter(Boolean).join('&')}`;
  async function share() {
    if (navigator.share) { try { await navigator.share({ title: t('A spot in Nashik'), url }); } catch { /* cancelled */ } }
    else copy(url, t('Link to this spot copied'));
  }
  async function shareDirections() {
    const text = describe(ctx.lngLat);
    if (navigator.share) { try { await navigator.share({ title: t('How to find this spot'), text, url }); } catch { /* cancelled */ } }
    else copy(`${text}\n${url}`, t('Directions copied with link'));
  }
  const item = (icon: IconName, label: string, run: () => void) => (
    <button role="menuitem" onClick={() => { onClose(); run(); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] text-fg/90 hover:bg-ink/[0.05] focus-visible:bg-ink/[0.05] focus-visible:outline-none">
      <Icon name={icon} className="size-4 text-accent" />{label}
    </button>
  );
  const x = Math.min(Math.max(ctx.x, 8), window.innerWidth - 228), y = Math.min(Math.max(ctx.y, 8), window.innerHeight - 220);
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={dismiss} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div role="menu" aria-label={t('Actions for {coords}', { coords })} className="glass rise fixed z-50 w-[220px] rounded-xl p-1" style={{ left: x, top: y }}>
        <p className="px-3 pt-1.5 pb-1 font-mono text-[11px] text-muted">{coords}</p>
        {item('nearby', t("What's nearby here"), onNearby)}
        {item('pin', t('Drop a pin here'), onPin)}
        {item('share', t('Share as directions'), shareDirections)}
        {item('external', t('Share link only'), share)}
        {item('copy', t('Copy coordinates'), () => copy(coords, t('Coordinates copied')))}
      </div>
    </>
  );
}

function Logo() {
  return <img src={`${import.meta.env.BASE_URL}logo-192.png`} alt="" width={36} height={36} className="size-9 shrink-0" />;
}

function CtrlButton({ icon, label, onClick, children }: { icon?: IconName; label: string; onClick: () => void; children?: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="grid size-11 place-items-center text-fg/75 transition hover:bg-ink/[0.05] hover:text-fg active:bg-ink/10">
      {children ?? <Icon name={icon!} className="size-[18px]" />}
    </button>
  );
}

function MapControls({ map, hidden, raised, onToast, onNearby, onLegend, legendOpen }: { map: MLMap; hidden: boolean; raised: boolean; onToast: (m: string) => void; onNearby: () => void; onLegend: () => void; legendOpen: boolean }) {
  const [bearing, setBearing] = useState(0);
  const marker = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    const u = () => setBearing(map.getBearing());
    map.on('move', u); u();
    return () => { map.off('move', u); };
  }, [map]);

  function locate() {
    if (!navigator.geolocation) return onToast(t('Geolocation is not supported by this browser'));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const p: LngLat = [coords.longitude, coords.latitude];
        if (!inRegion(p)) return onToast(t('You are outside the Nashik coverage area'));
        const el = document.createElement('div'); el.className = 'locate-dot';
        marker.current?.remove();
        marker.current = new maplibregl.Marker({ element: el }).setLngLat(p).addTo(map);
        map.flyTo({ center: p, zoom: Math.max(map.getZoom(), 15.5) });
      },
      () => onToast(t('Location permission denied or unavailable')),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  if (hidden) return null;
  return (
    <div className={`absolute right-3 z-20 flex flex-col gap-2 md:right-4 ${raised ? 'md:right-[412px]' : ''} bottom-[max(2.5rem,calc(env(safe-area-inset-bottom)+1rem))]`}>
      <div className="glass flex flex-col divide-y divide-ink/[0.07] overflow-hidden rounded-2xl">
        <CtrlButton icon="plus" label={t('Zoom in')} onClick={() => map.zoomIn()} />
        <CtrlButton icon="minus" label={t('Zoom out')} onClick={() => map.zoomOut()} />
      </div>
      <div className="glass flex flex-col divide-y divide-ink/[0.07] overflow-hidden rounded-2xl">
        <CtrlButton label={t('Reset bearing to north')} onClick={() => map.resetNorth()}>
          <svg viewBox="0 0 24 24" className="size-5" style={{ transform: `rotate(${-bearing}deg)` }} aria-hidden="true">
            <path d="M12 3l3.5 9h-7z" fill="#b8402f" /><path d="M12 21l-3.5-9h7z" fill="currentColor" opacity="0.35" />
          </svg>
        </CtrlButton>
        <CtrlButton icon="nearby" label={t("What's nearby")} onClick={onNearby} />
        <CtrlButton icon="locate" label={t('Show my location')} onClick={locate} />
        <CtrlButton icon="home" label={t('Reset view to Nashik')} onClick={() => map.flyTo({ center: NASHIK_CENTER, zoom: 12.4, bearing: 0 })} />
        <CtrlButton icon="legend" label={legendOpen ? t('Hide legend') : t('Show legend')} onClick={onLegend} />
      </div>
    </div>
  );
}

function CursorReadout({ map }: { map: MLMap }) {
  const [s, setS] = useState<{ lng: number; lat: number; z: number } | null>(null);
  useEffect(() => {
    const u = (e: maplibregl.MapMouseEvent) => setS({ lng: e.lngLat.lng, lat: e.lngLat.lat, z: map.getZoom() });
    map.on('mousemove', u);
    return () => { map.off('mousemove', u); };
  }, [map]);
  if (!s) return null;
  return (
    <div className="pointer-events-none absolute bottom-[34px] left-[10px] z-10 rounded bg-paper/75 px-1.5 py-0.5 font-mono text-[10.5px] tracking-wide text-muted">
      {s.lat.toFixed(5)}° N · {s.lng.toFixed(5)}° E · z{s.z.toFixed(1)}
    </div>
  );
}
