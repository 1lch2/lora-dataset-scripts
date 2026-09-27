import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../api/client';
import type { AnalysisReport, AnalysisStatus, BaselineReport } from './types';
import { download } from './utils';

const INITIAL_FIELDS = {
  analysisDirectory: '',
  analysisLimit: '1500',
  analysisPoseThreshold: '0.18',
  analysisHashThreshold: '6',
  analysisCache: '',
  analysisSearch: '',
  analysisSort: 'brightness',
  analysisOrder: 'desc',
};
export function useAnalysis(token: string, active: boolean) {
  const client = useQueryClient();
  const [started, setStarted] = useState(active);
  const [fields, setFields] = useState(INITIAL_FIELDS);
  const [checks, setChecks] = useState({
    analysisRecursive: true,
    analysisPose: false,
    analysisCaptions: false,
  });
  const [baseline, setBaseline] = useState<BaselineReport>();
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const baselineRef = useRef<HTMLInputElement>(null);
  const statusQuery = useQuery({
    queryKey: ['analysisStatus'],
    queryFn: () => request<AnalysisStatus>('/api/analysis/status'),
    enabled: started,
    refetchInterval: (query) =>
      query.state.error ? 3000 : query.state.data?.status === 'running' ? 1000 : false,
    refetchIntervalInBackground: true,
  });
  const reportQuery = useQuery({
    queryKey: ['analysisReport'],
    queryFn: () => request<AnalysisReport>('/api/analysis/report'),
    enabled: statusQuery.data?.status === 'complete',
    staleTime: Infinity,
    refetchInterval: (query) => (query.state.error ? 3000 : false),
  });
  const startMutation = useMutation({
    mutationFn: () =>
      request(
        '/api/analysis/start',
        {
          directory: fields.analysisDirectory,
          recursive: checks.analysisRecursive,
          pose: checks.analysisPose,
          captions: checks.analysisCaptions,
          model_cache: fields.analysisCache,
          pair_limit: Number(fields.analysisLimit),
          pose_threshold: Number(fields.analysisPoseThreshold),
          hash_threshold: Number(fields.analysisHashThreshold),
        },
        token,
      ),
  });
  const cancelMutation = useMutation({ mutationFn: () => request('/api/analysis/cancel', {}, token) });
  useEffect(() => {
    if (active) {
      setStarted(true);
      void statusQuery.refetch();
    }
  }, [active]);
  const status = statusQuery.data,
    report = reportQuery.data,
    running = status?.status === 'running';
  const phase =
    (
      { scan: '扫描目录', images: '计算逐图统计', similarity: '比较近似图片', poses: '比较姿势' } as Record<
        string,
        string
      >
    )[status?.phase || ''] || '';
  const statusText =
    error ||
    (statusQuery.error
      ? statusQuery.error.message + '；正在重连'
      : reportQuery.error
        ? reportQuery.error.message + '；正在重连'
        : running
          ? `${phase} · ${status?.done || 0}/${status?.total || '…'}`
          : status?.error ||
            (
              {
                idle: '等待选择目录',
                complete: '分析完成',
                cancelled: '已取消，未修改数据集',
                failed: '分析失败',
              } as Record<string, string>
            )[status?.status || 'idle']);
  function setField(name: keyof typeof INITIAL_FIELDS, value: string) {
    setFields((previous) => ({ ...previous, [name]: value }));
    if (['analysisSearch', 'analysisSort', 'analysisOrder'].includes(name)) setPage(0);
  }
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await startMutation.mutateAsync();
      client.setQueryData(['analysisStatus'], { status: 'running', done: 0, total: 0 });
      client.removeQueries({ queryKey: ['analysisReport'] });
      setPage(0);
      await statusQuery.refetch();
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function handleCancel() {
    try {
      setError('');
      await cancelMutation.mutateAsync();
      await statusQuery.refetch();
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function handleCsv() {
    try {
      const response = await fetch('/api/analysis/csv');
      if (!response.ok) throw Error('CSV 导出失败');
      download('\uFEFF' + (await response.text()), 'text/csv;charset=utf-8', 'dataset-analysis.csv');
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function handleBaseline(event: ChangeEvent<HTMLInputElement>) {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 50 * 1024 * 1024) throw Error('对照报告超过 50 MiB');
      const data = JSON.parse(await file.text());
      if (data.schema_version !== 1 || !data.summary || typeof data.summary !== 'object')
        throw Error('不是支持的数据集分析报告');
      setBaseline(data);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  function handleClearBaseline() {
    setBaseline(undefined);
    if (baselineRef.current) baselineRef.current.value = '';
  }
  const filtered = (report?.records || [])
    .filter((r) => r.file.toLowerCase().includes(fields.analysisSearch.toLowerCase()))
    .sort((a, b) => {
      const av = a[fields.analysisSort],
        bv = b[fields.analysisSort];
      if (!Number.isFinite(av)) return Number.isFinite(bv) ? 1 : 0;
      if (!Number.isFinite(bv)) return -1;
      return (fields.analysisOrder === 'asc' ? 1 : -1) * ((av as number) - (bv as number));
    });
  const pages = Math.max(1, Math.ceil(filtered.length / 100)),
    currentPage = Math.min(page, pages - 1);
  return {
    fields,
    setField,
    checks,
    setChecks,
    baseline,
    baselineRef,
    report,
    running,
    startPending: startMutation.isPending,
    status,
    statusText:
      statusText +
      (status?.status === 'failed' && status.log_path ? ` 本地诊断日志：${status.log_path}` : ''),
    handleSubmit,
    handleCancel,
    handleCsv,
    handleBaseline,
    handleClearBaseline,
    handleJson: () => download(JSON.stringify(report, null, 2), 'application/json', 'dataset-analysis.json'),
    page: currentPage,
    pages,
    setPage,
    filtered,
    rows: filtered.slice(currentPage * 100, (currentPage + 1) * 100),
  };
}
