import { useReviewContext } from '../../../context';
import { CROP_NAMES, imageUrl } from '../../../utils';

export function SingleEditor() {
  const v = useReviewContext();
  return (
    <div
      id='singleToolPanel'
      role='tabpanel'
      aria-labelledby='singleToolTab'
      className='panelScroll'
      hidden={v.tool !== 'single'}
    >
      <h2>单图标签</h2>
      <p className='hint'>点击左侧缩略图选择图片。</p>
      <p id='singleName'>
        {v.tags.focused ? `${v.tags.focused[0].relative} · ${CROP_NAMES[v.tags.focused[1].kind]}` : ''}
      </p>
      <details>
        <summary>图片预览</summary>
        <img
          id='singlePreview'
          alt='当前编辑样本'
          hidden={!v.tags.focused}
          src={
            v.tags.focused
              ? imageUrl(v.tags.focused[0], 'tag', v.state!.updated_at, v.tags.focused[1])
              : undefined
          }
        />
      </details>
      <p id='singleNotes' className='bad'>
        {v.tags.focused
          ? [
              ...(v.tags.focused[1].tag.auto_removed.length
                ? [
                    `${v.tags.focused[1].tag.restore_raw ? '已恢复自动删除' : '自动删除'}：${v.tags.focused[1].tag.auto_removed.join(', ')}`,
                  ]
                : []),
              ...(v.tags.focused[1].tag.suggestions || []),
            ].join('\n')
          : ''}
      </p>
      <label>
        标签
        <textarea
          id='singleCaption'
          rows={8}
          placeholder='逗号分隔…'
          spellCheck='false'
          value={v.fields.singleCaption}
          onChange={(event) => v.handleField('singleCaption', event.target.value)}
        ></textarea>
      </label>
      <div className='compactActions'>
        <button
          id='saveSingle'
          className='primary'
          disabled={v.processing || !v.tags.focused?.[1].tag_current}
          onClick={() => v.handleAction('saveSingle')}
        >
          保存此图标签
        </button>
      </div>
    </div>
  );
}
