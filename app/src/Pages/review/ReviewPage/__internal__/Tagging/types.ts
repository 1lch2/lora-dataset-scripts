import type { TaggingEvidence } from '../../../../../api/types';

export type ResultGroup = 'common' | 'wd' | 'pixai' | 'filtered';
export type ResultView = ResultGroup | 'kept' | 'changes';

export interface ScoreRow {
  key: string;
  name: string;
  sample: string;
  wd?: number;
  pixai?: number;
  removed: boolean;
  saved: boolean;
}

export interface ScoredSample {
  key: string;
  source: string;
  candidate: string;
  name: string;
  evidence: TaggingEvidence;
  removed: string[];
  tags: string[];
  image: string;
}
