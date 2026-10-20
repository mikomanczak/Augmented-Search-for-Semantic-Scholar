import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { searchQueries, SearchQueryCache, SearchError, type SearchProgress, type FetchedPaper } from '../src/lib/search-queries.ts';

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

const cachedSearch = (queries: string[], cache: SearchQueryCache, filters = new URLSearchParams()) =>
  searchQueries(queries, filters, undefined, undefined, undefined, undefined, undefined, cache);

test('editing and reordering queries reuses unchanged results, including empty results', async () => {
  const cache = new SearchQueryCache();
  const calls: string[] = [];
  globalThis.fetch = async input => {
    const query = new URL(String(input)).searchParams.get('query')!;
    calls.push(query);
    return response(query === 'empty' ? [] : [query, 'shared']);
  };
  await cachedSearch(['first', 'second', 'empty'], cache);
  const result = await cachedSearch(['empty', 'edited', 'first'], cache);
  assert.deepEqual(calls, ['first', 'second', 'empty', 'edited']);
  assert.deepEqual(result.queryResults.map(result => result.query), ['empty', 'edited', 'first']);
  assert.deepEqual(result.results.map(p => p.paperId), ['edited', 'shared', 'first']);
});

test('changed filters fetch fresh results and parameter order does not matter', async () => {
  const cache = new SearchQueryCache();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(['paper']); };
  await cachedSearch(['query'], cache, new URLSearchParams({ limit: '50', minCitationCount: '5' }));
  await cachedSearch(['query'], cache, new URLSearchParams({ minCitationCount: '5', limit: '50' }));
  assert.equal(calls, 1);
  await cachedSearch(['query'], cache, new URLSearchParams({ limit: '50', minCitationCount: '10' }));
  assert.equal(calls, 2);
});

test('completed queries survive a later failure while failures are fetched again', async () => {
  const cache = new SearchQueryCache();
  let calls = 0;
  globalThis.fetch = async () => ++calls === 2 ? new Response('', { status: 500 }) : response(['paper']);
  await assert.rejects(cachedSearch(['first', 'second'], cache), SearchError);
  await cachedSearch(['first', 'second'], cache);
  assert.equal(calls, 3);
});

test('expired entries and least recently used entries are fetched again', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const cache = new SearchQueryCache(100, 2);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response([]); };
  await cachedSearch(['first', 'second'], cache);
  await cachedSearch(['first', 'third'], cache);
  await cachedSearch(['second'], cache);
  assert.equal(calls, 4);
  t.mock.timers.tick(100);
  await cachedSearch(['second'], cache);
  assert.equal(calls, 5);
});

test('browser storage restores results after recreating the cache and respects expiry', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let saved: unknown;
  const storage = { load: async () => saved, save: async (value: unknown) => { saved = structuredClone(value); } };
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(['paper']); };
  await cachedSearch(['query'], new SearchQueryCache(100, 100, storage));
  await cachedSearch(['query'], new SearchQueryCache(100, 100, storage));
  assert.equal(calls, 1);
  t.mock.timers.tick(100);
  await cachedSearch(['query'], new SearchQueryCache(100, 100, storage));
  assert.equal(calls, 2);
});

test('corrupt or inaccessible browser storage does not prevent searching', async () => {
  globalThis.fetch = async () => response(['paper']);
  for (const saved of ['invalid', {}, [['key', null]]]) {
    const cache = new SearchQueryCache(100, 100, {
      load: async () => saved,
      save: async () => { throw new Error('Storage unavailable'); },
    });
    const result = await cachedSearch(['query'], cache);
    assert.deepEqual(result.results, [paper('paper')]);
    assert.deepEqual(await cache.get('query', new URLSearchParams()), [paper('paper')]);
  }
});

test('unavailable IndexedDB falls back to memory', async () => {
  const cache = new SearchQueryCache(1000, 100, {
    load: async () => { throw new Error('Unavailable'); },
    save: async () => { throw new Error('Quota exceeded'); },
  });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(['paper']); };
  await cachedSearch(['query'], cache);
  await cachedSearch(['query'], cache);
  assert.equal(calls, 1);
});

test('cancelling during cache loading prevents requests and stale progress', async () => {
  let finishLoad!: (value: unknown) => void;
  const cache = new SearchQueryCache(1000, 100, {
    load: () => new Promise(resolve => { finishLoad = resolve; }),
    save: async () => {},
  });
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(['paper']); };
  const progress: SearchProgress[] = [];
  const pending = searchQueries(['query'], new URLSearchParams(), undefined, undefined,
    update => progress.push(update), undefined, controller.signal, cache);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  finishLoad([]);
  await rejected;
  assert.equal(calls, 0);
  assert.deepEqual(progress.map(update => update.completed), [0]);
});
