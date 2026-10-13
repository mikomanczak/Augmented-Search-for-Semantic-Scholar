import { strToU8, zip, type Zippable } from 'fflate';
import type { Paper } from '../context/SearchContext';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_BYTES = 100 * 1024 * 1024;
const CONCURRENCY = 3;

export type PdfCandidate = { paperId: string; title: string; year?: number | null; url: string };
export type DownloadProgress = { completed: number; total: number; downloaded: number; failed: number; packaging: boolean };
export type DownloadRecord = PdfCandidate & { status: 'downloaded' | 'failed'; filename?: string; reason?: string };

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
    return [{ paperId: paper.paperId, title: paper.title, year: paper.year, url }];
  });
}

function pdfFilename(paper: PdfCandidate, index: number): string {
  const title = paper.title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').trim().slice(0, 100) || 'paper';
  return `${String(index + 1).padStart(3, '0')}-${paper.year ? `${paper.year}-` : ''}${title}.pdf`;
}

function makeZip(files: Zippable, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancel = () => { terminate(); reject(signal.reason); };
    const terminate = zip(files, { level: 0 }, (error, data) => {
      signal.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve(data);
    });
    signal.addEventListener('abort', cancel, { once: true });
  });
}

export async function downloadPdfs(
  papers: PdfCandidate[],
  options: { signal: AbortSignal; endpoint?: string; onProgress: (progress: DownloadProgress) => void },
): Promise<{ blob: Blob; downloaded: number; failed: number }> {
  const { signal, endpoint, onProgress } = options;
  const files: Zippable = Object.create(null);
  const records: DownloadRecord[] = new Array(papers.length);
  let nextIndex = 0;
  let completed = 0;
  let downloaded = 0;
  let batchBytes = 0;
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
      try {
        let url: URL;
        try { url = new URL(paper.url); }
        catch { throw new Error('Invalid PDF URL.'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
          throw new Error('Invalid or unsupported PDF URL.');
        }
        if (batchBytes >= MAX_BATCH_BYTES) throw new Error('The 100 MB batch limit was reached.');
        const response = await fetch(endpoint || url.href, {
          signal: controller.signal,
          credentials: 'omit',
          ...(endpoint ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url.href }),
          } : {}),
        });
        if (!response.ok) {
          const detail = endpoint ? await response.json().catch(() => null) as { error?: string } | null : null;
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
          batchBytes += value.length;
          if (batchBytes > MAX_BATCH_BYTES) throw new Error('The 100 MB batch limit was reached.');
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
        files[filename] = bytes;
        records[index] = { ...paper, status: 'downloaded', filename };
        downloaded++;
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        const reason = controller.signal.aborted ? 'Download timed out.'
          : error instanceof TypeError ? (endpoint
            ? 'Could not reach the PDF service. Check that it is running and allows this website.'
            : 'Could not fetch this PDF. The publisher may block browser downloads (CORS).')
          : error instanceof Error ? error.message : 'Download failed.';
        records[index] = { ...paper, status: 'failed', reason };
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
  files['download-report.json'] = strToU8(JSON.stringify({
    createdAt: new Date().toISOString(),
    total: papers.length,
    downloaded,
    failed: papers.length - downloaded,
    papers: records,
  }, null, 2));
  progress(true);
  const archive = await makeZip(files, signal);
  signal.throwIfAborted();
  return { blob: new Blob([archive as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), downloaded, failed: papers.length - downloaded };
}
