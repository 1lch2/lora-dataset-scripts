import { useReviewContext } from '../../../context';

export function StatusBar() {
  const v = useReviewContext();
  return (
    <footer className='appStatus'>
      <span id='summary' title={v.state?.config.run_dir}>
        {v.state ? `${v.sources.length} 张源图` : ''}
      </span>
      <progress
        id='jobProgress'
        hidden={v.job.status !== 'running' || v.job.action !== 'start_tag'}
        aria-label='打标进度'
        max={Math.max(v.job.total, 1)}
        value={v.job.done}
      ></progress>
      <p id='jobStatus' role='status' aria-live='polite' className={v.job.status === 'failed' ? 'error' : ''}>
        {v.jobStatus}
      </p>
    </footer>
  );
}
