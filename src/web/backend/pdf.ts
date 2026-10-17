import { lookup } from 'node:dns/promises';
import { request as httpRequest, IncomingMessage, ClientRequest, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export class PdfError extends Error {
  constructor(message: string, public status = 422, public upstreamStatus?: number, public retryAfterMs?: number) { super(message); }
}

export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; }
  catch { return false; }
}

type Dependencies = {
  resolve: (hostname: string) => Promise<{ address: string; family: number }[]>;
  request: (url: URL, options: RequestOptions) => ClientRequest;
};

const defaults: Dependencies = {
  resolve: hostname => lookup(hostname, { all: true }),
  request: (url, options) => (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, options),
};

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function fetchResource(rawUrl: string, signal: AbortSignal, dependencies = defaults,
  mode: 'pdf' | 'document' | 'json' = 'pdf'): Promise<{ bytes: Buffer; url: string }> {
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw new PdfError('Invalid PDF URL.', 400); }

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    signal.throwIfAborted();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))) {
      throw new PdfError('Only public HTTP(S) URLs on standard ports are allowed.', 400);
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await withAbort(dependencies.resolve(hostname), signal);
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(target => !isPublicAddress(target.address))) {
      throw new PdfError('Private or reserved network destinations are not allowed.', 400);
    }
    const target = addresses.find(address => address.family === 4) ?? addresses[0];
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = dependencies.request(url, {
        signal,
        agent: false,
        family: target.family,
        // Pin the connection to the address we checked, including after redirects.
        lookup: (_host, _options, callback) => callback(null, target.address, target.family),
        headers: {
          'User-Agent': 'AugmentedSearch-PDFDownloader/1.0',
          Accept: mode === 'json' ? 'application/json' : 'application/pdf, text/html;q=0.9, application/octet-stream;q=0.8',
          'Accept-Encoding': 'identity',
        },
      });
      request.on('error', reject);
      request.on('response', resolve);
      request.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      response.destroy();
      if (!response.headers.location || redirects === MAX_REDIRECTS) {
        throw new PdfError('The publisher returned too many or invalid redirects.');
      }
      try { url = new URL(response.headers.location, url); }
      catch { throw new PdfError('The publisher returned an invalid redirect.'); }
      continue;
    }
    if (response.statusCode !== 200) {
      response.destroy();
      const retryAfter = response.headers['retry-after'];
      let retryAfterMs: number | undefined;
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const parsed = /^\d+(?:\.\d+)?$/.test(retryAfter) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(parsed)) retryAfterMs = Math.max(0, parsed);
      }
      throw new PdfError(`Publisher returned HTTP ${response.statusCode ?? 'error'}.`, 422, response.statusCode, retryAfterMs);
    }
    if (Number(response.headers['content-length']) > MAX_PDF_BYTES) {
      response.destroy();
      throw new PdfError('PDF exceeds the 20 MB file limit.');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of response) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_PDF_BYTES) throw new PdfError('PDF exceeds the 20 MB file limit.');
        chunks.push(bytes);
        const isPdf = size >= 5 && Buffer.concat(chunks, Math.min(size, 5)).toString('ascii', 0, 5) === '%PDF-';
        if (mode !== 'pdf' && !isPdf && size > 2 * 1024 * 1024) {
          throw new PdfError('Article metadata exceeds the 2 MB limit.');
        }
        if (mode === 'pdf' && size >= 5 && !isPdf) {
          throw new PdfError('The link returned a webpage or another non-PDF file.');
        }
      }
    } finally { response.destroy(); }
    const pdf = Buffer.concat(chunks, size);
    if (mode === 'pdf' && pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new PdfError('The link returned an empty or non-PDF file.');
    }
    return { bytes: pdf, url: url.href };
  }
  throw new PdfError('Too many redirects.');
}

export async function fetchPdf(rawUrl: string, signal: AbortSignal, dependencies = defaults): Promise<Buffer> {
  return (await fetchResource(rawUrl, signal, dependencies)).bytes;
}
