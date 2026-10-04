import { request } from '../../api/client';
import type { CompositeRequest, CompositeStatus } from './types';

export const getCompositeJobInfo = () => request<CompositeStatus>('/api/composite/status');
export const startCompositeTagging = (data: CompositeRequest, token: string) =>
  request<CompositeStatus>('/api/composite/start', data, token);
export const cancelCompositeTagging = (token: string) =>
  request<CompositeStatus>('/api/composite/cancel', {}, token);
