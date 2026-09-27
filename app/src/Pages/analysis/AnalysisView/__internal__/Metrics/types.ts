import type { AnalysisReport, BaselineReport } from '../../../types';
export interface MetricsProps {
  report: AnalysisReport;
  baseline?: BaselineReport;
}
