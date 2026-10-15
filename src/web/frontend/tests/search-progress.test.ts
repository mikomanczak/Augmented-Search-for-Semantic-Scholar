import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchProgressPercent } from '../src/lib/search-progress.ts';

const progress = { completed: 2, total: 10, currentQuery: 'battery' };
const retry = (attempt: number, maxRetries = 60) => ({ attempt, maxRetries, retryAt: 0, reason: 'network' as const });

test('each retry advances by one attempt out of the worst-case query budget', () => {
  assert.equal(searchProgressPercent(progress, null), 20);
  for (let attempt = 1; attempt <= 60; attempt++) {
    const percent = searchProgressPercent(progress, retry(attempt));
    assert.equal(percent, (2 + attempt / 61) / 10 * 100);
    const previous = searchProgressPercent(progress, attempt > 1 ? retry(attempt - 1) : null);
    assert.ok(percent > previous && percent < 30);
  }
  assert.equal(progress.completed, 2);
});

test('the full worst-case sequence increases on every retry and query completion', () => {
  const total = 7;
  let previous = 0;
  for (let completed = 0; completed < total; completed++) {
    for (let attempt = 1; attempt <= 60; attempt++) {
      const percent = searchProgressPercent({ completed, total, currentQuery: 'q' }, retry(attempt));
      assert.ok(percent > previous && percent < 100);
      previous = percent;
    }
    const percent = searchProgressPercent({ completed: completed + 1, total, currentQuery: null }, null);
    assert.ok(percent > previous);
    previous = percent;
  }
  assert.equal(previous, 100);
});

test('uses the supplied retry budget and ignores retries outside the active query', () => {
  assert.equal(searchProgressPercent(progress, retry(2, 3)), 25);
  assert.equal(searchProgressPercent(progress, retry(100)), searchProgressPercent(progress, retry(60)));
  assert.equal(searchProgressPercent({ ...progress, currentQuery: null }, retry(60)), 20);
  assert.equal(searchProgressPercent({ completed: 10, total: 10, currentQuery: null }, retry(60)), 100);
  assert.equal(searchProgressPercent({ completed: 0, total: 0, currentQuery: null }, null), 0);
});
