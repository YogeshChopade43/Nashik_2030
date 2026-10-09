import type { Feature, Geometry } from 'geojson';

/**
 * City entity model — the shared spatial vocabulary for Nashik 2030.
 * Every entity is a GeoJSON Feature whose properties carry a stable ID and provenance.
 *
 * Derived (not stored) entities:
 *   Road         = all road_segment entities sharing a normalised name (see roadSegmentsByName)
 * Not yet available (no open data, see public/data/metadata.json → unavailable):
 *   Ward, Intersection, BusRoute
 */
export type EntityType =
  | 'city'
  | 'locality'
  | 'admin_boundary'
  | 'road_segment'
  | 'river'
  | 'water_body'
  | 'park'
  | 'hospital'
  | 'school'
  | 'college'
  | 'market'
  | 'religious'
  | 'tourism'
  | 'government'
  | 'bus_stop'
  | 'railway_station';

export interface EntityProps {
  /** Stable ID: `<prefix>_<n|w|r><osm id>`, e.g. `place_n1671916246`. */
  id: string;
  type: EntityType;
  name: string | null;
  /** Name in the local script (Marathi/Devanagari) when distinct from `name`. */
  name_local: string | null;
  category: string | null;
  source: 'openstreetmap';
  /** Source-native ID, e.g. `node/1671916246`. */
  source_id: string;
  /** Last edit time of the source element. */
  updated_at: string | null;
  /** Whitelisted source tags (address, phone, lanes, …). Absent = not available. */
  tags: Record<string, string>;
}

export type CityEntity = Feature<Geometry, EntityProps>;

export interface DatasetMeta {
  file: string;
  description: string;
  features: number;
  source: string;
  license: string;
  osm_data_timestamp: string | null;
}

export interface Metadata {
  extracted_at: string;
  bbox: { south: number; west: number; north: number; east: number };
  processing: string[];
  unavailable: { layer: string; reason: string }[];
  datasets: Record<string, DatasetMeta>;
}
