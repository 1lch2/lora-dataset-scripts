import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../../../../api/client';
import { useReviewContext } from '../../../context';
import type { SettingsInfo, SettingsValues } from './types';
import styles from './styles.module.css';

interface SettingsFormProps {
  info: SettingsInfo;
  token: string;
  busy: boolean;
  onClose: () => void;
}

function SettingsForm({ info, token, busy, onClose }: SettingsFormProps) {
  const [values, setValues] = useState(info.values);
  const [dropTags, setDropTags] = useState(info.values.drop_tags.join(', '));
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      request<SettingsInfo>(
        '/api/settings',
        {
          ...values,
          drop_tags: dropTags
            .split(/[,，\n]/)
            .map((tag) => tag.trim())
            .filter(Boolean),
        },
        token,
      ),
    onSuccess: (result) => {
      queryClient.setQueryData(['settings'], result);
      void queryClient.invalidateQueries({ queryKey: ['run'] });
      onClose();
    },
  });
  function handleValue<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <h2 id='settingsTitle'>设置</h2>
      <p>填写 SD WebUI Forge Neo 目录即可开始。模型操作时按需启动 Forge。</p>
      <fieldset disabled={busy || mutation.isPending}>
        <label>
          Forge Neo 目录
          <input
            required
            value={values.forge_dir}
            onChange={(event) => handleValue('forge_dir', event.target.value)}
            placeholder='例如 E:\Forge Neo'
          />
        </label>
        <p>
          固定使用{' '}
          <a href={info.taggerRepository} target='_blank' rel='noreferrer'>
            1lch2 / WD14 Tagger
          </a>
          ，保存时检查已安装的插件来源。
        </p>
        <p>打标模型和置信度范围在“打标”页选择。标签整理 CSV 已内置，无需填写路径。</p>
        <details>
          <summary>处理参数</summary>
          <p>保存后用于当前及之后打开的数据集；不会自动重新处理图片。</p>
          {(
            [
              ['forge_url', 'Forge API 地址'],
              ['upscaler_1', '主放大模型'],
              ['upscaler_2', '辅助放大模型'],
              ['copyright', '作品标签'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                required={key !== 'copyright'}
                value={values[key]}
                onChange={(event) => handleValue(key, event.target.value)}
              />
            </label>
          ))}
          {(
            [
              ['blend', '辅助模型混合比例', 0, 1, 0.01],
              ['target_area', '裁切目标像素数', 1, undefined, 1],
              ['min_area', '裁切最小像素数', 1, undefined, 1],
              ['duplicate_iou', '重复裁框 IoU 阈值', 0.01, 1, 0.01],
            ] as const
          ).map(([key, label, min, max, step]) => (
            <label key={key}>
              {label}
              <input
                type='number'
                required
                min={min}
                max={max}
                step={step}
                value={values[key]}
                onChange={(event) => handleValue(key, event.target.valueAsNumber)}
              />
            </label>
          ))}
          <label>
            默认移除标签（逗号分隔）
            <textarea value={dropTags} onChange={(event) => setDropTags(event.target.value)} />
          </label>
        </details>
      </fieldset>
      {mutation.error ? <p role='alert'>{mutation.error.message}</p> : null}
      {busy ? <p role='status'>任务运行中，完成后可保存设置。</p> : null}
      <footer>
        <button type='button' onClick={onClose} disabled={mutation.isPending}>
          取消
        </button>
        <button className='primary' disabled={busy || mutation.isPending}>
          {mutation.isPending ? '保存中…' : '保存设置'}
        </button>
      </footer>
    </form>
  );
}

export function Settings() {
  const v = useReviewContext();
  const [opened, setOpened] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => request<SettingsInfo>('/api/settings'),
  });
  const visible = opened || (!!settings.data && !settings.data.configured && !dismissed);
  useEffect(() => {
    if (visible) dialog.current?.showModal();
    else dialog.current?.close();
  }, [visible]);
  function handleClose() {
    setOpened(false);
    setDismissed(true);
  }
  return (
    <>
      <button type='button' onClick={() => setOpened(true)}>
        设置
      </button>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby='settingsTitle' onCancel={handleClose}>
        {visible && settings.data ? (
          <SettingsForm info={settings.data} token={v.session.token} busy={v.busy} onClose={handleClose} />
        ) : null}
        {!settings.data ? (
          <>
            <h2 id='settingsTitle'>设置</h2>
            <p role='status'>{settings.error?.message || '读取设置…'}</p>
            {settings.error ? <button onClick={() => void settings.refetch()}>重试</button> : null}
            <button onClick={handleClose}>关闭</button>
          </>
        ) : null}
      </dialog>
    </>
  );
}
