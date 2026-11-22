export type ToastVariant = 'info' | 'error' | 'success';

export interface ToastMessage {
  text: string;
  variant: ToastVariant;
  persistent?: boolean;
}

export interface ToastProps {
  message: ToastMessage | null;
  onDismiss: (message: ToastMessage) => void;
}
