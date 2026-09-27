import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getJobInfo, getRunInfo, updateReview } from '../../api/client';
import type { Box, EditRequest, JobInfo, PreviewInfo, RunInfo, SessionInfo, Source } from '../../api/types';
import { CROP_NAMES, splitTags } from './utils';
import { useTags } from './useTags';
import { INITIAL_FIELDS } from './constants';
import type { FieldName } from './types';

export function useReview(session: SessionInfo) {
  const client = useQueryClient();
  const [stage, setStage] = useState(
    session.analysisOnly || new URLSearchParams(location.search).has('analysis') ? 'analysis' : 'crop',
  );
  const [reviewStarted, setReviewStarted] = useState(stage !== 'analysis');
  const [focusCrop, setFocusCrop] = useState(false);
  const [fields, setFields] = useState(INITIAL_FIELDS);
  const [checks, setChecks] = useState({ matchCase: true, prependTags: false });
  const [tool, setTool] = useState('filter');
  const [sourceId, setSourceId] = useState<string>();
  const [candidateId, setCandidateId] = useState<string | null>();
  const [box, setBox] = useState<Box | null>(null);
  const [notice, setNotice] = useState({ text: '', error: false });
  const [jobStatus, setJobStatus] = useState('');
  const [preview, setPreview] = useState<PreviewInfo>();
  const [previewImage, setPreviewImage] = useState('');
  const [reviewAdvance, setReviewAdvance] = useState(0);
  const handledJob = useRef<string | undefined>(undefined);
  const initialized = useRef(false);
  const mutation = useMutation({
    mutationFn: (data: EditRequest) => updateReview(data, session.token),
    onSuccess: async (_result, data) => {
      if (data.action === 'start_tag' || data.action === 'export') return;
      await client.fetchQuery({ queryKey: ['run'], queryFn: getRunInfo });
    },
  });
  const previewMutation = useMutation({
    mutationFn: (data: EditRequest) => updateReview(data, session.token),
  });
  const runQuery = useQuery({ queryKey: ['run'], queryFn: getRunInfo, enabled: reviewStarted });
  const jobQuery = useQuery({
    queryKey: ['job'],
    queryFn: getJobInfo,
    enabled: reviewStarted && !!runQuery.data,
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
  });
  const state = runQuery.data;
  const job: JobInfo = jobQuery.data || { status: 'idle', total: 0, done: 0, errors: [] };
  const busy = mutation.isPending;
  const processing = busy || job.status === 'running';
  function message(text: string, error = false) {
    setNotice({ text, error });
  }
  function setField(name: FieldName, value: string) {
    setFields((previous) => ({ ...previous, [name]: value }));
    setPreview(undefined);
  }
  const sources = useMemo(() => Object.values(state?.sources || {}).filter((s) => s.active), [state]);
  const tags = useTags(sources, fields, setField);
  const source = tags.filteredSources.find((s) => s.id === sourceId) || tags.filteredSources[0];
  const candidate =
    candidateId === null
      ? undefined
      : source?.candidates.find((c) => c.id === candidateId) ||
        source?.candidates.find((c) => c.status === 'pending') ||
        source?.candidates.find((c) => c.box) ||
        source?.candidates.find((c) => c.id === 'full');
  const sourceSignature = JSON.stringify([source?.id, candidate?.id, candidate?.box, state?.updated_at]);
  useEffect(() => {
    setSourceId(source?.id);
    if (candidate) setCandidateId(candidate.id);
    setBox(candidate?.box ? [...candidate.box] : null);
    setFields((previous) => ({
      ...previous,
      scale: String(source?.scale || 1),
      person:
        source?.person_index !== undefined
          ? String(source.person_index)
          : source?.detection?.persons.length
            ? '0'
            : '',
    }));
  }, [sourceSignature]);
  useEffect(() => {
    if (!state) return;
    const firstLoad = !initialized.current;
    setFields((previous) => ({
      ...previous,
      group: firstLoad
        ? [
            ...new Set(
              Object.values(state.sources)
                .filter((s) => s.active)
                .map((s) => s.group),
            ),
          ].sort()[0] || ''
        : previous.group,
      dropTags: (state.drop_tags_override || state.config.drop_tags).join(', '),
    }));
    initialized.current = true;
  }, [state]);
  useEffect(() => {
    if (!notice.text || notice.error || notice.text === '处理中…') return;
    const timer = setTimeout(() => setNotice({ text: '', error: false }), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (runQuery.error) message(runQuery.error.message, true);
  }, [runQuery.error]);
  useEffect(() => {
    if (!tags.singleKey || tags.focused) return;
    tags.handleFocus();
  }, [tags.singleKey, !!tags.focused]);
  useEffect(() => {
    if (!job.id || job.id === handledJob.current || !['complete', 'failed'].includes(job.status) || busy)
      return;
    handledJob.current = job.id;
    client
      .fetchQuery({ queryKey: ['run'], queryFn: getRunInfo })
      .then((data) => {
        setJobStatus(
          job.status === 'failed'
            ? `处理未完成，已保存成功项，可重试。\n${job.errors.join('\n')}`
            : job.action === 'start_tag'
              ? `打标完成，共 ${job.total} 份样本。可编辑标签并导出训练集。`
              : `已导出 ${job.count} 组图片和标签至 ${data.config.output_dir}`,
        );
        if (job.status === 'complete' && job.action === 'start_tag')
          setStage((previous) => (previous === 'analysis' || previous === 'lora' ? previous : 'tag'));
      })
      .catch((error) => {
        handledJob.current = undefined;
        setJobStatus(`${error.message}，正在重连；可用“刷新数据”核对已保存结果。`);
      });
  }, [job, busy, client]);
  useEffect(() => {
    document.body.classList.toggle('analyzing', stage === 'analysis');
    document.body.classList.toggle('tagEditing', stage === 'tag');
    document.body.classList.toggle('loraTools', stage === 'lora');
    document.body.classList.toggle('focusCrop', focusCrop && stage === 'crop');
    return () => document.body.classList.remove('analyzing', 'tagEditing', 'loraTools', 'focusCrop');
  }, [stage, focusCrop]);
  function handleStage(next: string) {
    setStage(next);
    if (next !== 'crop') setFocusCrop(false);
    if (next === 'analysis' || next === 'lora') return;
    setReviewStarted(true);
    restoreDraft(source, candidate?.id);
  }
  function restoreDraft(nextSource: Source | undefined, nextCandidateId?: string) {
    const restored =
      nextSource?.candidates.find((c) => c.id === nextCandidateId) ||
      nextSource?.candidates.find((c) => c.status === 'pending') ||
      nextSource?.candidates.find((c) => c.box) ||
      nextSource?.candidates.find((c) => c.id === 'full');
    setCandidateId(restored?.id);
    setBox(restored?.box ? [...restored.box] : null);
  }
  async function reload() {
    const result = await runQuery.refetch();
    if (result.error) throw result.error;
    if (stage !== 'analysis')
      restoreDraft(source ? result.data!.sources[source.id] : undefined, candidate?.id);
    setPreview(undefined);
    return result.data!;
  }
  function advanceReview(
    data: RunInfo,
    previousSource: string,
    previousCandidate: string | undefined,
    result: string,
  ) {
    setReviewAdvance((previous) => previous + 1);
    const s = data.sources[previousSource],
      crops = s.candidates;
    const index = crops.findIndex((c) => c.id === previousCandidate);
    const next = [...crops.slice(index + 1), ...crops.slice(0, index + 1)].find(
      (c) => c.status === 'pending',
    );
    if (next) {
      setSourceId(previousSource);
      setCandidateId(next.id);
      message(
        `${result}，已切换到「${CROP_NAMES[next.kind]}」。本图还剩 ${crops.filter((c) => c.status === 'pending').length} 个待审裁框。`,
      );
      return;
    }
    const list = Object.values(data.sources).filter(
      (s) =>
        s.active &&
        (!fields.group || s.group === fields.group) &&
        s.relative.toLowerCase().includes(fields.search.toLowerCase()),
    );
    const si = list.findIndex((s) => s.id === previousSource);
    const nextSource = [...list.slice(si + 1), ...list.slice(0, si)].find(
      (s) => !s.error && s.candidates.some((c) => c.status === 'pending'),
    );
    if (nextSource) {
      setSourceId(nextSource.id);
      setCandidateId(undefined);
      message(`「${s.relative}」裁切审核完成。已进入下一张：${nextSource.relative}`);
      return;
    }
    const remaining = Object.values(data.sources).some(
      (s) => s.active && (s.error || s.candidates.some((c) => c.status === 'pending')),
    );
    message(
      `「${s.relative}」裁切审核完成。${remaining ? '当前筛选范围内没有可继续审核的裁框，请检查其他图片或处理失败项。' : '全部图片裁切审核完成，可以开始打标。'}`,
    );
  }
  async function edit(data: EditRequest, advance = false) {
    if (processing) return;
    const previousSource = source?.id,
      previousCandidate = candidate?.id;
    message('处理中…');
    try {
      const result = await mutation.mutateAsync(data);
      if (result.result.id) setCandidateId(result.result.id);
      const updated = client.getQueryData<RunInfo>(['run'])!;
      setPreview(undefined);
      if (advance && previousSource)
        advanceReview(
          updated,
          previousSource,
          previousCandidate,
          data.status === 'rejected' ? '已拒绝' : '已接受',
        );
      else message(data.action === 'crop' ? '裁框已保存，尚待接受或拒绝' : '已保存');
    } catch (error) {
      message((error as Error).message, true);
    }
  }
  async function startJob(action: string) {
    if (processing || !state) return;
    if (action === 'start_tag' && box && (!candidate?.box || box.some((v, i) => v !== candidate.box![i]))) {
      message('当前裁框尚未保存，请先保存并审核，再开始打标。', true);
      return;
    }
    if (
      action === 'start_tag' &&
      sources.every((s) => s.candidates.every((c) => c.status !== 'accepted' || c.tag_current)) &&
      job.status !== 'failed'
    ) {
      handleStage('tag');
      return;
    }
    try {
      await mutation.mutateAsync({ action });
      client.setQueryData(['job'], { ...job, status: 'running', action });
      message('');
    } catch (error) {
      message((error as Error).message, true);
    }
    await jobQuery.refetch();
  }
  const pending = sources.reduce((n, s) => n + s.candidates.filter((c) => c.status === 'pending').length, 0);
  const samples = sources.flatMap((s) => s.candidates.filter((c) => c.status === 'accepted'));
  const untagged = samples.filter((c) => !c.tag_current).length;
  const ready = sources.length > 0 && !pending && !sources.some((s) => s.error);
  const tagging = stage === 'tag';
  const stageStatus = !state
    ? '读取进度…'
    : tagging
      ? `${samples.length} 份样本 · ${untagged} 份待打标`
      : pending
        ? `还有 ${pending} 个裁框待审（全部图片）`
        : ready
          ? `裁切审核完成 · ${samples.length} 份样本可打标`
          : '请先完成图片准备';
  const startLabel =
    job.status === 'running' && job.action === 'start_tag'
      ? '正在打标…'
      : job.status === 'failed' && job.action === 'start_tag'
        ? '重试打标'
        : !untagged && samples.length
          ? '查看标签'
          : tagging
            ? '重新打标'
            : '开始打标';
  const width = box ? Math.abs(Math.round(box[2]) - Math.round(box[0])) : 0,
    height = box ? Math.abs(Math.round(box[3]) - Math.round(box[1])) : 0;
  const enough = !!box && width * height >= (state?.config.min_area || 0),
    full = candidate?.kind === 'full';
  const operation = {
    mode: fields.tagOperation,
    tags: splitTags(fields.editTags),
    old: fields.oldTag,
    new: fields.tagOperation === 'match' ? fields.matchReplacement : fields.newTag,
    search: fields.matchSearch,
    match: fields.matchMode,
    case_sensitive: checks.matchCase,
    prepend: checks.prependTags,
    by: fields.captionSort,
    order: fields.captionOrder,
  };
  const mode = fields.tagOperation;
  const applyDisabled =
    processing ||
    !tags.targets.length ||
    (mode === 'replace'
      ? !fields.oldTag.trim() || !fields.newTag.trim()
      : mode === 'match'
        ? !fields.matchSearch.trim()
        : mode === 'sort'
          ? false
          : !splitTags(fields.editTags).length);
  const previewSignature = JSON.stringify([operation, tags.targets]);
  const currentPreviewSignature = useRef(previewSignature);
  currentPreviewSignature.current = previewSignature;
  const previewValidSignature = useRef('');
  const actions: Record<string, () => void | Promise<unknown>> = {
    dismissMessage: () => message(''),
    startTag: () => startJob('start_tag'),
    exportDataset: () => startJob('export'),
    refresh: () => reload().catch((error) => message(error.message, true)),
    openWorkdir: async () => {
      try {
        await updateReview({ action: 'open_workdir' }, session.token);
      } catch (error) {
        message((error as Error).message, true);
      }
    },
    focusCrop: () => setFocusCrop((v) => !v),
    newCrop: () => {
      setCandidateId(null);
      setBox(null);
      message('新建裁框：在工作图上拖出矩形，尺寸达到下限后即可接受。');
    },
    saveCrop: () =>
      edit({ action: 'crop', source: source?.id, candidate: candidate?.id ?? null, box, status: 'pending' }),
    acceptCrop: () =>
      edit(
        { action: 'crop', source: source?.id, candidate: candidate?.id ?? null, box, status: 'accepted' },
        true,
      ),
    rejectCrop: () =>
      edit({ action: 'crop', source: source?.id, candidate: candidate?.id, status: 'rejected' }, true),
    acceptSource: () => edit({ action: 'accept_source', source: source?.id }, true),
    setScale: () => edit({ action: 'scale', source: source?.id, scale: Number(fields.scale) }),
    setPerson: () => edit({ action: 'person', source: source?.id, index: Number(fields.person) }),
    selectVisible: () =>
      tags.setSelected(
        (previous) =>
          new Set([
            ...previous,
            ...tags.visibleTags.filter(([, c]) => c.tag_current).map(([s, c]) => `${s.id}/${c.id}`),
          ]),
      ),
    clearSelection: () => {
      tags.setSelected(new Set());
      tags.handleFocus();
    },
    filterChecked: () =>
      tags.setImageBasket(
        (previous) => new Set([...previous, ...tags.selections.map((pair) => pair.join('/'))]),
      ),
    filterVisible: () =>
      tags.setImageBasket(
        (previous) => new Set([...previous, ...tags.visibleTags.map(([s, c]) => `${s.id}/${c.id}`)]),
      ),
    invertImageFilter: () =>
      tags.setImageBasket(
        new Set(tags.allImages.map(([s, c]) => `${s.id}/${c.id}`).filter((k) => !tags.imageBasket.has(k))),
      ),
    clearImageBasket: () => tags.setImageBasket(new Set()),
    applyImageFilter: () => tags.setImageFilter(new Set(tags.imageBasket)),
    resetImageFilter: () => tags.setImageFilter(null),
    resetTagFilters: () => {
      tags.setImageFilter(null);
      tags.setClickedTags(new Set());
      setFields((p) => ({
        ...p,
        group: '',
        search: '',
        kind: '',
        hasTag: '',
        notTag: '',
        tagSearch: '',
        hasLogic: 'all',
        notLogic: 'any',
      }));
      setPreview(undefined);
    },
    showAllTags: () => tags.handleFocus(),
    chooseRemovalTags: () =>
      setField(
        'editTags',
        [...new Set([...splitTags(fields.editTags), ...tags.frequencies.map(([t]) => t)])].join(', '),
      ),
    clearRemovalTags: () => setField('editTags', ''),
    dedupeTags: () => edit({ action: 'tags', selections: tags.targets, operation: { mode: 'dedupe' } }),
    applyTags: () => edit({ action: 'tags', selections: tags.targets, operation }),
    restore: () => edit({ action: 'tags', selections: tags.targets, operation: { mode: 'restore' } }),
    previewTags: async () => {
      try {
        const data = await previewMutation.mutateAsync({
          action: 'preview_tags',
          selections: tags.targets,
          operation,
        });
        if (currentPreviewSignature.current !== previewSignature) return;
        previewValidSignature.current = previewSignature;
        setPreview(data.result as PreviewInfo);
      } catch (error) {
        message((error as Error).message, true);
      }
    },
    saveDrop: () => edit({ action: 'drop_tags', tags: splitTags(fields.dropTags) }),
    saveSingle: () =>
      edit({
        action: 'tags',
        selections: [tags.singleKey!.split('/')],
        operation: { mode: 'set', tags: splitTags(fields.singleCaption) },
      }),
  };
  function handleAction(id: string) {
    void actions[id]?.();
  }
  function handleField(name: FieldName, value: string) {
    if (name === 'group' || name === 'search') restoreDraft(source, candidate?.id);
    if (name === 'hasTag') tags.setClickedTags(new Set());
    setField(name, value);
  }
  const visiblePreview = previewValidSignature.current === previewSignature ? preview : undefined;
  return {
    session,
    state,
    job,
    busy,
    processing,
    stage,
    handleStage,
    focusCrop,
    fields,
    setField,
    handleField,
    checks,
    setChecks,
    tool,
    setTool,
    source,
    candidate,
    sourceId,
    setSourceId,
    candidateId,
    setCandidateId,
    restoreDraft,
    box,
    setBox,
    notice,
    message,
    preview: visiblePreview,
    previewImage,
    setPreviewImage,
    tags,
    reviewAdvance,
    stageStatus,
    startLabel,
    pending,
    samples,
    untagged,
    ready,
    width,
    height,
    enough,
    full,
    mode,
    applyDisabled,
    previewPending: previewMutation.isPending,
    handleAction,
    edit,
    sources,
    jobStatus: jobQuery.error
      ? `${jobQuery.error.message}，正在重连；可用“刷新数据”核对已保存结果。`
      : job.status === 'running'
        ? job.action === 'start_tag'
          ? `已打标 ${job.done} / ${job.total} 份（含已完成缓存）。正在裁切、缩放和打标，可刷新页面查看进度。`
          : '正在导出训练集…'
        : jobStatus,
  };
}
