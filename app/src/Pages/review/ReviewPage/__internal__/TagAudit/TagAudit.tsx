import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addAuditFeature,
  deleteAuditFeature,
  updateAuditFeature,
  updateReview,
} from '../../../../../api/client';
import type {
  EditRequest,
  TagAuditFeature,
  TagAuditFinding,
  TagAuditOptions,
  TagImage,
} from '../../../../../api/types';
import { useReviewContext } from '../../../context';
import { imageKey, imageUrl as getImageUrl, splitTags } from '../../../utils';
import type { AuditCategory, AuditRow, FeatureEdit, FeatureStatus } from './types';
import styles from './styles.module.css';

const CATEGORY_LABELS = { framing: '构图范围', count: '人物数量', rule: '数据集规则', feature: '核心特征' };
const STATUS_LABELS = { pending: '待处理', ignored: '已保留', applied: '已应用', stale: '已过期' };
const ANOMALY_STATUS_LABELS = { ...STATUS_LABELS, failed: '失败' };
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
const DEFAULT_OPTIONS: TagAuditOptions = {
  visual: true,
  endpoint: 'http://localhost:23333/v1',
  model: 'qwen3.5-4b-uncensored-hauhaucs-aggressive',
  concurrency: 1,
  forbidden: [],
};
const PAGE_SIZE = 30;

interface ReferenceSelection {
  sampleKey: string;
  tags: string[];
}

interface SupplementConfirmation {
  ids: string[];
  tags: string[];
}

function getReferenceTags(sample: TagImage | undefined) {
  if (!sample) return [];
  return [...new Set(sample[1].tag.tags.map((tag) => tag.replaceAll('_', ' ').trim()).filter(Boolean))];
}

function getFindingTags(finding: TagAuditFinding) {
  return finding.tags ?? (finding.tag ? [finding.tag] : []);
}

interface SupplementDialogProps {
  confirmation: SupplementConfirmation;
  disabled: boolean;
  onClose: (confirmed: boolean) => void;
}

function SupplementDialog({ confirmation, disabled, onClose }: SupplementDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const summary = useId();
  const consequence = useId();

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.confirmation}
      aria-labelledby={heading}
      aria-describedby={`${summary} ${consequence}`}
      onClose={(event) => onClose(event.currentTarget.returnValue === 'apply')}
    >
      <div className={styles.dialogHeading}>
        <h2 id={heading}>确认补标</h2>
      </div>
      <div className={styles.confirmationBody}>
        <p id={summary}>将应用 {confirmation.ids.length} 项补标建议，追加以下标签。</p>
        <ul className={styles.confirmationTags}>
          {confirmation.tags.map((tag) => (
            <li className='tagChip' key={tag}>
              {tag}
            </li>
          ))}
        </ul>
        <p id={consequence}>仅修改工作 TXT，可通过「应用历史与撤销」恢复该批次。</p>
      </div>
      <form className={styles.dialogActions} method='dialog'>
        <button type='submit' value='cancel' autoFocus>
          取消
        </button>
        <button type='submit' className='primary' value='apply' disabled={disabled}>
          确认补标
        </button>
      </form>
    </dialog>
  );
}

interface ReferencePickerProps {
  samples: TagImage[];
  initialSelection?: ReferenceSelection;
  updatedAt: string;
  onSelect: (selection: ReferenceSelection) => void;
  onDismiss: () => void;
}

