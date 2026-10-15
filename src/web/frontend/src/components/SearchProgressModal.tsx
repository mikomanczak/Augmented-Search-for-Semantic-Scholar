import { useEffect, useRef, type ReactNode } from 'react';
import type { SearchProgress as Progress, FetchedPaper } from '../lib/search-queries';
import type { RetryProgress } from '../../../../shared/retry.ts';
import SearchProgress from './SearchProgress';
import './SearchProgressModal.css';

export default function SearchProgressModal({ progress, retryProgress, papers, children, onDismiss }: {
  progress: Progress;
  retryProgress: RetryProgress | null;
  papers: FetchedPaper[];
  children?: ReactNode;
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
    <dialog ref={dialogRef} className={`search-progress-modal${children ? ' search-progress-modal--preview' : ''}`} tabIndex={-1}
      aria-labelledby="search-progress-title" aria-describedby="search-progress-description"
      onCancel={event => { event.preventDefault(); onDismiss(); }}>
      <button className="search-progress-modal__close" type="button" onClick={onDismiss}
        aria-label="Stop fetching and close" title="Stop fetching and close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
      {children}
      <SearchProgress progress={progress} retryProgress={retryProgress} papers={papers} />
    </dialog>
  );
}
