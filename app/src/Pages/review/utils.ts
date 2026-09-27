import type { Candidate, Source } from '../../api/types';
import type { KeyboardEvent } from 'react';

export const CROP_NAMES: Record<string, string> = {
  full: '完整图',
  head: '头部',
  upper: '腰上',
  knees: '膝盖以上',
  eyes_calf: '眼睛到小腿',
  lower: '下半身',
  manual: '手动',
};
export const splitTags = (value: string) => [
  ...new Set(
    value
      .split(/[,\r\n]+/)
      .map((t) => t.trim().replaceAll('_', ' '))
      .filter(Boolean),
  ),
];
export const tagContains = (tag: string, term: string) =>
  tag.replaceAll('_', ' ').toLowerCase().includes(term.toLowerCase());
export const imageKey = (s: Source, c: Candidate) => `${s.id}/${c.id}`;
export const imageUrl = (s: Source, kind: string, updated: string, c?: Candidate) =>
  `/image?source=${encodeURIComponent(s.id)}&kind=${kind}&candidate=${encodeURIComponent(c?.id || '')}&v=${updated}`;
export function sortedCounts(counts: Map<string, number>, by: string, order: string) {
  return [...counts].sort((a, b) => {
    const alpha = a[0].localeCompare(b[0], 'en');
    const difference = by === 'frequency' ? a[1] - b[1] : by === 'length' ? a[0].length - b[0].length : alpha;
    return (order === 'desc' ? -difference : difference) || alpha;
  });
}
export function tagMatcher(query: string, mode: string) {
  try {
    if (!query) return { match: () => true, error: '' };
    if (mode === 'regex') {
      const regex = new RegExp(query, 'i');
      return { match: (tag: string) => regex.test(tag), error: '' };
    }
    const text = query.replaceAll('_', ' ').toLowerCase();
    return {
      match: (tag: string) => {
        const t = tag.toLowerCase();
        return mode === 'prefix'
          ? t.startsWith(text)
          : mode === 'suffix'
            ? t.endsWith(text)
            : mode === 'exact'
              ? t === text
              : t.includes(text);
      },
      error: '',
    };
  } catch (error) {
    return { match: () => false, error: `正则表达式无效：${(error as Error).message}` };
  }
}
export function handleTabKeys(event: KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')].filter(
    (b) => !b.disabled,
  );
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (i + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
  buttons[next]?.click();
  buttons[next]?.focus();
}
