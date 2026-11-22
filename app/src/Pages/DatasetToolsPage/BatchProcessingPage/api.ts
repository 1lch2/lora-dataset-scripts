import { request } from '../../../api/client';
import type { ToolsRequest, ToolsScan, ToolsStatus } from './types';

export const scanDatasetFiles = (directory: string, recursive: boolean, token: string) =>
  request<ToolsScan>('/api/tools/scan', { directory, recursive }, token);
export const previewDatasetProcessing = (data: ToolsRequest, token: string) =>
  request<ToolsStatus>('/api/tools/preview', data, token);
export const executeDatasetProcessing = (id: string, token: string) =>
  request<ToolsStatus>('/api/tools/execute', { id }, token);
export const cancelDatasetProcessing = (token: string) =>
  request<ToolsStatus>('/api/tools/cancel', {}, token);
export const getDatasetProcessingInfo = () => request<ToolsStatus>('/api/tools/status');
