import { useEffect, useRef, useState } from 'react';
import type { SelectedImage } from './types';

export function useImageSelection() {
  const [image, setImage] = useState<SelectedImage>();
  const [inputError, setInputError] = useState('');
  const [reading, setReading] = useState(false);
  const selection = useRef(0);

  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url);
    },
    [image],
  );
  useEffect(
    () => () => {
      selection.current += 1;
    },
    [],
  );

  async function selectImage(file: File) {
    const current = ++selection.current;
    setInputError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setInputError('请选择 PNG、JPEG 或 WebP 图片');
      return false;
    }
    if (file.size > 20 * 1024 * 1024) {
      setInputError('图片文件不能超过 20 MiB');
      return false;
    }
    setReading(true);
    const url = URL.createObjectURL(file);
    const preview = new Image();
    preview.src = url;
    try {
      await preview.decode();
      if (current !== selection.current) {
        URL.revokeObjectURL(url);
        return false;
      }
      setImage({ file, url, width: preview.naturalWidth, height: preview.naturalHeight });
      return true;
    } catch {
      URL.revokeObjectURL(url);
      setInputError('无法读取图片，请确认文件未损坏且格式为 PNG、JPEG 或 WebP');
      return false;
    } finally {
      if (current === selection.current) setReading(false);
    }
  }

  return { image, inputError, reading, selectImage };
}
