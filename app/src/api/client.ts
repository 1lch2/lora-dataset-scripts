import type {
  DatasetImportRequest,
  DatasetListInfo,
  DatasetOpenResult,
  EditRequest,
  EditResult,
  JobInfo,
  LoraFilesInfo,
  LoraRenameChange,
  LoraRenameResult,
  RunInfo,
  SessionInfo,
  TagAuditFeatureFields,
  TagAuditOptions,
  TagAuditReference,
} from './types';

export async function request<T>(url: string, data?: unknown, token?: string): Promise<T> {
  const response = await fetch(
    url,
    data === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Review-Token': token || '' },
          body: JSON.stringify(data),
        },
  );
  const body = await response.json();
  if (!response.ok) throw Error(body.error || '请求失败');
  return body;
}
export const getSessionInfo = () => request<SessionInfo>('/api/session');
export const getRunInfo = () => request<RunInfo>('/api/state');
export const getJobInfo = () => request<JobInfo>('/api/job');
export const getAllDatasetList = () => request<DatasetListInfo>('/api/datasets');
export const deleteDataset = (runDir: string, token: string) =>
  request<{ ok: boolean; currentDeleted: boolean }>('/api/datasets/delete', { runDir }, token);
export const importDataset = (data: DatasetImportRequest, token: string) =>
  request<DatasetOpenResult>('/api/datasets/import', data, token);
export const openDataset = (runDir: string, token: string) =>
  request<DatasetOpenResult>('/api/datasets/open', { runDir }, token);
export const updateReview = (data: EditRequest, token: string) =>
  request<EditResult>('/api/edit', data, token);

export const describeAuditCostume = (
  runDir: string,
  costumeReference: TagAuditReference,
  audit: TagAuditOptions,
  token: string,
) =>
  request<{ result: { description: string } }>(
    '/api/edit',
    { action: 'describe_costume', runDir, costumeReference, audit },
    token,
  );

export const addAuditFeature = (runDir: string, fields: TagAuditFeatureFields, token: string) =>
  request<EditResult>('/api/tag-audit/feature', { action: 'save_feature', runDir, ...fields }, token);
export const updateAuditFeature = (
  runDir: string,
  featureId: string,
  fields: TagAuditFeatureFields,
  token: string,
) =>
  request<EditResult>(
    '/api/tag-audit/feature',
    { action: 'save_feature', runDir, featureId, ...fields },
    token,
  );
export const deleteAuditFeature = (runDir: string, featureId: string, token: string) =>
  request<EditResult>('/api/tag-audit/feature', { action: 'delete_feature', runDir, featureId }, token);

export const getLoraFilesInfo = (directory: string) =>
  request<LoraFilesInfo>(`/api/lora/files?directory=${encodeURIComponent(directory)}`);
export const renameLoraFiles = (directory: string, changes: LoraRenameChange[], token: string) =>
  request<LoraRenameResult>('/api/lora/rename', { directory, changes }, token);
