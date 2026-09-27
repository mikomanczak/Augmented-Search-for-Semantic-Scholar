import { useSearch } from '../context/SearchContext';

export default function Results({ onBack }: { onBack: () => void }) {
  const { keywords, results, isSearching, searchError } = useSearch();

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
      {searchError && <p className="results-error" role="alert">{searchError}</p>}
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
