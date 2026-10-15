import type { SearchProgress } from './search-queries';
import type { RetryProgress } from '../../../../shared/retry.ts';

// Each query reserves one initial request plus its maximum retry budget.
// A retry notification means the preceding request finished unsuccessfully.
// Successful queries consume their entire share, including unused retry slots.
export function searchProgressPercent(progress: SearchProgress, retry: RetryProgress | null): number {
  const { completed, total, currentQuery } = progress;
  if (total <= 0) return 0;
  if (completed >= total) return 100;
  let queryFraction = 0;
  if (retry && currentQuery !== null) {
    const maxRetries = Math.max(0, retry.maxRetries);
    const attemptsUsed = Math.min(maxRetries, Math.max(0, retry.attempt));
    queryFraction = attemptsUsed / (maxRetries + 1);
  }
  return (completed + queryFraction) / total * 100;
}
