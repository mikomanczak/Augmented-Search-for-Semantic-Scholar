import { setTimeout as delay } from 'node:timers/promises';
import { fetchResource, PdfError } from './pdf';
import { hasRepositoryIdentifiers, repositorySources, type PaperIdentifiers } from './repository-sources';

export type DownloadAttempt = { url: string; reason: string; upstreamStatus?: number };
export class ResolutionError extends PdfError {
  constructor(public attempts: DownloadAttempt[]) {
    super(attempts[attempts.length - 1]?.reason ?? 'No downloadable PDF was found.');
  }
}

function decodeAttribute(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const code = entity.slice(2, -1);
    const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  });
}

// Read explicit scholarly metadata and PDF links, never execute page scripts.
export function articleLinks(html: string, pageUrl: string): { urls: string[] } {
  const urls: string[] = [];
  const document = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  for (const tag of document.match(/<(?:meta|link|a)\b[^>]*>/gi) ?? []) {
    const attributes: Record<string, string> = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes[match[1].toLowerCase()] = decodeAttribute(match[2] ?? match[3] ?? match[4]);
    }
    const name = (attributes.name ?? attributes.property ?? '').toLowerCase();
    const href = name === 'citation_pdf_url' ? attributes.content
      : attributes.type?.toLowerCase() === 'application/pdf' || /\.pdf(?:$|[?#])/i.test(attributes.href ?? '')
        ? attributes.href : undefined;
    if (!href) continue;
    try {
      const url = new URL(href, pageUrl);
      url.hash = '';
      if (['http:', 'https:'].includes(url.protocol)) urls.push(url.href);
    } catch { /* Ignore malformed metadata links. */ }
  }
  return { urls: [...new Set(urls)].slice(0, 4) };
}

export async function resolvePdf(
  originalUrl: string, signal: AbortSignal,
  options: { load?: typeof fetchResource; externalIds?: PaperIdentifiers } = {},
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
  throw new ResolutionError(attempts);
}
