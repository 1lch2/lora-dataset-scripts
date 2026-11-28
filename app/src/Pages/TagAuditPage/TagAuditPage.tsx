import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addAuditFeature,
  deleteAuditFeature,
  describeAuditCostume,
  unloadForgeCheckpoint,
  updateAuditFeature,
  updateReview,
} from '../../api/client';
import type {
  TagAuditFeature,
  TagAuditFinding,
  TagAuditOptions,
  TagAuditReference,
  TagImage,
} from '../../api/types';
import { SideTabLayout } from '../../components/SideTabLayout';
import { useReviewContext } from '../../review/context';
import { imageKey, imageUrl as getImageUrl, splitTags } from '../../review/utils';
import { AuditSampleActions } from './__internal__/AuditSampleActions';
import { AuditSettings } from './__internal__/AuditSettings';
import type {
  AuditCategory,
  AuditConfirmation,
  AuditEditRequest,
  AuditFilter,
  AuditMode,
  AuditRetryStatus,
  AuditRow,
  AuditSection,
  FeatureEdit,
} from './types';
import styles from './styles.module.css';

const CATEGORY_LABELS = {
  framing: '构图范围',
  count: '人物数量',
  rule: '数据集规则',
  feature: '核心特征',
  costume: '换装',
};
const SECTIONS = {
  anomaly: { section: 'anomaly', title: '错标检查', tab: 'auditAnomalyTab', panel: 'auditAnomalyView' },
  feature: { section: 'feature', title: '漏标补充', tab: 'auditFeatureTab', panel: 'auditFeatureView' },
  costume: { section: 'costume', title: '换装检查', tab: 'auditCostumeTab', panel: 'auditCostumeView' },
  settings: { section: 'settings', title: '检查设置', tab: 'auditSettingsTab', panel: 'auditSettingsView' },
} as const;
const STATUS_LABELS = { pending: '待处理', ignored: '已保留', applied: '已应用', stale: '已过期' };
const RETRY_STATUS_LABELS = { uncertain: '不确定', failed: '失败' };
const ANOMALY_STATUS_LABELS = { ...STATUS_LABELS, ...RETRY_STATUS_LABELS };
const FEATURE_STATUS_LABELS = {
  pending: '待补标',
  consistent: '已一致',
  absent: '未发现',
  unobservable: '不可观察',
  uncertain: '不确定',
  failed: '失败',
  ignored: '已忽略',
  applied: '已应用',
  stale: '已过期',
};
const COSTUME_TAG = 'alternate costume';
const COSTUME_STATUS_LABELS = {
  alternate: '识别为换装',
  ...FEATURE_STATUS_LABELS,
  consistent: '已标注换装',
  absent: '标准服装',
};
const DEFAULT_OPTIONS: TagAuditOptions = {
  visual: true,
  endpoint: 'http://localhost:23333/v1',
  model: 'qwen3.5-4b-uncensored-hauhaucs-aggressive',
  concurrency: 1,
  max_tokens: 8192,
  temperature: 0,
  top_k: 20,
  repeat_penalty: 1,
  presence_penalty: 1.5,
  top_p: 0.95,
  min_p: 0,
  forbidden: [],
};
const PAGE_SIZE = 30;

interface ReferenceSelection {
  sampleKey: string;
  tags: string[];
}

function getReferenceTags(sample: TagImage | undefined) {
  if (!sample) return [];
  return [...new Set(sample[1].tag.tags.map((tag) => tag.replaceAll('_', ' ').trim()).filter(Boolean))];
}

function getFindingTags(finding: TagAuditFinding) {
  return finding.tags ?? (finding.tag ? [finding.tag] : []);
}

function isRetryStatus(status: AuditFilter): status is AuditRetryStatus {
  return status === 'failed' || status === 'uncertain';
}

interface AuditConfirmationDialogProps {
  confirmation: AuditConfirmation;
  disabled: boolean;
  onClose: (confirmed: boolean) => void;
}

function AuditConfirmationDialog({ confirmation, disabled, onClose }: AuditConfirmationDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const summary = useId();
  const consequence = useId();
  const clearing = confirmation.action === 'clear';
  const title = clearing ? '确认清空检查结果' : '确认补标';
  const clearLabel = clearing
    ? (confirmation.mode === 'anomaly' ? ANOMALY_STATUS_LABELS : FEATURE_STATUS_LABELS)[confirmation.status]
    : undefined;

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.confirmation}
      aria-labelledby={heading}
      aria-describedby={`${summary} ${consequence}`}
      onClose={(event) => onClose(event.currentTarget.returnValue === 'confirm')}
    >
      <div className={styles.dialogHeading}>
        <h2 id={heading}>{title}</h2>
      </div>
      <div className={styles.confirmationBody}>
        {clearing ? (
          <>
            <p id={summary}>
              将清空「{SECTIONS[confirmation.mode].title}」的「{clearLabel}」中
              {confirmation.category === 'all'
                ? ''
                : `「${CATEGORY_LABELS[confirmation.category]}」类型的`}{' '}
              {confirmation.count} 项检查记录。
            </p>
            <p id={consequence}>此操作只清理当前数据集的检查记录。</p>
          </>
        ) : (
          <>
            <p id={summary}>将应用 {confirmation.ids.length} 项补标建议，追加以下标签。</p>
            <ul className={styles.confirmationTags}>
              {confirmation.tags.map((tag) => (
                <li className='tagChip' key={tag}>
                  {tag}
                </li>
              ))}
            </ul>
            <p id={consequence}>仅修改工作 TXT，可通过「应用历史与撤销」恢复该批次。</p>
          </>
        )}
      </div>
      <form className={styles.dialogActions} method='dialog'>
        <button type='submit' value='cancel' autoFocus>
          取消
        </button>
        <button type='submit' className='primary' value='confirm' disabled={disabled}>
          {clearing ? '确认清空' : '确认补标'}
        </button>
      </form>
    </dialog>
  );
}

