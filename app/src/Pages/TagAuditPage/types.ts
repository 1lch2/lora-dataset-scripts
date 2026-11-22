import type {
  TagAuditFeature,
  TagAuditFeatureFields,
  TagAuditFeatureSample,
  TagAuditFinding,
} from '../../api/types';

export type AuditCategory = 'all' | Exclude<TagAuditFinding['category'], 'feature'>;
export type AuditStatus = 'all' | TagAuditFinding['status'];
export type FeatureStatus = AuditStatus | Exclude<TagAuditFeatureSample['status'], 'present'>;

export interface AuditRow {
  id: string;
  source: string;
  candidate: string;
  name: string;
  status: Exclude<FeatureStatus, 'all'>;
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
