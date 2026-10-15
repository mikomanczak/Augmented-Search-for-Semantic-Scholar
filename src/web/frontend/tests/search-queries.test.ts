import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { searchQueries, SearchError, type SearchProgress, type FetchedPaper } from '../src/lib/search-queries.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const paper = (paperId: string) => ({ paperId, title: paperId });
const response = (ids: string[]) => Response.json({ data: ids.map(paper) });

test('searches each query with the same filters and waits for all responses before returning deduplicated results', async () => {
  const queries = ['battery + electric', 'BEV | "electric cars"'];
  const filters = new URLSearchParams({ limit: '50', fields: 'paperId,title', publicationDateOrYear: '2010:2024', fieldsOfStudy: 'Engineering', minCitationCount: '5', publicationTypes: 'Review', openAccessPdf: 'true' });
  const calls: string[] = [];
  let finishLast!: (value: Response) => void;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.searchParams.get('query')!);
    for (const [name, value] of filters) assert.equal(url.searchParams.get(name), value);
    assert.deepEqual(init?.headers, { 'x-api-key': 'test-key' });
    return calls.length === 1 ? response(['shared', 'first']) : new Promise(resolve => { finishLast = resolve; });
  };
  let completed = false;
  const progress: SearchProgress[] = [];
  const fetchedPapers: FetchedPaper[][] = [];
  const pending = searchQueries(queries, filters, 'test-key', undefined, update => progress.push(update), papers => fetchedPapers.push(papers)).then(result => { completed = true; return result; });
  await flush();
  assert.deepEqual(calls, queries);
  assert.equal(completed, false);
  assert.deepEqual(fetchedPapers, [['shared', 'first'].map(paper)]);
  assert.deepEqual(progress, [
    { completed: 0, total: 2, currentQuery: queries[0] },
    { completed: 1, total: 2, currentQuery: null },
    { completed: 1, total: 2, currentQuery: queries[1] },
  ]);
  finishLast(response(['shared', 'second']));
  const result = await pending;
  assert.deepEqual(progress.at(-1), { completed: 2, total: 2, currentQuery: null });
  assert.deepEqual(result.queryResults, [
    { query: queries[0], papers: ['shared', 'first'].map(paper) },
    { query: queries[1], papers: ['shared', 'second'].map(paper) },
  ]);
  assert.deepEqual(result.results.map(p => p.paperId), ['shared', 'first', 'second']);
  assert.deepEqual(fetchedPapers.at(-1), ['shared', 'first', 'second'].map(paper));
  assert.equal(filters.has('query'), false);
});

test('a later failed query rejects the entire search without returning partial results', async () => {
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? response(['first']) : new Response('', { status: 500 });
  await assert.rejects(searchQueries(['first', 'failed', 'unreached'], new URLSearchParams()), error => error instanceof SearchError && error.status === 500);
  assert.equal(calls, 2);
});

test('waits through retries for one query before starting the next', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: string[] = [];
  globalThis.fetch = async input => {
    calls.push(new URL(String(input)).searchParams.get('query')!);
    return calls.length === 1 ? new Response('', { status: 429 }) : response([]);
  };
  const completedQueries: SearchProgress[] = [];
  const progress: unknown[] = [];
  const pending = searchQueries(['first', 'second'], new URLSearchParams(), undefined, update => progress.push(update), update => completedQueries.push(update));
  await flush();
  assert.deepEqual(calls, ['first']);
  assert.deepEqual(completedQueries, [{ completed: 0, total: 2, currentQuery: 'first' }]);
  t.mock.timers.tick(1000);
  const result = await pending;
  assert.deepEqual(calls, ['first', 'first', 'second']);
  assert.equal(progress.length, 3);
  assert.deepEqual(completedQueries.map(update => update.completed), [0, 1, 1, 2]);
  assert.deepEqual(result.queryResults, [{ query: 'first', papers: [] }, { query: 'second', papers: [] }]);
  assert.deepEqual(result.results, []);
});

test('malformed responses fail instead of being accepted as successful empty searches', async () => {
  for (const payload of [{}, { data: null }, { data: {} }]) {
    globalThis.fetch = async () => Response.json(payload);
    const progress: SearchProgress[] = [];
    await assert.rejects(searchQueries(['query'], new URLSearchParams(), undefined, undefined, update => progress.push(update)), /invalid search results/);
    assert.deepEqual(progress.map(update => update.completed), [0]);
  }
});

test('cancelling aborts the active request and never starts later queries', async () => {
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    assert.equal(init?.signal, controller.signal);
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    });
  };
  const pending = searchQueries(['first', 'unreached'], new URLSearchParams(), undefined, undefined, undefined, undefined, controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(calls, 1);
});

test('cancelling during a retry wait prevents further requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('', { status: 429 }); };
  const pending = searchQueries(['first', 'unreached'], new URLSearchParams(), undefined, undefined, undefined, undefined, controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await flush();
  controller.abort();
  await rejected;
  t.mock.timers.tick(60_000);
  assert.equal(calls, 1);
});

test('cancelling while parsing a response prevents stale paper and progress updates', async () => {
  const controller = new AbortController();
  let finishJson!: (value: unknown) => void;
  globalThis.fetch = async () => {
    const result = response(['first']);
    result.json = () => new Promise(resolve => { finishJson = resolve; });
    return result;
  };
  const papers: FetchedPaper[][] = [];
  const progress: SearchProgress[] = [];
  const pending = searchQueries(['first', 'unreached'], new URLSearchParams(), undefined, undefined,
    update => progress.push(update), update => papers.push(update), controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await flush();
  controller.abort();
  finishJson({ data: [paper('first')] });
  await rejected;
  assert.deepEqual(papers, []);
  assert.deepEqual(progress.map(update => update.completed), [0]);
});
