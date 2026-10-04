import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelCompositeTagging, getCompositeJobInfo, startCompositeTagging } from '../api';
import type { CompositeRequest } from '../types';
import type { CompositeTaggingProps } from './types';
import styles from './styles.module.css';

const STATUS_LABELS = {
  idle: '等待开始',
  running: '正在打标',
  cancelling: '正在取消，等待当前模型返回',
  cancelled: '已取消，已完成的样本保留',
  complete: '打标完成',
  failed: '部分或全部处理失败，请查看错误',
};

export function CompositeTagging({ token, active }: CompositeTaggingProps) {
  const client = useQueryClient();
  const [fields, setFields] = useState<CompositeRequest>({
    directory: '',
    output_directory: '',
    forge_url: 'http://127.0.0.1:7860',
    recursive: true,
  });
  const [error, setError] = useState('');
  const statusQuery = useQuery({
    queryKey: ['composite-job'],
    queryFn: getCompositeJobInfo,
    enabled: active,
    refetchInterval: (query) =>
      query.state.error || ['running', 'cancelling'].includes(query.state.data?.status || '') ? 1000 : false,
  });
  const startMutation = useMutation({
    mutationFn: () => startCompositeTagging(fields, token),
    onSuccess: (status) => client.setQueryData(['composite-job'], status),
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelCompositeTagging(token),
    onSuccess: (status) => client.setQueryData(['composite-job'], status),
  });
  const status = statusQuery.data;
  const running = status?.status === 'running' || status?.status === 'cancelling';
  const disabled = running || startMutation.isPending || statusQuery.isPending;

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      await startMutation.mutateAsync();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  async function handleCancel() {
    setError('');
    try {
      await cancelMutation.mutateAsync();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  return (
    <main
      id='compositeView'
      role='tabpanel'
      aria-labelledby='compositeTab'
      hidden={!active}
      className={styles.view}
    >
      <div className={styles.content}>
        <section className={styles.section}>
          <h2>双模型复合打标</h2>
          <p className='text-review-muted'>
            为未打标图片合并 WD EVA02 Large 和 PixAI 标签。已有同名 TXT 的图片会跳过，源目录保持不变。
          </p>
          <form onSubmit={handleStart}>
            <fieldset disabled={disabled} className={styles.fields}>
              <label htmlFor='compositeDirectory'>图片目录</label>
              <input
                id='compositeDirectory'
                required
                value={fields.directory}
                onChange={(event) => setFields({ ...fields, directory: event.target.value })}
                placeholder='未打标图片所在的本地目录'
              />
              <label htmlFor='compositeOutput'>输出根目录</label>
              <input
                id='compositeOutput'
                required
                value={fields.output_directory}
                onChange={(event) => setFields({ ...fields, output_directory: event.target.value })}
                placeholder='请选择新目录或空目录，不能位于输入目录中'
              />
              <label htmlFor='compositeForge'>Forge 地址</label>
              <input
                id='compositeForge'
                type='url'
                required
                value={fields.forge_url}
                onChange={(event) => setFields({ ...fields, forge_url: event.target.value })}
              />
              <label className={styles.checkbox}>
                <input
                  type='checkbox'
                  checked={fields.recursive}
                  onChange={(event) => setFields({ ...fields, recursive: event.target.checked })}
                />
                包含子目录
              </label>
            </fieldset>
            <p className='text-review-muted'>
              WD 阈值 0.30；PixAI 使用默认分类阈值。去除 meta 标签，下划线转空格，括号保留原样。
            </p>
            <p className='text-review-muted'>
              只在两个模型均支持单人且无多人、多视图证据时，删除置信度较低的互斥动作。同分冲突保留待核。
            </p>
            <div className='flex flex-wrap items-center gap-3'>
              <button type='submit' className='primary' disabled={disabled || !!statusQuery.error}>
                开始复合打标
              </button>
              <button
                type='button'
                onClick={handleCancel}
                disabled={status?.status !== 'running' || cancelMutation.isPending}
              >
                取消任务
              </button>
              <span role='status' aria-live='polite'>
                {STATUS_LABELS[status?.status || 'idle']}{' '}
                {status?.total ? `· ${status.done}/${status.total}` : ''}
              </span>
            </div>
            {running && (
              <p>
                {status?.current} ·{' '}
                {status?.phase === 'wd-eva02-large-tagger-v3'
                  ? 'WD EVA02 Large'
                  : status?.phase === 'pixai-tagger-v1.0'
                    ? 'PixAI'
                    : status?.phase}
              </p>
            )}
            {running && (
              <progress aria-label='复合打标进度' max={status?.total || 1} value={status?.done || 0} />
            )}
            {(error || statusQuery.error) && (
              <p role='alert' className={styles.error}>
                {error || statusQuery.error?.message}
              </p>
            )}
          </form>
        </section>
        <section className={styles.section} aria-label='输出说明'>
          <h3>输出目录</h3>
          <ul>
            <li>
              <strong>dataset</strong>：图片副本和同名 TXT，供训练使用。
            </li>
            <li>
              <strong>probabilities</strong>：同名 JSON，保存最终标签及合并概率。
            </li>
            <li>
              <strong>evidence</strong>：两模型原始概率、合并前标签和动作处理记录。
            </li>
          </ul>
          <p>合并概率取两个模型的最大值。概率和处理记录与训练数据分目录保存。</p>
          {status?.output_directory && <p className={styles.path}>本次输出：{status.output_directory}</p>}
        </section>
        {status && status.status !== 'idle' && (
          <section className={styles.section}>
            <h3>处理结果</h3>
            <p>
              成功 {status.results.length} 张，失败 {status.errors.length} 项，跳过已有标签{' '}
              {status.skipped || 0} 张。
            </p>
            {status.errors.map((item, index) => (
              <p className={styles.error} key={`${item.file}-${index}`}>
                {item.file || '任务'}：{item.error}
              </p>
            ))}
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>图片</th>
                    <th>标签数</th>
                    <th>动作处理</th>
                  </tr>
                </thead>
                <tbody>
                  {status.results.map((item) => (
                    <tr key={item.file}>
                      <td>{item.file}</td>
                      <td>{item.tags}</td>
                      <td>
                        <div>{item.person_reason}</div>
                        {item.removed.map((removed) => (
                          <div key={removed.tag}>
                            移除 {removed.tag} ({removed.score.toFixed(3)})；保留 {removed.winner} (
                            {removed.winner_score.toFixed(3)})
                          </div>
                        ))}
                        {item.unresolved.map((conflict, index) => (
                          <div key={index}>
                            待核：{conflict.tags.join(' / ')} · {conflict.reason}
                          </div>
                        ))}
                        {!item.removed.length && !item.unresolved.length && <div>无动作冲突</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
