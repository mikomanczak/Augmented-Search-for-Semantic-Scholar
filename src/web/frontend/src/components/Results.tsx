import { useSearch } from '../context/SearchContext';
import { Fragment, useMemo, useState } from 'react';
import Export from './Export';
import QueryOverlap from './QueryOverlap';
import TopicMap from './TopicMap';
import RetryStatus from './RetryStatus';

type SortOrder = 'relevance' | 'newest' | 'oldest' | 'most-cited' | 'least-cited';

export default function Results() {
  const { keywords, queryResults, results, isSearching, retryProgress, searchError, rateLimited, isMockResultsEnabled, search } = useSearch();
  const [sortOrder, setSortOrder] = useState<SortOrder>('relevance');
  const [view, setView] = useState<'full' | 'compact'>('full');
  const [isHeaderExpanded, setIsHeaderExpanded] = useState(false);
  const isResultsInsightsEnabled = new URLSearchParams(window.location.search).has('results_insights');
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
      <div className="results-overview">
        <header className="results-header">
          <div className="results-header__summary">
            <h1>Search results</h1>
            <p>{queryResults.length || keywords.length} queries combined · Showing {results.length} papers</p>
            {isMockResultsEnabled && <span className="mock-results-badge">Local mock data</span>}
          </div>
          <Export papers={results} />
          {isResultsInsightsEnabled && results.length > 0 && (
            <button className="results-header__toggle" type="button"
              aria-label={`${isHeaderExpanded ? 'Collapse' : 'Expand'} results header`}
              aria-expanded={isHeaderExpanded} aria-controls="results-header-details"
              onClick={() => setIsHeaderExpanded(expanded => !expanded)}>
              <span>{isHeaderExpanded ? 'Collapse' : 'Expand'}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d={isHeaderExpanded ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
              </svg>
            </button>
          )}
          <div className="results-header__details" id="results-header-details" hidden={!isHeaderExpanded}>
            {(queryResults.length === 3 || results.length > 0) && (
              <section className="results-insights" aria-label="Query overlap and topic map">
                {queryResults.length === 3 && <QueryOverlap queries={queryResults} />}
                {results.length > 0 && <TopicMap key={results.map(paper => paper.paperId).join(',')} papers={results} queries={queryResults} isMock={isMockResultsEnabled} />}
              </section>
            )}
          </div>
        </header>
      </div>
      {isSearching && (retryProgress ? <RetryStatus progress={retryProgress} />
        : <p className="results-message" role="status">Searching Semantic Scholar…</p>)}
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
      {results.length > 0 && (
        <div className="results-toolbar" role="group" aria-label="Search result controls">
          <div className="results-toolbar__controls">
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
          </div>
        </div>
      )}
      <div className="paper-list">
        {sortedResults.map(paper => (
          <article className="paper-card" key={paper.paperId}>
            <div className="paper-heading">
              <h2>{paper.url ? <a href={paper.url} target="_blank" rel="noreferrer">{paper.title}</a> : paper.title}</h2>
              <div className="paper-badges">
                {paper.year != null && <span className="paper-badge paper-badge--year" aria-label={`Published in ${paper.year}`}>{paper.year}</span>}
                {paper.citationCount != null && (
                  <span
                    className="paper-badge paper-badge--citations"
                    aria-label={`${paper.citationCount.toLocaleString()} ${paper.citationCount === 1 ? 'citation' : 'citations'}`}
                    title={`${paper.citationCount.toLocaleString()} ${paper.citationCount === 1 ? 'citation' : 'citations'}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                      <path d="M10 11H4V7h6v7a5 5 0 0 1-5 5M20 11h-6V7h6v7a5 5 0 0 1-5 5" />
                    </svg>
                    {paper.citationCount.toLocaleString()}
                  </span>
                )}
                {paper.openAccessPdf?.url && (
                  <a className="paper-badge paper-badge--pdf" href={paper.openAccessPdf.url} target="_blank" rel="noreferrer">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                      <path d="M14 2v6h6M8 13h8M8 17h5" />
                    </svg>
                    PDF
                  </a>
                )}
              </div>
            </div>
            {(paper.venue || !!paper.authors?.length) && (
              <p className="paper-meta">
                {paper.venue}
                {paper.venue && !!paper.authors?.length && ' · '}
                {paper.authors?.map((author, index) => (
                  <Fragment key={`${author.authorId ?? author.name}-${index}`}>
                    {index > 0 && ', '}
                    {author.authorId ? (
                      <a href={`https://www.semanticscholar.org/author/${encodeURIComponent(author.authorId)}`} target="_blank" rel="noreferrer">
                        {author.name}
                      </a>
                    ) : author.name}
                  </Fragment>
                ))}
              </p>
            )}
            {view === 'full' && paper.abstract && <p className="paper-abstract">{paper.abstract}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
