import { useReviewContext } from '../../../context';
import { CROP_NAMES, imageKey, imageUrl } from '../../../utils';

export function TagCards() {
  const v = useReviewContext();
  return (
    <div
      id='tagCards'
      tabIndex={0}
      aria-label='可选择的样本列表'
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          v.tags.handleFocus();
          event.currentTarget.focus();
        }
      }}
    >
      {v.tags.visibleTags.map((pair) => {
        const [s, c] = pair,
          k = imageKey(s, c),
          selected = v.tags.selected.has(k),
          focused = v.tags.singleKey === k;
        const label = `${s.relative} ${CROP_NAMES[c.kind]}`;
        return (
          <article
            key={k}
            className={`card${selected ? ' selected' : ''}${focused ? ' focused' : ''}`}
            title={`${s.relative} · ${CROP_NAMES[c.kind]} · ${c.tag_current ? '标签已生成' : '标签过期'}`}
          >
            <button
              className='imageButton'
              aria-label={`选择 ${label}`}
              aria-pressed={focused}
              disabled={v.busy}
              onClick={() => v.tags.handleFocus(focused ? undefined : pair)}
            >
              <img
                src={imageUrl(s, 'tag', v.state!.updated_at, c)}
                alt={label}
                loading='lazy'
                width={140}
                height={140}
              />
            </button>
            <input
              type='checkbox'
              checked={selected}
              disabled={!c.tag_current}
              data-selection={k}
              aria-label={`批量选择 ${label}`}
              onChange={(event) => {
                const checked = event.target.checked;
                v.tags.setSelected((previous) => {
                  const next = new Set(previous);
                  if (checked) next.add(k);
                  else next.delete(k);
                  return next;
                });
              }}
            />
          </article>
        );
      })}
      {!v.tags.visibleTags.length ? (
        <p className='emptyState'>暂无匹配样本。可切换到“标签筛选”调整条件，或在裁切审核完成后开始打标。</p>
      ) : null}
    </div>
  );
}
