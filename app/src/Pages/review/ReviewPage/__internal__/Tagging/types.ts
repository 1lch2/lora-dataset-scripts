import type { TaggingEvidence } from '../../../../../api/types';

export interface ScoreRow {
  key: string;
  name: string;
  sample: string;
  wd?: number;
  pixai?: number;
  removed: boolean;
}

export interface ScoredSample {
  key: string;
  source: string;
  candidate: string;
  name: string;
  evidence: TaggingEvidence;
  removed: string[];
}
