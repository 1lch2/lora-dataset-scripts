import type { TagAuditOptions } from '../../../../api/types';

export interface AuditSettingsProps {
  options: TagAuditOptions;
  forbidden: string;
  disabled: boolean;
  onOptionsChange: (options: TagAuditOptions) => void;
  onForbiddenChange: (value: string) => void;
}
