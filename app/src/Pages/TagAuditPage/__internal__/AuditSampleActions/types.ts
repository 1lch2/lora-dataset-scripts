export interface AuditSampleActionsProps {
  name: string;
  tags: string[];
  disabled: boolean;
  onRetry: () => void;
  onSave: (tags: string[]) => Promise<boolean>;
}
