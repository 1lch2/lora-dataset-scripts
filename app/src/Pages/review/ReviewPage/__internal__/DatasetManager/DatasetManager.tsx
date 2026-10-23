import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { deleteDataset, getAllDatasetList, importDataset, openDataset } from '../../../../../api/client';
import type { DatasetImportRequest, DatasetInfo } from '../../../../../api/types';
import { useReviewContext } from '../../../context';
import styles from './styles.module.css';

export function DatasetManager() {
  const v = useReviewContext();
  const [importing, setImporting] = useState(false);
  const [managing, setManaging] = useState(false);
  const [cropMode, setCropMode] = useState<DatasetImportRequest['cropMode']>();
  const [directory, setDirectory] = useState('');
  const [identity, setIdentity] = useState('');
  const [search, setSearch] = useState('');
  const list = useQuery({
    queryKey: ['datasets'],
    queryFn: getAllDatasetList,
    enabled: !v.session.analysisOnly && v.stage === 'home',
  });
  const mutation = useMutation({
    mutationFn: (data: DatasetImportRequest | string) =>
      typeof data === 'string' ? openDataset(data, v.session.token) : importDataset(data, v.session.token),
    onMutate: () => v.setDatasetSwitching(true),
    onSuccess: async () => {
      await v.handleDatasetChange();
      await list.refetch();
      setImporting(false);
      v.message('已选择数据集，正在同步文件。');
    },
    onError: (error: Error) => v.message(error.message, true),
    onSettled: () => v.setDatasetSwitching(false),
  });
  const deletion = useMutation({
    mutationFn: (runDir: string) => deleteDataset(runDir, v.session.token),
    onMutate: () => v.setDatasetSwitching(true),
    onSuccess: async (result) => {
      if (result.currentDeleted) await v.handleDatasetChange();
      await list.refetch();
      v.message('已移除数据集，并清理工作记录和导出产物。');
    },
    onError: async (error: Error) => {
      await list.refetch();
      v.message(error.message, true);
    },
    onSettled: () => v.setDatasetSwitching(false),
  });
  const disabled = v.processing || v.busy || mutation.isPending || deletion.isPending;
  function handleDelete(dataset: DatasetInfo) {
    if (disabled || !dataset.deletable) return;
    if (
      !window.confirm(
        `永久移除“${dataset.name}”？\n\n将清理工作记录、临时数据及导出产物：\n${dataset.runDir}\n${dataset.outputDir}\n\n导入来源的原始素材将保留。此操作无法撤销。`,
      )
    )
      return;
    deletion.mutate(dataset.runDir);
  }
  const datasets = list.data?.datasets.filter((dataset) =>
    `${dataset.name} ${dataset.inputDir}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  if (v.session.analysisOnly) return null;
  return (
    <>
      {['crop', 'tag'].includes(v.stage) ? (
        <section className={styles.manager} aria-label='当前数据集与处理'>
          <div className={styles.current}>
            <span className={styles.badge}>
              {v.state?.config.crop_mode === 'prepared' ? '完整打标' : '待处理'}
            </span>
            <span className={styles.currentPath} title={v.state?.config.input_dir}>
              {v.state?.config.input_dir}
            </span>
            <button type='button' disabled={v.busy} onClick={() => v.handleStage('home')}>
              切换数据集
            </button>
          </div>
          {v.state?.datasetLoaded && v.state.config.crop_mode !== 'prepared' ? (
            <div className={styles.processing}>
              <span className='hint'>处理范围：当前数据集全部图片（不受筛选影响）</span>
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
                识别主体并生成裁切候选
              </button>
              <span className='hint'>总像素不足 1024² × 80% 时放大 1.5 倍，各步骤独立执行。</span>
            </div>
          ) : null}
        </section>
      ) : null}
      <main
        id='homeView'
        role='tabpanel'
        aria-labelledby='homeTab'
        className={styles.home}
        hidden={v.stage !== 'home'}
      >
        <div className={styles.layout}>
          <section className={styles.welcome} aria-labelledby='welcomeTitle'>
            <span className={styles.eyebrow}>LoRA / DATASET WORKSPACE</span>
            <h2 id='welcomeTitle'>
              从一个数据集
              <br />
              开始工作。
            </h2>
            <p className={styles.description}>
              打开已有的工作记录，或导入新的素材。
              <br />
              从图片准备到标签导出，按你的节奏继续。
            </p>
            <div className={styles.startActions}>
              <button
                type='button'
                disabled={disabled}
                aria-pressed={managing}
                onClick={() => {
                  setImporting(false);
                  setManaging(!managing);
                }}
              >
                {managing ? '完成管理' : '管理数据集'}
              </button>
              <button
                type='button'
                className={`primary ${styles.importButton}`}
                disabled={disabled}
                onClick={() => {
                  setManaging(false);
                  setImporting(true);
                }}
              >
                <span aria-hidden='true'>＋</span> 导入数据集 <span aria-hidden='true'>→</span>
              </button>
              {v.state?.datasetLoaded ? (
                <button
                  type='button'
                  className={styles.resumeButton}
                  disabled={v.busy}
                  onClick={v.handleResumeDataset}
                >
                  继续当前数据集 <span aria-hidden='true'>↗</span>
                </button>
              ) : null}
            </div>
            <div className={styles.workflow}>
              <span className={styles.eyebrow}>工作流程</span>
              <p>
                准备图片 <span aria-hidden='true'>/</span> 审核裁切 <span aria-hidden='true'>/</span> 编辑标签{' '}
                <span aria-hidden='true'>/</span> 导出训练集
              </p>
            </div>
          </section>

          <section className={styles.workspace} aria-labelledby='workspaceTitle'>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>{importing ? 'IMPORT DATASET' : 'OPEN DATASET'}</span>
                <h2 id='workspaceTitle'>{importing ? '导入数据集' : '已有数据集'}</h2>
              </div>
              {importing ? (
                <button type='button' disabled={disabled} onClick={() => setImporting(false)}>
                  返回列表
                </button>
              ) : (
                <button
                  type='button'
                  disabled={disabled || list.isFetching}
                  onClick={() => void list.refetch()}
                >
                  {list.isFetching ? '刷新中…' : '刷新列表'}
                </button>
              )}
            </div>

            {importing ? (
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (disabled || !cropMode || !directory.trim()) return;
                  mutation.mutate({ directory: directory.trim(), identity: identity.trim(), cropMode });
                }}
              >
                <fieldset className={styles.typePicker} disabled={disabled}>
                  <legend>选择数据集类型</legend>
                  <label className={styles.typeOption}>
                    <input
                      type='radio'
                      name='datasetType'
                      value='prepared'
                      checked={cropMode === 'prepared'}
                      onChange={() => setCropMode('prepared')}
                      required
                    />
                    <span>
                      <strong>完整打标数据集</strong>
                      <small>图片与同名 TXT 标签已就绪，直接编辑标签、导出。</small>
                    </span>
                  </label>
                  <label className={styles.typeOption}>
                    <input
                      type='radio'
                      name='datasetType'
                      value='manual'
                      checked={cropMode === 'manual'}
                      onChange={() => setCropMode('manual')}
                      required
                    />
                    <span>
                      <strong>待处理数据集</strong>
                      <small>原始图片素材，按需超分、识别裁切和打标。</small>
                    </span>
                  </label>
                </fieldset>
                {cropMode ? (
                  <>
                    <label>
                      数据集目录
                      <input
                        id='datasetDirectory'
                        required
                        value={directory}
                        placeholder={list.data?.defaultInputDir || '粘贴本地目录的完整路径'}
                        onChange={(event) => setDirectory(event.target.value)}
                        disabled={disabled}
                        autoComplete='off'
                      />
                    </label>
                    <label>
                      角色名称（可选）
                      <input
                        id='datasetIdentity'
                        value={identity}
                        placeholder='留空时按目录识别角色'
                        onChange={(event) => setIdentity(event.target.value)}
                        disabled={disabled}
                      />
                    </label>
                    <p className={styles.formHint}>
                      {cropMode === 'prepared'
                        ? '保留图片原尺寸与文件名，读取同名 UTF-8 TXT；缺少标签的图片可在导入后补充。'
                        : '仅导入图片，不读取源 TXT 标签。超分、识别和打标由你在工作区手动启动。'}
                      支持整个目录或子目录。
                    </p>
                    <button type='submit' className='primary' disabled={disabled || !directory.trim()}>
                      {mutation.isPending ? '正在加载…' : '导入并打开'}
                    </button>
                  </>
                ) : (
                  <p className={styles.formHint}>先选择类型，再指定要导入的本地目录。</p>
                )}
              </form>
            ) : (
              <>
                {managing ? (
                  <p className={styles.formHint}>
                    删除会清理当前项目内的独立工作记录、临时数据及导出产物，并移除首页条目。导入来源的原始素材保留。
                  </p>
                ) : null}
                <label className={styles.search}>
                  搜索数据集
                  <input
                    type='search'
                    value={search}
                    placeholder='按名称或目录搜索'
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                {list.isPending ? (
                  <p className={styles.empty} role='status'>
                    正在读取数据集列表…
                  </p>
                ) : null}
                {list.error ? (
                  <p className={styles.empty} role='alert'>
                    {list.error.message}
                  </p>
                ) : null}
                {datasets?.length === 0 && !list.error ? (
                  <div className={styles.empty}>
                    <h3>{search.trim() ? '没有匹配的数据集' : '还没有已导入的数据集'}</h3>
                    <p>
                      {search.trim() ? '试试其他名称或目录。' : '从本地目录导入素材，工作记录会保存在这里。'}
                    </p>
                    {!search.trim() ? (
                      <button type='button' disabled={disabled} onClick={() => setImporting(true)}>
                        导入第一个数据集
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <ul className={styles.datasetList} aria-label='已有数据集列表'>
                  {datasets?.map((dataset) => (
                    <li key={dataset.runDir}>
                      <button
                        type='button'
                        className={styles.dataset}
                        disabled={disabled}
                        onClick={() => mutation.mutate(dataset.runDir)}
                      >
                        <span className={styles.datasetHeading}>
                          <strong>{dataset.name}</strong>
                          <span className={styles.badge}>
                            {dataset.cropMode === 'prepared' ? '完整打标' : '待处理'}
                          </span>
                          {dataset.runDir === list.data?.currentRunDir ? (
                            <span className={styles.currentLabel}>当前</span>
                          ) : null}
                        </span>
                        <span className={styles.datasetPath}>{dataset.inputDir}</span>
                        <span className={styles.openArrow} aria-hidden='true'>
                          ↗
                        </span>
                      </button>
                      {managing ? (
                        <div className={styles.manageActions}>
                          <span className={styles.datasetPath}>
                            {dataset.deletable
                              ? `导出目录：${dataset.outputDir}`
                              : '此数据集不在项目独立管理目录内，无法删除'}
                          </span>
                          <button
                            type='button'
                            className='danger'
                            disabled={disabled || !dataset.deletable}
                            onClick={() => handleDelete(dataset)}
                            aria-label={`删除数据集 ${dataset.name}`}
                          >
                            {deletion.isPending && deletion.variables === dataset.runDir
                              ? '正在删除…'
                              : '删除数据集'}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {disabled ? (
              <p className={styles.activity} role='status'>
                {deletion.isPending
                  ? '正在清理数据集…'
                  : mutation.isPending
                    ? '正在打开数据集…'
                    : v.jobStatus || '正在处理，请稍候…'}
              </p>
            ) : null}
          </section>
        </div>
        <footer className={styles.homeFooter}>本地素材 · 独立工作记录 · 手动启动处理</footer>
      </main>
    </>
  );
}
