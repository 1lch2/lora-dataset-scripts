import { useEffect, useRef } from 'react';
import { useReviewContext } from '../../../context';

export function PreviewDialog() {
  const { previewImage, setPreviewImage } = useReviewContext();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (previewImage) ref.current!.showModal();
    else ref.current!.close();
  }, [previewImage]);
  return (
    <dialog id='preview' ref={ref} onClose={() => setPreviewImage('')}>
      <button id='closePreview' onClick={() => setPreviewImage('')}>
        关闭
      </button>
      <img alt='样本大图' src={previewImage || undefined} />
    </dialog>
  );
}
