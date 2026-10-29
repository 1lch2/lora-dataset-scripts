import type { TaggingFilters } from '../../../../../api/types';
import type { ResultGroup, ScoreRow } from './types';

export const DEFAULT_FILTERS: TaggingFilters = { wd: 0.3, pixai: 0.4, commonWd: 0.2, commonPixai: 0.2 };

export function keepTag(row: ScoreRow, filters: TaggingFilters) {
  return tagGroup(row, filters) !== 'filtered';
}

export function tagGroup(row: ScoreRow, filters: TaggingFilters): ResultGroup {
  if (row.removed) return 'filtered';
  if (
    row.wd !== undefined &&
    row.pixai !== undefined &&
    row.wd >= filters.commonWd &&
    row.pixai >= filters.commonPixai
  )
    return 'common';
  if (row.wd !== undefined && row.wd >= filters.wd) return 'wd';
  if (row.pixai !== undefined && row.pixai >= filters.pixai) return 'pixai';
  return 'filtered';
}

export function scoreBin(score?: number) {
  return score === undefined ? 0 : Math.min(9, Math.floor(score * 10)) + 1;
}

export function binLabel(bin: number) {
  if (bin === 0) return '未返回';
  return `${((bin - 1) / 10).toFixed(1)}–${(bin / 10).toFixed(1)}`;
}
