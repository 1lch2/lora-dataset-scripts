import { useReviewContext } from '../../../context';
import { CROP_NAMES, imageUrl } from '../../../utils';
import { TagChoices } from '../TagChoices';

export function TagFilters() {
  const v = useReviewContext();
  return (
    <section id='tagFilters' className='panelScroll' hidden={v.stage !== 'tag'}>
      <div className='sampleFilterToolbar'>
        <label>
          裁切类型
          <select
            id='kind'
            name='kind'
            value={v.fields.kind}
            onChange={(event) => v.handleField('kind', event.target.value)}
          >
            <option value=''>全部</option>
            <option value='full'>完整图</option>
            <option value='head'>头部</option>
            <option value='upper'>腰上</option>
            <option value='knees'>膝盖以上</option>
            <option value='eyes_calf'>眼睛到小腿</option>
            <option value='lower'>下半身</option>
            <option value='manual'>手动</option>
          </select>
        </label>
        <button id='resetTagFilters' disabled={v.busy} onClick={() => v.handleAction('resetTagFilters')}>
          清除筛选
        </button>
      </div>
      <div className='tagConditionGrid'>
        <div className='fieldRow filterCondition'>
          <label>
            包含标签
            <input
              id='hasTag'
              name='hasTag'
              placeholder='例如 white shirt, skirt…'
              autoComplete='off'
              spellCheck='false'
              value={v.fields.hasTag}
              onChange={(event) => v.handleField('hasTag', event.target.value)}
            />
          </label>
          <label>
            包含逻辑
            <select
              id='hasLogic'
              value={v.fields.hasLogic}
              onChange={(event) => v.handleField('hasLogic', event.target.value)}
            >
              <option value='all'>AND · 同时包含</option>
              <option value='any'>OR · 任意包含</option>
            </select>
          </label>
        </div>
        <div className='fieldRow filterCondition'>
          <label>
            排除标签
            <input
              id='notTag'
              name='notTag'
              placeholder='例如 full body…'
              autoComplete='off'
              spellCheck='false'
              value={v.fields.notTag}
              onChange={(event) => v.handleField('notTag', event.target.value)}
            />
          </label>
          <label>
            排除逻辑
            <select
              id='notLogic'
              value={v.fields.notLogic}
              onChange={(event) => v.handleField('notLogic', event.target.value)}
            >
              <option value='any'>OR · 排除任意命中</option>
              <option value='all'>AND · 排除全部命中</option>
            </select>
          </label>
        </div>
      </div>
      <hr />
      <div className='tagListHeading'>
        <h3>
          标签列表{' '}
          <small id='vocabularyCount'>{`${v.tags.vocabulary.length} / ${v.tags.vocabularyTotal}`}</small>
        </h3>
        <div className='tagFocus'>
          <span id='tagFocusName'>
            {v.tags.focused
              ? `${v.tags.focused[0].relative} · ${CROP_NAMES[v.tags.focused[1].kind]}`
              : '全部图片的标签'}
          </span>
          <button
            id='viewFocusedImage'
            hidden={!v.tags.focused}
            disabled={v.busy}
            onClick={() => {
              if (v.tags.focused)
                v.setPreviewImage(imageUrl(v.tags.focused[0], 'tag', v.state!.updated_at, v.tags.focused[1]));
            }}
          >
            查看大图
          </button>
          <button
            id='showAllTags'
            hidden={!v.tags.focused}
            disabled={v.busy}
            onClick={() => v.handleAction('showAllTags')}
          >
            显示全部标签
          </button>
        </div>
      </div>
      <div className='tagSearchToolbar'>
        <label>
          搜索标签
          <input
            id='tagSearch'
            type='search'
            placeholder='搜索标签名称…'
            value={v.fields.tagSearch}
            onChange={(event) => v.handleField('tagSearch', event.target.value)}
          />
        </label>
        <label>
          匹配
          <select
            id='tagSearchMode'
            value={v.fields.tagSearchMode}
            onChange={(event) => v.handleField('tagSearchMode', event.target.value)}
          >
            <option value='contains'>包含</option>
            <option value='prefix'>前缀</option>
            <option value='suffix'>后缀</option>
            <option value='exact'>完整标签</option>
            <option value='regex'>正则表达式</option>
          </select>
        </label>
        <label>
          排序
          <select
            id='tagSort'
            value={v.fields.tagSort}
            onChange={(event) => v.handleField('tagSort', event.target.value)}
          >
            <option value='frequency'>出现频率</option>
            <option value='alpha'>字母顺序</option>
          </select>
        </label>
        <label>
          顺序
          <select
            id='tagOrder'
            value={v.fields.tagOrder}
            onChange={(event) => v.handleField('tagOrder', event.target.value)}
          >
            <option value='desc'>降序</option>
            <option value='asc'>升序</option>
          </select>
        </label>
      </div>
      <p id='tagSearchError' className='error' role='status'>
        {v.tags.vocabularyError}
      </p>
      <p className='hint'>点击标签加入包含条件；点击 − 加入排除条件。数字为基础筛选中含此标签的图片数。</p>
      <div id='tagVocabulary' className='tagVocabulary'>
        <TagChoices />
      </div>
    </section>
  );
}
