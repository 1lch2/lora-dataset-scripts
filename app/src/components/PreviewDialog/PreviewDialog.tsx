import { useEffect, useRef } from 'react';
import type { PreviewDialogProps } from './types';

export function PreviewDialog({ image, alt, onClose }: PreviewDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (image) ref.current!.showModal();
    else ref.current!.close();
  }, [image]);
  return (
    <dialog id='preview' ref={ref} onClose={onClose}>
      <button id='closePreview' onClick={onClose}>
        关闭
      </button>
      <img alt={alt} src={image || undefined} />
    </dialog>
  );
}
