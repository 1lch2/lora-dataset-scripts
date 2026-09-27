export type Box = [number, number, number, number];
export interface Tag {
  tags: string[];
  image: string;
  auto_removed: string[];
  restore_raw?: boolean;
  suggestions?: string[];
}
export interface Candidate {
  id: string;
  kind: string;
  aliases?: string[];
  status: string;
  box?: Box;
  tag?: Tag;
  tag_current: boolean;
}
export interface Source {
  id: string;
  active: boolean;
  group: string;
  relative: string;
  scale: number;
  error?: string;
  notes?: string[];
  working?: string;
  person_index?: number;
  detection?: { persons: { score: number }[] };
  candidates: Candidate[];
}
export interface RunInfo {
  sources: Record<string, Source>;
  updated_at: string;
  drop_tags_override?: string[];
  config: { run_dir: string; output_dir: string; min_area: number; drop_tags: string[] };
}
export interface SessionInfo {
  token: string;
  analysisOnly: boolean;
}
export interface JobInfo {
  id?: string;
  status: string;
  action?: string;
  total: number;
  done: number;
  count?: number;
  errors: string[];
}
export interface PreviewInfo {
  total: number;
  changed: number;
  examples: { name: string; before: string[]; after: string[] }[];
}
export interface EditResult {
  ok: boolean;
  result: { id?: string } & Partial<PreviewInfo>;
}
export interface EditRequest {
  action: string;
  [key: string]: unknown;
}
export type TagImage = [Source, Candidate & { tag: Tag }];