interface ReferencePickerProps {
  samples: TagImage[];
  initialSelection?: ReferenceSelection;
  updatedAt: string;
  costume?: boolean;
  onSelect: (selection: ReferenceSelection) => void;
  onDismiss: () => void;
}

function ReferencePicker({
  samples,
  initialSelection,
  updatedAt,
  costume = false,
  onSelect,
  onDismiss,
}: ReferencePickerProps) {
  const heading = useId();
  const tagsHeading = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const selectedTile = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState(
    () => initialSelection ?? { sampleKey: imageKey(...samples[0]), tags: [] },
  );
  const sample = samples.find(([source, candidate]) => imageKey(source, candidate) === selection.sampleKey);
  const tags = costume ? [] : getReferenceTags(sample);
  const canConfirm =
    !!sample && (costume || (selection.tags.length > 0 && selection.tags.every((tag) => tags.includes(tag))));

  useEffect(() => {
    if (!dialog.current || dialog.current.open) return;
    dialog.current.showModal();
    selectedTile.current?.focus();
  }, []);

  function handleSelectImage(sampleKey: string) {
    setSelection((previous) => (previous.sampleKey === sampleKey ? previous : { sampleKey, tags: [] }));
  }

  function handleToggleTag(tag: string, checked: boolean) {
    setSelection((previous) => ({
      ...previous,
      tags: checked ? [...previous.tags, tag] : previous.tags.filter((value) => value !== tag),
    }));
  }

  function handleConfirm() {
    if (!canConfirm) return;
    onSelect(selection);
    dialog.current?.close();
  }

  return (
    <dialog ref={dialog} className={styles.picker} aria-labelledby={heading} onClose={onDismiss}>
      <div className={styles.dialogHeading}>
        <h2 id={heading}>{costume ? '选择标准服装参考图' : '选择参考图和标签'}</h2>
      </div>
      <div className={styles.pickerBody}>
        <section className={styles.pickerGallery} aria-label='参考图样本'>
          <div className={styles.referenceGrid}>
            {samples.map(([source, candidate]) => {
              const key = imageKey(source, candidate);
              const label = `${source.relative} · ${candidate.id}`;
              const selected = key === selection.sampleKey;
              return (
                <button
                  key={key}
                  ref={selected ? selectedTile : undefined}
                  type='button'
                  className={styles.referenceTile}
                  title={label}
                  aria-pressed={selected}
                  onClick={() => handleSelectImage(key)}
                >
                  <img src={getImageUrl(source, 'tag', updatedAt, candidate)} alt='' loading='lazy' />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </section>
        <section className={styles.pickerTags} aria-labelledby={tagsHeading}>
          <h3 id={tagsHeading}>{costume ? '参考图预览' : '目标标签'}</h3>
          {sample ? (
            <>
              <p>
                {sample[0].relative} · {sample[1].id}
              </p>
              <img
                className={styles.referencePreview}
                src={getImageUrl(sample[0], 'tag', updatedAt, sample[1])}
                alt='当前所选参考图'
              />
              {!costume ? (
                <div className={styles.referenceTags} role='group' aria-labelledby={tagsHeading}>
                  {tags.map((tag) => {
                    const checked = selection.tags.includes(tag);
                    return (
                      <label
                        className={`tagChip ${styles.referenceTag}${checked ? ` ${styles.referenceTagSelected}` : ''}`}
                        key={tag}
                      >
                        <input
                          type='checkbox'
                          name={tagsHeading}
                          value={tag}
                          checked={checked}
                          onChange={(event) => handleToggleTag(tag, event.currentTarget.checked)}
                        />
                        <span className='tagText'>{tag}</span>
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : (
            <p>请选择参考图</p>
          )}
        </section>
      </div>
      <div className={styles.dialogActions}>
        <button type='button' onClick={() => dialog.current?.close()}>
          取消
        </button>
        <button type='button' className='primary' disabled={!canConfirm} onClick={handleConfirm}>
          确认选择
        </button>
      </div>
    </dialog>
  );
}

interface FeatureFormProps {
  feature?: TagAuditFeature;
  samples: TagImage[];
  updatedAt: string;
  disabled: boolean;
  onSave: (edit: FeatureEdit) => void;
  onCancel: () => void;
  onPreview: (url: string) => void;
}

function FeatureForm({
  feature,
  samples,
  updatedAt,
  disabled,
  onSave,
  onCancel,
  onPreview,
}: FeatureFormProps) {
  const heading = useId();
  const saved = feature?.reference;
  const [selection, setSelection] = useState<ReferenceSelection | undefined>(() =>
    saved && feature ? { sampleKey: `${saved.source}/${saved.candidate}`, tags: feature.tags } : undefined,
  );
  const [pickingReference, setPickingReference] = useState(false);
  const sample = samples.find(([source, candidate]) => imageKey(source, candidate) === selection?.sampleKey);
  const validTags = getReferenceTags(sample);
  const chosenTags =
    selection && selection.tags.every((tag) => validTags.includes(tag)) ? selection.tags : [];
  const previewUrl = sample ? getImageUrl(sample[0], 'tag', updatedAt, sample[1]) : '';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pickingReference || !sample || !chosenTags.length) return;
    const [source, candidate] = sample;
    const form = new FormData(event.currentTarget);
    onSave({
      action: 'save',
      feature,
      fields: {
        name: String(form.get('name')),
        description: String(form.get('description')),
        tags: chosenTags,
        reference: { source: source.id, candidate: candidate.id },
      },
    });
  }

  return (
    <form action='/api/tag-audit/feature' method='post' onSubmit={handleSubmit} aria-labelledby={heading}>
      <fieldset disabled={disabled}>
        <legend id={heading}>{feature ? '编辑核心特征' : '新增核心特征'}</legend>
        <div className={styles.detail}>
          <div className={styles.toolbar}>
            <button
              type='button'
              aria-haspopup='dialog'
              disabled={!samples.length}
              onClick={() => setPickingReference(true)}
            >
              {sample ? '更换参考图或标签' : '选择参考图和标签'}
            </button>
            {sample ? (
              <small>
                {sample[0].relative} · {sample[1].id}
              </small>
            ) : null}
          </div>
          {chosenTags.length ? (
            <div className={styles.toolbar}>
              <small>目标标签</small>
              {chosenTags.map((tag) => (
                <span className='tagChip' key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          {!samples.length ? <p>没有带标签的有效样本</p> : null}
          {previewUrl ? (
            <button type='button' className={styles.reference} onClick={() => onPreview(previewUrl)}>
              <img src={previewUrl} alt='查看参考图' />
            </button>
          ) : null}
        </div>
        {pickingReference && samples.length ? (
          <ReferencePicker
            samples={samples}
            initialSelection={sample ? selection : undefined}
            updatedAt={updatedAt}
            onSelect={setSelection}
            onDismiss={() => setPickingReference(false)}
          />
        ) : null}
        <label>
          名称
          <input name='name' defaultValue={feature?.name} required maxLength={100} />
        </label>
        <label>
          可观察描述
          <textarea
            name='description'
            defaultValue={feature?.description}
            required
            maxLength={2000}
            rows={3}
            placeholder='例如，参考图中白色衬衫的领口或衣身清晰可见。'
          />
        </label>
        <div className={styles.toolbar}>
          <button type='submit' className='primary' disabled={!sample || !chosenTags.length}>
            保存特征
          </button>
          <button type='button' onClick={onCancel}>
            取消
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function TagAuditPage() {
  const v = useReviewContext();
  const client = useQueryClient();
  const audit = v.state?.tag_audit;
  const costumeRun = audit?.costumeRun;
  const [featureId, setFeatureId] = useState<string | undefined>(
    () => v.job.auditFeature?.id ?? Object.keys(audit?.featureRuns ?? {})[0],
  );
  const [checkedFeatureIds, setCheckedFeatureIds] = useState<Set<string>>();
  const features = Object.values(audit?.features ?? {});
  const feature = features.find((item) => item.id === featureId) || features[0];
  const latest = feature ? audit?.featureRuns?.[feature.id] : undefined;
  const checkedFeatures = checkedFeatureIds
    ? features.filter((item) => checkedFeatureIds.has(item.id))
    : features.filter((item) => item.id === feature?.id);
  const [mode, setMode] = useState<AuditMode>(() => {
    if (v.job.auditCostume || (costumeRun && !latest && !v.job.auditFeature)) return 'costume';
    return latest || v.job.auditFeature ? 'feature' : 'anomaly';
  });
  const [showSettings, setShowSettings] = useState(false);
  const section = showSettings ? 'settings' : mode;
  const anomalyMode = mode === 'anomaly';
  const featureMode = mode === 'feature';
  const costumeMode = mode === 'costume';
  const [options, setOptions] = useState({ ...DEFAULT_OPTIONS, ...audit?.options });
  const [forbidden, setForbidden] = useState(options.forbidden.join(', '));
  const [category, setCategory] = useState<AuditCategory>('all');
  const [status, setStatus] = useState<AuditFilter>(() => (costumeMode ? 'alternate' : 'pending'));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState<AuditConfirmation>();
  const [page, setPage] = useState(0);
  const [form, setForm] = useState<'new' | 'edit'>();
  const [pickingCostumeReference, setPickingCostumeReference] = useState(false);
  const [costumeSelection, setCostumeSelection] = useState<{ key: string; previousRunId?: string }>();
  const [descriptionEdit, setDescriptionEdit] = useState<{ text: string; previousRunId?: string }>();
  const costumeFormId = useId();
  const descriptionId = useId();
  const descriptionHelp = useId();
  const referenceSamples = useMemo(
    () => v.tags.allImages.filter(([, candidate]) => candidate.tag_current && candidate.tag.tags.length),
    [v.tags.allImages],
  );
  const costumeSamples = useMemo(
    () => v.tags.allImages.filter(([, candidate]) => candidate.tag_current),
    [v.tags.allImages],
  );
  const savedReference = feature?.reference;
  const referenceSample = savedReference
    ? referenceSamples.find(
        ([source, candidate]) =>
          source.id === savedReference.source && candidate.id === savedReference.candidate,
      )
    : undefined;
  const hasNewCostumeSelection = !!costumeSelection && costumeSelection.previousRunId === costumeRun?.id;
  const savedCostumeReference = costumeRun?.reference;
  const costumeKey = hasNewCostumeSelection
    ? costumeSelection.key
    : savedCostumeReference && `${savedCostumeReference.source}/${savedCostumeReference.candidate}`;
  const costumeSample = costumeMode
    ? costumeSamples.find(([source, candidate]) => imageKey(source, candidate) === costumeKey)
    : undefined;
  const costumeReferenceError = hasNewCostumeSelection ? undefined : costumeRun?.referenceError;
  const costumeDescription =
    descriptionEdit && descriptionEdit.previousRunId === costumeRun?.id
      ? descriptionEdit.text
      : (!hasNewCostumeSelection && !costumeReferenceError && savedCostumeReference?.description) || '';
  const updatedAt = v.state?.updated_at || '';
  const forbiddenTags = splitTags(forbidden);
  const targetTags = costumeMode ? [COSTUME_TAG] : checkedFeatures.flatMap((item) => item.tags);
  const conflict = [...new Set(targetTags.filter((tag) => forbiddenTags.includes(tag)))];
  const blockedFeatures = featureMode ? checkedFeatures.filter((item) => item.referenceError) : [];
  const rows = useMemo<AuditRow[]>(() => {
    const findings = audit?.findings || [];
    if (mode === 'anomaly') {
      return [
        ...findings.filter((finding) => finding.action !== 'add').map((finding) => ({ ...finding, finding })),
        ...(audit?.samples || []).flatMap((sample) => {
          const { status } = sample;
          if (status === 'complete') return [];
          return [
            {
              ...sample,
              status,
              id: `sample/${sample.source}/${sample.candidate}`,
              name: `${sample.name} · ${sample.candidate}`,
              reason:
                status === 'failed'
                  ? sample.error
                  : [sample.observation?.count_reason, sample.observation?.framing_reason]
                      .filter(Boolean)
                      .join('；'),
            },
          ];
        }),
      ];
    }
    const run = mode === 'feature' ? latest : costumeRun;
    if (!run) return [];
    const byId = new Map(
      findings
        .filter((finding) => finding.category === mode && finding.round === run.id)
        .map((finding) => [finding.id, finding]),
    );
    return run.samples.map((sample) => {
      const finding = sample.findingId ? byId.get(sample.findingId) : undefined;
      const status = finding?.status ?? (sample.status === 'present' ? 'stale' : sample.status);
      return {
        ...sample,
        id: `${sample.source}/${sample.candidate}`,
        name: `${sample.name} · ${sample.candidate}`,
        status,
        alternate:
          mode === 'costume' &&
          status !== 'stale' &&
          (sample.status === 'present' || sample.status === 'consistent'),
        reason: sample.error || sample.reason,
        finding,
      };
    });
  }, [audit?.findings, audit?.samples, mode, latest, costumeRun]);

  const visible = rows.filter((row) => {
    if (status === 'alternate') return row.alternate;
    if (anomalyMode && isRetryStatus(row.status)) {
      return status === row.status || (status === 'all' && category === 'all');
    }
    return (
      (!anomalyMode || category === 'all' || row.finding?.category === category) &&
      (status === 'all' || row.status === status)
    );
  });
  const visiblePendingIds = visible.flatMap((row) =>
    row.finding?.status === 'pending' ? [row.finding.id] : [],
  );
  const selectedIds = visiblePendingIds.filter((id) => selected.has(id));
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const pagePendingIds = pageRows.flatMap((row) =>
    row.finding?.status === 'pending' ? [row.finding.id] : [],
  );
  const pending = rows.filter((row) => row.status === 'pending').length;
  const uncertain = rows.filter((row) => row.status === 'uncertain');
  const failed = rows.filter((row) => row.status === 'failed');
  const eligible = v.tags.allTargets.length;
  const editableSamples = useMemo(
    () =>
      new Map(
        v.tags.allImages
          .filter(([, candidate]) => candidate.tag_current)
          .map((pair) => [imageKey(...pair), pair[1]]),
      ),
    [v.tags.allImages],
  );
  const retryStatus = status === 'failed' || (anomalyMode && status === 'uncertain') ? status : undefined;
  const clearStatus =
    isRetryStatus(status) || status === 'pending' || status === 'stale' ? status : undefined;
  const retryCounts = {
    failed: failed.filter((row) => editableSamples.has(`${row.source}/${row.candidate}`)).length,
    uncertain: uncertain.filter((row) => editableSamples.has(`${row.source}/${row.candidate}`)).length,
  };
  const retryable = retryStatus ? retryCounts[retryStatus] : 0;
  const activeAudit = v.job.action === 'start_audit' && v.job.status === 'running';
  const refresh = () => client.invalidateQueries({ queryKey: ['run'] });
  const mutation = useMutation({
    mutationFn: (data: AuditEditRequest) => updateReview(data, v.session.token),
    onMutate: () => v.setDatasetSwitching(true),
    onSuccess: async ({ result }, data) => {
      setSelected(new Set());
      const retry = data.retryStatus;
      const startCostume = data.action === 'start_costume_audit';
      if (data.action === 'start_audit' || retry || startCostume) {
        if (!data.retrySample) {
          setPage(0);
          setStatus(startCostume ? 'alternate' : (retry ?? 'pending'));
        }
        const firstFeatureId = data.featureIds?.[0] ?? data.featureId;
        const total = retry ? retryCounts[retry] : eligible * (data.featureIds?.length ?? 1);
        client.setQueryData(['job'], {
          status: 'running',
          action: 'start_audit',
          auditFeature: features.find((item) => item.id === firstFeatureId) ?? null,
          auditCostume: startCostume || data.retryCategory === 'costume',
          total: data.retrySample ? 1 : total,
          done: 0,
          errors: [],
          failedCount: 0,
        });
        v.showToast(
          retry ? `正在重试${RETRY_STATUS_LABELS[retry]}样本。` : '标签检查已开始，工作 TXT 保持原样。',
          'info',
        );
      } else if (data.action === 'tags') {
        v.showToast('已保存此图的工作标签。', 'success');
      } else if (data.action === 'clear_audit_results') {
        setPage(0);
        v.showToast(
          result.changed ? `已清空 ${result.changed} 项检查记录。` : '当前筛选下没有可清空的记录。',
          'success',
        );
      } else v.showToast(data.action === 'undo_audit' ? '已撤销该批次。' : '检查结果已保存。', 'success');
      await Promise.all([refresh(), client.invalidateQueries({ queryKey: ['job'] })]);
    },
    onError: (error: Error, data) => {
      const outdated =
        ['retry_audit_samples', 'start_costume_audit', 'clear_audit_results'].includes(data.action) &&
        error.message === '未知操作';
      v.showToast(outdated ? '请重启 WebUI，使后端加载当前版本。' : error.message, 'error');
    },
    onSettled: () => v.setDatasetSwitching(false),
  });
  const featureMutation = useMutation({
    mutationFn: (edit: FeatureEdit) => {
      const runDir = v.state!.config.run_dir;
      const token = v.session.token;
      if (edit.action === 'delete') return deleteAuditFeature(runDir, edit.feature.id, token);
      if (edit.feature) return updateAuditFeature(runDir, edit.feature.id, edit.fields, token);
      return addAuditFeature(runDir, edit.fields, token);
    },
    onMutate: () => v.setDatasetSwitching(true),
    onSuccess: async (response, edit) => {
      await refresh();
      setFeatureId(edit.action === 'save' ? response.result.id : undefined);
      setForm(undefined);
      v.showToast(edit.action === 'save' ? '已保存特征。' : '已删除特征。', 'success');
    },
    onError: (error: Error) => v.showToast(error.message, 'error'),
    onSettled: () => v.setDatasetSwitching(false),
  });
  const descriptionMutation = useMutation({
    mutationFn: (reference: TagAuditReference) =>
      describeAuditCostume(v.state!.config.run_dir, reference, options, v.session.token),
    onMutate: () => v.setDatasetSwitching(true),
    onSuccess: ({ result }) => {
      setDescriptionEdit({ text: result.description, previousRunId: costumeRun?.id });
      v.showToast('已生成标准服装描述，请核对后运行。', 'success');
    },
    onError: (error: Error) => {
      v.showToast(
        error.message === '未知操作' ? '请重启 WebUI，使后端加载当前版本。' : error.message,
        'error',
      );
    },
    onSettled: () => v.setDatasetSwitching(false),
  });
  const unloadForgeMutation = useMutation({
    mutationFn: () => unloadForgeCheckpoint(v.session.token),
    onSuccess: () => v.showToast('已卸载 Forge 生图模型，下次生图时会自动加载。', 'success'),
    onError: (error: Error) => v.showToast(error.message, 'error'),
  });
  const disabled =
    v.processing ||
    mutation.isPending ||
    featureMutation.isPending ||
    descriptionMutation.isPending ||
    unloadForgeMutation.isPending;

  function handleFilter(nextStatus: AuditFilter, nextCategory = category) {
    setStatus(nextStatus);
    setCategory(nextCategory);
    setPage(0);
    setSelected(new Set());
  }

  function handleSectionChange(next: AuditSection) {
    setShowSettings(next === 'settings');
    if (next === 'settings' || next === mode) return;
    setMode(next);
    handleFilter(next === 'costume' ? 'alternate' : 'pending', 'all');
  }

  function handleFeatureChange(nextId: string) {
    setFeatureId(nextId);
    handleFilter(status);
  }

  function handleToggleFeature(id: string, checked: boolean) {
    setCheckedFeatureIds((previous) => {
      const next = new Set(previous ?? (feature ? [feature.id] : []));
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleCostumeReference({ sampleKey }: ReferenceSelection) {
    if (sampleKey === costumeKey && !costumeReferenceError) return;
    setCostumeSelection({ key: sampleKey, previousRunId: costumeRun?.id });
    setDescriptionEdit({ text: '', previousRunId: costumeRun?.id });
  }

  function handleDescribeCostume() {
    if (!costumeSample || costumeReferenceError) return;
    const [source, candidate] = costumeSample;
    descriptionMutation.mutate({ source: source.id, candidate: candidate.id });
  }

  function handleStartAudit() {
    const auditOptions = { ...options, forbidden: forbiddenTags };
    if (costumeMode) {
      if (!costumeSample || costumeReferenceError) return;
      const [source, candidate] = costumeSample;
      mutation.mutate({
        action: 'start_costume_audit',
        audit: auditOptions,
        costumeReference: { source: source.id, candidate: candidate.id },
        costumeDescription,
      });
      return;
    }
    mutation.mutate({
      action: 'start_audit',
      audit: auditOptions,
      featureIds: featureMode ? checkedFeatures.map((item) => item.id) : undefined,
    });
  }

  function handleRetryAudit(retryStatus: AuditRetryStatus, retrySample?: TagAuditReference) {
    mutation.mutate({
      action: 'retry_audit_samples',
      audit: { ...options, forbidden: forbiddenTags },
      retryStatus,
      retrySample,
      retryCategory: mode,
      featureId: featureMode ? feature?.id : undefined,
      auditRunId: featureMode ? latest?.id : costumeMode ? costumeRun?.id : undefined,
    });
  }

  async function handleSaveSample({ source, candidate }: TagAuditReference, tags: string[]) {
    try {
      await mutation.mutateAsync({
        action: 'tags',
        selections: [[source, candidate]],
        operation: { mode: 'set', tags },
      });
      return true;
    } catch {
      return false;
    }
  }

  function handleDecision(action: 'apply_audit' | 'ignore_audit', ids: string[]) {
    if (!ids.length || disabled) return;
    if (action === 'apply_audit') {
      const idSet = new Set(ids);
      const tags = [
        ...new Set(
          rows.flatMap(({ finding }) => (finding && idSet.has(finding.id) ? getFindingTags(finding) : [])),
        ),
      ];
      if (!anomalyMode) {
        setConfirmation({ action: 'supplement', ids, tags });
        return;
      }
      if (
        !window.confirm(
          `将删除所选异常对应的标签（${ids.length} 项）：\n${tags.join(', ')}\n\n仅修改工作 TXT，可在本页撤销该批次。`,
        )
      )
        return;
    }
    mutation.mutate({ action, ids });
  }

  function handleClearResults() {
    const runDir = v.state?.config.run_dir;
    if (!clearStatus || !visible.length || disabled || !runDir) return;
    setConfirmation({
      action: 'clear',
      mode,
      status: clearStatus,
      category: anomalyMode && !retryStatus ? category : 'all',
      count: visible.length,
      runDir,
      auditRunId: featureMode ? latest?.id : costumeMode ? costumeRun?.id : undefined,
    });
  }

  function handleConfirmationClose(confirmed: boolean) {
    setConfirmation(undefined);
    if (!confirmed || !confirmation || disabled) return;
    if (confirmation.action === 'clear') {
      const { mode, status, category, runDir, auditRunId } = confirmation;
      mutation.mutate({
        action: 'clear_audit_results',
        status,
        category: mode === 'anomaly' ? category : mode,
        runDir,
        auditRunId,
      });
      return;
    }
    mutation.mutate({ action: 'apply_audit', ids: confirmation.ids });
  }

  function imageUrl(sample: Pick<AuditRow, 'source' | 'candidate'>) {
    return `/image?source=${encodeURIComponent(sample.source)}&candidate=${encodeURIComponent(sample.candidate)}&kind=tag&v=${encodeURIComponent(v.state?.updated_at || '')}`;
  }

  const statusLabels = costumeMode
    ? COSTUME_STATUS_LABELS
    : featureMode
      ? FEATURE_STATUS_LABELS
      : ANOMALY_STATUS_LABELS;
  const modeTitle = SECTIONS[mode].title;
  const featureEmptyMessage = feature ? '当前特征尚未检查。' : '保存一条特征，再检查当前数据集。';
  const referenceUrl = referenceSample
    ? getImageUrl(referenceSample[0], 'tag', updatedAt, referenceSample[1])
    : '';
  const costumeReferenceUrl = costumeSample
    ? getImageUrl(costumeSample[0], 'tag', updatedAt, costumeSample[1])
    : '';
  const checkContent = (
    <>
      {confirmation ? (
        <AuditConfirmationDialog
          confirmation={confirmation}
          disabled={disabled}
          onClose={handleConfirmationClose}
        />
      ) : null}
      <section className={`tagGallery ${styles.results}`} aria-label={`${modeTitle}结果`}>
        <div className={styles.toolbar}>
          <h2>{modeTitle}</h2>
          {anomalyMode ? <span>待处理 {pending} 项</span> : null}
          {anomalyMode && status !== 'uncertain' && uncertain.length ? (
            <button type='button' onClick={() => handleFilter('uncertain')}>
              不确定（{uncertain.length}）
            </button>
          ) : null}
          {status !== 'failed' && failed.length ? (
            <button type='button' onClick={() => handleFilter('failed')}>
              失败（{failed.length}）
            </button>
          ) : null}
          {anomalyMode ? (
            <label>
              类型
              <select
                value={category}
                disabled={!!retryStatus}
                onChange={(event) => handleFilter(status, event.target.value as AuditCategory)}
              >
                <option value='all'>全部类型</option>
                <option value='framing'>{CATEGORY_LABELS.framing}</option>
                <option value='count'>{CATEGORY_LABELS.count}</option>
                <option value='rule'>{CATEGORY_LABELS.rule}</option>
              </select>
            </label>
          ) : null}
          <label>
            状态
            <select value={status} onChange={(event) => handleFilter(event.target.value as AuditFilter)}>
              <option value='all'>全部状态</option>
              {Object.entries(statusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {featureMode && latest ? (
          <p>
            最近一轮：{latest.feature.name} · {latest.feature.tags.join(' + ')} · {latest.samples.length} /{' '}
            {latest.total} 份 · 待补标 {pending} 份 · 失败 {failed.length} 份
          </p>
        ) : null}
        {costumeMode && costumeRun ? (
          <p>
            本轮参考图：{costumeRun.reference.name} · {costumeRun.reference.candidate} · 已检查{' '}
            {costumeRun.samples.length} / {costumeRun.total} 份 · 待补标 {pending} 份 · 失败 {failed.length}{' '}
            份
          </p>
        ) : null}
        {costumeMode && costumeRun && !costumeRun.reference.description ? (
          <p>上一轮使用旧规则，请确认标准服装描述后重新检查。</p>
        ) : null}
        <div className={styles.toolbar}>
          {retryStatus ? (
            <>
              <button
                type='button'
                className='primary'
                disabled={disabled || !retryable}
                onClick={() => handleRetryAudit(retryStatus)}
              >
                重试全部{RETRY_STATUS_LABELS[retryStatus]}项（{retryable}）
              </button>
              {visible.length > retryable ? (
                <span>{visible.length - retryable} 份样本已不在有效范围</span>
              ) : null}
            </>
          ) : !clearStatus || clearStatus === 'pending' ? (
            <>
              <button
                disabled={disabled || !pagePendingIds.length}
                onClick={() => setSelected(new Set(pagePendingIds))}
              >
                选择本页{anomalyMode ? '待处理项' : '待补标项'}
              </button>
              <button
                type='button'
                disabled={disabled || !visiblePendingIds.length}
                onClick={() => setSelected(new Set(visiblePendingIds))}
              >
                选择当前筛选全部{anomalyMode ? '待处理项' : '待补标项'}（{visiblePendingIds.length}）
              </button>
              <button disabled={disabled || !selectedIds.length} onClick={() => setSelected(new Set())}>
                清空选择
              </button>
              <button
                className='primary'
                disabled={disabled || !selectedIds.length}
                onClick={() => handleDecision('apply_audit', selectedIds)}
              >
                {anomalyMode ? '应用所选删除' : '补标所选'}（{selectedIds.length}）
              </button>
              <button
                disabled={disabled || !selectedIds.length}
                onClick={() => handleDecision('ignore_audit', selectedIds)}
              >
                {anomalyMode ? '保留所选原标签' : '忽略所选'}
              </button>
            </>
          ) : null}
          {clearStatus ? (
            <button
              type='button'
              className={styles.clearResults}
              disabled={disabled || !visible.length}
              onClick={handleClearResults}
            >
              清空
            </button>
          ) : null}
        </div>
        <div className={styles.list}>
          {pageRows.map((row) => {
            const finding = row.finding;
            const url = imageUrl(row);
            const sampleStatus =
              row.status === 'failed' || (anomalyMode && row.status === 'uncertain') ? row.status : undefined;
            const sample = sampleStatus ? editableSamples.get(`${row.source}/${row.candidate}`) : undefined;
            return (
              <article key={row.id} className={styles.finding}>
                <button
                  className={styles.imageButton}
                  aria-label={`查看 ${row.name}`}
                  onClick={() => v.setPreviewImage(url)}
                >
                  <img src={url} alt={row.name} loading='lazy' />
                </button>
                <div className={styles.detail}>
                  <span>{row.name}</span>
                  <strong>
                    {!anomalyMode
                      ? `${finding ? getFindingTags(finding).join(' + ') : costumeMode ? COSTUME_TAG : latest?.feature.tags.join(' + ')} · ${(costumeMode ? COSTUME_STATUS_LABELS : FEATURE_STATUS_LABELS)[row.status]}`
                      : finding
                        ? `${CATEGORY_LABELS[finding.category]} · ${finding.tag}`
                        : sampleStatus && RETRY_STATUS_LABELS[sampleStatus]}
                  </strong>
                  <p>{row.reason}</p>
                  {anomalyMode && finding ? (
                    <span>
                      建议删除：{finding.tag} · {STATUS_LABELS[finding.status]}
                    </span>
                  ) : null}
                  {finding?.model ? <small>观察模型：{finding.model}</small> : null}
                  {anomalyMode && sample && sampleStatus ? (
                    <AuditSampleActions
                      name={row.name}
                      tags={sample.tag.tags}
                      disabled={disabled}
                      onRetry={() =>
                        handleRetryAudit(sampleStatus, { source: row.source, candidate: row.candidate })
                      }
                      onSave={(tags) => handleSaveSample(row, tags)}
                    />
                  ) : null}
                  {!anomalyMode && sample && sampleStatus ? (
                    <div className={styles.toolbar}>
                      <button
                        type='button'
                        aria-label={`重试此项 ${row.name}`}
                        disabled={disabled}
                        onClick={() =>
                          handleRetryAudit(sampleStatus, { source: row.source, candidate: row.candidate })
                        }
                      >
                        重试此项
                      </button>
                    </div>
                  ) : null}
                  {finding?.status === 'pending' ? (
                    <div className={styles.toolbar}>
                      <label>
                        <input
                          type='checkbox'
                          checked={selected.has(finding.id)}
                          disabled={disabled}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSelected((previous) => {
                              const next = new Set(previous);
                              if (checked) next.add(finding.id);
                              else next.delete(finding.id);
                              return next;
                            });
                          }}
                        />
                        选择此项
                      </label>
                      <button disabled={disabled} onClick={() => handleDecision('apply_audit', [finding.id])}>
                        {anomalyMode ? '应用删除' : '应用补标'}
                      </button>
                      <button
                        disabled={disabled}
                        onClick={() => handleDecision('ignore_audit', [finding.id])}
                      >
                        {anomalyMode ? '保留原标签' : '忽略此项'}
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
          {!visible.length ? (
            <p className='emptyState'>
              {status === 'failed'
                ? '没有失败样本。'
                : status === 'uncertain' && anomalyMode
                  ? '没有不确定样本。'
                  : costumeMode && !costumeRun
                    ? '选择标准服装参考图并确认描述后运行检查。'
                    : featureMode && !latest
                      ? featureEmptyMessage
                      : '当前筛选下没有检查结果。'}
            </p>
          ) : null}
        </div>
        {visible.length ? (
          <div className={styles.toolbar}>
            <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
              上一页
            </button>
            <span>
              {visible.length} 项 · {currentPage + 1} / {pageCount} 页
            </span>
            <button disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>
              下一页
            </button>
          </div>
        ) : null}
      </section>
      <aside className={`tagTools ${styles.controls}`} aria-label={`${modeTitle}操作`}>
        <div className={`panelScroll ${styles.controlsBody}`}>
          {featureMode ? (
            <>
              <label>
                查看特征
                <select
                  disabled={disabled || !!form || !features.length}
                  value={feature?.id || ''}
                  onChange={(event) => handleFeatureChange(event.target.value)}
                >
                  {!features.length ? <option value=''>暂无特征</option> : null}
                  {features.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.toolbar}>
                <button disabled={disabled || !!form} onClick={() => setForm('new')}>
                  新增特征
                </button>
                {feature ? (
                  <>
                    <button disabled={disabled || !!form} onClick={() => setForm('edit')}>
                      编辑特征
                    </button>
                    <button
                      disabled={disabled || !!form}
                      onClick={() => {
                        if (window.confirm(`删除特征「${feature.name}」？该特征的待处理建议将过期。`))
                          featureMutation.mutate({ action: 'delete', feature });
                      }}
                    >
                      删除特征
                    </button>
                  </>
                ) : null}
              </div>
              {form ? (
                <FeatureForm
                  key={form === 'edit' ? feature?.id : 'new'}
                  feature={form === 'edit' ? feature : undefined}
                  samples={referenceSamples}
                  updatedAt={updatedAt}
                  disabled={disabled}
                  onSave={(edit) => featureMutation.mutate(edit)}
                  onCancel={() => setForm(undefined)}
                  onPreview={v.setPreviewImage}
                />
              ) : feature ? (
                <div className={styles.detail}>
                  <p>{feature.description}</p>
                  {referenceSample ? (
                    <small>
                      参考图 · {referenceSample[0].relative} · {referenceSample[1].id}
                    </small>
                  ) : null}
                  {referenceUrl ? (
                    <button className={styles.reference} onClick={() => v.setPreviewImage(referenceUrl)}>
                      <img src={referenceUrl} alt='查看参考图' />
                    </button>
                  ) : null}
                  {feature.referenceError ? <p role='status'>{feature.referenceError}</p> : null}
                </div>
              ) : null}
            </>
          ) : null}
          {costumeMode ? (
            <div className={styles.detail}>
              <div className={styles.toolbar}>
                <button
                  type='button'
                  aria-haspopup='dialog'
                  disabled={disabled || !costumeSamples.length}
                  onClick={() => setPickingCostumeReference(true)}
                >
                  {costumeSample ? '更换标准服装参考图' : '选择标准服装参考图'}
                </button>
              </div>
              {costumeSample ? (
                <small>
                  {costumeSample[0].relative} · {costumeSample[1].id}
                </small>
              ) : null}
              {costumeReferenceUrl ? (
                <button className={styles.reference} onClick={() => v.setPreviewImage(costumeReferenceUrl)}>
                  <img src={costumeReferenceUrl} alt='查看标准服装参考图' />
                </button>
              ) : null}
              {costumeReferenceError ? <p role='status'>{costumeReferenceError}</p> : null}
              {costumeSample ? (
                <form
                  id={costumeFormId}
                  className={styles.detail}
                  action='/api/edit'
                  method='post'
                  aria-labelledby={descriptionId + '-label'}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!disabled) handleStartAudit();
                  }}
                >
                  <label id={descriptionId + '-label'} htmlFor={descriptionId}>
                    标准服装描述（必填）
                  </label>
                  <textarea
                    id={descriptionId}
                    name='costumeDescription'
                    aria-describedby={descriptionHelp}
                    required
                    maxLength={2000}
                    rows={4}
                    value={costumeDescription}
                    disabled={disabled || !!costumeReferenceError}
                    onChange={(event) =>
                      setDescriptionEdit({ text: event.target.value, previousRunId: costumeRun?.id })
                    }
                  />
                  <p id={descriptionHelp}>核对可见的上衣、外套、下装和鞋袜，尤其是款式、剪裁和层次。</p>
                  <button
                    type='button'
                    disabled={disabled || !!costumeReferenceError}
                    onClick={handleDescribeCostume}
                  >
                    {descriptionMutation.isPending
                      ? '正在生成描述…'
                      : costumeDescription
                        ? '重新生成描述'
                        : '生成标准服装描述'}
                  </button>
                </form>
              ) : null}
              {pickingCostumeReference && costumeSamples.length ? (
                <ReferencePicker
                  costume
                  samples={costumeSamples}
                  initialSelection={
                    costumeSample && costumeKey ? { sampleKey: costumeKey, tags: [] } : undefined
                  }
                  updatedAt={updatedAt}
                  onSelect={handleCostumeReference}
                  onDismiss={() => setPickingCostumeReference(false)}
                />
              ) : null}
            </div>
          ) : null}
          {featureMode && features.length ? (
            <fieldset disabled={disabled || !!form}>
              <legend>要检查的特征</legend>
              <div className={`${styles.toolbar} ${styles.featureChoices}`}>
                {features.map((item) => (
                  <label key={item.id}>
                    <input
                      type='checkbox'
                      checked={checkedFeatureIds?.has(item.id) ?? item.id === feature?.id}
                      onChange={(event) => handleToggleFeature(item.id, event.target.checked)}
                    />
                    {item.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <p>范围为当前数据集全部 {eligible} 份有效标签样本，独立于标签页筛选。</p>
          {blockedFeatures.length ? (
            <p role='status'>
              请重新确认参考图和目标标签：{blockedFeatures.map((item) => item.name).join('、')}。
            </p>
          ) : null}
          {!anomalyMode && conflict.length ? (
            <p role='status'>
              目标标签 {conflict.join('、')} 已被禁用，请先在检查设置中调整禁用标签
              {featureMode ? '或修改特征的目标标签。' : '。'}
            </p>
          ) : null}
          <button
            className='primary'
            type={costumeMode ? 'submit' : 'button'}
            form={costumeMode ? costumeFormId : undefined}
            disabled={
              disabled ||
              !eligible ||
              (!anomalyMode && !!conflict.length) ||
              (featureMode && (!checkedFeatures.length || !!form || !!blockedFeatures.length)) ||
              (costumeMode && (!costumeSample || !!costumeReferenceError))
            }
            onClick={costumeMode ? undefined : () => handleStartAudit()}
          >
            {costumeMode
              ? '确认描述并运行换装检查'
              : featureMode
                ? `检查所选特征（${checkedFeatures.length}）`
                : '运行检查，不改标签'}
          </button>
          {activeAudit ? (
            <div className={styles.detail} role='status'>
              <p>
                {v.job.auditCostume
                  ? '正在检查换装'
                  : v.job.auditFeature
                    ? `正在检查「${v.job.auditFeature.name}」`
                    : '正在检查错标'}{' '}
                · {v.job.done} / {v.job.total} 份
              </p>
              <progress aria-label='标签检查进度' max={Math.max(v.job.total, 1)} value={v.job.done} />
            </div>
          ) : null}
          {anomalyMode && audit?.samples ? (
            <p>
              最近一轮：检查 {audit.samples.length} 份 · 部分不确定 {uncertain.length} 份。
            </p>
          ) : null}
          <details>
            <summary>应用历史与撤销</summary>
            <p>图片或标签有后续编辑时，需先撤销后续批次，或在标签编辑中手动恢复。</p>
            {[...(audit?.batches || [])].reverse().map((batch, index) => (
              <div key={batch.id} className={styles.toolbar}>
                <span>
                  批次 {(audit?.batches.length || 0) - index} · {batch.findings.length} 项
                </span>
                <button
                  disabled={disabled || batch.undone}
                  onClick={() => mutation.mutate({ action: 'undo_audit', batch: batch.id })}
                >
                  {batch.undone ? '已撤销' : '撤销此批次'}
                </button>
              </div>
            ))}
          </details>
        </div>
      </aside>
    </>
  );

  const tabs = Object.values(SECTIONS).map((tab) => ({
    ...tab,
    disabled: tab.section !== section && (mutation.isPending || descriptionMutation.isPending),
  }));

  return (
    <SideTabLayout
      id='auditView'
      labelledBy='auditTab'
      navigationLabel='标签检查导航'
      tabs={tabs}
      selected={section}
      onSelect={handleSectionChange}
    >
      {tabs.map(({ section: item, tab, panel }) => (
        <div
          key={item}
          id={panel}
          className={item === 'settings' ? styles.settingsPanel : styles.checkPanel}
          role='tabpanel'
          aria-labelledby={tab}
          hidden={item !== section}
        >
          {item === mode ? checkContent : null}
          {item === 'settings' ? (
            <AuditSettings
              options={options}
              forbidden={forbidden}
              disabled={disabled}
              unloadingForge={unloadForgeMutation.isPending}
              onOptionsChange={setOptions}
              onForbiddenChange={setForbidden}
              onUnloadForge={() => unloadForgeMutation.mutate()}
            />
          ) : null}
        </div>
      ))}
    </SideTabLayout>
  );
}
