import { useReviewContext } from '../../../context';
import { splitTags } from '../../../utils';
import type { TagChoicesProps } from './types';

export function TagChoices({ frequency = false }: TagChoicesProps) {
  const v = useReviewContext();
  const rows = frequency ? v.tags.frequencies : v.tags.vocabulary;
  const removing = frequency && v.mode === 'remove';
  const negative = splitTags(v.fields.notTag),
    removals = splitTags(v.fields.editTags);
  return (
    <>
      {rows.map(([tag, count]) => {
        const marked = removing ? removals.includes(tag) : negative.includes(tag);
        function handleSecondary() {
          if (!removing) {
            v.tags.handleToggleFilter('notTag', tag);
            return;
          }
          v.setField(
            'editTags',
            (removals.includes(tag) ? removals.filter((t) => t !== tag) : [...removals, tag]).join(', '),
          );
        }
        return (
          <div className='tagChoice' key={tag}>
            <button
              className={`tagChip${v.tags.clickedTags.has(tag) ? ' active' : ''}`}
              data-tag={frequency ? tag : undefined}
              aria-pressed={v.tags.clickedTags.has(tag)}
              disabled={v.busy}
              onClick={() => v.tags.handleToggleFilter('hasTag', tag)}
            >
              <span className='tagText'>{tag}</span>
              <span className='tagCount'>[{count}]</span>
            </button>
            <button
              type='button'
              className={marked ? 'active' : ''}
              aria-label={`${removing ? '选择待删除标签' : '排除'} ${tag}`}
              aria-pressed={marked}
              disabled={v.busy}
              onClick={handleSecondary}
            >
              −
            </button>
          </div>
        );
      })}
    </>
  );
}
