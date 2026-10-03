import { Paper, useSearch } from '../context/SearchContext';

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

export default function Export() {
  const { results, isSearching, hasSuccessfulSearch } = useSearch();
  const disabled = isSearching || results.length === 0;

  if (!hasSuccessfulSearch || isSearching) return null;

  return (
    <div className="results-export" aria-label="Download search results">
      <span className="results-export__label">Download results</span>
      <button
        className="secondary-button"
        type="button"
        disabled={disabled}
        onClick={() => downloadFile(JSON.stringify(results, null, 2), 'application/json;charset=utf-8', 'search-results.json')}
      >
        JSON
      </button>
      <button
        className="secondary-button"
        type="button"
        disabled={disabled}
        onClick={() => downloadFile(toCsv(results), 'text/csv;charset=utf-8', 'search-results.csv')}
      >
        CSV
      </button>
    </div>
  );
}
