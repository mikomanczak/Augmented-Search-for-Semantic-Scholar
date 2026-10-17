import { fetchResource, PdfError } from './pdf';
import type { DownloadAttempt } from './resolve-pdf';

export type PaperIdentifiers = { DOI?: string | null; ArXiv?: string | null; PubMedCentral?: string | null };
const PMC_BUCKET = 'https://pmc-oa-opendata.s3.amazonaws.com';

export function readIdentifiers(value: unknown): PaperIdentifiers {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new PdfError('Provide an externalIds object.', 400);
  const result: PaperIdentifiers = {};
  for (const key of ['DOI', 'ArXiv', 'PubMedCentral'] as const) {
    const id = (value as Record<string, unknown>)[key];
    if (id !== undefined && id !== null && (typeof id !== 'string' || id.length > 512)) {
      throw new PdfError(`Provide a valid ${key} identifier.`, 400);
    }
    if (typeof id === 'string') result[key] = id.trim();
  }
  return result;
}

function arxivId(value?: string | null): string | undefined {
  const id = value?.trim().replace(/^arxiv:/i, '');
  return id && /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v[1-9]\d*)?$/.test(id) ? id : undefined;
}

function pmcId(value?: string | null): string | undefined {
  const id = value?.trim().replace(/^PMC/i, '');
  return id && /^[1-9]\d*$/.test(id) ? `PMC${id}` : undefined;
}

function doiId(value?: string | null): string | undefined {
  const id = value?.trim().replace(/^(?:doi:|https?:\/\/(?:dx\.)?doi\.org\/)/i, '');
  return id && /^10\.\d{4,9}\/[^\s<>"#?]+$/i.test(id) ? id : undefined;
}

export function hasRepositoryIdentifiers(ids: PaperIdentifiers): boolean {
  return Boolean(arxivId(ids.ArXiv) || pmcId(ids.PubMedCentral) || doiId(ids.DOI));
}

// Lazily resolve matching repositories only after the publisher attempt fails.
// PMC uses the supported Cloud Service, never scraped PMC article pages.
export async function* repositorySources(
  ids: PaperIdentifiers, signal: AbortSignal, load: typeof fetchResource, attempts: DownloadAttempt[],
): AsyncGenerator<string> {
  const arxiv = arxivId(ids.ArXiv);
  if (arxiv) yield `https://arxiv.org/pdf/${arxiv}`;
  let pmcid = pmcId(ids.PubMedCentral);
  const doi = doiId(ids.DOI);

  async function metadata(url: string): Promise<Buffer | undefined> {
    signal.throwIfAborted();
    try {
      const result = await load(url, AbortSignal.any([signal, AbortSignal.timeout(5_000)]), undefined, 'document');
      return result.bytes;
    } catch (error) {
      signal.throwIfAborted();
      attempts.push({ url, reason: error instanceof Error ? error.message : 'Repository lookup failed.' });
      return undefined;
    }
  }

  if (!pmcid && doi) {
    const url = new URL('https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/');
    url.search = new URLSearchParams({ ids: doi, idtype: 'doi', format: 'json', tool: 'AugmentedSearch' }).toString();
    const bytes = await metadata(url.href);
    if (bytes) {
      try {
        const response = JSON.parse(bytes.toString('utf8'));
        const record = Array.isArray(response.records) && response.records.find((record: { doi?: string }) =>
          typeof record?.doi === 'string' && record.doi.toLowerCase() === doi.toLowerCase());
        pmcid = record && record.live !== false && record.live !== 'false' ? pmcId(record.pmcid) : undefined;
        attempts.push({ url: url.href, reason: pmcid ? `Matching PMC record found: ${pmcid}.` : 'No available PMC record matches this DOI.' });
      } catch {
        attempts.push({ url: url.href, reason: 'PMC identifier lookup returned invalid metadata.' });
      }
    }
  }
  if (!pmcid) return;

  // List only this article's metadata, then use pdf_url to avoid supplementary PDFs.
  // A .1 version is not guaranteed to exist, so discover versions instead of guessing.
  const listing = new URL(PMC_BUCKET);
  listing.search = new URLSearchParams({ 'list-type': '2', prefix: `metadata/${pmcid}.`, 'max-keys': '20' }).toString();
  const bytes = await metadata(listing.href);
  if (!bytes) return;
  const keys = [...bytes.toString('utf8').matchAll(/<Key>(metadata\/PMC[1-9]\d*\.([1-9]\d*)\.json)<\/Key>/g)]
    .filter(match => match[1].startsWith(`metadata/${pmcid}.`))
    .sort((a, b) => Number(a[2]) - Number(b[2]));
  if (!keys.length) attempts.push({ url: listing.href, reason: 'This article is not in the public PMC dataset.' });
  for (const match of keys.slice(0, 2)) {
    const url = `${PMC_BUCKET}/${match[1]}`;
    const data = await metadata(url);
    if (!data) continue;
    try {
      const article = JSON.parse(data.toString('utf8'));
      if (pmcId(String(article.pmcid)) !== pmcid || typeof article.pdf_url !== 'string') {
        attempts.push({ url, reason: 'No matching article PDF is available in this PMC version.' });
        continue;
      }
      let pdf = new URL(article.pdf_url);
      if (pdf.protocol === 's3:' && pdf.hostname === 'pmc-oa-opendata' && !pdf.port && !pdf.username && !pdf.password) {
        pdf = new URL(`${PMC_BUCKET}${pdf.pathname}${pdf.search}`);
      }
      const version = match[1].slice('metadata/'.length, -'.json'.length);
      if (pdf.origin !== PMC_BUCKET || !pdf.pathname.startsWith(`/${version}/`) || !pdf.pathname.endsWith('.pdf') || pdf.username || pdf.password) {
        throw new Error('Unexpected PMC PDF location.');
      }
      attempts.push({ url, reason: 'Matching article PDF found in the NLM PubMed Central dataset.' });
      yield pdf.href;
    } catch {
      attempts.push({ url, reason: 'PMC returned invalid article metadata.' });
    }
  }
}
