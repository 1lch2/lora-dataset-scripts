import type {
  EditRequest,
  TagAuditFeature,
  TagAuditFeatureFields,
  TagAuditFeatureSample,
  TagAuditFinding,
  TagAuditReference,
} from '../../api/types';

export type AuditMode = 'anomaly' | 'feature' | 'costume';
export type AuditSection = AuditMode | 'settings';
export type AuditCategory = 'all' | Exclude<TagAuditFinding['category'], 'feature' | 'costume'>;
export type AuditStatus = 'all' | TagAuditFinding['status'];
type ResultStatus = Exclude<AuditStatus, 'all'> | Exclude<TagAuditFeatureSample['status'], 'present'>;
export type AuditFilter = ResultStatus | 'all' | 'alternate';
export type AuditRetryStatus = 'failed' | 'uncertain';
export type AuditClearStatus = AuditRetryStatus | 'pending' | 'stale';

export type AuditConfirmation =
  | { action: 'supplement'; ids: string[]; tags: string[] }
  | {
      action: 'clear';
      mode: AuditMode;
      status: AuditClearStatus;
      category: AuditCategory;
      count: number;
      runDir: string;
      auditRunId?: string;
    };

export interface AuditEditRequest extends EditRequest {
  retryStatus?: AuditRetryStatus;
  retrySample?: TagAuditReference;
}

export interface AuditRow {
  id: string;
  source: string;
  candidate: string;
  name: string;
  status: ResultStatus;
  alternate?: boolean;
  reason?: string;
  finding?: TagAuditFinding;
}

export type FeatureEdit =
  | {
      action: 'save';
      feature?: TagAuditFeature;
      fields: TagAuditFeatureFields;
    }
  | { action: 'delete'; feature: TagAuditFeature };
