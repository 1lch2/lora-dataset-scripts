import { request } from '../../../api/client';
import type { DenoiseInfo, DenoiseOptions } from './types';

export const getDenoiseInfo = () => request<DenoiseInfo>('/api/denoise/status');
export const loadDenoiseModels = (token: string) => request<DenoiseInfo>('/api/denoise/models', {}, token);

export async function executeDenoise(file: File, options: DenoiseOptions, token: string) {
  const image = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(Error('无法读取所选图片'));
    reader.readAsDataURL(file);
  });
  return request<DenoiseInfo>('/api/denoise/start', { ...options, image, name: file.name }, token);
}

export const getDenoiseImageUrl = (id: string, kind: 'original' | 'output') =>
  `/api/denoise/image?id=${encodeURIComponent(id)}&kind=${kind}`;
