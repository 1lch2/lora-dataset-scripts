import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageCompare } from '../../../components/ImageCompare';
import { useImageSelection } from '../useImageSelection';
import { executeScunet, getScunetImageUrl, getScunetInfo } from './api';
import type { ScunetPageProps, ScunetRequest } from './types';
import imageStyles from '../imageTool.module.css';
import styles from './styles.module.css';

const STAGES = {
  scan: '正在扫描图片目录…',
  connect: '正在连接 Forge 并检查 ScuNET…',
  process: '正在运行 ScuNET…',
};

export function ScunetPage({ active, token, processing }: ScunetPageProps) {
  const client = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  const { image, inputError, reading, selectImage } = useImageSelection();
  const [selectedMode, setSelectedMode] = useState<ScunetRequest['mode']>();
  const [inputDir, setInputDir] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const status = useQuery({
    queryKey: ['scunet'],
    queryFn: getScunetInfo,
    enabled: active,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 500 : 2000),
    retry: false,
  });
  const run = useMutation({
    mutationFn: (data: ScunetRequest) => executeScunet(data, token),
    onSuccess: (result) => {
      client.setQueryData(['scunet'], result);
      void client.invalidateQueries({ queryKey: ['job'] });
    },
  });
  const info = status.data;
  const taskMode = info?.output ? 'batch' : 'single';
  const running = info?.status === 'running';
  const mode = running ? taskMode : (selectedMode ?? taskMode);
  const busy = running || processing || reading || run.isPending;
  const error = run.error || status.error;
  const sizeError =
    image && (image.width * image.height > 36_000_000 || Math.max(image.width, image.height) > 8192)
      ? '当前图片超过处理上限（3600 万像素，单边 8192）。可预览和替换。'
      : '';
  const matchingSingle = taskMode === 'single' && (!image || run.data?.id === info?.id);
  const result = matchingSingle ? info?.result : null;

  async function handleFile(file?: File) {
    if (!file || busy) return;
    if (await selectImage(file)) run.reset();
  }

  return (
    <section
      id='scunetView'
      role='tabpanel'
      aria-labelledby='scunetTab'
      hidden={!active}
      className={imageStyles.page}
    >
      <form
        className={styles.workspace}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (mode === 'batch') {
            run.mutate({ mode, inputDir: inputDir.trim(), outputDir: outputDir.trim() });
          } else if (image && !sizeError) {
            run.mutate({ mode, file: image.file });
          }
        }}
      >
        <div className={styles.column}>
          <fieldset disabled={busy} className={styles.modes}>
            <legend className='sr-only'>降噪方式</legend>
            {(['single', 'batch'] as const).map((value) => (
              <label key={value}>
                <input
                  type='radio'
                  name='scunetMode'
                  value={value}
                  checked={mode === value}
                  onChange={() => setSelectedMode(value)}
                  className='sr-only'
                />
                <span>{value === 'single' ? '单张图片' : '文件夹批量'}</span>
              </label>
            ))}
          </fieldset>
          {mode === 'batch' ? (
            <div className={imageStyles.panel}>
              <fieldset disabled={busy} className={imageStyles.fields}>
                <legend className='mb-3 font-semibold'>处理目录</legend>
                <label>
                  输入目录
                  <input
                    name='inputDir'
                    value={inputDir}
                    onChange={(event) => setInputDir(event.target.value)}
                    aria-describedby='scunetFolderHint'
                    spellCheck={false}
                    required
                  />
                </label>
                <small id='scunetFolderHint'>
                  以 <code>{'/**'}</code> 或 <code>{'\\**'}</code>{' '}
                  结尾时包含子文件夹。普通路径只处理当前文件夹。
                </small>
                <label>
                  输出目录
                  <input
                    name='outputDir'
                    value={outputDir}
                    onChange={(event) => setOutputDir(event.target.value)}
                    aria-describedby='scunetOutputHint'
                    spellCheck={false}
                    required
                  />
                </label>
                <small id='scunetOutputHint'>另存为 PNG，保留相对目录。同名结果自动编号。</small>
              </fieldset>
            </div>
          ) : (
            <section className={`${imageStyles.panel} ${styles.mediaPanel}`} aria-labelledby='scunetSource'>
              <div className={styles.panelHeader}>
                <h3 id='scunetSource'>原图</h3>
                {image ? (
                  <button type='button' disabled={busy} onClick={() => picker.current?.click()}>
                    替换图片
                  </button>
                ) : null}
              </div>
              <input
                ref={picker}
                name='image'
                type='file'
                accept='image/png,image/jpeg,image/webp'
                aria-label='选择降噪图片'
                className={imageStyles.fileInput}
                disabled={busy}
                onChange={(event) => {
                  void handleFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <div
                className={styles.sourceCanvas}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleFile(event.dataTransfer.files[0]);
                }}
              >
                {image ? (
                  <img src={image.url} alt='待降噪的原始图片' draggable={false} />
                ) : (
                  <button
                    type='button'
                    className={styles.upload}
                    disabled={busy}
                    onClick={() => picker.current?.click()}
                  >
                    <strong>选择图片</strong>
                    <span>或将图片拖到这里</span>
                  </button>
                )}
              </div>
              <small className={styles.sourceMeta}>
                {image
                  ? `${image.file.name} · ${image.width} × ${image.height}`
                  : 'PNG / JPEG / WebP · 文件最多 20 MiB'}
              </small>
              {reading ? <p role='status'>正在读取图片…</p> : null}
              {inputError || sizeError ? (
                <p role='alert' className='error'>
                  {inputError || sizeError}
                </p>
              ) : null}
            </section>
          )}
        </div>
        <div className={styles.column}>
          <button
            className={`primary ${styles.submit}`}
            type='submit'
            disabled={busy || (mode === 'single' && (!image || !!sizeError))}
          >
            {mode === 'batch' ? '开始批量降噪' : '开始降噪'}
          </button>
          {run.isPending ? <p role='status'>正在提交任务…</p> : null}
          {error ? (
            <p className='error' role='alert'>
              {error.message}
            </p>
          ) : null}
          {mode === 'batch' ? (
            <section className={imageStyles.panel} aria-labelledby='scunetBatchResult'>
              <div className={styles.panelHeader}>
                <h3 id='scunetBatchResult'>批量降噪结果</h3>
                <small>ScuNET · 1×</small>
              </div>
              {info?.output ? (
                <>
                  <p role='status'>
                    {running && info.stage ? STAGES[info.stage] : '批量任务已结束。'} 已处理 {info.done} /{' '}
                    {info.total} 张，已保存 {info.saved} 张。
                  </p>
                  {info.total ? (
                    <progress aria-label='批量降噪进度' value={info.done} max={info.total} />
                  ) : null}
                  <p className={imageStyles.filename}>输出目录：{info.output}</p>
                  {info.errors.length ? (
                    <ul className={imageStyles.filename} aria-label='处理错误'>
                      {info.errors.map((message, index) => (
                        <li key={index} className='error'>
                          {message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : (
            <section className={`${imageStyles.panel} ${styles.mediaPanel}`} aria-labelledby='scunetResult'>
              <div className={styles.panelHeader}>
                <h3 id='scunetResult'>降噪结果</h3>
                <div className={styles.resultActions}>
                  <small>ScuNET · 1×</small>
                  {result ? (
                    <a
                      className={imageStyles.download}
                      href={getScunetImageUrl(result.id, 'output')}
                      download={result.name}
                    >
                      下载 PNG
                    </a>
                  ) : null}
                </div>
              </div>
              {running && info.stage ? <p role='status'>{STAGES[info.stage]}</p> : null}
              {matchingSingle && info?.status === 'failed' ? (
                <p role='alert' className='error'>
                  {info.errors[0]}
                </p>
              ) : null}
              {result ? (
                <>
                  <p role='status' className='sr-only'>
                    降噪完成
                  </p>
                  <ImageCompare
                    key={result.id}
                    original={getScunetImageUrl(result.id, 'original')}
                    output={getScunetImageUrl(result.id, 'output')}
                    width={result.width}
                    height={result.height}
                    outputLabel='降噪结果'
                    fitToViewport
                  />
                </>
              ) : (
                <div className={styles.resultPlaceholder}>降噪完成后可在这里对比结果。</div>
              )}
            </section>
          )}
        </div>
      </form>
    </section>
  );
}
