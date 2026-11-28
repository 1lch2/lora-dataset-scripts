import { useId } from 'react';
import type { AuditSettingsProps } from './types';
import styles from './styles.module.css';

export function AuditSettings({
  options,
  forbidden,
  disabled,
  unloadingForge,
  onOptionsChange,
  onForbiddenChange,
  onUnloadForge,
}: AuditSettingsProps) {
  const concurrencyId = useId();
  const unloadHintId = useId();

  return (
    <div className={styles.settings}>
      <h2>检查设置</h2>
      <p>设置随检查保存到当前数据集。</p>
      <fieldset disabled={disabled}>
        <legend>视觉模型</legend>
        <label>
          API 地址（包含 /v1）
          <input
            value={options.endpoint}
            onChange={(event) => onOptionsChange({ ...options, endpoint: event.target.value })}
          />
        </label>
        <label>
          模型 ID
          <input
            value={options.model}
            onChange={(event) => onOptionsChange({ ...options, model: event.target.value })}
          />
        </label>
        <div>
          <div className={styles.concurrencyHeader}>
            <label htmlFor={concurrencyId}>并发请求数</label>
            <output htmlFor={concurrencyId}>{options.concurrency}</output>
          </div>
          <input
            id={concurrencyId}
            className={styles.concurrency}
            type='range'
            min={1}
            max={16}
            step={1}
            value={options.concurrency}
            onChange={(event) =>
              onOptionsChange({ ...options, concurrency: event.currentTarget.valueAsNumber })
            }
          />
        </div>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>Forge 模型</legend>
        <p id={unloadHintId}>建议在 WebUI Forge 空闲时卸载生图模型，为 LLM 检查腾出显存和内存空间。</p>
        <button type='button' className='self-start' aria-describedby={unloadHintId} onClick={onUnloadForge}>
          {unloadingForge ? '正在卸载 Forge 生图模型…' : '卸载 Forge 生图模型'}
        </button>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>检查规则</legend>
        <label className={styles.check}>
          <input
            type='checkbox'
            checked={options.visual}
            onChange={(event) => onOptionsChange({ ...options, visual: event.target.checked })}
          />
          在错标检查中使用视觉模型检查构图范围和人物数量
        </label>
        <label>
          当前数据集禁用标签
          <textarea
            rows={3}
            value={forbidden}
            placeholder='例如 virtual youtuber，逗号或换行分隔'
            onChange={(event) => onForbiddenChange(event.target.value)}
          />
        </label>
      </fieldset>
    </div>
  );
}
