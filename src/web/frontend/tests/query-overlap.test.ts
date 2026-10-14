import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getQueryOverlap } from '../src/lib/query-overlap.ts';

const paper = (paperId: string) => ({ paperId, title: paperId });

test('partitions all seven exact intersections and deduplicates within each query', () => {
  const result = getQueryOverlap([
    { query: 'A', papers: ['a', 'a', 'ab', 'ac', 'abc'].map(paper) },
    { query: 'B', papers: ['b', 'ab', 'bc', 'abc'].map(paper) },
    { query: 'C', papers: ['c', 'ac', 'bc', 'abc'].map(paper) },
  ]);
  assert.equal(result.total, 7);
  assert.equal(result.shared, 4);
  assert.deepEqual(result.matrix, [[4, 2, 2], [2, 4, 2], [2, 2, 4]]);
  assert.deepEqual(result.regions.map(region => region.papers.map(paper => paper.paperId)), [
    ['a'], ['b'], ['ab'], ['c'], ['ac'], ['bc'], ['abc'],
  ]);
});

test('keeps empty regions for disjoint and empty query results', () => {
  const result = getQueryOverlap([
    { query: 'A', papers: [paper('a')] },
    { query: 'B', papers: [paper('b')] },
    { query: 'C', papers: [] },
  ]);
  assert.equal(result.total, 2);
  assert.equal(result.shared, 0);
  assert.deepEqual(result.matrix, [[1, 0, 0], [0, 1, 0], [0, 0, 0]]);
  assert.deepEqual(result.regions.map(region => region.papers.length), [1, 1, 0, 0, 0, 0, 0]);
});
