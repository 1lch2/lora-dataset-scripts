import { request } from '../../../api/client';
import { readImageData } from '../readImageData';
import type { ScunetInfo, ScunetRequest } from './types';

export const getScunetInfo = () => request<ScunetInfo>('/api/scunet/status');

export async function executeScunet(data: ScunetRequest, token: string) {
  const payload =
    data.mode === 'single'
      ? { mode: data.mode, image: await readImageData(data.file), name: data.file.name }
      : data;
  return request<ScunetInfo>('/api/scunet/start', payload, token);
}

export const getScunetImageUrl = (id: string, kind: 'original' | 'output') =>
  `/api/scunet/image?id=${encodeURIComponent(id)}&kind=${kind}`;
