import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { searchQueries, SearchError } from '../src/lib/search-queries.ts';

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
  const pending = searchQueries(queries, filters, 'test-key').then(result => { completed = true; return result; });
  await flush();
  assert.deepEqual(calls, queries);
  assert.equal(completed, false);
  finishLast(response(['shared', 'second']));
  const result = await pending;
  assert.deepEqual(result.queryResults, [
    { query: queries[0], papers: ['shared', 'first'].map(paper) },
    { query: queries[1], papers: ['shared', 'second'].map(paper) },
  ]);
  assert.deepEqual(result.results.map(p => p.paperId), ['shared', 'first', 'second']);
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
  const progress: unknown[] = [];
  const pending = searchQueries(['first', 'second'], new URLSearchParams(), undefined, update => progress.push(update));
  await flush();
  assert.deepEqual(calls, ['first']);
  t.mock.timers.tick(1000);
  const result = await pending;
  assert.deepEqual(calls, ['first', 'first', 'second']);
  assert.equal(progress.length, 3);
  assert.deepEqual(result.queryResults, [{ query: 'first', papers: [] }, { query: 'second', papers: [] }]);
  assert.deepEqual(result.results, []);
});

test('malformed responses fail instead of being accepted as successful empty searches', async () => {
  for (const payload of [{}, { data: null }, { data: {} }]) {
    globalThis.fetch = async () => Response.json(payload);
    await assert.rejects(searchQueries(['query'], new URLSearchParams()), /invalid search results/);
  }
});
