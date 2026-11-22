export interface Metric {
  count: number;
  mean: number;
  median: number;
  p05: number;
  p95: number;
  histogram: number[];
  edges: number[];
}
export interface Pair {
  a: string;
  b: string;
  distance: number;
}
export interface AnalysisRecord {
  file: string;
  width: number;
  height: number;
  brightness: number;
  highlights: number;
  shadows: number;
  contrast: number;
  saturation: number;
  detail: number;
  person_area?: number;
  flags: string[];
  transparency?: boolean;
  [key: string]: string | number | boolean | string[] | undefined;
}
export interface AnalysisReport {
  schema_version: number;
  total: number;
  successful: number;
  failed: number;
  settings: Record<string, unknown>;
  summary: Record<string, Metric>;
  pixel_histogram: number[];
  errors: { file: string; error: string }[];
  warnings: string[];
  records: AnalysisRecord[];
  duplicates: {
    exact_groups: string[][];
    exact_extra: number;
    sampled: number;
    population: number;
    compared_pairs: number;
    near_count: number;
    near_members: number;
    near_pairs: Pair[];
    flat_excluded: number;
  };
  pose: {
    enabled: boolean;
    attempted: number;
    detected: number;
    usable: number;
    error?: string;
    sampled: number;
    comparable_pairs: number;
    similar_pairs: number;
    similar_images: number;
    pairs: Pair[];
  };
  captions: { enabled: boolean; read: number; tags: [string, number][] };
}
export interface AnalysisStatus {
  status: string;
  phase?: string;
  total: number;
  done: number;
  error?: string;
  log_path?: string;
}
export interface BaselineReport {
  schema_version: number;
  settings?: Record<string, unknown>;
  summary: Record<string, Metric>;
}
