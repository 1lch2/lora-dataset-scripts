import type { TagAuditFinding } from '../../../../../api/types';

export type AuditCategory = 'all' | TagAuditFinding['category'];
export type AuditStatus = 'all' | TagAuditFinding['status'];
