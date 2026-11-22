import { Activity } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSessionInfo } from '../api/client';
import { PreviewDialog } from '../components/PreviewDialog';
import { Toast } from '../components/Toast';
import { CropPage } from '../Pages/CropPage';
import { DatasetToolsPage } from '../Pages/DatasetToolsPage';
import { HomePage } from '../Pages/HomePage';
import { LoraToolsPage } from '../Pages/LoraToolsPage';
import { TagAuditPage } from '../Pages/TagAuditPage';
import { TagEditorPage } from '../Pages/TagEditorPage';
import { TaggingPage } from '../Pages/TaggingPage';
import { ReviewContext } from '../review/context';
import { useReview } from '../review/useReview';
import { Header } from './__internal__/Header';
import { DatasetToolbar } from './__internal__/DatasetToolbar';
import { StatusBar } from './__internal__/StatusBar';
import type { WorkspaceProps } from './types';
import styles from './styles.module.css';

function Workspace({ session }: WorkspaceProps) {
  const startInAnalysis = session.analysisOnly || new URLSearchParams(location.search).has('analysis');
  const review = useReview(session, startInAnalysis);
  const runDirectory = review.state?.datasetLoaded ? review.state.config.run_dir : undefined;
  return (
    <ReviewContext value={review}>
      <div className={styles.page}>
        <Header />
        <DatasetToolbar />
        <HomePage />
        <div className='appShell' hidden={review.stage === 'home'}>
          <DatasetToolsPage initialSection={startInAnalysis ? 'analysis' : 'processing'} />
          <LoraToolsPage
            token={session.token}
            defaultDirectory={session.loraOutputDir}
            active={review.stage === 'lora'}
            onToast={review.showToast}
          />
          <CropPage />
          {review.stage === 'tagging' && runDirectory ? (
            <TaggingPage key={`tagging:${runDirectory}`} />
          ) : null}
          <Activity mode={review.stage === 'tag' ? 'visible' : 'hidden'}>
            <TagEditorPage />
          </Activity>
          {runDirectory ? (
            <Activity key={`audit:${runDirectory}`} mode={review.stage === 'audit' ? 'visible' : 'hidden'}>
              <TagAuditPage />
            </Activity>
          ) : null}
        </div>
        {review.stage !== 'home' ? <StatusBar /> : null}
        <PreviewDialog
          image={review.previewImage}
          alt='样本大图'
          onClose={() => review.setPreviewImage('')}
        />
        <Toast message={review.toast} onDismiss={review.dismissToast} />
      </div>
    </ReviewContext>
  );
}

export function App() {
  const session = useQuery({ queryKey: ['session'], queryFn: getSessionInfo, staleTime: Infinity });
  if (session.isPending)
    return (
      <p className='p-4 text-review-muted' role='status'>
        读取进度…
      </p>
    );
  if (session.error)
    return (
      <p className='p-4' role='alert'>
        {session.error.message}
        <button onClick={() => void session.refetch()}>刷新</button>
      </p>
    );
  return <Workspace session={session.data} />;
}
