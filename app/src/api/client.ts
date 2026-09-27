import type { EditRequest, EditResult, JobInfo, RunInfo, SessionInfo } from './types';

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
export const updateReview = (data: EditRequest, token: string) =>
  request<EditResult>('/api/edit', data, token);
