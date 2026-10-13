import { Paper, useSearch } from '../context/SearchContext';
import { useRef } from 'react';

const CSV_COLUMNS = [
  'paperId',
  'title',
  'abstract',
  'year',
  'authors',
  'venue',
  'citationCount',
  'url',
  'openAccessPdfUrl',
] as const;

function downloadFile(content: string, type: string, filename: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function escapeCsvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(papers: Paper[]): string {
  const rows = papers.map(paper => [
    paper.paperId,
    paper.title,
    paper.abstract,
    paper.year,
    paper.authors?.map(author => author.name).join('; '),
    paper.venue,
    paper.citationCount,
    paper.url,
    paper.openAccessPdf?.url,
  ]);

  // The BOM helps spreadsheet apps recognize UTF-8 text such as author names.
  return `\uFEFF${[
    CSV_COLUMNS.join(','),
    ...rows.map(row => row.map(escapeCsvCell).join(',')),
  ].join('\r\n')}`;
}

export default function Export({ papers }: { papers?: Paper[] }) {
  const { results, isSearching, hasSuccessfulSearch } = useSearch();
  const exportResults = papers ?? results;
  const disabled = isSearching || exportResults.length === 0;
  const dialogRef = useRef<HTMLDialogElement>(null);

  function handleExport(format: string) {
    if (format === 'json') {
      downloadFile(JSON.stringify(exportResults, null, 2), 'application/json;charset=utf-8', 'search-results.json');
    } else if (format === 'csv') {
      downloadFile(toCsv(exportResults), 'text/csv;charset=utf-8', 'search-results.csv');
    }
    dialogRef.current?.close();
  }

  if (!hasSuccessfulSearch || isSearching) return null;

  return (
    <div className="results-export">
      <button
        className="results-export__button"
        type="button"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => dialogRef.current?.showModal()}
      >
        <svg className="results-export__icon" aria-hidden="true" viewBox="0 0 20 20" fill="none">
          <path d="M10 2.75v9.5m0 0 3.5-3.5M10 12.25l-3.5-3.5M3.75 13.25v3h12.5v-3" />
        </svg>
        Download
      </button>
      <dialog
        className="results-export__dialog"
        ref={dialogRef}
        aria-labelledby="results-export-title"
        onClick={event => {
          if (event.target === dialogRef.current) dialogRef.current.close();
        }}
      >
        <div className="results-export__dialog-header">
          <div>
            <h2 id="results-export-title">Export search results</h2>
            <p>{exportResults.length} {exportResults.length === 1 ? 'paper' : 'papers'} will be exported.</p>
          </div>
          <button className="results-export__close" type="button" aria-label="Close export dialog"
            onClick={() => dialogRef.current?.close()}>×</button>
        </div>
        <div className="results-export__formats">
          <button type="button" onClick={() => handleExport('csv')}>Download CSV</button>
          <button type="button" onClick={() => handleExport('json')}>Download JSON</button>
        </div>
      </dialog>
    </div>
  );
}
