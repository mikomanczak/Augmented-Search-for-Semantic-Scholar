import { CSSProperties, FormEvent, PointerEvent, useRef, useState } from 'react';
import { PUBLICATION_TYPES, useSearch } from '../context/SearchContext';
import HighlightedQueryEditor, { validateQuery } from './HighlightedQueryEditor';
import InfoIcon from './InfoIcon';
import QuerySyntaxHelp from './QuerySyntaxHelp';

export default function InputForm({ onSearch, isSearching }: { onSearch: () => void; isSearching: boolean }) {
  const [editorWidth, setEditorWidth] = useState(62);
  const [syntaxHelpCollapsed, setSyntaxHelpCollapsed] = useState(false);
  const queriesContentRef = useRef<HTMLDivElement>(null);
  const {
    keywordText,
    setKeywordText,
    keywordCount,
    resultsPerKeyword,
    setResultsPerKeyword,
    startYear,
    setStartYear,
    endYear,
    setEndYear,
    openAccessOnly,
    setOpenAccessOnly,
    minCitations,
    setMinCitations,
    publicationTypes,
    togglePublicationType,
    maxKeywords,
  } = useSearch();
  const validationError = validateQuery(keywordText);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validationError) onSearch();
  };

  const resizeEditor = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = queriesContentRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const percent = ((event.clientX - bounds.left) / bounds.width) * 100;
    const nextWidth = Math.min(97, Math.max(30, percent));
    setEditorWidth(nextWidth);
    if (bounds.right - event.clientX <= 84) setSyntaxHelpCollapsed(true);
  };

  const handleResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeEditor(event);
  };

  return (
    <form className="input-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <section className="card queries-card" aria-labelledby="queries-heading">
          <h2 className="card-heading" id="queries-heading">Queries</h2>
          <label className="field-label" htmlFor="keywords">
            Enter queries to search for (one per line) <InfoIcon />
          </label>
          <div
            className="queries-content"
            ref={queriesContentRef}
            style={{ '--editor-width': `${editorWidth}%` } as CSSProperties}
          >
            <HighlightedQueryEditor
              id="keywords"
              value={keywordText}
              onChange={setKeywordText}
              placeholder={`Enter up to ${maxKeywords} queries`}
            />
            <div
              className="queries-splitter"
              role="separator"
              aria-label="Resize query editor and syntax help"
              aria-orientation="vertical"
              aria-valuemin={30}
              aria-valuemax={85}
              aria-valuenow={Math.round(editorWidth)}
              tabIndex={0}
              onPointerDown={handleResizeStart}
              onPointerMove={event => event.buttons === 1 && resizeEditor(event)}
              onPointerUp={resizeEditor}
              onKeyDown={event => {
                if (event.key === 'ArrowLeft') setEditorWidth(width => Math.max(30, width - 2));
                if (event.key === 'ArrowRight') {
                  setEditorWidth(width => {
                    const nextWidth = Math.min(97, width + 2);
                    if (event.currentTarget.parentElement?.getBoundingClientRect().width * (1 - nextWidth / 100) <= 84) {
                      setSyntaxHelpCollapsed(true);
                    }
                    return nextWidth;
                  });
                }
              }}
            />
            <QuerySyntaxHelp
              isCollapsed={syntaxHelpCollapsed}
              onDragExpand={clientX => {
                const bounds = queriesContentRef.current?.getBoundingClientRect();
                if (!bounds) return;
                const remainingWidth = bounds.right - clientX;
                if (remainingWidth <= 84) {
                  setSyntaxHelpCollapsed(true);
                  return;
                }
                const percent = ((clientX - bounds.left) / bounds.width) * 100;
                setEditorWidth(Math.min(97, Math.max(30, percent)));
                setSyntaxHelpCollapsed(false);
              }}
              onCollapsedChange={collapsed => {
                if (!collapsed) setEditorWidth(width => Math.min(width, 85));
                setSyntaxHelpCollapsed(collapsed);
              }}
            />
          </div>
          {validationError && (
            <p className="query-validation" role="alert">
              Line {validationError.line}: {validationError.message}
            </p>
          )}
          <p className="keyword-count" aria-live="polite">
            {keywordCount} / {maxKeywords} queries
          </p>
        </section>

        <section className="card settings-card" aria-labelledby="settings-heading">
          <h2 className="card-heading" id="settings-heading">Search settings</h2>

          <div className="filter-group">
            <label className="field-label" htmlFor="results-per-keyword">
              Max results per query
            </label>
            <input
              id="results-per-keyword"
              type="number"
              min="1"
              max="100"
              step="1"
              inputMode="numeric"
              value={resultsPerKeyword}
              onChange={event => setResultsPerKeyword(event.target.value)}
              placeholder="50"
            />
          </div>

          <fieldset className="filter-group year-fieldset">
            <legend>Year range (optional)</legend>
            <div className="year-range">
              <input
                type="number"
                min="1900"
                max="2100"
                aria-label="Start year"
                value={startYear}
                onChange={event => setStartYear(event.target.value)}
                placeholder="From"
              />
              <span aria-hidden="true">–</span>
              <input
                type="number"
                min="1900"
                max="2100"
                aria-label="End year"
                value={endYear}
                onChange={event => setEndYear(event.target.value)}
                placeholder="To"
              />
            </div>
          </fieldset>

          <div className="filter-group">
            <label className="field-label" htmlFor="min-citations">
              Minimum number of citations (optional)
            </label>
            <input
              id="min-citations"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={minCitations}
              onChange={event => setMinCitations(event.target.value)}
              placeholder="Any"
            />
          </div>

          <fieldset className="filter-group publication-types-fieldset">
            <legend>Publication type (optional)</legend>
            <div className="publication-types">
              {PUBLICATION_TYPES.map(type => {
                const selected = publicationTypes.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    className={`chip${selected ? ' chip--enabled' : ' chip--disabled'}`}
                    onClick={() => togglePublicationType(type)}
                  >
                    {type.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="filter-group toggle-row">
            <div>
              <span className="toggle-title">Open Access Only</span>
              <span className="toggle-description">
                Filter results to include only open access papers
              </span>
            </div>
            <button
              className={`toggle ${openAccessOnly ? 'toggle--on' : ''}`}
              type="button"
              role="switch"
              aria-checked={openAccessOnly}
              aria-label="Open access only"
              onClick={() => setOpenAccessOnly(value => !value)}
            >
              <span />
            </button>
          </div>
          <div className="submit-bar">
              <button className="primary-button" type="submit" disabled={keywordCount === 0 || !!validationError || isSearching}>
                <span className="search-icon" aria-hidden="true" />
                {isSearching ? 'Searching…' : 'Start Search'}
            </button>
          </div>
        </section>
      </div>


    </form>
  );
}