function ReferencePicker({
  samples,
  initialSelection,
  updatedAt,
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
  const tags = getReferenceTags(sample);
  const canConfirm = selection.tags.length > 0 && selection.tags.every((tag) => tags.includes(tag));

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
        <h2 id={heading}>选择参考图和标签</h2>
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
          <h3 id={tagsHeading}>目标标签</h3>
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

export function TagAudit() {
  const v = useReviewContext();
  const client = useQueryClient();
  const audit = v.state?.tag_audit;
  const latest = audit?.featureRun;
  const [featureMode, setFeatureMode] = useState(!!latest || !!v.job.auditFeature);
  const [options, setOptions] = useState({ ...DEFAULT_OPTIONS, ...audit?.options });
  const [forbidden, setForbidden] = useState(options.forbidden.join(', '));
  const [category, setCategory] = useState<AuditCategory>('all');
  const [status, setStatus] = useState<FeatureStatus>('pending');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [supplement, setSupplement] = useState<SupplementConfirmation>();
  const [page, setPage] = useState(0);
  const [featureId, setFeatureId] = useState(latest?.feature.id);
  const [form, setForm] = useState<'new' | 'edit'>();
  const features = Object.values(audit?.features || {});
  const feature = features.find((item) => item.id === featureId) || features[0];
  const referenceSamples = useMemo(
    () => v.tags.allImages.filter(([, candidate]) => candidate.tag_current && candidate.tag.tags.length),
    [v.tags.allImages],
  );
  const savedReference = feature?.reference;
  const referenceSample = savedReference
    ? referenceSamples.find(
        ([source, candidate]) =>
          source.id === savedReference.source && candidate.id === savedReference.candidate,
      )
    : undefined;
  const updatedAt = v.state?.updated_at || '';
  const forbiddenTags = splitTags(forbidden);
  const conflict = feature?.tags.filter((tag) => forbiddenTags.includes(tag)) ?? [];
  const rows = useMemo<AuditRow[]>(() => {
    const findings = audit?.findings || [];
    if (!featureMode) {
      return [
        ...findings.filter((finding) => finding.action !== 'add').map((finding) => ({ ...finding, finding })),
        ...(audit?.samples || [])
          .filter((sample) => sample.status === 'failed')
          .map((sample) => ({
            ...sample,
            id: `failed/${sample.source}/${sample.candidate}`,
            name: `${sample.name} · ${sample.candidate}`,
            status: 'failed' as const,
            reason: sample.error,
          })),
      ];
    }
    const byId = new Map(
      findings.filter((finding) => finding.action === 'add').map((finding) => [finding.id, finding]),
    );
    return (latest?.samples || []).map((sample) => {
      const finding = sample.findingId ? byId.get(sample.findingId) : undefined;
      return {
        ...sample,
        id: `${sample.source}/${sample.candidate}`,
        name: `${sample.name} · ${sample.candidate}`,
        status: finding?.status ?? (sample.status === 'present' ? 'stale' : sample.status),
        reason: sample.error || sample.reason,
        finding,
      };
    });
  }, [audit?.findings, audit?.samples, featureMode, latest]);

  const visible = rows.filter((row) => {
    if (!featureMode && row.status === 'failed') return status === 'failed';
    return (
      (featureMode || category === 'all' || row.finding?.category === category) &&
      (status === 'all' || row.status === status)
    );
  });
  const selectedIds = visible.flatMap((row) =>
    row.finding?.status === 'pending' && selected.has(row.finding.id) ? [row.finding.id] : [],
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const pagePendingIds = pageRows.flatMap((row) =>
    row.finding?.status === 'pending' ? [row.finding.id] : [],
  );
  const pending = rows.filter((row) => row.status === 'pending').length;
  const uncertain = audit?.samples?.filter((sample) => sample.status === 'uncertain') || [];
  const failed = rows.filter((row) => row.status === 'failed');
  const eligible = v.tags.allTargets.length;
  const eligibleKeys = useMemo(
    () => new Set(v.tags.allTargets.map(([source, candidate]) => `${source}/${candidate}`)),
    [v.tags.allTargets],
  );
  const retryable = failed.filter((row) => eligibleKeys.has(`${row.source}/${row.candidate}`)).length;
  const activeAudit = v.job.action === 'start_audit' && v.job.status === 'running';
  const refresh = () => client.invalidateQueries({ queryKey: ['run'] });
  const mutation = useMutation({
    mutationFn: (data: EditRequest) => updateReview(data, v.session.token),
    onMutate: () => v.setDatasetSwitching(true),
    onSuccess: async (_result, data) => {
      setSelected(new Set());
      const retry = data.action === 'retry_audit_failed';
      if (data.action === 'start_audit' || retry) {
        setPage(0);
        setStatus(retry ? 'failed' : 'pending');
        client.setQueryData(['job'], {
          status: 'running',
          action: 'start_audit',
          auditFeature: data.featureId ? feature : null,
          total: retry ? retryable : eligible,
          done: 0,
          errors: [],
          failedCount: 0,
        });
        v.message(retry ? '正在重试失败样本。' : '标签检查已开始，工作 TXT 保持原样。');
      } else v.message(data.action === 'undo_audit' ? '已撤销该批次。' : '检查结果已保存。');
      await Promise.all([refresh(), client.invalidateQueries({ queryKey: ['job'] })]);
    },
    onError: (error: Error, data) => {
      const outdated = data.action === 'retry_audit_failed' && error.message === '未知操作';
      v.message(outdated ? '当前 WebUI 后端版本过旧。请重启 WebUI 后再重试失败项。' : error.message, true);
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
      v.message(edit.action === 'save' ? '已保存特征。' : '已删除特征。');
    },
    onError: (error: Error) => v.message(error.message, true),
    onSettled: () => v.setDatasetSwitching(false),
  });
  const disabled = v.processing || mutation.isPending || featureMutation.isPending;

  function handleFilter(nextStatus: FeatureStatus, nextCategory = category) {
    setStatus(nextStatus);
    setCategory(nextCategory);
    setPage(0);
    setSelected(new Set());
  }

  function handleModeChange(next: boolean) {
    setFeatureMode(next);
    handleFilter('pending', 'all');
  }

  function handleStartAudit(retryFailed = false) {
    mutation.mutate({
      action: retryFailed ? 'retry_audit_failed' : 'start_audit',
      audit: { ...options, forbidden: forbiddenTags },
      featureId: featureMode ? feature?.id : undefined,
    });
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
      if (featureMode) {
        setSupplement({ ids, tags });
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

  function handleSupplementClose(confirmed: boolean) {
    setSupplement(undefined);
    if (confirmed && supplement && !disabled) {
      mutation.mutate({ action: 'apply_audit', ids: supplement.ids });
    }
  }

  function imageUrl(sample: Pick<AuditRow, 'source' | 'candidate'>) {
    return `/image?source=${encodeURIComponent(sample.source)}&candidate=${encodeURIComponent(sample.candidate)}&kind=tag&v=${encodeURIComponent(v.state?.updated_at || '')}`;
  }

  const statusLabels = featureMode ? FEATURE_STATUS_LABELS : ANOMALY_STATUS_LABELS;
  const modeTitle = featureMode ? '漏标补充' : '错标检查';
  const showingFailed = !featureMode && status === 'failed';
  const referenceUrl = referenceSample
    ? getImageUrl(referenceSample[0], 'tag', updatedAt, referenceSample[1])
    : '';
  return (
    <main
      id='auditView'
      className={styles.page}
      role='tabpanel'
      aria-labelledby='auditTab'
      hidden={v.stage !== 'audit'}
    >
      {supplement ? (
        <SupplementDialog confirmation={supplement} disabled={disabled} onClose={handleSupplementClose} />
      ) : null}
      <section className={`tagGallery ${styles.results}`} aria-label={`${modeTitle}结果`}>
        <div className={styles.toolbar}>
          <h2>{modeTitle}</h2>
          {!featureMode ? <span>待处理 {pending} 项</span> : null}
          {!featureMode && !showingFailed && failed.length ? (
            <button type='button' onClick={() => handleFilter('failed')}>
              失败（{failed.length}）
            </button>
          ) : null}
          {!featureMode ? (
            <label>
              类型
              <select
                value={category}
                disabled={showingFailed}
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
            <select value={status} onChange={(event) => handleFilter(event.target.value as FeatureStatus)}>
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
        {showingFailed ? (
          <div className={styles.toolbar}>
            <button
              type='button'
              className='primary'
              disabled={disabled || !retryable}
              onClick={() => handleStartAudit(true)}
            >
              重试全部失败项（{retryable}）
            </button>
            {failed.length > retryable ? <span>{failed.length - retryable} 份样本已不在有效范围</span> : null}
          </div>
        ) : (
          <div className={styles.toolbar}>
            <button
              disabled={disabled || !pagePendingIds.length}
              onClick={() => setSelected(new Set(pagePendingIds))}
            >
              选择本页{featureMode ? '待补标项' : '待处理项'}
            </button>
            <button disabled={disabled || !selectedIds.length} onClick={() => setSelected(new Set())}>
              清空选择
            </button>
            <button
              className='primary'
              disabled={disabled || !selectedIds.length}
              onClick={() => handleDecision('apply_audit', selectedIds)}
            >
              {featureMode ? '补标所选' : '应用所选删除'}（{selectedIds.length}）
            </button>
            <button
              disabled={disabled || !selectedIds.length}
              onClick={() => handleDecision('ignore_audit', selectedIds)}
            >
              {featureMode ? '忽略所选' : '保留所选原标签'}
            </button>
          </div>
        )}
        <div className={styles.list}>
          {pageRows.map((row) => {
            const finding = row.finding;
            const url = imageUrl(row);
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
                    {featureMode
                      ? `${finding ? getFindingTags(finding).join(' + ') : latest?.feature.tags.join(' + ')} · ${FEATURE_STATUS_LABELS[row.status]}`
                      : finding
                        ? `${CATEGORY_LABELS[finding.category]} · ${finding.tag}`
                        : '检查失败'}
                  </strong>
                  <p>{row.reason}</p>
                  {!featureMode && finding ? (
                    <span>
                      建议删除：{finding.tag} · {STATUS_LABELS[finding.status]}
                    </span>
                  ) : null}
                  {finding?.model ? <small>观察模型：{finding.model}</small> : null}
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
                        {featureMode ? '应用补标' : '应用删除'}
                      </button>
                      <button
                        disabled={disabled}
                        onClick={() => handleDecision('ignore_audit', [finding.id])}
                      >
                        {featureMode ? '忽略此项' : '保留原标签'}
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
          {!visible.length ? (
            <p className='emptyState'>
              {showingFailed
                ? '没有失败样本。'
                : featureMode && !latest
                  ? '保存一条特征，再检查当前数据集。'
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
      <aside className={`tagTools ${styles.controls}`} aria-label='标签检查设置'>
        <div className={styles.toolbar}>
          <h2>标签检查设置</h2>
        </div>
        <div className={`panelScroll ${styles.settings}`}>
          <div className={styles.toolbar} role='group' aria-label='检查类型'>
            <button
              aria-pressed={!featureMode}
              className={!featureMode ? 'active' : ''}
              onClick={() => handleModeChange(false)}
            >
              错标检查
            </button>
            <button
              aria-pressed={featureMode}
              className={featureMode ? 'active' : ''}
              onClick={() => handleModeChange(true)}
            >
              漏标补充
            </button>
          </div>
          {featureMode ? (
            <>
              <label>
                要检查的特征
                <select
                  disabled={disabled || !!form || !features.length}
                  value={feature?.id || ''}
                  onChange={(event) => setFeatureId(event.target.value)}
                >
                  {!features.length ? <option value=''>暂无特征</option> : null}
                  {features.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.tags.join(' + ')}
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
          <p>范围为当前数据集全部 {eligible} 份有效标签样本，独立于标签页筛选。</p>
          <fieldset disabled={disabled}>
            <legend>本地视觉检查</legend>
            {!featureMode ? (
              <label className={styles.check}>
                <input
                  type='checkbox'
                  checked={options.visual}
                  onChange={(event) => setOptions({ ...options, visual: event.target.checked })}
                />
                检查构图范围和人物数量
              </label>
            ) : null}
            <label>
              API 地址（包含 /v1）
              <input
                value={options.endpoint}
                disabled={!featureMode && !options.visual}
                onChange={(event) => setOptions({ ...options, endpoint: event.target.value })}
              />
            </label>
            <label>
              模型 ID
              <input
                value={options.model}
                disabled={!featureMode && !options.visual}
                onChange={(event) => setOptions({ ...options, model: event.target.value })}
              />
            </label>
            <label className={styles.concurrency}>
              <span>
                并发请求数
                <output htmlFor='auditConcurrency'>{options.concurrency}</output>
              </span>
              <input
                id='auditConcurrency'
                aria-label='并发请求数'
                type='range'
                min={1}
                max={16}
                step={1}
                value={options.concurrency}
                disabled={!featureMode && !options.visual}
                onChange={(event) =>
                  setOptions({ ...options, concurrency: event.currentTarget.valueAsNumber })
                }
              />
            </label>
          </fieldset>
          <label>
            当前数据集禁用标签
            <textarea
              rows={3}
              value={forbidden}
              disabled={disabled}
              placeholder='例如 virtual youtuber，逗号或换行分隔'
              onChange={(event) => setForbidden(event.target.value)}
            />
          </label>
          {featureMode && conflict.length ? (
            <p role='status'>目标标签 {conflict.join('、')} 已被禁用，请先调整禁用规则或目标标签。</p>
          ) : null}
          <button
            className='primary'
            disabled={
              disabled ||
              !eligible ||
              (featureMode && (!feature || !!form || !!conflict.length || !!feature.referenceError))
            }
            onClick={() => handleStartAudit()}
          >
            {featureMode ? '检查此特征' : '运行检查，不改标签'}
          </button>
          {activeAudit ? (
            <div className={styles.detail} role='status'>
              <p>
                {v.job.auditFeature ? `正在检查「${v.job.auditFeature.name}」` : '正在检查错标'} ·{' '}
                {v.job.done} / {v.job.total} 份
              </p>
              <progress aria-label='标签检查进度' max={Math.max(v.job.total, 1)} value={v.job.done} />
            </div>
          ) : null}
          {!featureMode && audit?.samples ? (
            <p>
              最近一轮：检查 {audit.samples.length} 份 · 部分不确定 {uncertain.length} 份。
            </p>
          ) : null}
          {!featureMode && uncertain.length ? (
            <details>
              <summary>查看不确定样本</summary>
              {uncertain.map((sample) => (
                <div key={`${sample.source}/${sample.candidate}`} className={styles.sample}>
                  <button onClick={() => v.setPreviewImage(imageUrl(sample))}>
                    {sample.name} · {sample.candidate}
                  </button>
                  <p>
                    {sample.observation?.count_reason}；{sample.observation?.framing_reason}
                  </p>
                </div>
              ))}
            </details>
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
    </main>
  );
}
