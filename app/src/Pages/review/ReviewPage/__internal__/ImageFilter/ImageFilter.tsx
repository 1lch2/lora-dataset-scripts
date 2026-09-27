import { useReviewContext } from '../../../context';
import { CROP_NAMES, imageKey, imageUrl } from '../../../utils';

export function ImageFilter() {
  const v = useReviewContext();
  return (
    <div
      id='selectionToolPanel'
      role='tabpanel'
      aria-labelledby='selectionToolTab'
      className='panelScroll'
      hidden={v.tool !== 'selection'}
    >
      <div className='compactActions'>
        <button id='filterChecked' disabled={v.busy} onClick={() => v.handleAction('filterChecked')}>
          加入勾选图片
        </button>
        <button id='filterVisible' disabled={v.busy} onClick={() => v.handleAction('filterVisible')}>
          加入当前结果
        </button>
        <button id='invertImageFilter' disabled={v.busy} onClick={() => v.handleAction('invertImageFilter')}>
          反选
        </button>
        <button id='clearImageBasket' disabled={v.busy} onClick={() => v.handleAction('clearImageBasket')}>
          清空
        </button>
      </div>
      <div className='compactActions'>
        <button
          id='applyImageFilter'
          className='primary'
          disabled={v.busy}
          onClick={() => v.handleAction('applyImageFilter')}
        >
          应用图片过滤
        </button>
        <button id='resetImageFilter' disabled={v.busy} onClick={() => v.handleAction('resetImageFilter')}>
          取消图片过滤
        </button>
        <span
          id='imageFilterStatus'
          role='status'
        >{`待过滤 ${v.tags.basket.length} 张 · ${v.tags.imageFilter === null ? '未启用' : `已启用 ${v.tags.filterCount} 张`}`}</span>
      </div>
      <p className='hint'>点击下方缩略图可移出待过滤列表。应用后与标签条件共同生效。</p>
      <div id='imageFilterBasket'>
        {v.tags.basket.map(([s, c]) => (
          <button
            key={imageKey(s, c)}
            className='imageButton'
            aria-label={`移出过滤 ${s.relative} ${CROP_NAMES[c.kind]}`}
            disabled={v.busy}
            onClick={() =>
              v.tags.setImageBasket((previous) => {
                const next = new Set(previous);
                next.delete(imageKey(s, c));
                return next;
              })
            }
          >
            <img
              src={imageUrl(s, 'tag', v.state!.updated_at, c)}
              alt={`${s.relative} ${CROP_NAMES[c.kind]}`}
              loading='lazy'
            />
          </button>
        ))}
      </div>
    </div>
  );
}
