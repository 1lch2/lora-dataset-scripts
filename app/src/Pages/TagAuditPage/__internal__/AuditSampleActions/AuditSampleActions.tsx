import { useState } from 'react';
import type { FormEvent } from 'react';
import { splitTags } from '../../../../review/utils';
import styles from '../../styles.module.css';
import type { AuditSampleActionsProps } from './types';

export function AuditSampleActions({ name, tags, disabled, onRetry, onSave }: AuditSampleActionsProps) {
  const [draft, setDraft] = useState<string>();
  const current = tags.join(', ');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || draft === undefined || draft === current) return;
    if (await onSave(splitTags(draft))) setDraft(undefined);
  }

  if (draft !== undefined) {
    return (
      <form className={styles.detail} onSubmit={(event) => void handleSubmit(event)}>
        <label>
          工作标签
          <textarea
            autoFocus
            rows={3}
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <div className={styles.toolbar}>
          <button className='primary' type='submit' disabled={disabled || draft === current}>
            保存此图标签
          </button>
          <button type='button' disabled={disabled} onClick={() => setDraft(undefined)}>
            取消编辑
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      <p>工作标签：{current || '无'}</p>
      <div className={styles.toolbar}>
        <button
          type='button'
          aria-label={`编辑标签 ${name}`}
          disabled={disabled}
          onClick={() => setDraft(current)}
        >
          编辑标签
        </button>
        <button type='button' aria-label={`重试此项 ${name}`} disabled={disabled} onClick={onRetry}>
          重试此项
        </button>
      </div>
    </>
  );
}
