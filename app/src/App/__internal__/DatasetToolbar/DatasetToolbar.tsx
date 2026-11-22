import { useReviewContext } from '../../../review/context';
import styles from './styles.module.css';

export function DatasetToolbar() {
  const v = useReviewContext();
  if (v.session.analysisOnly || !['crop', 'tagging', 'tag'].includes(v.stage)) return null;

  return (
    <section className={`${styles.manager} ${styles.compactManager}`} aria-label='当前数据集与处理'>
      <div className={styles.current}>
        <span className={styles.badge}>
          {v.state?.config.crop_mode === 'prepared' ? '完整打标' : '待处理'}
        </span>
        <span className={styles.currentPath} title={v.state?.config.input_dir}>
          {v.state?.config.input_dir}
        </span>
      </div>
      {v.stage === 'crop' && v.state?.datasetLoaded && v.state.config.crop_mode !== 'prepared' ? (
        <div className={styles.processing}>
          <span className='hint'>范围：数据集全部图片</span>
          <div className={styles.processingAction}>
            <button
              id='upscaleDataset'
              type='button'
              disabled={v.processing || !v.sources.length}
              onClick={() => v.handleAction('upscaleDataset')}
            >
              按尺寸超分
            </button>
            <span className={styles.help}>
              <button
                type='button'
                className={styles.helpButton}
                aria-label='按尺寸超分说明'
                aria-describedby='upscaleHelp'
              >
                ？
              </button>
              <span id='upscaleHelp' role='tooltip' className={styles.tooltip}>
                作用于当前数据集全部图片，不受筛选影响。总像素不足 1024² × 80% 时放大 1.5
                倍；此步骤独立执行，不自动识别主体或生成裁切候选。
              </span>
            </span>
          </div>
          <div className={styles.processingAction}>
            <button
              id='detectDataset'
              type='button'
              disabled={v.processing || !v.sources.length}
              onClick={() => v.handleAction('detectDataset')}
            >
              识别主体并生成裁切候选
            </button>
            <span className={styles.help}>
              <button
                type='button'
                className={styles.helpButton}
                aria-label='识别主体说明'
                aria-describedby='detectHelp'
              >
                ？
              </button>
              <span id='detectHelp' role='tooltip' className={styles.tooltip}>
                对当前数据集全部图片识别主体并生成裁切候选，不受筛选影响。此步骤独立执行，不自动超分或打标。
              </span>
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
