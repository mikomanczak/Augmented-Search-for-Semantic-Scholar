import { useSearch } from '../context/SearchContext';
import { useMemo, useState } from 'react';
import Export from './Export';

type SortOrder = 'relevance' | 'newest' | 'oldest' | 'most-cited' | 'least-cited';

export default function Results({ onBack }: { onBack: () => void }) {
  const { keywords, results, isSearching, searchError, rateLimited, search } = useSearch();
  const [sortOrder, setSortOrder] = useState<SortOrder>('relevance');
  const [view, setView] = useState<'full' | 'compact'>('full');
  const sortedResults = useMemo(() => {
    if (sortOrder === 'relevance') return results;
    return results
      .map((paper, index) => ({ paper, index }))
      .sort((a, b) => {
        const byDate = sortOrder === 'newest' || sortOrder === 'oldest';
        const aValue = byDate ? a.paper.year : a.paper.citationCount;
        const bValue = byDate ? b.paper.year : b.paper.citationCount;
        if (aValue == null && bValue == null) return a.index - b.index;
        if (aValue == null) return 1;
        if (bValue == null) return -1;
        const descending = sortOrder === 'newest' || sortOrder === 'most-cited';
        return (descending ? bValue - aValue : aValue - bValue) || a.index - b.index;
      })
      .map(({ paper }) => paper);
  }, [results, sortOrder]);
  const isRateLimitError = rateLimited || /rate.?limit|too many requests|quota exceeded|\b429\b/i.test(searchError ?? '');
  const isFetchFailure = /failed to fetch|networkerror|network request failed/i.test(searchError ?? '');

  return (
    <section className="results-view">
      <a className="results-back" href="#search" onClick={event => { event.preventDefault(); onBack(); }}>
        <span aria-hidden="true">←</span> Edit search
      </a>
      <header className="results-header">
        <div>
          <h1>Search results</h1>
          <p>{keywords.length} queries combined · {results.length} papers</p>
        </div>
        <div className="results-header__actions">
          <div className="results-view-switch" role="group" aria-label="Results view">
            <button type="button" aria-pressed={view === 'full'} onClick={() => setView('full')}>Full view</button>
            <button type="button" aria-pressed={view === 'compact'} onClick={() => setView('compact')}>Compact view</button>
          </div>
          <label className="sort-control">
            <select
              aria-label="Sort by"
              value={sortOrder}
              onChange={event => setSortOrder(event.target.value as SortOrder)}
            >
              <option value="relevance">Sort: Relevance</option>
              <option value="newest">Sort: Publication date (newest)</option>
              <option value="oldest">Sort: Publication date (oldest)</option>
              <option value="most-cited">Sort: Citation count (highest)</option>
              <option value="least-cited">Sort: Citation count (lowest)</option>
            </select>
          </label>
          <Export />
        </div>
      </header>
      {isSearching && <p className="results-message" role="status">Searching Semantic Scholar…</p>}
      {searchError && (isRateLimitError || isFetchFailure ? (
        <section className="results-error rate-limit-notice" role="alert">
          <img className="rate-limit-art" src={`${import.meta.env.BASE_URL}rate-limit-robot.png`} alt="A friendly vintage robot" />
          <div>
            <h2>{isRateLimitError ? 'That was a lot of searching at once' : 'The search service didn’t respond'}</h2>
            <p>{isRateLimitError
              ? `${searchError} This demo uses shared public API access, which is rate limited. Please wait a little and rerun your search.`
              : `${searchError}. The browser couldn’t read a response from Semantic Scholar, so we can’t confirm the cause. Shared public API access may be temporarily unavailable or rate limited. Please wait a little and rerun your search.`}</p>
            <p>You can also self-host the app and provide your own Semantic Scholar API key for your searches.</p>
            <div className="rate-limit-actions">
              <button className="primary-button" type="button" onClick={() => void search()} disabled={isSearching}>
                {isSearching ? 'Searching…' : 'Retry search'}
              </button>
              <a
                className="secondary-button api-key-docs-button"
                href="https://github.com/mikomanczak/Augmented-Search-for-Semantic-Scholar#web"
                target="_blank"
                rel="noreferrer"
              >
                Run with your own API key
              </a>
            </div>
          </div>
        </section>
      ) : <p className="results-error" role="alert">{searchError}</p>)}
      {!isSearching && !searchError && results.length === 0 && (
        <p className="results-message">No papers found. Try changing your query or filters.</p>
      )}
      <div className="paper-list">
        {sortedResults.map(paper => (
          <article className="paper-card" key={paper.paperId}>
            <h2>{paper.url ? <a href={paper.url} target="_blank" rel="noreferrer">{paper.title}</a> : paper.title}</h2>
            <p className="paper-meta">
              {[paper.year, paper.venue, paper.authors?.map(author => author.name).join(', '),
                paper.citationCount != null ? `${paper.citationCount} citations` : null]
                .filter(Boolean).join(' · ')}
            </p>
            {view === 'full' && paper.abstract && <p className="paper-abstract">{paper.abstract}</p>}
            {paper.openAccessPdf?.url && <a className="paper-pdf" href={paper.openAccessPdf.url} target="_blank" rel="noreferrer">Open access PDF</a>}
          </article>
        ))}
      </div>
    </section>
  );
}
