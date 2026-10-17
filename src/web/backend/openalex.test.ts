import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openAlexSources, lookupOpenAlex } from './openalex';
import { fetchResource } from './pdf';
import { PdfError } from './pdf';
import { resolvePdf } from './resolve-pdf';

test('uses only exact-DOI open-access locations and tries PDFs before landing pages', () => {
  const work = { doi: 'https://doi.org/10.1234/TEST', locations: [
    { is_oa: true, pdf_url: null, landing_page_url: 'https://repo.example/item/1', version: 'acceptedVersion', license: 'cc-by' },
    { is_oa: false, pdf_url: 'https://publisher.example/closed.pdf' },
    { is_oa: true, pdf_url: 'https://repo.example/paper.pdf#page=1', landing_page_url: 'https://repo.example/paper.pdf', source: { display_name: 'University repository' } },
    { is_oa: true, pdf_url: 'javascript:alert(1)', landing_page_url: 'https://user:pass@example.org/file' },
  ] };
  const sources = openAlexSources(work, '10.1234/test');
  assert.deepEqual(sources.map(source => source.url), ['https://repo.example/paper.pdf', 'https://repo.example/item/1']);
  assert.equal(sources[0].source, 'University repository');
  assert.equal(sources[1].version, 'acceptedVersion');
  assert.deepEqual(openAlexSources(work, '10.1234/other'), []);
});

test('lookup encodes the DOI filter and refuses unrelated records', async () => {
  const load: typeof fetchResource = async url => {
    assert.equal(new URL(url).searchParams.get('filter'), 'doi:https://doi.org/10.1234/test');
    return { url, bytes: Buffer.from(JSON.stringify({ results: [{ id: 'https://openalex.org/W123', doi: 'https://doi.org/10.1234/test', locations: [{ is_oa: true, pdf_url: 'https://repo.example/paper.pdf' }] }] })) };
  };
  assert.equal((await lookupOpenAlex('10.1234/test', new AbortController().signal, load)).sources.length, 1);
  const unrelated: typeof fetchResource = async url => ({ url, bytes: Buffer.from(JSON.stringify({ results: [{ doi: '10.1234/unrelated', locations: [{ is_oa: true, pdf_url: 'https://repo.example/wrong.pdf' }] }] })) });
  assert.deepEqual((await lookupOpenAlex('10.1234/test', new AbortController().signal, unrelated)).sources, []);
});

test('malformed metadata and locations without explicit open-access status produce no candidates', () => {
  for (const value of [null, [], {}, { doi: '10.1234/test', locations: [null, false, 'invalid', { pdf_url: 'https://repo.example/unknown.pdf' }] }]) {
    assert.deepEqual(openAlexSources(value, '10.1234/test'), []);
  }
});

test('normal downloader uses OpenAlex after publisher and PMC fail, skipping already attempted URLs', async () => {
  const original = 'https://publisher.example/article.pdf';
  const calls: string[] = [];
  const load: typeof fetchResource = async url => {
    calls.push(url);
    if (url === original) throw new PdfError('Publisher returned HTTP 403.', 422, 403);
    if (url.includes('pmc.ncbi.nlm.nih.gov')) return { url, bytes: Buffer.from('{"records":[]}') };
    if (url.includes('api.openalex.org')) return { url, bytes: Buffer.from(JSON.stringify({ results: [{
      doi: 'https://doi.org/10.1234/test', locations: [
        { is_oa: true, pdf_url: original }, { is_oa: true, pdf_url: 'https://repo.example/paper.pdf' },
      ],
    }] })) };
    return { url, bytes: Buffer.from('%PDF-1.4\nfixture\n%%EOF') };
  };
  const result = await resolvePdf(original, new AbortController().signal, { load, externalIds: { DOI: '10.1234/test' } });
  assert.equal(result.url, 'https://repo.example/paper.pdf');
  assert.equal(calls.filter(url => url === original).length, 1);
  assert.equal(calls.length, 4);
});

test('OpenAlex source URLs retain private-network checks and the six-source budget', async () => {
  for (const privateTarget of [true, false]) {
    let sources = 0;
    const load: typeof fetchResource = async (url, signal) => {
      if (url.includes('pmc.ncbi.nlm.nih.gov')) return { url, bytes: Buffer.from('{"records":[]}') };
      if (url.includes('api.openalex.org')) return { url, bytes: Buffer.from(JSON.stringify({ results: [{
        doi: '10.1234/test', locations: Array.from({ length: 20 }, (_, index) => ({
          is_oa: true, pdf_url: privateTarget ? `http://127.0.0.1/${index}` : `https://repo.example/${index}.pdf`,
        })),
      }] })) };
      sources++;
      if (url.startsWith('http://127.0.0.1')) return fetchResource(url, signal);
      throw new PdfError('Publisher returned HTTP 403.', 422, 403);
    };
    await assert.rejects(resolvePdf('https://publisher.example/article.pdf', new AbortController().signal, {
      load, externalIds: { DOI: '10.1234/test' },
    }), privateTarget ? /Private or reserved/ : /HTTP 403/);
    assert.equal(sources, 6);
  }
});

test('caller cancellation interrupts OpenAlex metadata lookup', async () => {
  const controller = new AbortController();
  const load: typeof fetchResource = async (url, signal) => {
    if (url.includes('pmc.ncbi.nlm.nih.gov')) return { url, bytes: Buffer.from('{"records":[]}') };
    if (url.includes('api.openalex.org')) { controller.abort(); signal.throwIfAborted(); }
    throw new PdfError('Publisher returned HTTP 403.', 422, 403);
  };
  await assert.rejects(resolvePdf('https://publisher.example/article.pdf', controller.signal, {
    load, externalIds: { DOI: '10.1234/test' },
  }), /abort/i);
});
