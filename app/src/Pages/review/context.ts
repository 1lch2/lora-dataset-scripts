import { createContext, useContext } from 'react';
import type { useReview } from './useReview';

export const ReviewContext = createContext<ReturnType<typeof useReview> | null>(null);
export function useReviewContext() {
  const value = useContext(ReviewContext);
  if (!value) throw Error('缺少审核页面上下文');
  return value;
}
