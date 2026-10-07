import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getAllDatasetList, importDataset, openDataset } from '../../../../../api/client';
import type { DatasetImportRequest } from '../../../../../api/types';
import { useReviewContext } from '../../../context';
import styles from './styles.module.css';

export function DatasetManager() {
  const v = useReviewContext();
  const [directory, setDirectory] = useState('');
  const [identity, setIdentity] = useState('');
  const list = useQuery({ queryKey: ['datasets'], queryFn: getAllDatasetList });
  const mutation = useMutation({
    mutationFn: (data: DatasetImportRequest | string) =>
      typeof data === 'string' ? openDataset(data, v.session.token) : importDataset(data, v.session.token),
    onMutate: () => v.setDatasetSwitching(true),
    onSuccess: async () => {
      await v.handleDatasetChange();
      await list.refetch();
      v.message('已选择数据集，正在导入文件。');
    },
    onError: (error: Error) => v.message(error.message, true),
    onSettled: () => v.setDatasetSwitching(false),
  });
  const disabled = v.processing || mutation.isPending;
  if (v.session.analysisOnly) return null;
  return (
    <section className={styles.manager} aria-label='数据集加载与处理'>
      <details open={!v.state?.datasetLoaded || undefined}>
        <summary>数据集目录 · 接入 / 切换</summary>
        <div className={styles.content}>
          <label>
            已接入数据集
            <select
              id='datasetRun'
              value={list.data?.currentRunDir || ''}
              disabled={disabled || !list.data}
              onChange={(event) => mutation.mutate(event.target.value)}
            >
              <option value='' disabled>
                请选择已有数据集
              </option>
              {list.data?.datasets.map((dataset) => (
                <option key={dataset.runDir} value={dataset.runDir}>
                  {dataset.name} · {dataset.cropMode === 'prepared' ? '含 TXT / 成品' : '图片 / 手动处理'} ·{' '}
                  {dataset.inputDir}
                </option>
              ))}
            </select>
          </label>
          <p className='hint'>
            当前输入目录：{v.state?.datasetLoaded ? v.state.config.input_dir : '尚未加载数据集'}
          </p>
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              if (disabled) return;
              mutation.mutate({
                directory,
                identity,
              });
            }}
          >
            <label className={styles.wide}>
              数据集目录
              <input
                id='datasetDirectory'
                required
                value={directory}
                placeholder={list.data?.defaultInputDir}
                onChange={(event) => setDirectory(event.target.value)}
                disabled={disabled}
              />
            </label>
            <label>
              角色名称（可选）
              <input
                id='datasetIdentity'
                value={identity}
                onChange={(event) => setIdentity(event.target.value)}
                disabled={disabled}
              />
            </label>
            <p className={`hint ${styles.wide}`}>
              选择整个目录或需要加载的子目录。导入仅复制文件：含 TXT
              时视为已完成超分、裁切和打标，接入同名标签；只有图片时由你手动选择处理步骤。角色名称留空时，根目录有图片则使用目录名，否则按一级子目录识别角色。
            </p>
            <button type='submit' className='primary' disabled={disabled}>
              {mutation.isPending ? '正在加载…' : '仅导入数据集'}
            </button>
          </form>
          {list.error ? <p role='alert'>{list.error.message}</p> : null}
          <button type='button' disabled={disabled || list.isFetching} onClick={() => void list.refetch()}>
            刷新数据集列表
          </button>
        </div>
      </details>
      {v.state?.datasetLoaded && v.state.config.crop_mode !== 'prepared' ? (
        <div className={styles.processing}>
          <span className='hint'>处理范围：{v.fields.group || '全部角色'}</span>
          <button
            id='upscaleDataset'
            type='button'
            disabled={disabled || !v.sources.length}
            onClick={() => v.handleAction('upscaleDataset')}
          >
            按尺寸超分
          </button>
          <button
            id='detectDataset'
            type='button'
            disabled={disabled || !v.sources.length}
            onClick={() => v.handleAction('detectDataset')}
          >
            识别并生成裁切候选
          </button>
          <span className='hint'>超分仅将总像素不足 1024² × 80% 的图片放大 1.5 倍。各步骤独立执行。</span>
        </div>
      ) : null}
    </section>
  );
}
