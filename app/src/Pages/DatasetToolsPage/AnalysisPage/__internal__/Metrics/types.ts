import type { AnalysisReport, BaselineReport } from '../../reportTypes';
export interface MetricsProps {
  report: AnalysisReport;
  baseline?: BaselineReport;
}
