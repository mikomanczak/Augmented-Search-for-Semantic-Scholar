import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fetchTopicEmbeddings, mapNeighborhoods, nearestTopics, normalizeVector, projectTopics, titleVectors } from '../src/lib/topic-map.ts';

const paper = (paperId: string, title = paperId) => ({ paperId, title });
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('normalizes vectors and excludes invalid or zero embeddings', () => {
  assert.deepEqual(normalizeVector([3, 4]), [0.6, 0.8]);
  assert.equal(normalizeVector([0, 0]), null);
  assert.equal(normalizeVector([NaN, 1]), null);
  assert.equal(normalizeVector([]), null);
});

test('projection is deterministic, bounded, and handles empty/single/identical inputs', () => {
  const papers = [paper('a'), paper('b'), paper('c')];
  const vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const points = projectTopics(papers, vectors);
  assert.deepEqual(projectTopics(papers, vectors), points);
  assert.ok(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1));
  assert.deepEqual(projectTopics([], []), []);
  assert.deepEqual(projectTopics([paper('a')], [[1, 0]]).map(({ x, y }) => [x, y]), [[0, 0]]);
  assert.ok(projectTopics(papers, papers.map(() => [1, 0])).every(point => point.x === 0 && point.y === 0));
  assert.throws(() => projectTopics(papers, [[1], [1, 2], [1]]), /dimensions/);
});

test('projection preserves distances for a two-dimensional centered dataset', () => {
  const vectors = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const points = projectTopics(vectors.map((_, i) => paper(String(i))), vectors);
  const adjacent = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  const opposite = Math.hypot(points[0].x - points[2].x, points[0].y - points[2].y);
  assert.ok(Math.abs(opposite / adjacent - Math.SQRT2) < 1e-6);
});

test('nearest papers use original vector similarity rather than screen distance', () => {
  const points = projectTopics([paper('a'), paper('b'), paper('c')], [[1, 0], [0.9, 0.1], [0, 1]]);
  assert.deepEqual(nearestTopics(points, 'a', 2).map(point => point.paper.paperId), ['b', 'c']);
});

test('mock title features favor shared words and handle titles without tokens', () => {
  const papers = [paper('a', 'JavaScript engine fuzzing'), paper('b', 'JavaScript engine security'), paper('c', 'Genome biology'), paper('d', 'A')];
  const points = projectTopics(papers, titleVectors(papers));
  assert.equal(nearestTopics(points, 'a', 1)[0].paper.paperId, 'b');
  assert.ok(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('batch embeddings are joined by ID, validated, and requested as SPECTER2', async () => {
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /embedding\.specter_v2/);
    assert.deepEqual(JSON.parse(String(init?.body)), { ids: ['a', 'b', 'c'] });
    return new Response(JSON.stringify([
      { paperId: 'b', embedding: { model: 'specter_v2', vector: [0, 1] } },
      null,
      { paperId: 'a', embedding: { model: 'specter_v2', vector: [1, 0] } },
      { paperId: 'c', embedding: { model: 'specter_v2', vector: [0, 0] } },
    ]));
  };
  const papers = await fetchTopicEmbeddings(['a', 'b', 'c'].map(id => paper(id)), new AbortController().signal);
  assert.deepEqual(papers.map(paper => paper.embedding?.vector ?? null), [[1, 0], [0, 1], null]);
});

test('embedding failures report a retryable error', async () => {
  globalThis.fetch = async () => new Response('', { status: 429, headers: { 'Retry-After': '0' } });
  await assert.rejects(fetchTopicEmbeddings([paper('a')], new AbortController().signal), /rate limit/);
});

test('embeddings recover automatically from a rate limit and report the retry', async () => {
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1
    ? new Response('', { status: 429, headers: { 'Retry-After': '0' } })
    : new Response(JSON.stringify([{ paperId: 'a', embedding: { model: 'specter_v2', vector: [1, 0] } }]));
  const attempts: number[] = [];
  const papers = await fetchTopicEmbeddings([paper('a')], new AbortController().signal, undefined, progress => attempts.push(progress.attempt));
  assert.equal(calls, 2);
  assert.deepEqual(attempts, [1]);
  assert.deepEqual(papers[0].embedding?.vector, [1, 0]);
});

test('neighborhood layout keeps related papers together and is deterministic', () => {
  const papers = Array.from({ length: 12 }, (_, i) => paper(String(i)));
  const vectors = papers.map((_, i) => i < 6 ? [1, 0.01 * i, 0] : [0, 0.01 * i, 1]);
  const points = mapNeighborhoods(papers, vectors);
  assert.deepEqual(mapNeighborhoods(papers, vectors), points);
  assert.ok(mapNeighborhoods(papers, papers.map(() => [1, 0])).every(point => point.x === 0 && point.y === 0));
  assert.ok(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1));
  const distance = (i: number, j: number) => Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
  assert.ok(distance(0, 1) < distance(0, 8));
});
