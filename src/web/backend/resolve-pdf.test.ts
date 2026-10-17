import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleLinks, resolvePdf, ResolutionError } from './resolve-pdf';
import { fetchResource, PdfError } from './pdf';

const pdf = Buffer.from('%PDF-1.4\nfixture\n%%EOF');

test('extracts explicit PDF links, relative URLs, and entities', () => {
  assert.deepEqual(articleLinks(`
    <!-- <meta name="citation_pdf_url" content="/comment.pdf"> -->
    <script>const fake = '<a href="/fake.pdf">';</script>
    <meta content="/download?a=1&amp;b=2" name="citation_pdf_url">
    <a href='/file.pdf'>PDF</a><a href='/unrelated'>Other article</a>
    <link type="application/pdf" href="https://repo.example/fulltext">
  `, 'https://publisher.example/article'), {
    urls: ['https://publisher.example/download?a=1&b=2', 'https://publisher.example/file.pdf', 'https://repo.example/fulltext'],
  });
});

test('resolves landing pages and retains the final PDF source', async () => {
  const calls: string[] = [];
  const load: typeof fetchResource = async url => {
    calls.push(url);
    return url.endsWith('/file.pdf') ? { bytes: pdf, url: 'https://cdn.example/file.pdf' }
      : { bytes: Buffer.from('<meta name="citation_pdf_url" content="/file.pdf">'), url: 'https://publisher.example/article' };
  };
  const result = await resolvePdf('https://doi.org/10.1234/test', new AbortController().signal, { load });
  assert.deepEqual(result.bytes, pdf);
  assert.equal(result.url, 'https://cdn.example/file.pdf');
  assert.deepEqual(calls, ['https://doi.org/10.1234/test', 'https://publisher.example/file.pdf']);
});

test('does not retry access refusals and reports attempted sources', async () => {
  let calls = 0;
  const load: typeof fetchResource = async () => { calls++; throw new PdfError('Publisher returned HTTP 403.', 422, 403); };
  await assert.rejects(resolvePdf('https://publisher.example/paper.pdf', new AbortController().signal, { load }), error => {
    assert.ok(error instanceof ResolutionError);
    assert.equal(error.attempts[0].upstreamStatus, 403);
    return true;
  });
  assert.equal(calls, 1);
});

test('retries temporary upstream responses once', async () => {
  let calls = 0;
  const load: typeof fetchResource = async url => {
    if (++calls === 1) throw new PdfError('Publisher returned HTTP 503.', 422, 503);
    return { bytes: pdf, url };
  };
  assert.deepEqual((await resolvePdf('https://publisher.example/paper.pdf', new AbortController().signal, { load })).bytes, pdf);
  assert.equal(calls, 2);
});

test('bounds discovery, skips duplicate links and rejects private metadata targets', async () => {
  let calls = 0;
  const load: typeof fetchResource = async url => {
    calls++;
    return { bytes: Buffer.from(`<meta name="citation_pdf_url" content="/page${calls}"><a href="${url}">Self</a>`), url };
  };
  await assert.rejects(resolvePdf('https://publisher.example/start', new AbortController().signal, { load }), ResolutionError);
  assert.equal(calls, 6);
  const privateLink: typeof fetchResource = async (url, signal) => {
    if (url.startsWith('https://publisher.example')) return {
      bytes: Buffer.from('<meta name="citation_pdf_url" content="http://127.0.0.1/private.pdf">'), url,
    };
    return fetchResource(url, signal);
  };
  await assert.rejects(resolvePdf('https://publisher.example/start', new AbortController().signal, { load: privateLink }), /Private or reserved/);
});

test('does not retry earlier than a long publisher Retry-After', async () => {
  let calls = 0;
  const load: typeof fetchResource = async () => {
    calls++;
    throw new PdfError('Publisher returned HTTP 429.', 422, 429, 60_000);
  };
  await assert.rejects(resolvePdf('https://publisher.example/paper.pdf', new AbortController().signal, { load }), /429/);
  assert.equal(calls, 1);
});

test('cancellation prevents follow-up source requests', async () => {
  const controller = new AbortController();
  const load: typeof fetchResource = async () => { controller.abort(); throw controller.signal.reason; };
  await assert.rejects(resolvePdf('https://doi.org/10.1234/test', controller.signal, { load }), /abort/i);
});
