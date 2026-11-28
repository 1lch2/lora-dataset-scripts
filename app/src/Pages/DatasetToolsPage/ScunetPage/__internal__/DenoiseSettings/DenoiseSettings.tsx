import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAllScunetModelList } from '../../api';
import imageStyles from '../../../imageTool.module.css';
import type { DenoiseSettingsProps } from './types';
import styles from './styles.module.css';

interface ModelSelectProps {
  id: string;
  label: string;
  value: string;
  models: string[];
  onChange: (value: string) => void;
}

function ModelSelect({ id, label, value, models, onChange }: ModelSelectProps) {
  return (
    <label htmlFor={id}>
      {label}
      <select id={id} name={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {!models.includes(value) ? <option value={value}>{value}</option> : null}
        {models.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DenoiseSettings({ active, values, onChange }: DenoiseSettingsProps) {
  const downloadDialog = useRef<HTMLDialogElement>(null);
  const modelList = useQuery({
    queryKey: ['scunet-models'],
    queryFn: getAllScunetModelList,
    enabled: active,
    retry: false,
  });
  const models = modelList.data?.models ?? [];
  const selected = values.fusion ? [values.lumaModel, values.chromaModel] : [values.model];
  const missing = modelList.data ? selected.filter((name) => !models.includes(name)) : [];

  return (
    <section
      className={imageStyles.page}
      id='scunetSettingsPanel'
      role='tabpanel'
      aria-labelledby='scunetSettingsTab'
      hidden={!active}
    >
      <div className={`${imageStyles.panel} ${styles.settings}`}>
        <div className={styles.heading}>
          <h3>Forge 降噪模型</h3>
          <button type='button' disabled={modelList.isFetching} onClick={() => void modelList.refetch()}>
            刷新模型列表
          </button>
        </div>
        <fieldset className={imageStyles.fields}>
          <legend className='sr-only'>降噪模型设置</legend>
          <div className={styles.fusionRow}>
            <label className={imageStyles.check}>
              <input
                type='checkbox'
                name='fusion'
                checked={values.fusion}
                aria-describedby='scunetFusionHint'
                onChange={(event) => onChange({ ...values, fusion: event.target.checked })}
              />
              双模型降噪融合
            </label>
            <div className={styles.help}>
              <button
                type='button'
                className={styles.helpButton}
                aria-label='模型下载帮助'
                aria-describedby='scunetDownloadTooltip'
                aria-haspopup='dialog'
                onClick={() => downloadDialog.current?.showModal()}
              >
                ?
              </button>
              <span id='scunetDownloadTooltip' role='tooltip' className={styles.tooltip}>
                查看下载位置
              </span>
            </div>
          </div>
          {values.fusion ? (
            <>
              <ModelSelect
                id='scunetLumaModel'
                label='亮度细节模型'
                value={values.lumaModel}
                models={models}
                onChange={(lumaModel) => onChange({ ...values, lumaModel })}
              />
              <ModelSelect
                id='scunetChromaModel'
                label='色度模型'
                value={values.chromaModel}
                models={models}
                onChange={(chromaModel) => onChange({ ...values, chromaModel })}
              />
            </>
          ) : (
            <ModelSelect
              id='scunetModel'
              label='降噪模型'
              value={values.model}
              models={models}
              onChange={(model) => onChange({ ...values, model })}
            />
          )}
          <small id='scunetFusionHint'>
            双模型分别处理同一张原图。亮度取自细节模型，色度取自色度模型，再以原图的低频色调校准。
          </small>
        </fieldset>
        {modelList.isFetching ? <p role='status'>正在读取 Forge 模型…</p> : null}
        {modelList.error ? (
          <p className='error' role='alert'>
            {modelList.error.message}
          </p>
        ) : null}
        {values.fusion && values.lumaModel === values.chromaModel ? (
          <p className='error' role='alert'>
            请为亮度和色度选择两个不同的模型。
          </p>
        ) : null}
        {missing.length ? (
          <p className='error' role='alert'>
            Forge 中未找到 {missing.join('、')}，请选择已安装的模型。
          </p>
        ) : null}
        <small>模型设置对下一次单图或批量任务生效，Forge 请求倍率为 1×。</small>
      </div>
      <dialog ref={downloadDialog} className={styles.downloadDialog} aria-labelledby='scunetDownloadTitle'>
        <div className={styles.heading}>
          <h1 id='scunetDownloadTitle'>模型下载与安装</h1>
          <form method='dialog'>
            <button type='submit' autoFocus>
              关闭
            </button>
          </form>
        </div>
        <dl className={styles.downloadLinks}>
          <div>
            <dt>亮度细节 · Manhwa Null</dt>
            <dd>
              <a href='https://openmodeldb.info/models/1x-Manhwa-Null' target='_blank' rel='noreferrer'>
                OpenModelDB 模型下载页
              </a>
            </dd>
          </div>
          <div>
            <dt>色度 · ScuNET</dt>
            <dd>
              <a
                href='https://github.com/cszn/KAIR/releases/download/v1.0/scunet_color_real_psnr.pth'
                target='_blank'
                rel='noreferrer'
              >
                下载官方彩色盲降噪权重（PSNR）
              </a>
            </dd>
          </div>
        </dl>
        <p>
          把下载的 <code>.pth</code> 放到 Forge 安装目录下的 <code>models/ESRGAN/</code>
          。如需与默认选项匹配，文件名分别使用 <code>1x_Manhwa_Null.pth</code> 和 <code>ScuNET.pth</code>。
        </p>
        <p>重启 Forge，再回到降噪设置点击「刷新模型列表」。</p>
      </dialog>
    </section>
  );
}
