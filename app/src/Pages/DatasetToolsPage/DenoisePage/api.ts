import { request } from '../../../api/client';
import { readImageData } from '../readImageData';
import type { DenoiseInfo, DenoiseOptions } from './types';

export const getDenoiseInfo = () => request<DenoiseInfo>('/api/denoise/status');
export const loadDenoiseModels = (token: string) => request<DenoiseInfo>('/api/denoise/models', {}, token);

export async function executeDenoise(file: File, options: DenoiseOptions, token: string) {
  const image = await readImageData(file);
  return request<DenoiseInfo>('/api/denoise/start', { ...options, image, name: file.name }, token);
}

export const getDenoiseImageUrl = (id: string, kind: 'original' | 'output') =>
  `/api/denoise/image?id=${encodeURIComponent(id)}&kind=${kind}`;
