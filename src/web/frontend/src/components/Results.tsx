import { useSearch } from '../context/SearchContext';
import { useMemo, useState } from 'react';
import Export from './Export';

type SortOrder = 'relevance' | 'newest' | 'oldest' | 'most-cited' | 'least-cited';

export default function Results({ onBack }: { onBack: () => void }) {
  const { keywords, results, isSearching, searchError, rateLimited, isMockResultsEnabled, search } = useSearch();
  const [sortOrder, setSortOrder] = useState<SortOrder>('relevance');
  const [view, setView] = useState<'full' | 'compact'>('full');
  const [textFilter, setTextFilter] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [minCitations, setMinCitations] = useState('');
  const [openAccessOnly, setOpenAccessOnly] = useState(false);
  const filteredResults = useMemo(() => {
    const query = textFilter.trim().toLocaleLowerCase();
    const from = yearFrom === '' ? null : Number(yearFrom);
    const to = yearTo === '' ? null : Number(yearTo);
    const citations = minCitations === '' ? null : Number(minCitations);
    return results.filter(paper => {
      if (query && !`${paper.title} ${paper.abstract ?? ''}`.toLocaleLowerCase().includes(query)) return false;
      if (from !== null && (paper.year == null || paper.year < from)) return false;
      if (to !== null && (paper.year == null || paper.year > to)) return false;
      if (citations !== null && (paper.citationCount == null || paper.citationCount < citations)) return false;
      if (openAccessOnly && !paper.openAccessPdf?.url) return false;
      return true;
    });
  }, [results, textFilter, yearFrom, yearTo, minCitations, openAccessOnly]);
  const activeFilterCount = [textFilter.trim(), yearFrom, yearTo, minCitations, openAccessOnly].filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0;
  const sortedResults = useMemo(() => {
    if (sortOrder === 'relevance') return filteredResults;
    return filteredResults
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
  }, [filteredResults, sortOrder]);
  const isRateLimitError = rateLimited || /rate.?limit|too many requests|quota exceeded|\b429\b/i.test(searchError ?? '');
  const isFetchFailure = /failed to fetch|networkerror|network request failed/i.test(searchError ?? '');

  return (
    <section className="results-view">
      <a className="results-back" href="#search" onClick={event => { event.preventDefault(); onBack(); }}>
        <span aria-hidden="true">←</span> Edit search
      </a>
      <div className="results-overview">
        <header className="results-header">
          <div>
            <h1>Search results</h1>
            <p>{keywords.length} queries combined · Showing {filteredResults.length} of {results.length} papers</p>
            {isMockResultsEnabled && <span className="mock-results-badge">Local mock data</span>}
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
            <Export papers={filteredResults} />
          </div>
        </header>
        {results.length > 0 && (
          <details className="results-filter-panel">
          <summary>
            <span>Refine results</span>
            {hasActiveFilters && <span className="results-filter-count">{activeFilterCount} active {activeFilterCount === 1 ? 'filter' : 'filters'}</span>}
          </summary>
          <section className="results-filters" aria-label="Filter search results">
          <label className="results-filter results-filter--text">
            <span>Search titles and abstracts</span>
            <input
              type="search"
              value={textFilter}
              onChange={event => setTextFilter(event.target.value)}
              placeholder="Filter papers…"
            />
          </label>
          <fieldset className="results-filter results-filter--years">
            <legend>Publication year</legend>
            <input type="number" min="1900" max="2100" aria-label="Publication year from" placeholder="From" value={yearFrom} onChange={event => setYearFrom(event.target.value)} />
            <span aria-hidden="true">–</span>
            <input type="number" min="1900" max="2100" aria-label="Publication year to" placeholder="To" value={yearTo} onChange={event => setYearTo(event.target.value)} />
          </fieldset>
          <label className="results-filter results-filter--citations">
            <span>Minimum citations</span>
            <input type="number" min="0" step="1" placeholder="Any" value={minCitations} onChange={event => setMinCitations(event.target.value)} />
          </label>
          <label className={`results-filter results-filter--checkbox${openAccessOnly ? ' results-filter--checkbox-selected' : ''}`}>
            <input type="checkbox" checked={openAccessOnly} onChange={event => setOpenAccessOnly(event.target.checked)} />
            <span>Open access only</span>
          </label>
          <button
            className={`clear-results-filters${hasActiveFilters ? '' : ' clear-results-filters--hidden'}`}
            type="button"
            disabled={!hasActiveFilters}
            aria-hidden={!hasActiveFilters}
            onClick={() => {
            setTextFilter(''); setYearFrom(''); setYearTo(''); setMinCitations(''); setOpenAccessOnly(false);
            }}
          >Clear filters</button>
          </section>
          </details>
        )}
      </div>
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
      {!isSearching && !searchError && results.length > 0 && filteredResults.length === 0 && (
        <p className="results-message" role="status">No papers match these filters. Adjust them or clear the filters to see your results.</p>
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
