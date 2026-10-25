import { useReviewContext } from '../../../context';

export function DatasetFilters() {
  const v = useReviewContext();
  return (
    <div className='filters'>
      <label>
        文件名
        <input
          id='search'
          name='search'
          type='search'
          placeholder='搜索图片…'
          autoComplete='off'
          value={v.fields.search}
          onChange={(event) => v.handleField('search', event.target.value)}
        />
      </label>
    </div>
  );
}
