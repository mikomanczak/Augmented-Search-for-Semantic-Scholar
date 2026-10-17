import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchResource, PdfError } from './pdf';
import { resolvePdf, ResolutionError } from './resolve-pdf';
import { readIdentifiers } from './repository-sources';

const original = 'https://publisher.example/article.pdf';
const bucket = 'https://pmc-oa-opendata.s3.amazonaws.com';
const pdf = Buffer.from('%PDF-1.4\nrepository fixture\n%%EOF');
const signal = () => new AbortController().signal;
const refused = () => { throw new PdfError('Publisher returned HTTP 403.', 422, 403); };

test('publisher success performs no repository lookups', async () => {
  const calls: string[] = [];
  const load: typeof fetchResource = async url => { calls.push(url); return { bytes: pdf, url }; };
  await resolvePdf(original, signal(), { load, externalIds: { DOI: '10.1234/test', ArXiv: '2403.13193', PubMedCentral: '123' } });
  assert.deepEqual(calls, [original]);
});

test('publisher refusal falls back to modern and legacy arXiv identifiers', async () => {
  for (const id of ['2403.13193', 'arXiv:2403.13193v2', 'hep-th/9901001v2']) {
    const calls: string[] = [];
    const load: typeof fetchResource = async url => {
      calls.push(url);
      if (url === original) return refused();
      return { bytes: pdf, url };
    };
    const result = await resolvePdf(original, signal(), { load, externalIds: { ArXiv: id } });
    assert.equal(result.url, `https://arxiv.org/pdf/${id.replace(/^arxiv:/i, '')}`);
    assert.equal(calls.length, 2);
    assert.equal(result.attempts[0].upstreamStatus, 403);
  }
});

test('reserves attempts for arXiv when publisher pages keep advertising more links', async () => {
  const calls: string[] = [];
  const load: typeof fetchResource = async url => {
    calls.push(url);
    return { bytes: url.startsWith('https://arxiv.org/') ? pdf
      : Buffer.from(`<meta name="citation_pdf_url" content="/page${calls.length}">`), url };
  };
  const result = await resolvePdf(original, signal(), { load, externalIds: { ArXiv: '2403.13193' } });
  assert.equal(calls.length, 4);
  assert.equal(result.url, 'https://arxiv.org/pdf/2403.13193');
});

test('failed arXiv falls back to the matching PMC cloud PDF, including S3 URLs and missing version 1', async () => {
  for (const pmcid of ['123', 'PMC123']) {
    const calls: string[] = [];
    const load: typeof fetchResource = async url => {
      calls.push(url);
      if (url === original || url.startsWith('https://arxiv.org/')) return refused();
      if (url.startsWith(`${bucket}/?`)) {
        assert.equal(new URL(url).searchParams.get('prefix'), 'metadata/PMC123.');
        return { bytes: Buffer.from('<ListBucketResult><Contents><Key>metadata/PMC123.2.json</Key></Contents></ListBucketResult>'), url };
      }
      if (url.endsWith('.json')) return { bytes: Buffer.from(JSON.stringify({ pmcid: 'PMC123', pdf_url: 's3://pmc-oa-opendata/PMC123.2/article.pdf?md5=test' })), url };
      return { bytes: pdf, url };
    };
    const result = await resolvePdf(original, signal(), { load, externalIds: { ArXiv: '2403.13193', PubMedCentral: pmcid } });
    assert.equal(result.url, `${bucket}/PMC123.2/article.pdf?md5=test`);
    assert.deepEqual(calls.slice(-2), [`${bucket}/metadata/PMC123.2.json`, result.url]);
    assert.equal(calls.length, 5);
    assert.ok(!calls.some(url => url.includes('/articles/PMC')));
  }
});

