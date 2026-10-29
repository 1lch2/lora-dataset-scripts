import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateReview } from '../../../../../api/client';
import type { EditRequest, TaggingFilters, TaggingMode } from '../../../../../api/types';
import { useReviewContext } from '../../../context';
import { binLabel, DEFAULT_FILTERS, keepTag, scoreBin } from './taggingUtils';
import type { ScoreRow, ScoredSample } from './types';
import styles from './styles.module.css';

const BINS = Array.from({ length: 11 }, (_, index) => index);
const REVERSED_BINS = [...BINS].reverse();
const FILTER_LABELS: [keyof TaggingFilters, string][] = [
  ['wd', 'WD 独立接受下限'],
  ['pixai', 'PixAI 独立接受下限'],
  ['commonWd', '共同支持 · WD 下限'],
  ['commonPixai', '共同支持 · PixAI 下限'],
];

export function Tagging() {
  const v = useReviewContext();
  const client = useQueryClient();
  const [mode, setMode] = useState<TaggingMode>(v.state?.tagging_options?.mode || 'wd');
  const [filters, setFilters] = useState<TaggingFilters>(
    v.state?.tagging_options?.filters || DEFAULT_FILTERS,
  );
  const [scope, setScope] = useState('all');
  const [cell, setCell] = useState<number>();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const scored = useMemo<ScoredSample[]>(
    () =>
      v.sources.flatMap((source) =>
        source.candidates.flatMap((candidate) => {
          if (candidate.status !== 'accepted' || !candidate.tag_current || !candidate.tag?.evidence)
            return [];
          return [
            {
              key: `${source.id}/${candidate.id}`,
              source: source.id,
              candidate: candidate.id,
              name: `${source.relative} · ${candidate.id}`,
              evidence: candidate.tag.evidence,
              removed: candidate.tag.auto_removed,
            },
          ];
        }),
      ),
    [v.sources],
  );
  const selected = useMemo(
    () => scored.filter((sample) => scope === 'all' || sample.key === scope),
    [scored, scope],
  );
  const rows = useMemo<ScoreRow[]>(
    () =>
      selected.flatMap((sample) => {
        const wd = sample.evidence.scores.wd || {};
        const pixai = sample.evidence.scores.pixai || {};
        return [...new Set([...Object.keys(wd), ...Object.keys(pixai)])].map((name) => ({
          key: `${sample.key}/${name}`,
          name,
          sample: sample.name,
          wd: wd[name],
          pixai: pixai[name],
          removed: sample.removed.includes(name),
        }));
      }),
    [selected],
  );
  const matrix = useMemo(() => {
    const values = Array<number>(121).fill(0);
    for (const row of rows) values[scoreBin(row.pixai) * 11 + scoreBin(row.wd)]++;
    return values;
  }, [rows]);
  const maxCount = Math.max(1, ...matrix);
  const common = rows.filter((row) => row.wd !== undefined && row.pixai !== undefined).length;
  const kept = rows.filter((row) => keepTag(row, filters)).length;
  const visible = rows.filter(
    (row) =>
      (cell === undefined || scoreBin(row.pixai) * 11 + scoreBin(row.wd) === cell) &&
      row.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / 100));
  const currentPage = Math.min(page, pageCount - 1);
  const mutation = useMutation({
    mutationFn: (data: EditRequest) => updateReview(data, v.session.token),
    onMutate: () => v.setDatasetSwitching(true),
    onSuccess: async (_result, data) => {
      if (data.action === 'start_tag') {
        client.setQueryData(['job'], {
          ...v.job,
          status: 'running',
          action: 'start_tag',
          total: v.samples.length,
          done: 0,
        });
        v.message('打标任务已开始，结果会保留两套独立分数。');
      } else
        v.message(
          data.action === 'restore_captions'
            ? '已重新导入源 TXT；来源文件未修改。'
            : '已将预览范围的过滤结果写入工作标签。',
        );
      await Promise.all([
        client.invalidateQueries({ queryKey: ['run'] }),
        client.invalidateQueries({ queryKey: ['job'] }),
      ]);
    },
    onError: (error: Error) => v.message(error.message, true),
    onSettled: () => v.setDatasetSwitching(false),
  });
  const disabled = v.processing || mutation.isPending;
  const prepared = v.state?.config.crop_mode === 'prepared';
  function handleStart() {
    if (disabled || !v.ready) return;
    if (v.box && (!v.candidate?.box || v.box.some((value, index) => value !== v.candidate?.box?.[index]))) {
      v.message('当前裁框尚未保存，请返回裁切页保存或取消修改。', true);
      return;
    }
    if (
      v.samples.some((candidate) => candidate.tag) &&
      !window.confirm(
        `将重新打标全部 ${v.samples.length} 份已接受样本，替换工作目录内的原有标签及其编辑结果。\n\n${v.state?.config.run_dir}\n\n导入来源不变。${prepared ? '可通过“重新导入源 TXT”安全恢复完整图的原始标签。' : '原始素材不会被修改。'}`,
      )
    )
      return;
    mutation.mutate({ action: 'start_tag', tagging: { mode, filters }, replaceConfirmed: true });
  }
  function handleApply() {
    if (!selected.length || disabled) return;
    if (
      !window.confirm(
        `将当前阈值应用到所选 ${selected.length} 份样本，并替换工作标签（包括之前的人工编辑）。原始模型分数保留，可调低阈值恢复。`,
      )
    )
      return;
    mutation.mutate({
      action: 'filter_tagging',
      filters,
      selections: selected.map(({ source, candidate }) => ({ source, candidate })),
    });
  }
  function handleRestore() {
    if (
      !window.confirm(
        '重新读取导入来源中的同名 TXT，替换当前完整图的工作标签？\n源文件不变；裁片标签不受影响。',
      )
    )
      return;
    mutation.mutate({ action: 'restore_captions', replaceConfirmed: true });
  }
  return (
    <main id='taggingView' role='tabpanel' aria-labelledby='taggingTab' className={styles.page}>
      <section className={styles.controls} aria-label='打标配置'>
        <h2>打标</h2>
        <p>范围：当前数据集全部 {v.samples.length} 份已接受样本。先完成裁切审核，再运行打标。</p>
        {prepared ? (
          <p className={styles.warning}>
            这是完整打标数据集。运行打标会替换工作目录中的原有 TXT 结果，导入来源保持不变，可重新导入源 TXT
            安全恢复。
          </p>
        ) : null}
        <fieldset disabled={disabled}>
          <legend>模型选择</legend>
          <label>
            <input type='radio' name='taggingMode' checked={mode === 'wd'} onChange={() => setMode('wd')} />{' '}
            单模型 · WD EVA02 Large v3
          </label>
          <label>
            <input
              type='radio'
              name='taggingMode'
              checked={mode === 'pixai'}
              onChange={() => setMode('pixai')}
            />{' '}
            单模型 · PixAI v1.0
          </label>
          <label>
            <input
              type='radio'
              name='taggingMode'
              checked={mode === 'mixed'}
              onChange={() => setMode('mixed')}
            />{' '}
            混合 · WD + PixAI
          </label>
        </fieldset>
        <details>
          <summary>PixAI 专用配置 · meta 类别强制排除</summary>
          <p>
            使用此模型完整 meta 类别表（含 highres），并排除 masterpiece。当前插件 HTTP API
            不支持分类过滤，在收到结果后、合并与写入前排除；不是仅隐藏显示。rating 不进入训练标签。
          </p>
        </details>
        <fieldset disabled={disabled}>
          <legend>置信度范围 · 保留下限至 1.00</legend>
          {FILTER_LABELS.map(([key, label]) => (
            <label key={key} className={styles.slider}>
              <span>
                {label}
                <output>{filters[key].toFixed(2)}</output>
              </span>
              <input
                aria-label={label}
                type='range'
                min='0.01'
                max='1'
                step='0.01'
                value={filters[key]}
                onChange={(event) =>
                  setFilters((previous) => ({ ...previous, [key]: Number(event.target.value) }))
                }
              />
            </label>
          ))}
        </fieldset>
        <p>
          满足任一模型的独立下限，或同时满足两项共同支持下限，即保留。单模型结果只使用对应独立下限，不平均两模型分数。
        </p>
        <button
          className='primary'
          disabled={disabled || !v.ready || !v.samples.length}
          onClick={handleStart}
        >
          {v.job.status === 'running' && v.job.action === 'start_tag'
            ? '正在打标…'
            : '运行打标并替换工作标签'}
        </button>
        {!v.ready ? <p role='status'>{v.stageStatus}</p> : null}
        {prepared ? (
          <button disabled={disabled} onClick={handleRestore}>
            重新导入源 TXT
          </button>
        ) : null}
      </section>
      <section className={styles.results} aria-label='合并结果'>
        <div className={styles.toolbar}>
          <h2>合并热力图</h2>
          <label>
            预览与应用范围
            <select
              value={scope}
              disabled={disabled}
              onChange={(event) => {
                setScope(event.target.value);
                setCell(undefined);
                setPage(0);
              }}
            >
              <option value='all'>全部有效打标结果（{scored.length} 份）</option>
              {scored.map((sample) => (
                <option key={sample.key} value={sample.key}>
                  {sample.name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={disabled || !selected.length} onClick={handleApply}>
            应用过滤到工作标签
          </button>
        </div>
        {!scored.length ? (
          <p className={styles.empty}>
            运行单模型或混合打标后，在这里查看分数与重合程度。导入 TXT 和旧打标记录不包含双模型证据。
          </p>
        ) : (
          <>
            <p>
              按“图片—标签”计数：共同 {common} / 并集 {rows.length} · 重合率{' '}
              {rows.length ? ((common / rows.length) * 100).toFixed(1) : '0.0'}% · 当前预览保留 {kept}，过滤{' '}
              {rows.length - kept}。滑块只预览，点击应用后写入。
            </p>
            {selected.some((sample) => sample.evidence.mode !== 'mixed') ? (
              <p>当前范围含单模型结果，缺少的另一模型分数不代表其否定该标签；重合率仅供结果覆盖参考。</p>
            ) : null}
            <div className={styles.chart}>
              <p>纵轴 PixAI 置信度 ↑ · 横轴 WD 置信度 → · 深色表示数量更多</p>
              <div className={styles.matrix} role='group' aria-label='双模型置信度分布'>
                {REVERSED_BINS.map((y) => (
                  <div className={styles.matrixRow} key={y}>
                    <span>{binLabel(y)}</span>
                    {BINS.map((x) => {
                      const index = y * 11 + x;
                      const count = matrix[index];
                      const level = count ? Math.max(1, Math.ceil((count / maxCount) * 4)) : 0;
                      return (
                        <button
                          key={x}
                          data-level={level}
                          aria-pressed={cell === index}
                          aria-label={`WD ${binLabel(x)}，PixAI ${binLabel(y)}：${count} 个标签`}
                          title={`WD ${binLabel(x)} / PixAI ${binLabel(y)}：${count}`}
                          onClick={() => {
                            setCell(cell === index ? undefined : index);
                            setPage(0);
                          }}
                        >
                          {count || '·'}
                        </button>
                      );
                    })}
                  </div>
                ))}
                <div className={styles.matrixRow}>
                  <span />
                  {BINS.map((x) => (
                    <span key={x}>{binLabel(x)}</span>
                  ))}
                </div>
              </div>
              <p>
                未返回＝未运行该模型或分数不高于采集下限 0.01；不等于 0
                分。点击格子查看对应标签，不改变应用范围。meta 已排除。
              </p>
            </div>
            <div className={styles.toolbar}>
              <input
                aria-label='搜索结果标签'
                placeholder='搜索标签'
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
              <button
                onClick={() => {
                  setCell(undefined);
                  setSearch('');
                  setPage(0);
                }}
              >
                显示全部格子
              </button>
              <span>
                {visible.length} 项 · {currentPage + 1} / {pageCount} 页
              </span>
              <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                上一页
              </button>
              <button disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>
                下一页
              </button>
            </div>
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th>标签</th>
                    <th>样本</th>
                    <th>WD</th>
                    <th>PixAI</th>
                    <th>过滤预览</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(currentPage * 100, (currentPage + 1) * 100).map((row) => (
                    <tr key={row.key}>
                      <td>{row.name}</td>
                      <td title={row.sample}>{row.sample}</td>
                      <td>{row.wd?.toFixed(3) ?? '—'}</td>
                      <td>{row.pixai?.toFixed(3) ?? '—'}</td>
                      <td>{row.removed ? '裁框冲突排除' : keepTag(row, filters) ? '保留' : '过滤'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
