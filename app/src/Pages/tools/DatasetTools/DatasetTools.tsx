import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAllDatasetList } from '../../../api/client';
import {
  cancelDatasetProcessing,
  executeDatasetProcessing,
  getDatasetProcessingInfo,
  previewDatasetProcessing,
  scanDatasetFiles,
} from './api';
import type { DatasetToolsProps, ToolsRequest } from './types';
import styles from './styles.module.css';

const STATUS_LABELS = {
  idle: '尚未开始',
  preparing: '正在生成预览',
  ready: '预览就绪',
  running: '正在另存结果',
  complete: '处理完成',
  failed: '处理失败',
  cancelled: '已取消',
};

export function DatasetTools({ active, token, currentDirectory }: DatasetToolsProps) {
  const client = useQueryClient();
  const [directory, setDirectory] = useState('');
  const [output, setOutput] = useState('');
  const [recursive, setRecursive] = useState(true);
  const [folder, setFolder] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [operation, setOperation] = useState<ToolsRequest['operation']>('resize');
  const [length, setLength] = useState(1280);
  const [threshold, setThreshold] = useState(10);
  const [duplicateMode, setDuplicateMode] = useState<ToolsRequest['duplicateMode']>('separate');
  const [scanSignature, setScanSignature] = useState('');
  const [previewSignature, setPreviewSignature] = useState('');
  const [previewId, setPreviewId] = useState<string>();
  const datasets = useQuery({ queryKey: ['datasets'], queryFn: getAllDatasetList, enabled: active });
  const status = useQuery({
    queryKey: ['dataset-tools'],
    queryFn: getDatasetProcessingInfo,
    enabled: active,
    refetchInterval: 1000,
  });
  const info = status.data;
  const scan = useMutation({
    mutationFn: () => scanDatasetFiles(directory.trim(), recursive, token),
    onSuccess: (result) => {
      setSelected(new Set(result.files.map((file) => file.path)));
      setScanSignature(JSON.stringify([directory.trim(), recursive]));
      setPreviewSignature('');
      setFolder('');
      setSearch('');
    },
  });
  const data: ToolsRequest = {
    directory: scan.data?.directory || directory.trim(),
    output: output.trim(),
    paths: [...selected].sort(),
    operation,
    length,
    threshold,
    duplicateMode,
  };
  const signature = JSON.stringify(data);
  const preview = useMutation({
    mutationFn: () => previewDatasetProcessing(data, token),
    onSuccess: (result) => {
      client.setQueryData(['dataset-tools'], result);
      setPreviewSignature(signature);
      setPreviewId(result.id);
    },
  });
  const execute = useMutation({
    mutationFn: () => executeDatasetProcessing(info!.id!, token),
    onSuccess: (result) => client.setQueryData(['dataset-tools'], result),
  });
  const cancel = useMutation({
    mutationFn: () => cancelDatasetProcessing(token),
    onSuccess: (result) => client.setQueryData(['dataset-tools'], result),
  });
  const running = info?.status === 'running' || info?.status === 'preparing';
  const busy = running || scan.isPending || preview.isPending || execute.isPending;
  const scanCurrent = scanSignature === JSON.stringify([directory.trim(), recursive]);
  const previewCurrent = scanCurrent && previewSignature === signature && previewId === info?.id;
  const files = scan.data?.files || [];
  const folders = [
    ...new Set(
      files.flatMap((file) => {
        const parts = file.path.split('/');
        return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
      }),
    ),
  ].sort();
  const visible = files.filter(
    (file) =>
      (!folder || file.path.startsWith(`${folder}/`)) &&
      file.path.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const error =
    scan.error || preview.error || execute.error || cancel.error || status.error || datasets.error;

  function handleSelectVisible(value: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const file of visible) {
        if (value) next.add(file.path);
        else next.delete(file.path);
      }
      return next;
    });
  }

  return (
    <section
      id='toolsView'
      role='tabpanel'
      aria-labelledby='toolsTab'
      hidden={!active}
      className={styles.page}
    >
      <header className={styles.heading}>
        <div>
          <h2>数据集处理工具</h2>
          <p>选择素材与范围，预览后另存。原图保留，同名 TXT 随图片复制。</p>
        </div>
        <span className={styles.count}>
          {selected.size}
          <small> 张已选择</small>
        </span>
      </header>
      <div className={styles.layout}>
        <section className={styles.panel} aria-label='输入与处理范围'>
          <h3>01 / 选择处理范围</h3>
          <fieldset disabled={busy} className={styles.fields}>
            <label>
              已有数据集
              <select
                value=''
                onChange={(event) => {
                  if (event.target.value) setDirectory(event.target.value);
                }}
              >
                <option value=''>选择已导入的数据集来源目录</option>
                {datasets.data?.datasets.map((dataset) => (
                  <option key={dataset.runDir} value={dataset.inputDir}>
                    {dataset.name} · {dataset.inputDir}
                  </option>
                ))}
              </select>
            </label>
            {currentDirectory ? (
              <button type='button' onClick={() => setDirectory(currentDirectory)}>
                使用当前审核数据集
              </button>
            ) : null}
            <label>
              输入目录
              <input
                value={directory}
                onChange={(event) => setDirectory(event.target.value)}
                placeholder='也可粘贴原始素材或导出数据集目录'
              />
            </label>
            <label className={styles.check}>
              <input
                type='checkbox'
                checked={recursive}
                onChange={(event) => setRecursive(event.target.checked)}
              />
              包含子目录
            </label>
            <button type='button' disabled={!directory.trim()} onClick={() => scan.mutate()}>
              {scan.isPending ? '正在扫描…' : '扫描图片'}
            </button>
          </fieldset>
          {scan.data ? (
            <>
              {!scanCurrent ? <p role='status'>目录选项已变化，请重新扫描。</p> : null}
              <fieldset disabled={busy || !scanCurrent} className={styles.fields}>
                <label>
                  子目录范围
                  <select value={folder} onChange={(event) => setFolder(event.target.value)}>
                    <option value=''>全部子目录</option>
                    {folders.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  筛选文件
                  <input
                    type='search'
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder='按相对路径筛选'
                  />
                </label>
                <div className={styles.actions}>
                  <button
                    type='button'
                    onClick={() => setSelected(new Set(visible.map((file) => file.path)))}
                  >
                    仅选择筛选结果
                  </button>
                  <button type='button' onClick={() => handleSelectVisible(true)}>
                    追加筛选结果
                  </button>
                  <button type='button' onClick={() => setSelected(new Set())}>
                    清空选择
                  </button>
                </div>
                <p>
                  共 {files.length} 张，显示 {visible.length} 张，已选 {selected.size}{' '}
                  张。筛选不会自动改变选择。
                </p>
              </fieldset>
              <div className={styles.fileList}>
                {visible.map((file) => (
                  <label key={file.path} className={styles.file}>
                    <input
                      type='checkbox'
                      disabled={busy || !scanCurrent}
                      checked={selected.has(file.path)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSelected((previous) => {
                          const next = new Set(previous);
                          if (checked) next.add(file.path);
                          else next.delete(file.path);
                          return next;
                        });
                      }}
                    />
                    <span>{file.path}</span>
                    <small>{Math.ceil(file.bytes / 1024)} KB</small>
                  </label>
                ))}
                {!visible.length ? <p>此范围没有图片。</p> : null}
              </div>
            </>
          ) : (
            <p className={styles.empty}>扫描后可按子目录、文件名筛选或逐张勾选。</p>
          )}
        </section>
        <section className={styles.panel} aria-label='处理选项与结果'>
          <h3>02 / 处理与另存</h3>
          <fieldset disabled={busy} className={styles.fields}>
            <label>
              工具
              <select
                value={operation}
                onChange={(event) => setOperation(event.target.value as ToolsRequest['operation'])}
              >
                <option value='resize'>按最短边长缩放</option>
                <option value='reverse'>水平镜像翻转</option>
                <option value='deduplicate'>图片去重</option>
              </select>
            </label>
            {operation === 'resize' ? (
              <>
                <label>
                  目标短边（像素）
                  <input
                    type='number'
                    min={1}
                    max={16384}
                    value={length}
                    onChange={(event) => setLength(Number(event.target.value))}
                  />
                </label>
                <p>保持比例，仅缩小短边达到目标值的图片；较小图片原样复制。</p>
              </>
            ) : null}
            {operation === 'reverse' ? (
              <p>水平镜像另存。TXT 内容保持原样，涉及左右方向的标签请自行复核。</p>
            ) : null}
            {operation === 'deduplicate' ? (
              <>
                <label>
                  平均哈希距离阈值
                  <input
                    type='number'
                    min={0}
                    max={64}
                    value={threshold}
                    onChange={(event) => setThreshold(Number(event.target.value))}
                  />
                </label>
                <label>
                  重复项处理
                  <select
                    value={duplicateMode}
                    onChange={(event) =>
                      setDuplicateMode(event.target.value as ToolsRequest['duplicateMode'])
                    }
                  >
                    <option value='separate'>分离保存：kept / duplicates</option>
                    <option value='omit'>只导出去重结果</option>
                  </select>
                </label>
                <p>
                  沿用旧工具的 8×8
                  平均哈希与首图分组规则，每组保留文件字节数最大者。阈值越大越宽松；相似不等于完全相同，请核对重复组。
                </p>
              </>
            ) : null}
            <label>
              新输出目录
              <input
                value={output}
                onChange={(event) => setOutput(event.target.value)}
                placeholder='完整路径，须不存在且不与输入目录重叠'
              />
            </label>
            <button
              type='button'
              disabled={!scanCurrent || !selected.size || !output.trim()}
              onClick={() => {
                execute.reset();
                preview.mutate();
              }}
            >
              生成处理预览
            </button>
          </fieldset>
          {error ? <p role='alert'>{error.message}</p> : null}
          {info && info.status !== 'idle' ? (
            <section className={styles.results} aria-label='处理预览'>
              <div className={styles.actions}>
                <strong role='status'>
                  {STATUS_LABELS[info.status]} · {info.done} / {info.total}
                </strong>
                {running ? (
                  <button type='button' disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                    取消任务
                  </button>
                ) : null}
              </div>
              {info.errors.map((message) => (
                <p role='alert' key={message}>
                  {message}
                </p>
              ))}
              {info.output ? <p className={styles.path}>输出：{info.output}</p> : null}
              {info.status === 'ready' && !previewCurrent ? <p>参数或选择已变化，请重新生成预览。</p> : null}
              {info.status === 'ready' ? (
                <button
                  className='primary'
                  type='button'
                  disabled={!previewCurrent || busy}
                  onClick={() => execute.mutate()}
                >
                  确认另存 {info.entries.filter((entry) => entry.destination !== null).length} 张图片
                </button>
              ) : null}
              <div className={styles.previewList}>
                {info.groups.map((group) => (
                  <details key={group.keep} open>
                    <summary>保留：{group.keep}</summary>
                    <ul>
                      {group.duplicates.map((name) => (
                        <li key={name}>重复：{name}</li>
                      ))}
                    </ul>
                  </details>
                ))}
                {info.entries.length ? (
                  <table>
                    <thead>
                      <tr>
                        <th>图片</th>
                        <th>尺寸</th>
                        <th>输出</th>
                      </tr>
                    </thead>
                    <tbody>
                      {info.entries.map((entry) => (
                        <tr key={entry.path}>
                          <td>{entry.path}</td>
                          <td>
                            {entry.size.join(' × ')} → {entry.resultSize.join(' × ')}
                          </td>
                          <td>{entry.destination || '不导出重复项'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            </section>
          ) : null}
        </section>
      </div>
    </section>
  );
}
