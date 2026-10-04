export interface CompositeRequest {
  directory: string;
  output_directory: string;
  forge_url: string;
  recursive: boolean;
}

export interface RemovedAction {
  tag: string;
  score: number;
  winner: string;
  winner_score: number;
  reason: string;
}

export interface CompositeResult {
  file: string;
  tags: number;
  single_person: boolean;
  person_reason: string;
  removed: RemovedAction[];
  unresolved: { tags: string[]; reason: string }[];
}

export interface CompositeStatus {
  status: 'idle' | 'running' | 'cancelling' | 'cancelled' | 'complete' | 'failed';
  phase?: string;
  current?: string;
  done: number;
  total: number;
  skipped?: number;
  output_directory?: string;
  dataset_directory?: string;
  probability_directory?: string;
  results: CompositeResult[];
  errors: { file: string; error: string }[];
}
