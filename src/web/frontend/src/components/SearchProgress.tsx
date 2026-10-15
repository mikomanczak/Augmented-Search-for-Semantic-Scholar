import { useEffect, useState } from 'react';
import type { SearchProgress as Progress, FetchedPaper } from '../lib/search-queries';
import type { RetryProgress } from '../../../../shared/retry.ts';
import './SearchProgress.css';
import { searchProgressPercent } from '../lib/search-progress';

export default function SearchProgress({ progress, retryProgress, papers }: {
  progress: Progress;
  papers: FetchedPaper[];
  retryProgress: RetryProgress | null;
}) {
  const { completed, total } = progress;
  const [paperIndex, setPaperIndex] = useState(0);
  useEffect(() => {
    if (papers.length < 2) return;
    const timer = window.setInterval(() => setPaperIndex(index => (index + 1) % papers.length), 500);
    return () => window.clearInterval(timer);
  }, [papers.length]);
  const paper = papers.length ? papers[paperIndex % papers.length] : null;
  const percent = searchProgressPercent(progress, retryProgress);
  const [displayPercent, setDisplayPercent] = useState(percent);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayPercent(percent);
      return;
    }
    setDisplayPercent(previous => percent > previous ? (previous + percent) / 2 : percent);
    const timer = window.setTimeout(() => setDisplayPercent(percent), 325);
    return () => window.clearTimeout(timer);
  }, [percent]);
  const percentLabel = displayPercent.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <section className="search-progress" aria-labelledby="search-progress-title">
      <div className="search-progress__content">
        <div className="search-progress__heading">
          <h2 id="search-progress-title">{retryProgress ? 'Fetching results from Semantic Scholar' : 'Fetching results'}</h2>
        </div>
        <p className="search-progress__note" id="search-progress-description">This may take a few minutes, depending on the number of queries and how busy Semantic Scholar is.</p>
        <div className="search-progress__track" role="progressbar" aria-label="Search progress"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayPercent}
          aria-valuetext={`${percentLabel}%; ${completed} of ${total} queries fetched`}>
          <div className="search-progress__fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="search-progress__percent" aria-hidden="true">{percentLabel}%</div>
        {paper && <p className="search-progress__paper-title">
          <span key={paper.paperId} title={paper.title}>“{paper.title}”</span>
        </p>}
      </div>
    </section>
  );
}
