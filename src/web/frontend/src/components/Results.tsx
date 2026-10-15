import { useSearch } from '../context/SearchContext';
import { Fragment, useMemo, useState } from 'react';
import Export from './Export';
import QueryOverlap from './QueryOverlap';
import TopicMap from './TopicMap';

type SortOrder = 'relevance' | 'newest' | 'oldest' | 'most-cited' | 'least-cited';

export default function Results() {
  const { keywords, queryResults, results, isMockResultsEnabled } = useSearch();
  const [sortOrder, setSortOrder] = useState<SortOrder>('relevance');
  const [view, setView] = useState<'full' | 'compact'>('full');
  const [isInsightsExpanded, setIsInsightsExpanded] = useState(false);
  const [activeInsight, setActiveInsight] = useState<'overlap' | 'topics' | null>(null);
  const [openedInsights, setOpenedInsights] = useState({ overlap: false, topics: false });
  const insightTabs = [
    ...(queryResults.length === 3 ? [{ id: 'overlap' as const, label: 'Compare queries' }] : []),
    { id: 'topics' as const, label: 'Similar papers' },
  ];
  const selectInsight = (id: 'overlap' | 'topics' | null) => {
    setActiveInsight(id);
    if (id) setOpenedInsights(current => ({ ...current, [id]: true }));
  };
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
        </header>
        {results.length > 0 && (
          <section className="results-explore" id="results-insights-section" hidden={!isInsightsExpanded} aria-labelledby="results-explore-heading">
            <div className="results-explore__header">
              <h2 id="results-explore-heading">Results insights</h2>

            </div>
            <div className="results-explore__tabs" role="tablist" aria-label="Results insights">
              {insightTabs.map(({ id, label }, index) => (
                <button key={id} id={`results-tab-${id}`} type="button" role="tab"
                  aria-selected={activeInsight === id} aria-controls="results-workspace"
                  tabIndex={activeInsight === id || (activeInsight === null && index === 0) ? 0 : -1}
                  onClick={() => selectInsight(id)}
                  onKeyDown={event => {
                    let nextIndex;
                    if (event.key === 'ArrowRight') nextIndex = (index + 1) % insightTabs.length;
                    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + insightTabs.length) % insightTabs.length;
                    else if (event.key === 'Home') nextIndex = 0;
                    else if (event.key === 'End') nextIndex = insightTabs.length - 1;
                    else return;
                    event.preventDefault();
                    selectInsight(insightTabs[nextIndex].id);
                    document.getElementById(`results-tab-${insightTabs[nextIndex].id}`)?.focus();
                  }}>{label}</button>
              ))}
            </div>
            <p className="results-explore__hint">{activeInsight === 'overlap'
              ? 'See which papers your queries share. Select a count to inspect the overlap.'
              : activeInsight === 'topics'
                ? 'Find related papers on the map. Select a dot to see a paper and its nearest matches.'
                : queryResults.length === 3
                  ? 'Browse the papers below, compare your queries, or explore related papers on a map.'
                  : 'Browse the papers below or explore related papers on a map.'}</p>
            <div id="results-workspace" role={results.length > 0 && activeInsight ? 'tabpanel' : undefined}
              aria-labelledby={results.length > 0 && activeInsight ? `results-tab-${activeInsight}` : undefined}
              tabIndex={results.length > 0 && activeInsight ? 0 : undefined}>
              {queryResults.length === 3 && openedInsights.overlap && (
                <div className="results-insights" hidden={activeInsight !== 'overlap'}>
                  <QueryOverlap queries={queryResults} />
                </div>
              )}
              {openedInsights.topics && results.length > 0 && (
                <div className="results-insights" hidden={activeInsight !== 'topics'}>
                  <TopicMap key={results.map(paper => paper.paperId).join(',')} papers={results} queries={queryResults} isMock={isMockResultsEnabled} />
                </div>
              )}
            </div>
          </section>
        )}
        {results.length > 0 && (
          <button className="results-overview__toggle" type="button"
            aria-expanded={isInsightsExpanded} aria-controls="results-insights-section"
            onClick={() => {
              if (!isInsightsExpanded && !activeInsight) selectInsight(insightTabs[0].id);
              setIsInsightsExpanded(expanded => !expanded);
            }}>
            <span>{isInsightsExpanded ? 'Hide insights' : 'Show insights'}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d={isInsightsExpanded ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
            </svg>
          </button>
        )}
      </div>
      <section className="results-papers" aria-label="Papers">
        {results.length === 0 && (
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
                <h3>{paper.url ? <a href={paper.url} target="_blank" rel="noreferrer">{paper.title}</a> : paper.title}</h3>
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
    </section>
  );
}
