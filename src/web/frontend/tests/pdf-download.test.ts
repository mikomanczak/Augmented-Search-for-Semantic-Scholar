import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { downloadPdfs, getPdfCandidates, type DownloadProgress } from '../src/lib/pdf-download.ts';

Object.assign(globalThis, { window: globalThis });
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const candidates = getPdfCandidates([
  { paperId: 'a', title: '../A: paper', year: 2025, openAccessPdf: { url: 'https://publisher.example/a.pdf#page=1' } },
  { paperId: 'b', title: 'B paper', openAccessPdf: { url: 'https://publisher.example/b.pdf' } },
  { paperId: 'c', title: 'C paper', openAccessPdf: { url: 'https://publisher.example/c.pdf' } },
]);

test('selects OA links and deduplicates IDs and URLs without fragments', () => {
  const result = getPdfCandidates([
    { paperId: 'a', title: 'A', openAccessPdf: { url: 'https://publisher.example/a.pdf#page=1' } },
    { paperId: 'b', title: 'Duplicate URL', openAccessPdf: { url: 'https://publisher.example/a.pdf' } },
    { paperId: 'a', title: 'Duplicate ID', openAccessPdf: { url: 'https://publisher.example/other.pdf' } },
    { paperId: 'c', title: 'No PDF' },
    { paperId: 'd', title: 'Empty URL', openAccessPdf: { url: '  ' } },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://publisher.example/a.pdf');
});

test('creates a readable ZIP with successful PDFs and a report for failures', async () => {
  const updates: DownloadProgress[] = [];
  globalThis.fetch = async input => {
    if (String(input).endsWith('/a.pdf')) return new Response('%PDF-1.4\nfixture\n%%EOF');
    if (String(input).endsWith('/b.pdf')) return new Response('<html>Landing page</html>');
    return new Response('Forbidden', { status: 403 });
  };
  const result = await downloadPdfs(candidates, { signal: new AbortController().signal, onProgress: value => updates.push(value) });
  const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  const filenames = Object.keys(archive).filter(name => name.endsWith('.pdf'));
  assert.equal(filenames.length, 1);
  assert.ok(!filenames[0].includes('/'));
  assert.match(strFromU8(archive[filenames[0]]), /^%PDF-/);
  const report = JSON.parse(strFromU8(archive['download-report.json']));
  assert.equal(report.downloaded, 1);
  assert.equal(report.failed, 2);
  assert.match(report.papers[1].reason, /non-PDF/);
  assert.match(report.papers[2].reason, /403/);
  assert.equal(updates.at(-1)?.completed, 3);
  assert.equal(updates.at(-1)?.packaging, true);
});

test('uses the configured proxy and preserves its error messages', async () => {
  globalThis.fetch = async (input, init) => {
    assert.equal(input, '/api/pdfs');
    assert.equal(init?.method, 'POST');
    assert.equal(JSON.parse(String(init?.body)).url, candidates[0].url);
    return Response.json({ error: 'Publisher download timed out.' }, { status: 502 });
  };
  const result = await downloadPdfs(candidates.slice(0, 1), {
    signal: new AbortController().signal, endpoint: '/api/pdfs', onProgress: () => {},
  });
  const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  assert.equal(Object.keys(archive).length, 1);
  const report = JSON.parse(strFromU8(archive['download-report.json']));
  assert.equal(report.papers[0].reason, 'Publisher download timed out.');
  assert.equal(result.downloaded, 0);
});

test('reports blocked browser downloads and oversized responses', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  let result = await downloadPdfs(candidates.slice(0, 1), { signal: new AbortController().signal, onProgress: () => {} });
  let archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  assert.match(JSON.parse(strFromU8(archive['download-report.json'])).papers[0].reason, /CORS/);
  globalThis.fetch = async () => new Response('%PDF-', { headers: { 'Content-Length': String(21 * 1024 * 1024) } });
  result = await downloadPdfs(candidates.slice(0, 1), { signal: new AbortController().signal, onProgress: () => {} });
  archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  assert.match(JSON.parse(strFromU8(archive['download-report.json'])).papers[0].reason, /20 MB/);
});

test('records resolved sources and failure attempts', async () => {
  const papers = getPdfCandidates([
    { paperId: 'a', title: 'A', openAccessPdf: { url: 'https://publisher.example/a.pdf' } },
    { paperId: 'b', title: 'B', openAccessPdf: { url: 'https://publisher.example/b.pdf' } },
  ]);
  const attempts = [{ url: papers[1].url, reason: 'Publisher returned HTTP 403.', upstreamStatus: 403 }];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.url === papers[0].url) {
      return new Response('%PDF-1.4\nfixture\n%%EOF', { headers: { 'X-Pdf-Source': encodeURIComponent('https://repo.example/a.pdf') } });
    }
    return Response.json({ error: 'Publisher returned HTTP 403.', attempts }, { status: 422 });
  };
  const result = await downloadPdfs(papers, {
    signal: new AbortController().signal, endpoint: '/api/pdfs', onProgress: () => {},
  });
  const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  const report = JSON.parse(strFromU8(archive['download-report.json']));
  assert.equal(report.papers[0].resolvedUrl, 'https://repo.example/a.pdf');
  assert.deepEqual(report.papers[1].attempts, attempts);
});

test('carries repository identifiers from search results to the backend and ZIP report', async () => {
  const ids = { DOI: '10.1234/test', ArXiv: '2403.13193', PubMedCentral: 'PMC123' };
  const papers = getPdfCandidates([
    { paperId: 'a', title: 'A', openAccessPdf: { url: 'https://publisher.example/a.pdf' }, externalIds: ids },
    { paperId: 'b', title: 'B', openAccessPdf: { url: 'https://publisher.example/b.pdf' }, externalIds: null },
  ]);
  assert.deepEqual(papers[0].externalIds, ids);
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.externalIds, body.url === papers[0].url ? ids : undefined);
    return new Response('%PDF-1.4\nfixture\n%%EOF', {
      headers: { 'X-Pdf-Source': encodeURIComponent('https://arxiv.org/pdf/2403.13193') },
    });
  };
  const result = await downloadPdfs(papers, { signal: new AbortController().signal, endpoint: '/api/pdfs', onProgress: () => {} });
  const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  const report = JSON.parse(strFromU8(archive['download-report.json']));
  assert.deepEqual(report.papers[0].externalIds, ids);
  assert.equal(report.papers[0].resolvedUrl, 'https://arxiv.org/pdf/2403.13193');
});

test('cancels active fetches without producing an archive', async () => {
  let started = 0;
  let aborted = 0;
  const controller = new AbortController();
  globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
    started++;
    init?.signal?.addEventListener('abort', () => { aborted++; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    if (started === 3) queueMicrotask(() => controller.abort());
  });
  await assert.rejects(downloadPdfs(candidates, { signal: controller.signal, onProgress: () => {} }), /abort/i);
  assert.equal(started, 3);
  assert.equal(aborted, 3);
});

test('limits concurrency to three and handles streamed oversized files', async () => {
  let active = 0;
  let maximumActive = 0;
  globalThis.fetch = async () => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('%PDF-'));
        stream.enqueue(new Uint8Array(20 * 1024 * 1024));
        stream.close();
      },
    }));
  };
  const result = await downloadPdfs([...candidates, ...candidates], { signal: new AbortController().signal, onProgress: () => {} });
  assert.equal(maximumActive, 3);
  assert.equal(result.downloaded, 0);
  assert.equal(result.failed, 6);
  const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  const report = JSON.parse(strFromU8(archive['download-report.json']));
  assert.match(report.papers[5].reason, /100 MB/);
});
