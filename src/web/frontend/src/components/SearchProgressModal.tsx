import { useEffect, useRef } from 'react';
import type { SearchProgress as Progress, FetchedPaper } from '../lib/search-queries';
import type { RetryProgress } from '../../../../shared/retry.ts';
import SearchProgress from './SearchProgress';
import SearchErrorNotice from './SearchErrorNotice';
import './SearchProgressModal.css';

export default function SearchProgressModal({ progress, searchError, retryProgress, papers, onDismiss }: {
  progress: Progress;
  searchError: string | null;
  retryProgress: RetryProgress | null;
  papers: FetchedPaper[];
  onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    dialog.focus();
    return () => dialog.close();
  }, []);

  return (
    <dialog ref={dialogRef} className={`search-progress-modal${searchError ? ' search-progress-modal--error' : ''}`} tabIndex={-1}
      aria-labelledby={searchError ? 'search-error-title' : 'search-progress-title'} aria-describedby={searchError ? undefined : 'search-progress-description'}
      onCancel={event => { event.preventDefault(); onDismiss(); }}>
      <button className="search-progress-modal__close" type="button" onClick={onDismiss}
        aria-label={searchError ? 'Close' : 'Stop fetching and close'} title={searchError ? 'Close' : 'Stop fetching and close'}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
      {searchError ? <>
        <h2 id="search-error-title">Search failed</h2>
        <SearchErrorNotice />
      </> : <SearchProgress progress={progress} retryProgress={retryProgress} papers={papers} />}
    </dialog>
  );
}
