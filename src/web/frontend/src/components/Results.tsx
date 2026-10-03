import { useSearch } from '../context/SearchContext';
import { useMemo, useState } from 'react';

type SortOrder = 'relevance' | 'newest' | 'oldest' | 'most-cited' | 'least-cited';

export default function Results({ onBack }: { onBack: () => void }) {
  const { keywords, results, isSearching, searchError, rateLimited } = useSearch();
  const [sortOrder, setSortOrder] = useState<SortOrder>('relevance');
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
      <header className="results-header">
        <div>
          <h1>Search results</h1>
          <p>{keywords.length} queries combined · {results.length} papers</p>
        </div>
        <div className="results-actions">
          <label className="sort-control">
            <span>Sort by</span>
            <select value={sortOrder} onChange={event => setSortOrder(event.target.value as SortOrder)}>
              <option value="relevance">Relevance</option>
              <option value="newest">Publication date (newest)</option>
              <option value="oldest">Publication date (oldest)</option>
              <option value="most-cited">Citation count (highest)</option>
              <option value="least-cited">Citation count (lowest)</option>
            </select>
          </label>
          <button className="secondary-button" type="button" onClick={onBack}>Edit search</button>
        </div>
      </header>
      {isSearching && <p className="results-message" role="status">Searching Semantic Scholar…</p>}
      {searchError && (isRateLimitError || isFetchFailure ? (
        <section className="results-error rate-limit-notice" role="alert">
          <pre className="rate-limit-art" aria-label="A tiny friendly robot">{isRateLimitError
            ? `  .----.\n | o  o |\n |  __  |  429\n '------'`
            : `  .----.\n | o  o |\n |  --  |  ...\n '------'`}</pre>
          <div>
            <h2>{isRateLimitError ? 'That was a lot of searching at once' : 'The search service didn’t respond'}</h2>
            <p>{isRateLimitError
              ? `${searchError} This demo uses shared public API access, which is rate limited. Please wait a little and rerun your search.`
              : `${searchError}. The browser couldn’t read a response from Semantic Scholar, so we can’t confirm the cause. Shared public API access may be temporarily unavailable or rate limited. Please wait a little and rerun your search.`}</p>
            <p>You can also self-host the app and provide your own Semantic Scholar API key for your searches.</p>
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
            {paper.abstract && <p className="paper-abstract">{paper.abstract}</p>}
            {paper.openAccessPdf?.url && <a className="paper-pdf" href={paper.openAccessPdf.url} target="_blank" rel="noreferrer">Open access PDF</a>}
          </article>
        ))}
      </div>
    </section>
  );
}