test('DOI-only metadata resolves an exact available PMC record and its article PDF', async () => {
  const calls: string[] = [];
  const load: typeof fetchResource = async url => {
    calls.push(url);
    if (url === original) return refused();
    if (url.startsWith('https://pmc.ncbi.nlm.nih.gov/tools/idconv/')) {
      assert.equal(new URL(url).searchParams.get('ids'), '10.1234/test');
      return { bytes: Buffer.from(JSON.stringify({ records: [{ doi: '10.1234/test', pmcid: 'PMC123' }] })), url };
    }
    if (url.startsWith(`${bucket}/?`)) return { bytes: Buffer.from('<Key>metadata/PMC123.1.json</Key>'), url };
    if (url.endsWith('.json')) return { bytes: Buffer.from(JSON.stringify({ pmcid: 'PMC123', pdf_url: `${bucket}/PMC123.1/main.pdf` })), url };
    return { bytes: pdf, url };
  };
  const result = await resolvePdf(original, signal(), { load, externalIds: { DOI: 'https://doi.org/10.1234/test' } });
  assert.equal(result.url, `${bucket}/PMC123.1/main.pdf`);
  assert.equal(calls.length, 5);
});

test('unrelated or embargoed DOI records cannot supply a repository PDF', async () => {
  for (const record of [{ doi: '10.1234/other', pmcid: 'PMC123' }, { doi: '10.1234/test', pmcid: 'PMC123', live: false }]) {
    let calls = 0;
    const load: typeof fetchResource = async url => {
      calls++;
      if (url === original) return refused();
      return { bytes: Buffer.from(JSON.stringify({ records: [record] })), url };
    };
    await assert.rejects(resolvePdf(original, signal(), { load, externalIds: { DOI: '10.1234/test' } }), /No available PMC record/);
    assert.equal(calls, 2);
  }
});

test('PMC tries another version when the first metadata object has no article PDF', async () => {
  const calls: string[] = [];
  const load: typeof fetchResource = async url => {
    calls.push(url);
    if (url === original) return refused();
    if (url.startsWith(`${bucket}/?`)) return { bytes: Buffer.from('<Key>metadata/PMC123.1.json</Key><Key>metadata/PMC123.2.json</Key>'), url };
    if (url.endsWith('.1.json')) return { bytes: Buffer.from(JSON.stringify({ pmcid: 'PMC123', media_urls: [`${bucket}/PMC123.1/supplement.pdf`] })), url };
    if (url.endsWith('.2.json')) return { bytes: Buffer.from(JSON.stringify({ pmcid: 'PMC123', pdf_url: `${bucket}/PMC123.2/main.pdf` })), url };
    return { bytes: pdf, url };
  };
  assert.equal((await resolvePdf(original, signal(), { load, externalIds: { PubMedCentral: '123' } })).url, `${bucket}/PMC123.2/main.pdf`);
  assert.ok(!calls.some(url => url.includes('supplement.pdf')));
});

test('rejects injected identifiers and unrelated or private PMC PDF locations', async () => {
  for (const ids of [{ ArXiv: '../private' }, { PubMedCentral: '123/../../private' }, { DOI: 'not a DOI' }]) {
    let calls = 0;
    const load: typeof fetchResource = async () => { calls++; return refused(); };
    await assert.rejects(resolvePdf(original, signal(), { load, externalIds: ids }), ResolutionError);
    assert.equal(calls, 1);
  }
  for (const location of ['http://127.0.0.1/private.pdf', `${bucket}/PMC456.1/main.pdf`, 's3://another-bucket/PMC123.1/main.pdf']) {
    let calls = 0;
    const load: typeof fetchResource = async url => {
      calls++;
      if (url === original) return refused();
      return { bytes: Buffer.from(url.endsWith('.json') ? JSON.stringify({ pmcid: 'PMC123', pdf_url: location }) : '<Key>metadata/PMC123.1.json</Key>'), url };
    };
    await assert.rejects(resolvePdf(original, signal(), { load, externalIds: { PubMedCentral: '123' } }), /invalid article metadata/);
    assert.equal(calls, 3);
  }
  assert.throws(() => readIdentifiers({ ArXiv: [] }), /valid ArXiv/);
  assert.throws(() => readIdentifiers([]), /externalIds object/);
  assert.deepEqual(readIdentifiers({ DOI: ' 10.1234/test ', CorpusId: 123 }), { DOI: '10.1234/test' });
});

test('cancellation during a repository lookup prevents further requests', async () => {
  const controller = new AbortController();
  const load: typeof fetchResource = async (url, requestSignal) => {
    if (url === original) return refused();
    controller.abort();
    requestSignal.throwIfAborted();
    throw new Error('unreachable');
  };
  await assert.rejects(resolvePdf(original, controller.signal, { load, externalIds: { DOI: '10.1234/test' } }), /abort/i);
});
