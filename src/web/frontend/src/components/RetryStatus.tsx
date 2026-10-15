import { useEffect, useState } from 'react';
import type { RetryProgress } from '../../../../shared/retry.ts';
import './RetryStatus.css';

export default function RetryStatus({ progress }: { progress: RetryProgress }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [progress.retryAt]);
  const seconds = Math.max(0, Math.ceil((progress.retryAt - now) / 1000));

  return (
    <div className="retry-status" role="status" aria-live="polite" aria-atomic="true">
      <span className="retry-status__spinner" aria-hidden="true" />
      <span>Semantic Scholar is busy. Retry {progress.attempt} of {progress.maxRetries}
        {seconds > 0 ? ` in ${seconds}s…` : ' — retrying…'}</span>
    </div>
  );
}
