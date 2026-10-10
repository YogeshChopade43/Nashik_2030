// Trails and elevation. OSM hiking routes are relations of unordered ways; chainLines joins them
// into walkable paths. Elevation comes from the same open Terrain Tiles the hillshade uses
// (Terrarium PNGs, ~30 m SRTM-based DEM), decoded in the browser, so it is approximate.
import { distance, type LngLat } from './geo.ts';

const key = (p: LngLat) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
const lengthOf = (l: LngLat[]) => l.reduce((s, p, i) => (i ? s + distance(l[i - 1], p) : 0), 0);

/** Join ways that share endpoints (either direction) into continuous lines, longest first. */
export function chainLines(lines: LngLat[][]): LngLat[][] {
  const pool = lines.filter((l) => l.length > 1).map((l) => [...l]);
  const out: LngLat[][] = [];
  while (pool.length) {
    let path = pool.shift()!;
    for (let grew = true; grew;) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i], s = key(path[0]), e = key(path[path.length - 1]), a = key(l[0]), b = key(l[l.length - 1]);
        let joined: LngLat[] | null = null;
        if (e === a) joined = [...path, ...l.slice(1)];
        else if (e === b) joined = [...path, ...[...l].reverse().slice(1)];
        else if (s === b) joined = [...l, ...path.slice(1)];
        else if (s === a) joined = [...[...l].reverse(), ...path.slice(1)];
        if (joined) { path = joined; pool.splice(i, 1); grew = true; break; }
      }
    }
    out.push(path);
  }
  return out.sort((x, y) => lengthOf(y) - lengthOf(x));
}

/** `n` evenly spaced points along a line, each with its distance from the start in metres. */
export function samplePath(line: LngLat[], n: number): { p: LngLat; d: number }[] {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + distance(line[i - 1], line[i]));
  const total = cum[cum.length - 1];
  const out: { p: LngLat; d: number }[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const d = (total * k) / (n - 1);
    while (j < line.length - 1 && cum[j] < d) j++;
    const seg = cum[j] - cum[j - 1], t = seg ? (d - cum[j - 1]) / seg : 0;
    const [a, b] = [line[j - 1], line[j]];
    out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d });
  }
  return out;
}

const NOISE_M = 10; // DEM noise; smaller rises and dips are not counted as climbing

/** Total ascent/descent (with a 10 m hysteresis against DEM noise) and the elevation range. */
export function climb(elev: number[]) {
  let up = 0, down = 0, ref = elev[0];
  for (const v of elev) {
    if (v - ref >= NOISE_M) { up += v - ref; ref = v; }
    else if (ref - v >= NOISE_M) { down += ref - v; ref = v; }
  }
  return { up: Math.round(up), down: Math.round(down), min: Math.round(Math.min(...elev)), max: Math.round(Math.max(...elev)) };
}

/** Terrarium PNG encoding → metres. */
export const terrarium = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

/** Web-Mercator tile containing a point, and the pixel inside it (256 px tiles). */
export function tileOf(lng: number, lat: number, z: number) {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  const fx = ((lng + 180) / 360) * n, fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const x = Math.floor(fx), y = Math.floor(fy);
  // fpx/fpy: fractional pixel position, for bilinear interpolation between DEM pixels.
  return { x, y, px: Math.min(255, Math.floor((fx - x) * 256)), py: Math.min(255, Math.floor((fy - y) * 256)), fpx: (fx - x) * 256, fpy: (fy - y) * 256 };
}

const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const DEM_ZOOM = 12; // ~35 m pixels at Nashik's latitude, about the DEM's real resolution
const tiles = new Map<string, Promise<ImageData>>();

function loadTile(x: number, y: number): Promise<ImageData> {
  const k = `${x}/${y}`;
  if (!tiles.has(k)) {
    const p = fetch(`${DEM_URL}/${DEM_ZOOM}/${x}/${y}.png`)
      .then((r) => { if (!r.ok) throw new Error(`DEM ${r.status}`); return r.blob(); })
      .then(createImageBitmap)
      .then((bmp) => { const c = new OffscreenCanvas(256, 256).getContext('2d')!; c.drawImage(bmp, 0, 0); return c.getImageData(0, 0, 256, 256); });
    p.catch(() => tiles.delete(k)); // retry on next request
    tiles.set(k, p);
  }
  return tiles.get(k)!;
}

/** Elevation in metres for each point (browser only). */
export async function elevations(points: LngLat[]): Promise<number[]> {
  return Promise.all(points.map(async ([lng, lat]) => {
    const t = tileOf(lng, lat, DEM_ZOOM);
    const img = await loadTile(t.x, t.y);
    // Bilinear between the 4 nearest pixel centres (clamped at the tile edge), so short trails
    // don't render as a staircase of ~35 m DEM pixels.
    const at = (px: number, py: number) => { const i = (py * 256 + px) * 4; return terrarium(img.data[i], img.data[i + 1], img.data[i + 2]); };
    const cx = Math.max(0, Math.min(255, t.fpx - 0.5)), cy = Math.max(0, Math.min(255, t.fpy - 0.5));
    const x0 = Math.floor(cx), y0 = Math.floor(cy), x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1), ax = cx - x0, ay = cy - y0;
    return (at(x0, y0) * (1 - ax) + at(x1, y0) * ax) * (1 - ay) + (at(x0, y1) * (1 - ax) + at(x1, y1) * ax) * ay;
  }));
}
