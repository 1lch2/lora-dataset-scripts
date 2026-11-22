import type { ToastVariant } from '../../components/Toast';

export interface LoraToolsPageProps {
  token: string;
  defaultDirectory: string;
  active: boolean;
  onToast: (message: string, variant: ToastVariant) => void;
}
