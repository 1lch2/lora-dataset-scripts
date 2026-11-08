import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { executeDenoise, getDenoiseImageUrl, getDenoiseInfo, loadDenoiseModels } from './api';
import { ImageCompare } from './__internal__/ImageCompare';
import type { DenoiseOptions, DenoisePageProps, SelectedImage } from './types';
import styles from './styles.module.css';

const PRESETS = [
  { name: '轻柔', scale: 0.8, strength: 0.0006 },
  { name: '标准', scale: 0.6, strength: 0.001 },
  { name: '强力', scale: 0.45, strength: 0.0018 },
];
const STAGES: Record<string, string> = {
  connect: '正在连接 Forge / 读取模型',
  decode: '正在读取图片',
  prescale: 'BOX 预缩放',
  upscale: 'Forge 超分重建',
  restore: '恢复原始分辨率',
  l0: 'L0 梯度平滑（CPU）',
  encode: '正在生成 PNG',
  complete: '处理完成',
};

export function DenoisePage({ active, token, processing }: DenoisePageProps) {
  const client = useQueryClient();
  const [image, setImage] = useState<SelectedImage>();
  const [inputError, setInputError] = useState('');
  const [reading, setReading] = useState(false);
  const [taskId, setTaskId] = useState<string>();
  const [options, setOptions] = useState<DenoiseOptions>({
    scale: 0.6,
    strength: 0.001,
    l0: true,
    model: '',
  });
  const picker = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const status = useQuery({
    queryKey: ['denoise'],
    queryFn: getDenoiseInfo,
    enabled: active,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 500 : 2000),
    retry: false,
  });
  const info = status.data;
  const model = options.model || info?.defaultModel || '';
  const run = useMutation({
    mutationFn: () => executeDenoise(image!.file, { ...options, model }, token),
    onSuccess: (result) => {
      setTaskId(result.id);
      client.setQueryData(['denoise'], result);
      void client.invalidateQueries({ queryKey: ['job'] });
    },
  });
  const models = useMutation({
    mutationFn: () => loadDenoiseModels(token),
    onSuccess: (result) => {
      client.setQueryData(['denoise'], result);
      void client.invalidateQueries({ queryKey: ['job'] });
    },
  });
  const busy = reading || processing || run.isPending || models.isPending || info?.status === 'running';
  const result = info?.result && (!image || taskId === info.result.id) ? info.result : null;
  const error = run.error || models.error || status.error;
  const sizeError =
    image && (image.width * image.height > 4_000_000 || Math.max(image.width, image.height) > 8192)
      ? '当前图片超过降噪处理上限（400 万像素，单边 8192）。可预览和替换，请缩小后再开始降噪。'
      : '';
  const valid =
    !sizeError &&
    Number.isFinite(options.scale) &&
    options.scale >= 0.4 &&
    options.scale <= 1 &&
    Number.isFinite(options.strength) &&
    options.strength >= 0.0001 &&
    options.strength <= 0.005;

  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url);
    },
    [image],
  );
  useEffect(
    () => () => {
      selection.current += 1;
    },
    [],
  );

  async function handleFile(file?: File) {
    if (!file || busy) return;
    const current = ++selection.current;
    setInputError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setInputError('请选择 PNG、JPEG 或 WebP 图片');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setInputError('图片文件不能超过 20 MiB');
      return;
    }
    setReading(true);
    const url = URL.createObjectURL(file);
    const preview = new Image();
    preview.src = url;
    try {
      await preview.decode();
      if (current !== selection.current) {
        URL.revokeObjectURL(url);
        return;
      }
      setImage({ file, url, width: preview.naturalWidth, height: preview.naturalHeight });
      setTaskId(undefined);
      run.reset();
    } catch {
      URL.revokeObjectURL(url);
      setInputError('无法读取图片，请确认文件未损坏且格式为 PNG、JPEG 或 WebP');
    } finally {
      if (current === selection.current) setReading(false);
    }
  }

  return (
    <section
      id='denoiseView'
      role='tabpanel'
      aria-labelledby='denoiseTab'
      hidden={!active}
      className={styles.page}
    >
      <p className={styles.description}>
        针对 gpt-image-2 系列生成图像的水印噪点进行降噪。实验性功能，不保证效果符合预期。
      </p>
      <div className={styles.layout}>
        <form
          className={styles.panel}
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !image || !valid || !model) return;
            run.mutate();
          }}
        >
          <fieldset disabled={busy} className={styles.fields}>
            <div
              className={styles.dropzone}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void handleFile(event.dataTransfer.files[0]);
              }}
            >
              <input
                ref={picker}
                type='file'
                accept='image/png,image/jpeg,image/webp'
                aria-label='选择降噪图片'
                className={styles.fileInput}
                onChange={(event) => {
                  void handleFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <button type='button' onClick={() => picker.current?.click()}>
                {image ? '替换图片' : '选择图片'}
              </button>
              <p>或将图片拖到这里</p>
              <small>PNG / JPEG / WebP · 文件最多 20 MiB</small>
            </div>
            {image ? (
              <p className={styles.filename}>
                {image.file.name} · {image.width} × {image.height}
              </p>
            ) : null}
            {reading ? <p role='status'>正在读取图片…</p> : null}
            {inputError ? (
              <p role='alert' className='error'>
                {inputError}
              </p>
            ) : null}
            {sizeError ? (
              <p id='denoiseSizeError' role='alert' className='error'>
                {sizeError}
              </p>
            ) : null}
            <div className={styles.presets} role='group' aria-label='降噪预设'>
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type='button'
                  aria-pressed={
                    options.l0 && options.scale === preset.scale && options.strength === preset.strength
                  }
                  onClick={() =>
                    setOptions((previous) => ({
                      ...previous,
                      scale: preset.scale,
                      strength: preset.strength,
                      l0: true,
                    }))
                  }
                >
                  {preset.name}
                </button>
              ))}
            </div>
            <label>
              预缩放比例（%）
              <input
                type='number'
                min='40'
                max='100'
                step='1'
                required
                value={Number.isFinite(options.scale) ? Math.round(options.scale * 100) : ''}
                onChange={(event) => setOptions({ ...options, scale: event.target.valueAsNumber / 100 })}
              />
            </label>
            <label>
              超分模型
              <select
                value={model}
                onChange={(event) => setOptions({ ...options, model: event.target.value })}
                required
              >
                {!info?.models.some((item) => item.name === model) ? (
                  <option value={model}>{model || '请读取 Forge 模型'}</option>
                ) : null}
                {info?.models.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                    {item.scale ? ` · ${item.scale}×` : ''}
                  </option>
                ))}
              </select>
            </label>
            <button type='button' onClick={() => models.mutate()}>
              读取 / 刷新 Forge 模型
            </button>
            <small>沿用设置中的 Forge 地址，按需启动。使用所选模型的原生倍率。</small>
            <label className={styles.check}>
              <input
                type='checkbox'
                checked={options.l0}
                onChange={(event) => setOptions({ ...options, l0: event.target.checked })}
              />
              L0 梯度平滑
            </label>
            <label>
              L0 强度（λ）
              <input
                type='number'
                min='0.0001'
                max='0.005'
                step='0.0001'
                required
                disabled={!options.l0}
                value={Number.isFinite(options.strength) ? options.strength : ''}
                onChange={(event) => setOptions({ ...options, strength: event.target.valueAsNumber })}
              />
            </label>
            <p>L0 会影响腮红、柔和渐变和小字，可降低强度或关闭。</p>
            <button
              type='submit'
              className='primary'
              disabled={!image || !valid || !model}
              aria-describedby={sizeError ? 'denoiseSizeError' : undefined}
            >
              开始降噪
            </button>
          </fieldset>
          <div role='status' aria-live='polite'>
            {run.isPending ? '正在提交图片…' : null}
            {info?.status === 'running' ? (
              <>
                <progress aria-label='降噪处理进度' /> <p>{STAGES[info.stage] || info.stage}…</p>
                <small>任务在后端执行，切换页面后仍会继续。</small>
              </>
            ) : null}
            {info?.status === 'complete' ? (
              <p>{result ? '降噪完成，可对比并下载 PNG。' : '模型列表已更新。'}</p>
            ) : null}
          </div>
          {error ? (
            <p role='alert' className='error'>
              {error.message}。请求中断时，后端任务可能仍在执行；状态会自动重连。
            </p>
          ) : null}
          {info?.status === 'failed' ? (
            <p role='alert' className='error'>
              {info.errors.join('\n')}
            </p>
          ) : null}
        </form>
        <section className={`${styles.panel} ${styles.preview}`} aria-label='图片预览与对比'>
          {result ? (
            <>
              <div className={styles.resultHeading}>
                <h3>原图与降噪结果</h3>
                <a
                  className={styles.download}
                  href={getDenoiseImageUrl(result.id, 'output')}
                  download={result.name}
                >
                  下载 PNG
                </a>
              </div>
              <ImageCompare
                key={result.id}
                original={getDenoiseImageUrl(result.id, 'original')}
                output={getDenoiseImageUrl(result.id, 'output')}
                width={result.width}
                height={result.height}
              />
            </>
          ) : image ? (
            <>
              <h3>
                原图 · {image.width} × {image.height}
              </h3>
              <div className={styles.original}>
                <img src={image.url} alt='待降噪的原始图片' />
              </div>
            </>
          ) : (
            <div className={styles.empty}>选择图片后预览，降噪完成后拖动分割线对比。</div>
          )}
        </section>
      </div>
    </section>
  );
}
