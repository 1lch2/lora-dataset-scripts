import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateReview } from '../../../../../api/client';
import type { EditRequest, TagAuditFinding, TagAuditOptions } from '../../../../../api/types';
import { useReviewContext } from '../../../context';
import { splitTags } from '../../../utils';
import type { AuditCategory, AuditStatus } from './types';
import styles from './styles.module.css';

const CATEGORY_LABELS = { framing: '构图范围', count: '人物数量', rule: '数据集规则' };
const STATUS_LABELS = { pending: '待处理', ignored: '已保留', applied: '已应用', stale: '已过期' };
const DEFAULT_OPTIONS: TagAuditOptions = {
  visual: true,
  endpoint: 'http://localhost:23333/v1',
  model: 'lfm3-vl-2b',
  forbidden: [],
};

export function TagAudit() {
  const v = useReviewContext();
  const client = useQueryClient();
  const audit = v.state?.tag_audit;
  const [options, setOptions] = useState(audit?.options || DEFAULT_OPTIONS);
  const [forbidden, setForbidden] = useState(options.forbidden.join(', '));
  const [category, setCategory] = useState<AuditCategory>('all');
  const [status, setStatus] = useState<AuditStatus>('pending');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const findings = audit?.findings || [];
  const visible = useMemo(
    () =>
      findings.filter(
        (f) => (category === 'all' || f.category === category) && (status === 'all' || f.status === status),
      ),
    [findings, category, status],
  );
  const selectedIds = visible.filter((f) => f.status === 'pending' && selected.has(f.id)).map((f) => f.id);
  const pageCount = Math.max(1, Math.ceil(visible.length / 30));
  const currentPage = Math.min(page, pageCount - 1);
  const pending = findings.filter((f) => f.status === 'pending').length;
  const uncertain = audit?.samples?.filter((s) => s.status === 'uncertain') || [];
  const failed = audit?.samples?.filter((s) => s.status === 'failed') || [];
  const eligible = v.sources.reduce(
    (sum, s) => sum + s.candidates.filter((c) => c.status === 'accepted' && c.tag_current).length,
    0,
  );
  const mutation = useMutation({
    mutationFn: (data: EditRequest) => updateReview(data, v.session.token),
    onMutate: () => v.setDatasetSwitching(true),
    onSuccess: async (_result, data) => {
      setSelected(new Set());
      if (data.action === 'start_audit') {
        client.setQueryData(['job'], {
          ...v.job,
          status: 'running',
          action: 'start_audit',
          total: eligible,
          done: 0,
          errors: [],
        });
        v.message('标签检查已开始，仅生成建议，不修改工作 TXT。');
      } else v.message(data.action === 'undo_audit' ? '已撤销该批次。' : '检查结果已保存。');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['run'] }),
        client.invalidateQueries({ queryKey: ['job'] }),
      ]);
    },
    onError: (error: Error) => v.message(error.message, true),
    onSettled: () => v.setDatasetSwitching(false),
  });
  const disabled = v.processing || mutation.isPending;

  function handleDecision(action: 'apply_audit' | 'ignore_audit', ids: string[]) {
    if (!ids.length || disabled) return;
    if (action === 'apply_audit') {
      const tags = [...new Set(findings.filter((f) => ids.includes(f.id)).map((f) => f.tag))];
      if (
        !window.confirm(
          `将删除所选 ${ids.length} 项异常对应的标签：\n${tags.join(', ')}\n\n仅修改工作 TXT，可在本页撤销该批次。`,
        )
      )
        return;
    }
    mutation.mutate({ action, ids });
  }

  function imageUrl(finding: Pick<TagAuditFinding, 'source' | 'candidate'>) {
    return `/image?source=${encodeURIComponent(finding.source)}&candidate=${encodeURIComponent(finding.candidate)}&kind=tag&v=${encodeURIComponent(v.state?.updated_at || '')}`;
  }

  return (
    <main
      id='tagView'
      className={styles.page}
      role='tabpanel'
      aria-labelledby='tagTab'
      hidden={v.stage !== 'tag'}
    >
      <section className={`tagGallery ${styles.results}`} aria-label='标签异常结果'>
        <div className={styles.toolbar}>
          <h2>检查结果</h2>
          <span>待处理 {pending} 项</span>
          <label>
            类型
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as AuditCategory);
                setPage(0);
                setSelected(new Set());
              }}
            >
              <option value='all'>全部类型</option>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            状态
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as AuditStatus);
                setPage(0);
                setSelected(new Set());
              }}
            >
              <option value='all'>全部状态</option>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.toolbar}>
          <button
            disabled={disabled}
            onClick={() =>
              setSelected(
                new Set(
                  visible
                    .slice(currentPage * 30, (currentPage + 1) * 30)
                    .filter((f) => f.status === 'pending')
                    .map((f) => f.id),
                ),
              )
            }
          >
            选择本页待处理项
          </button>
          <button disabled={disabled || !selectedIds.length} onClick={() => setSelected(new Set())}>
            清空选择
          </button>
          <button
            className='primary'
            disabled={disabled || !selectedIds.length}
            onClick={() => handleDecision('apply_audit', selectedIds)}
          >
            应用所选删除（{selectedIds.length}）
          </button>
          <button
            disabled={disabled || !selectedIds.length}
            onClick={() => handleDecision('ignore_audit', selectedIds)}
          >
            保留所选原标签
          </button>
        </div>
        <p>视觉判断是待核实的建议。只删除明确选中的标签，不补写其他标签；点击图片查看大图。</p>
        <div className={styles.list}>
          {visible.slice(currentPage * 30, (currentPage + 1) * 30).map((finding) => (
            <article key={finding.id} className={styles.finding}>
              <button
                className={styles.imageButton}
                aria-label={`查看 ${finding.name}`}
                onClick={() => v.setPreviewImage(imageUrl(finding))}
              >
                <img src={imageUrl(finding)} alt={finding.name} loading='lazy' />
              </button>
              <div className={styles.detail}>
                <span>{finding.name}</span>
                <strong>
                  {CATEGORY_LABELS[finding.category]} · {finding.tag}
                </strong>
                <p>{finding.reason}</p>
                <span>
                  建议删除：{finding.tag} · {STATUS_LABELS[finding.status]}
                </span>
                {finding.model ? <small>观察模型：{finding.model}</small> : null}
                {finding.status === 'pending' ? (
                  <div className={styles.toolbar}>
                    <label>
                      <input
                        type='checkbox'
                        checked={selected.has(finding.id)}
                        disabled={disabled}
                        onChange={(e) => {
                          const checked = e.target.checked;
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
                      应用删除
                    </button>
                    <button disabled={disabled} onClick={() => handleDecision('ignore_audit', [finding.id])}>
                      保留原标签
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
          {!visible.length ? (
            <p className='emptyState'>
              {audit
                ? '当前筛选下没有异常建议；这不代表全部标签已经验证正确。'
                : '运行检查后，这里只展示需要注意的标签。'}
            </p>
          ) : null}
        </div>
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
      </section>
      <aside className={`tagTools ${styles.controls}`} aria-label='标签检查设置'>
        <div className={styles.toolbar}>
          <h2>标签检查</h2>
          <button onClick={() => v.setTool('filter')} disabled={disabled}>
            返回标签编辑
          </button>
        </div>
        <div className={`panelScroll ${styles.settings}`}>
          <p>范围：当前数据集全部 {eligible} 份有效标签样本，不受标签页筛选或勾选影响。</p>
          <fieldset disabled={disabled}>
            <legend>本地视觉检查</legend>
            <label className={styles.check}>
              <input
                type='checkbox'
                checked={options.visual}
                onChange={(e) => setOptions({ ...options, visual: e.target.checked })}
              />
              检查构图范围和人物数量
            </label>
            <label>
              API 地址（包含 /v1）
              <input
                value={options.endpoint}
                disabled={!options.visual}
                onChange={(e) => setOptions({ ...options, endpoint: e.target.value })}
              />
            </label>
            <label>
              模型 ID
              <input
                value={options.model}
                disabled={!options.visual}
                onChange={(e) => setOptions({ ...options, model: e.target.value })}
              />
            </label>
            <p>发送实际训练样本到本机接口。先独立观察图片，再对照数量与构图标签。</p>
          </fieldset>
          <label>
            当前数据集禁用标签
            <textarea
              rows={3}
              value={forbidden}
              disabled={disabled}
              placeholder='例如 virtual youtuber；逗号或换行分隔'
              onChange={(e) => setForbidden(e.target.value)}
            />
          </label>
          <p>只填写你明确不使用的标签。不根据“游戏角色”自动推断身份，规则在运行检查时保存到当前数据集。</p>
          <button
            className='primary'
            disabled={disabled || !eligible}
            onClick={() =>
              mutation.mutate({
                action: 'start_audit',
                audit: { ...options, forbidden: splitTags(forbidden) },
              })
            }
          >
            运行检查，不改标签
          </button>
          {audit?.samples ? (
            <p>
              最近一轮：检查 {audit.samples.length} 份 · 部分不确定 {uncertain.length} 份 · 失败{' '}
              {failed.length} 份。
            </p>
          ) : null}
          {uncertain.length || failed.length ? (
            <details>
              <summary>查看不确定与失败样本</summary>
              {[...failed, ...uncertain].map((sample) => (
                <div key={`${sample.source}/${sample.candidate}`} className={styles.sample}>
                  <button onClick={() => v.setPreviewImage(imageUrl(sample))}>
                    {sample.name} · {sample.candidate}
                  </button>
                  <p>
                    {sample.error ||
                      `${sample.observation?.count_reason}；${sample.observation?.framing_reason}`}
                  </p>
                </div>
              ))}
            </details>
          ) : null}
          <details>
            <summary>应用历史与撤销</summary>
            <p>每次单项或批量应用都可撤销；之后标签或图片改变时拒绝覆盖，请先撤销后续批次。</p>
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
