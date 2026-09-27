import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getLoraFilesInfo, renameLoraFiles } from '../../../api/client';
import type { LoraFilesInfo } from '../../../api/types';
import type { LoraToolsProps } from './types';
import styles from './styles.module.css';

export function LoraTools({ token, defaultDirectory, active }: LoraToolsProps) {
  const [directory, setDirectory] = useState(defaultDirectory);
  const [selectedDirectory, setSelectedDirectory] = useState(defaultDirectory);
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const filesQuery = useQuery({
    queryKey: ['lora-files', selectedDirectory],
    queryFn: () => getLoraFilesInfo(selectedDirectory),
    enabled: active && !!selectedDirectory.trim(),
  });
  const renameMutation = useMutation({
    mutationFn: (info: LoraFilesInfo) => renameLoraFiles(info.directory, info.changes, token),
  });
  const info = filesQuery.data;
  const directoryChanged = directory.trim() !== selectedDirectory;

  function handleLoad(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!directory.trim()) {
      setNotice('请输入 LoRA 目录');
      setNoticeError(true);
      return;
    }
    setNotice('');
    if (directoryChanged) {
      setSelectedDirectory(directory.trim());
      return;
    }
    void filesQuery.refetch();
  }

  async function handleRename() {
    if (!info?.changes.length || directoryChanged || filesQuery.isFetching) return;
    try {
      const result = await renameMutation.mutateAsync(info);
      await filesQuery.refetch();
      setNotice(`已重命名 ${result.renamed} 个 LoRA 文件`);
      setNoticeError(false);
    } catch (error) {
      setNotice((error as Error).message);
      setNoticeError(true);
    }
  }

  async function handleCopy() {
    if (!info?.prompts) return;
    try {
      await navigator.clipboard.writeText(info.prompts);
      setNotice('提示词已复制到剪贴板');
      setNoticeError(false);
    } catch {
      setNotice('复制失败，请在文本框中手动复制');
      setNoticeError(true);
    }
  }

  return (
    <main id='loraView' role='tabpanel' aria-labelledby='loraTab' hidden={!active} className={styles.view}>
      <div className={styles.content}>
        <section className={styles.section}>
          <h2>LoRA 文件工具</h2>
          <p className={styles.hint}>默认读取项目 output 目录中的 .safetensors 文件；可输入其他本地目录。</p>
          <form className={styles.directoryForm} onSubmit={handleLoad}>
            <label htmlFor='loraDirectory'>LoRA 目录</label>
            <input
              id='loraDirectory'
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
              autoComplete='off'
              required
            />
            <button type='submit' disabled={filesQuery.isFetching || renameMutation.isPending}>
              刷新文件
            </button>
          </form>
          {filesQuery.isFetching ? <p role='status'>正在读取文件…</p> : null}
          {filesQuery.error ? <p role='alert' className={styles.error}>{filesQuery.error.message}</p> : null}
          {notice ? <p role='status' className={noticeError ? styles.error : ''}>{notice}</p> : null}
          {info && !filesQuery.isError ? (
            <p className={styles.hint}>已读取 {info.files.length} 个 LoRA 文件：{info.directory}</p>
          ) : null}
        </section>

        {info && !filesQuery.isError ? (
          <>
            <section className={styles.section}>
              <h2>按序号重命名</h2>
              <p className={styles.hint}>
                按文件名前缀分别排序，从 0 连续编号；无序号的同名前缀文件排在最后。仅处理 .safetensors 文件。
              </p>
              {info.changes.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th scope='col'>当前文件名</th><th scope='col'>新文件名</th></tr></thead>
                    <tbody>
                      {info.changes.map((change) => (
                        <tr key={change.from}><td>{change.from}</td><td>{change.to}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p>当前文件无需重命名。</p>}
              <button
                type='button'
                className='primary'
                disabled={!info.changes.length || directoryChanged || filesQuery.isFetching || renameMutation.isPending}
                onClick={() => void handleRename()}
              >
                {renameMutation.isPending ? '正在重命名…' : `重命名 ${info.changes.length} 个文件`}
              </button>
              {directoryChanged ? <p className={styles.hint}>目录已修改，请先刷新文件。</p> : null}
            </section>
            <section className={styles.section}>
              <div className={styles.heading}>
                <h2>效果对比提示词</h2>
                <button type='button' disabled={!info.prompts || directoryChanged} onClick={() => void handleCopy()}>
                  复制提示词
                </button>
              </div>
              <p className={styles.hint}>按数字序号排列，权重为 1；每行一个 &lt;lora:名称:1&gt;。</p>
              <textarea aria-label='LoRA 效果对比提示词' value={info.prompts} readOnly rows={Math.min(Math.max(info.files.length, 4), 16)} />
              {!info.prompts ? <p>没有符合“名称-序号.safetensors”格式的文件。</p> : null}
              <details>
                <summary>查看 LoRA 文件列表</summary>
                <ul>{info.files.map((name) => <li key={name}>{name}</li>)}</ul>
              </details>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
