import { setTimeout as delay } from 'node:timers/promises';
import { fetchResource, PdfError } from './pdf';
import { articleLinks } from './article-links';
export { articleLinks } from './article-links';
import { hasRepositoryIdentifiers, repositorySources, type PaperIdentifiers } from './repository-sources';
import { lookupOpenAlex, normalizeDoi } from './openalex';

export type DownloadAttempt = { url: string; reason: string; upstreamStatus?: number };
export class ResolutionError extends PdfError {
  constructor(public attempts: DownloadAttempt[]) {
    super(attempts[attempts.length - 1]?.reason ?? 'No downloadable PDF was found.');
  }
}

export async function resolvePdf(
  originalUrl: string, signal: AbortSignal,
  options: { load?: typeof fetchResource; externalIds?: PaperIdentifiers; openAlex?: boolean } = {},
): Promise<{ bytes: Buffer; url: string; attempts: DownloadAttempt[] }> {
  const load = options.load ?? fetchResource;
  const attempts: DownloadAttempt[] = [];
  const seen = new Set<string>();
  let requests = 0;
  async function trySources(initialUrls: string[], limit: number) {
    const queue = [...initialUrls];
    const start = requests;
    while (requests - start < limit) {
      signal.throwIfAborted();
      if (!queue.length) break;
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      requests++;
      const requestSignal = signal;
      try {
        let result;
        try {
          result = await load(url, requestSignal, undefined, 'document');
        } catch (error) {
          // Retry temporary responses once; never repeat persistent access refusals.
          if (!(error instanceof PdfError) || ![202, 429, 502, 503, 504].includes(error.upstreamStatus ?? 0)) throw error;
          if ((error.retryAfterMs ?? 0) > 2_000) throw error;
          attempts.push({ url, reason: `${error.message} Retrying once.`, upstreamStatus: error.upstreamStatus });
          await delay(error.retryAfterMs ?? 500, undefined, { signal: requestSignal });
          result = await load(url, requestSignal, undefined, 'document');
        }
        if (result.bytes.subarray(0, 5).toString('ascii') === '%PDF-') return { ...result, attempts };
        const links = articleLinks(result.bytes.toString('utf8'), result.url);
        queue.unshift(...links.urls.filter(link => !seen.has(link)));
        attempts.push({ url, reason: links.urls.length
          ? 'Article page found; following its PDF links.'
          : 'The link returned a webpage or another non-PDF file without a PDF link.' });
      } catch (error) {
        signal.throwIfAborted();
        // Preserve validation errors for the original URL.
        if (requests === 1 && error instanceof PdfError && error.status === 400) throw error;
        attempts.push({ url, reason: requestSignal.aborted ? 'Source download timed out.'
          : error instanceof Error ? error.message : 'Source download failed.',
          ...(error instanceof PdfError && error.upstreamStatus ? { upstreamStatus: error.upstreamStatus } : {}) });
      }
    }
    return undefined;
  }
  const ids = options.externalIds ?? {};
  // Reserve source attempts for repositories rather than exhausting all six on
  // links from a publisher page that has already failed to return a PDF.
  const original = await trySources([originalUrl], hasRepositoryIdentifiers(ids) ? 3 : 6);
  if (original) return original;
  const fallbacks = repositorySources(ids, signal, load, attempts);
  while (requests < 6) {
    signal.throwIfAborted();
    const source = await fallbacks.next();
    if (source.done) break;
    const result = await trySources([source.value], 6 - requests);
    if (result) return result;
  }
  const doi = normalizeDoi(ids.DOI);
  if (doi && requests < 6 && options.openAlex !== false) {
    let sources;
    const lookupUrl = 'https://api.openalex.org/works';
    try {
      sources = (await lookupOpenAlex(doi, AbortSignal.any([signal, AbortSignal.timeout(5_000)]), load)).sources;
      if (!sources.length) attempts.push({ url: lookupUrl, reason: 'OpenAlex found no matching open-access locations.' });
    } catch (error) {
      signal.throwIfAborted();
      attempts.push({ url: lookupUrl, reason: `OpenAlex lookup failed: ${error instanceof Error ? error.message : 'Unavailable.'}` });
    }
    for (const source of sources ?? []) {
      if (requests >= 6) break;
      if (seen.has(source.url)) continue;
      const result = await trySources([source.url], 6 - requests);
      if (result) return result;
    }
  }
  throw new ResolutionError(attempts);
}
