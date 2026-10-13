import { Paper, useSearch } from '../context/SearchContext';
import { useEffect, useRef, useState } from 'react';
import { downloadPdfs, getPdfCandidates, type DownloadProgress } from '../lib/pdf-download';

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
  const downloadController = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloadMessage, setDownloadMessage] = useState('');
  const pdfCandidates = getPdfCandidates(exportResults);
  const pdfEndpoint = import.meta.env.VITE_PDF_API_URL?.trim() || (import.meta.env.DEV ? '/api/pdfs' : undefined);
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
    try {
      const result = await downloadPdfs(pdfCandidates, {
        signal: controller.signal,
        endpoint: pdfEndpoint,
        onProgress: setProgress,
      });
      if (controller.signal.aborted) return;
      saveBlob(result.blob, 'open-access-pdfs.zip');
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
        onClick={() => { setDownloadMessage(''); dialogRef.current?.showModal(); }}
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
            <p>{exportResults.length} {exportResults.length === 1 ? 'paper' : 'papers'} in these search results.</p>
          </div>
          <button className="results-export__close" type="button" aria-label="Close export dialog"
            disabled={isDownloading} onClick={closeDialog}>×</button>
        </div>
        <div className="results-export__formats">
          <button type="button" disabled={isDownloading} onClick={() => handleExport('csv')}>Download CSV</button>
          <button type="button" disabled={isDownloading} onClick={() => handleExport('json')}>Download JSON</button>
        </div>
        <div className="results-export__pdfs">
          <button className="results-export__pdf-button" type="button"
            disabled={isDownloading || pdfCandidates.length === 0} onClick={() => void handlePdfDownload()}>
            Download open access PDFs (.zip)
          </button>
          <p>{pdfCandidates.length} unique open access {pdfCandidates.length === 1 ? 'link' : 'links'} available. Up to 20 MB per PDF and 100 MB per batch.</p>
          {!pdfEndpoint && <p>Some publishers block browser downloads. Unavailable PDFs will be listed in the ZIP report.</p>}
          {progress && (
            <div className="results-export__progress">
              <progress aria-label="PDF download progress" value={progress.completed} max={progress.total} />
              <p role="status">{progress.packaging ? 'Preparing ZIP…' : `${progress.completed} of ${progress.total} checked · ${progress.downloaded} downloaded · ${progress.failed} failed`}</p>
              <button type="button" onClick={() => downloadController.current?.abort()}>Cancel download</button>
            </div>
          )}
          {downloadMessage && <p className="results-export__status" role="status">{downloadMessage}</p>}
        </div>
      </dialog>
    </div>
  );
}
