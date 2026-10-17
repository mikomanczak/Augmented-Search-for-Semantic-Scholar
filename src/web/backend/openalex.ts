import { fetchResource, PdfError } from './pdf';
import { setTimeout as delay } from 'node:timers/promises';

export type OpenAlexSource = { url: string; kind: 'pdf' | 'landing'; version: string | null; license: string | null; source: string | null };
type Lookup = { workId?: string; sources: OpenAlexSource[]; cachedPdf?: string };
const cache = new Map<string, { expires: number; result: Lookup }>();
let nextLookupAt = 0;

export function normalizeDoi(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const doi = value.trim().replace(/^(?:doi:|https?:\/\/(?:dx\.)?doi\.org\/)/i, '').toLowerCase();
  return /^10\.\d{4,9}\/[^\s<>"?#]+$/.test(doi) && doi.length <= 512 ? doi : undefined;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function openAlexSources(work: unknown, requestedDoi: string): OpenAlexSource[] {
  const record = object(work);
  const doi = normalizeDoi(requestedDoi);
  if (!doi || normalizeDoi(record.doi) !== doi) return [];
  const locations = Array.isArray(record.locations) ? record.locations.map(object) : [];
  const result = new Map<string, OpenAlexSource>();
  // Try direct PDFs before landing pages, preserving metadata for the chosen copy.
  for (const kind of ['pdf', 'landing'] as const) {
    for (const location of locations) {
      if (location.is_oa !== true) continue;
      const value = location[kind === 'pdf' ? 'pdf_url' : 'landing_page_url'];
      if (typeof value !== 'string' || value.length > 4096) continue;
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
        url.hash = '';
        if (result.has(url.href)) continue;
        const source = object(location.source);
        result.set(url.href, { url: url.href, kind,
          version: typeof location.version === 'string' ? location.version : null,
          license: typeof location.license === 'string' ? location.license : null,
          source: typeof source.display_name === 'string' ? source.display_name : null,
        });
      } catch { /* Invalid URLs are not download candidates. */ }
    }
  }
  return [...result.values()];
}

export async function lookupOpenAlex(doi: string, signal: AbortSignal, load = fetchResource): Promise<Lookup> {
  const normalized = normalizeDoi(doi);
  if (!normalized) return { sources: [] };
  signal.throwIfAborted();
  if (load === fetchResource) {
    const saved = cache.get(normalized);
    if (saved && saved.expires > Date.now()) return saved.result;
    const scheduled = Math.max(Date.now(), nextLookupAt);
    nextLookupAt = scheduled + 200;
    if (scheduled > Date.now()) await delay(scheduled - Date.now(), undefined, { signal });
  }
  const url = new URL('https://api.openalex.org/works');
  url.search = new URLSearchParams({ filter: `doi:https://doi.org/${normalized}`, select: 'id,doi,locations,has_content,content_urls', per_page: '1' }).toString();
  const result = await load(url.href, signal, undefined, 'json');
  const data = object(JSON.parse(result.bytes.toString('utf8')));
  const work = Array.isArray(data.results) ? data.results.find(value => normalizeDoi(object(value).doi) === normalized) : undefined;
  const lookup = { cachedPdf: openAlexCachedPdf(work, normalized), workId: typeof object(work).id === 'string' ? object(work).id as string : undefined, sources: openAlexSources(work, normalized) };
  if (load === fetchResource) {
    if (cache.size >= 256) cache.delete(cache.keys().next().value!);
    cache.set(normalized, { expires: Date.now() + 60 * 60 * 1000, result: lookup });
  }
  return lookup;
}

export function openAlexCachedPdf(work: unknown, requestedDoi: string): string | undefined {
  const record = object(work);
  const doi = normalizeDoi(requestedDoi);
  if (!doi || normalizeDoi(record.doi) !== doi || object(record.has_content).pdf !== true) return;
  const id = typeof record.id === 'string' ? /^https:\/\/openalex\.org\/(W\d+)$/.exec(record.id)?.[1] : undefined;
  if (!id) return;
  const canonical = `https://content.openalex.org/works/${id}.pdf`;
  return object(record.content_urls).pdf === canonical ? canonical : undefined;
}

// Keep credentials out of source headers, download reports, and error messages.
export async function fetchOpenAlexCachedPdf(url: string, key: string, signal: AbortSignal, load = fetchResource) {
  if (!/^https:\/\/content\.openalex\.org\/works\/W\d+\.pdf$/.test(url)) throw new PdfError('Invalid OpenAlex content URL.');
  const authenticated = new URL(url);
  authenticated.searchParams.set('api_key', key);
  try {
    const result = await load(authenticated.href, signal, undefined, 'pdf');
    if (result.bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Invalid PDF');
    return { bytes: result.bytes, url };
  } catch (error) {
    signal.throwIfAborted();
    throw new PdfError('OpenAlex cached PDF download failed.', 422, error instanceof PdfError ? error.upstreamStatus : undefined);
  }
}
