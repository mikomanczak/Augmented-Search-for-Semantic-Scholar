import { Paper, useSearch } from '../context/SearchContext';
import { useEffect, useId, useRef, useState } from 'react';
import { downloadPdfs, getPdfCandidates, type DownloadProgress } from '../lib/pdf-download';
import { toBibtex } from '../lib/bibtex';

const CSV_COLUMNS = [
  'paperId',
  'title',
  'abstract',
  'year',
  'authors',
  'venue',
  'publicationTypes',
  'citationCount',
  'url',
  'openAccessPdfUrl',
] as const;

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function downloadFile(content: string, type: string, filename: string) {
  saveBlob(new Blob([content], { type }), filename);
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
    paper.publicationTypes?.join('; '),
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

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export default function Export({ papers }: { papers?: Paper[] }) {
  const { results, queryResults, isSearching, hasSuccessfulSearch } = useSearch();
  const mergedResults = papers ?? results;
  const [selection, setSelection] = useState('merged');
  const [format, setFormat] = useState('csv');
  const selectionId = useId();
  const selectedQuery = selection === 'merged' ? undefined : queryResults[Number(selection)];
  const exportResults = selection === 'merged' ? mergedResults : selectedQuery?.papers ?? [];
  const filenamePrefix = selection === 'merged' ? '' : `query-${Number(selection) + 1}-`;
  const [pdfSelection, setPdfSelection] = useState('merged');
  const pdfQuery = pdfSelection === 'merged' ? undefined : queryResults[Number(pdfSelection)];
  const pdfResults = pdfSelection === 'merged' ? mergedResults : pdfQuery?.papers ?? [];
  const pdfCandidates = getPdfCandidates(pdfResults);
  const pdfPreviewFiles = pdfCandidates.length > 3
    ? ['paper1.pdf', 'paper2.pdf', '....', `paper${pdfCandidates.length}.pdf`]
    : Array.from({ length: pdfCandidates.length }, (_, index) => `paper${index + 1}.pdf`);
  const pdfFilenamePrefix = pdfSelection === 'merged' ? '' : `query-${Number(pdfSelection) + 1}-`;
  const disabled = isSearching || mergedResults.length === 0;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const downloadController = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloadMessage, setDownloadMessage] = useState('');
  const pdfEndpoint = import.meta.env.VITE_PDF_API_URL?.trim() || (import.meta.env.DEV
    ? '/api/pdfs'
    : 'https://augmented-search-for-semantic-scholar.onrender.com/api/pdfs');
  const isDownloading = progress !== null;

  useEffect(() => () => downloadController.current?.abort(), []);

  function closeDialog() {
    if (!downloadController.current) dialogRef.current?.close();
  }

  async function handlePdfDownload() {
    if (downloadController.current || !pdfCandidates.length) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloadMessage('');
    setProgress({ completed: 0, total: pdfCandidates.length, downloaded: 0, failed: 0, packaging: false });
    try {
      const result = await downloadPdfs(pdfCandidates, {
        signal: controller.signal,
        endpoint: pdfEndpoint,
        onProgress: setProgress,
      });
      if (controller.signal.aborted) return;
      saveBlob(result.blob, `${pdfFilenamePrefix}open-access-pdfs.zip`);
      setDownloadMessage(result.downloaded === 0
        ? 'No PDFs could be downloaded. The ZIP contains a report explaining each failure.'
        : `${result.downloaded} ${result.downloaded === 1 ? 'PDF' : 'PDFs'} downloaded${result.failed ? `; ${result.failed} failed` : ''}. A download report is included in the ZIP.`);
    } catch (error) {
      setDownloadMessage(controller.signal.aborted
        ? 'Download cancelled. No ZIP was saved.'
        : error instanceof Error ? error.message : 'Could not create the PDF archive.');
    } finally {
      downloadController.current = null;
      setProgress(null);
    }
  }

  function handleExport(format: string, exportResults: Paper[], filenamePrefix: string) {
    if (format === 'json') {
      downloadFile(JSON.stringify(exportResults, null, 2), 'application/json;charset=utf-8', `${filenamePrefix}search-results.json`);
    } else if (format === 'csv') {
      downloadFile(toCsv(exportResults), 'text/csv;charset=utf-8', `${filenamePrefix}search-results.csv`);
    } else if (format === 'bibtex') {
      downloadFile(toBibtex(exportResults), 'application/x-bibtex;charset=utf-8', `${filenamePrefix}search-results.bib`);
    }
    dialogRef.current?.close();
  }

  function renderDownloads(exportResults: Paper[], filenamePrefix: string) {
    return (
      <div className="results-export__downloads">
        <div className="results-export__formats">
          <select id={`${selectionId}-format`} aria-label="Results export format"
            value={format} disabled={isDownloading || exportResults.length === 0}
            onChange={event => setFormat(event.target.value)}>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="bibtex">BibTeX</option>
          </select>
          <button type="button" disabled={isDownloading || exportResults.length === 0}
            onClick={() => handleExport(format, exportResults, filenamePrefix)}>
            <svg className="results-export__icon" aria-hidden="true" viewBox="0 0 20 20" fill="none">
              <path d="M10 2.75v9.5m0 0 3.5-3.5M10 12.25l-3.5-3.5M3.75 13.25v3h12.5v-3" />
            </svg>
            Download metadata
          </button>
        </div>
      </div>
    );
  }

  if (!hasSuccessfulSearch || isSearching) return null;

  return (
    <div className="results-export">
      <button
        className="results-export__button"
        type="button"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => { setSelection('merged'); setDownloadMessage(''); setPdfSelection('merged'); dialogRef.current?.showModal(); }}
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
        onCancel={event => { if (downloadController.current) event.preventDefault(); }}
        onClick={event => {
          if (event.target === dialogRef.current) closeDialog();
        }}
      >
        <div className="results-export__dialog-header">
          <div>
            <h2 id="results-export-title">Export search results</h2>
          </div>
          <button className="results-export__close" type="button" aria-label="Close export dialog"
            disabled={isDownloading} onClick={closeDialog}>×</button>
        </div>
        <div className="results-export__sections">
          <section className="results-export__section" aria-labelledby={`${selectionId}-query`}>
            <h3 id={`${selectionId}-query`}>Paper metadata</h3>
            <div>
              <p className="results-export__description">Titles, authors, abstracts, and links</p>
              <pre className="results-export__preview" aria-label={`Example ${format.toUpperCase()} metadata for a dummy paper`}><code>{format === 'json'
                ? '{\n  "title": "Example paper",\n  "year": 2024,\n  "authors": [{"name": "John Doe"}]\n}'
                : format === 'bibtex'
                  ? toBibtex([{ paperId: 'example', title: 'Example paper', authors: [{ name: 'John Doe' }], publicationTypes: ['JournalArticle'], venue: 'Example Journal' }])
                : 'title,year,authors\nExample paper,2024,John Doe'}</code></pre>
            </div>
            <div className="results-export__selection">
              <select id={selectionId} aria-label="Metadata query" value={selection} disabled={isDownloading}
                onChange={event => { setSelection(event.target.value); }}>
                <option value="merged">All queries ({countLabel(mergedResults.length, 'paper')})</option>
                {queryResults.map((result, index) => (
                  <option key={index} value={String(index)}>
                    {result.query} ({countLabel(result.papers.length, 'paper')})
                  </option>
                ))}
              </select>
            </div>
            {renderDownloads(exportResults, filenamePrefix)}
          </section>
          <section className="results-export__section results-export__section--pdfs" aria-labelledby={`${selectionId}-pdfs`}>
            <h3 id={`${selectionId}-pdfs`}>Full-text PDFs</h3>
            <div>
              <p className="results-export__description">Available open access articles</p>
              <div className="results-export__preview results-export__preview--pdf" role="img" aria-label={`Example ZIP folder open-access-pdfs.zip containing ${countLabel(pdfCandidates.length, 'PDF')}`}>
                <div className="results-export__zip-name">
                  <svg className="results-export__file-icon" aria-hidden="true" viewBox="0 0 20 20" fill="none">
                    <path d="M2 6V4a1 1 0 0 1 1-1h5l2 3h7a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6Z" />
                    <path d="M12 6v2m0 2v2m0 2v3m0-8h2m-2 4h2" />
                  </svg>
                  <span>open-access-pdfs.zip</span>
                </div>
                <ul className="results-export__zip-files" aria-hidden="true">
                  {pdfPreviewFiles.map(filename => (
                    <li key={filename}>
                      {filename === '....' ? <span className="results-export__file-icon" /> : <svg className="results-export__file-icon" viewBox="0 0 20 20" fill="none">
                        <path d="M11 2H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-5-5Z" />
                        <path d="M11 2v5h5M7 11h6M7 14h4" />
                      </svg>}
                      <span>{filename}</span>
                    </li>
                  ))}
                  {pdfCandidates.length === 0 && <li>No PDFs available</li>}
                </ul>
              </div>
            </div>
            <div className="results-export__selection">
              <select id={`${selectionId}-pdf-query`} aria-label="PDF queries" value={pdfSelection} disabled={isDownloading}
                onChange={event => { setPdfSelection(event.target.value); setDownloadMessage(''); }}>
                <option value="merged">All queries ({countLabel(getPdfCandidates(mergedResults).length, 'paper')})</option>
                {queryResults.map((result, index) => (
                  <option key={index} value={String(index)}>{result.query} ({countLabel(getPdfCandidates(result.papers).length, 'paper')})</option>
                ))}
              </select>
            </div>
            <div className="results-export__pdfs">
              <div className="results-export__formats">
                <div className="results-export__archive-format">ZIP archive</div>
                <button className="results-export__pdf-button" type="button"
                  disabled={isDownloading || pdfCandidates.length === 0} onClick={() => void handlePdfDownload()}>
                  <svg className="results-export__icon" aria-hidden="true" viewBox="0 0 20 20" fill="none">
                    <path d="M10 2.75v9.5m0 0 3.5-3.5M10 12.25l-3.5-3.5M3.75 13.25v3h12.5v-3" />
                  </svg>
                  Download PDFs
                </button>
              </div>
              {progress && (
                <div className="results-export__progress">
                  <progress aria-label="PDF download progress" value={progress.completed} max={progress.total} />
                  <p role="status">{progress.packaging ? 'Preparing ZIP…' : `${progress.completed} of ${progress.total} checked · ${progress.downloaded} downloaded · ${progress.failed} failed`}</p>
                  <button type="button" onClick={() => downloadController.current?.abort()}>Cancel download</button>
                </div>
              )}
              {downloadMessage && <p className="results-export__status" role="status">{downloadMessage}</p>}
            </div>
          </section>
        </div>
      </dialog>
    </div>
  );
}
