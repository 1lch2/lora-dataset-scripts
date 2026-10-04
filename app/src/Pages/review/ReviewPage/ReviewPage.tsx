import { ReviewContext } from '../context';
import { useReview } from '../useReview';
import { Header } from './__internal__/Header';
import { Library } from './__internal__/Library';
import { CropEditor } from './__internal__/CropEditor';
import { TagEditor } from './__internal__/TagEditor';
import { StatusBar } from './__internal__/StatusBar';
import { PreviewDialog } from './__internal__/PreviewDialog';
import { AnalysisView } from '../../analysis/AnalysisView';
import { LoraTools } from '../../lora/LoraTools';
import { CompositeTagging } from '../../composite/CompositeTagging';
import type { ReviewPageProps } from './types';
import styles from './styles.module.css';

export function ReviewPage({ session }: ReviewPageProps) {
  const review = useReview(session);
  return (
    <ReviewContext value={review}>
      <div className={styles.page}>
        <Header />
        <div className='appShell'>
          <AnalysisView token={session.token} active={review.stage === 'analysis'} />
          <CompositeTagging token={session.token} active={review.stage === 'composite'} />
          <LoraTools
            token={session.token}
            defaultDirectory={session.loraOutputDir}
            active={review.stage === 'lora'}
          />
          <Library />
          <CropEditor />
          <TagEditor />
        </div>
        <StatusBar />
        <PreviewDialog />
      </div>
    </ReviewContext>
  );
}
