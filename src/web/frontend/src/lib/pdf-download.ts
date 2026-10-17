import { strToU8, Zip, ZipPassThrough } from 'fflate';
import type { Paper } from '../context/SearchContext';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const CONCURRENCY = 3;

export type PdfCandidate = { paperId: string; title: string; year?: number | null; url: string; externalIds?: NonNullable<Paper['externalIds']> };
export type DownloadProgress = { completed: number; total: number; downloaded: number; failed: number; packaging: boolean };
type DownloadAttempt = { url: string; reason: string; upstreamStatus?: number };
export type DownloadRecord = PdfCandidate & { status: 'downloaded' | 'failed'; filename?: string; reason?: string; resolvedUrl?: string; attempts?: DownloadAttempt[] };

export function getPdfCandidates(papers: Paper[]): PdfCandidate[] {
  const seenUrls = new Set<string>();
  const seenIds = new Set<string>();
  return papers.flatMap(paper => {
    let url = paper.openAccessPdf?.url?.trim();
    if (!url) return [];
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      url = parsed.href;
    } catch { /* Include invalid links so the report explains their failure. */ }
    if (seenUrls.has(url) || seenIds.has(paper.paperId)) return [];
    seenUrls.add(url);
    seenIds.add(paper.paperId);
    return [{ paperId: paper.paperId, title: paper.title, year: paper.year, url,
      ...(paper.externalIds ? { externalIds: {
        DOI: paper.externalIds.DOI, ArXiv: paper.externalIds.ArXiv, PubMedCentral: paper.externalIds.PubMedCentral,
      } } : {}),
    }];
  });
}

function pdfFilename(paper: PdfCandidate, index: number): string {
  const title = paper.title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').trim().slice(0, 100) || 'paper';
  return `${String(index + 1).padStart(3, '0')}-${paper.year ? `${paper.year}-` : ''}${title}.pdf`;
}

export async function downloadPdfs(
  papers: PdfCandidate[],
  options: { signal: AbortSignal; endpoint?: string; onProgress: (progress: DownloadProgress) => void },
): Promise<{ blob: Blob; downloaded: number; failed: number }> {
  const { signal, endpoint, onProgress } = options;
  // Store completed ZIP chunks as browser-managed Blobs rather than retaining
  // every PDF and then allocating another contiguous buffer for the whole ZIP.
  const parts: Blob[] = [];
  let archiveError: Error | null = null;
  const archive = new Zip((error, chunk) => {
    if (error) archiveError = error;
    else parts.push(new Blob([chunk as Uint8Array<ArrayBuffer>]));
  });
  function addFile(filename: string, bytes: Uint8Array) {
    signal.throwIfAborted();
    const file = new ZipPassThrough(filename);
    archive.add(file);
    file.push(bytes, true);
    if (archiveError) throw archiveError;
  }
  const records: DownloadRecord[] = new Array(papers.length);
  let nextIndex = 0;
  let completed = 0;
  let downloaded = 0;
  const progress = (packaging = false) => onProgress({ completed, total: papers.length, downloaded, failed: completed - downloaded, packaging });
  progress();

  async function worker() {
    while (nextIndex < papers.length && !signal.aborted) {
      const index = nextIndex++;
      const paper = papers[index];
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      const timeout = window.setTimeout(() => controller.abort(new Error('Download timed out.')), 30_000);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let attempts: DownloadAttempt[] | undefined;
      try {
        let url: URL;
        try { url = new URL(paper.url); }
        catch { throw new Error('Invalid PDF URL.'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
          throw new Error('Invalid or unsupported PDF URL.');
        }
        const response = await fetch(endpoint || url.href, {
          signal: controller.signal,
          credentials: 'omit',
          ...(endpoint ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url.href, externalIds: paper.externalIds }),
          } : {}),
        });
        if (!response.ok) {
          const detail = endpoint ? await response.json().catch(() => null) as { error?: string; attempts?: DownloadAttempt[] } | null : null;
          attempts = detail?.attempts;
          throw new Error(detail?.error ?? `Publisher returned HTTP ${response.status}.`);
        }
        if (Number(response.headers.get('content-length')) > MAX_FILE_BYTES) throw new Error('PDF exceeds the 20 MB file limit.');
        if (!response.body) throw new Error('The publisher returned an empty file.');
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        let signature = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_FILE_BYTES) throw new Error('PDF exceeds the 20 MB file limit.');
          for (let i = 0; i < value.length && signature.length < 5; i++) signature += String.fromCharCode(value[i]);
          if (signature.length === 5 && signature !== '%PDF-') throw new Error('The link returned a webpage or another non-PDF file.');
          chunks.push(value);
        }
        controller.signal.throwIfAborted();
        if (signature !== '%PDF-') throw new Error('The publisher returned an empty or non-PDF file.');
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const filename = pdfFilename(paper, index);
        addFile(filename, bytes);
        let resolvedUrl = paper.url;
        try { resolvedUrl = decodeURIComponent(response.headers.get('X-Pdf-Source') ?? '') || response.url || paper.url; }
        catch { /* Retain the original URL if a source header is malformed. */ }
        records[index] = { ...paper, status: 'downloaded', filename, resolvedUrl };
        downloaded++;
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        const reason = controller.signal.aborted ? 'Download timed out.'
          : error instanceof TypeError ? (endpoint
            ? 'Could not reach the PDF service. Check that it is running and allows this website.'
            : 'Could not fetch this PDF. The publisher may block browser downloads (CORS).')
          : error instanceof Error ? error.message : 'Download failed.';
        records[index] = { ...paper, status: 'failed', reason, ...(attempts ? { attempts } : {}) };
      } finally {
        await reader?.cancel().catch(() => {});
        controller.abort();
        window.clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
      }
      completed++;
      progress();
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, papers.length) }, worker));
  signal.throwIfAborted();
  addFile('download-report.json', strToU8(JSON.stringify({
    createdAt: new Date().toISOString(),
    total: papers.length,
    downloaded,
    failed: papers.length - downloaded,
    papers: records,
  }, null, 2)));
  progress(true);
  archive.end();
  if (archiveError) throw archiveError;
  signal.throwIfAborted();
  return { blob: new Blob(parts, { type: 'application/zip' }), downloaded, failed: papers.length - downloaded };
}
