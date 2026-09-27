import { useSearch } from '../context/SearchContext';

export default function Results({ onBack }: { onBack: () => void }) {
  const { keywords, results, isSearching, searchError, rateLimited } = useSearch();
  const isRateLimitError = rateLimited || /rate.?limit|too many requests|quota exceeded|\b429\b/i.test(searchError ?? '');
  const isFetchFailure = /failed to fetch|networkerror|network request failed/i.test(searchError ?? '');

  return (
    <section className="results-view">
      <header className="results-header">
        <div>
          <h1>Search results</h1>
          <p>{keywords.length} queries combined · {results.length} papers</p>
        </div>
        <button className="secondary-button" type="button" onClick={onBack}>Edit search</button>
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
        {results.map(paper => (
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
