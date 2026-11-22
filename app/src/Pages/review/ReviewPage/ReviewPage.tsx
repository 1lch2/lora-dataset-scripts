import { Activity } from 'react';
import { ReviewContext } from '../context';
import { useReview } from '../useReview';
import { Header } from './__internal__/Header';
import { DatasetManager } from './__internal__/DatasetManager';
import { Library } from './__internal__/Library';
import { CropEditor } from './__internal__/CropEditor';
import { TagEditor } from './__internal__/TagEditor';
import { TagAudit } from './__internal__/TagAudit';
import { Tagging } from './__internal__/Tagging';
import { DatasetToolsPage } from './__internal__/DatasetToolsPage';
import { StatusBar } from './__internal__/StatusBar';
import { PreviewDialog } from './__internal__/PreviewDialog';
import { LoraTools } from '../../lora/LoraTools';
import type { ReviewPageProps } from './types';
import styles from './styles.module.css';

export function ReviewPage({ session }: ReviewPageProps) {
  const startInAnalysis = session.analysisOnly || new URLSearchParams(location.search).has('analysis');
  const review = useReview(session, startInAnalysis);
  const runDirectory = review.state?.datasetLoaded ? review.state.config.run_dir : undefined;
  return (
    <ReviewContext value={review}>
      <div className={styles.page}>
        <Header />
        <DatasetManager />
        <div className='appShell' hidden={review.stage === 'home'}>
          <DatasetToolsPage initialSection={startInAnalysis ? 'analysis' : 'processing'} />
          <LoraTools
            token={session.token}
            defaultDirectory={session.loraOutputDir}
            active={review.stage === 'lora'}
          />
          <Library />
          <CropEditor />
          {review.stage === 'tagging' && runDirectory ? <Tagging key={`tagging:${runDirectory}`} /> : null}
          <Activity mode={review.stage === 'tag' ? 'visible' : 'hidden'}>
            <TagEditor />
          </Activity>
          {runDirectory ? (
            <Activity key={`audit:${runDirectory}`} mode={review.stage === 'audit' ? 'visible' : 'hidden'}>
              <TagAudit />
            </Activity>
          ) : null}
        </div>
        {review.stage !== 'home' ? <StatusBar /> : null}
        <PreviewDialog />
      </div>
    </ReviewContext>
  );
}
