import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fetchWithRetry, retryOn429, type RetryProgress } from '../../../shared/retry.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('recovers on the 60th retry, reports progress, and preserves request data', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let calls = 0;
  const init = { method: 'POST', headers: { 'x-api-key': 'test-key' }, body: '{"ids":["a"]}' };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://example.test/papers');
    assert.equal(options, init);
    return new Response('', { status: ++calls <= 60 ? 429 : 200 });
  };
  const progress: RetryProgress[] = [];
  const pending = fetchWithRetry('https://example.test/papers', init, update => progress.push(update));
  for (let retry = 0; retry < 60; retry++) {
    await flush();
    const before = calls;
    t.mock.timers.tick(999);
    await flush();
    assert.equal(calls, before);
    t.mock.timers.tick(1);
  }
  assert.equal((await pending).status, 200);
  assert.equal(calls, 61);
  assert.deepEqual(progress.map(p => [p.attempt, p.maxRetries]), Array.from({ length: 60 }, (_, index) => [index + 1, 60]));
  assert.equal(progress.at(-1)?.retryAt, 60000);
});

test('returns the final 429 after the retry limit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const pending = retryOn429(async () => ({ status: 429, call: ++calls }), () => '0');
  for (let i = 0; i < 60; i++) {
    await flush();
    t.mock.timers.tick(0);
  }
  assert.deepEqual(await pending, { status: 429, call: 61 });
});

test('respects Retry-After seconds and HTTP dates', async t => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
  for (const makeHeader of [() => '3', () => new Date(Date.now() + 3000).toUTCString(), () => new Date(Date.now() - 3000).toUTCString()]) {
    const header = makeHeader();
    let calls = 0;
    const pending = retryOn429(async () => ({ status: ++calls === 1 ? 429 : 200 }), () => header);
    await flush();
    const delay = header === '3' ? 3000 : Math.max(0, Date.parse(header) - Date.now());
    if (delay > 0) {
      t.mock.timers.tick(delay - 1);
      await flush();
      assert.equal(calls, 1);
      t.mock.timers.tick(1);
    } else t.mock.timers.tick(0);
    assert.equal((await pending).status, 200);
  }
});

test('invalid Retry-After falls back to the fixed delay; long waits surface the error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  for (const header of ['invalid', '', '-1']) {
    let calls = 0;
    const pending = retryOn429(async () => ({ status: ++calls === 1 ? 429 : 200 }), () => header);
    await flush();
    t.mock.timers.tick(999);
    await flush();
    assert.equal(calls, 1);
    t.mock.timers.tick(1);
    assert.equal((await pending).status, 200);
  }
  let calls = 0;
  const response = await retryOn429(async () => ({ status: 429, call: ++calls }), () => '120');
  assert.equal(response.status, 429);
  assert.equal(calls, 1);
});

test('does not retry other statuses or network failures', async () => {
  for (const status of [200, 400, 401, 500, 503]) {
    let calls = 0;
    assert.equal((await retryOn429(async () => { calls++; return { status }; }, () => null)).status, status);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(retryOn429(async () => { calls++; throw new Error('offline'); }, () => null), /offline/);
  assert.equal(calls, 1);
});

test('cancellation interrupts a retry wait and prevents further requests', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = retryOn429(async () => ({ status: 429, call: ++calls }), () => '60', controller.signal);
  await flush();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);
  await assert.rejects(retryOn429(async () => { calls++; return { status: 200 }; }, () => null, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('browser-hidden HTTP failures retry with connection progress and can recover', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw new TypeError('Failed to fetch');
    return new Response('', { status: calls === 2 ? 429 : 200, headers: { 'Retry-After': '2' } });
  };
  const progress: RetryProgress[] = [];
  const pending = fetchWithRetry('https://example.test/search', {}, update => progress.push(update));
  await flush();
  assert.equal(calls, 1);
  assert.deepEqual(progress[0], { attempt: 1, maxRetries: 60, retryAt: 1000, reason: 'network' });
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(calls, 2);
  assert.deepEqual(progress[1], { attempt: 2, maxRetries: 60, retryAt: 3000, reason: 'rate-limit' });
  t.mock.timers.tick(2000);
  assert.equal((await pending).status, 200);
  assert.equal(calls, 3);
});

test('network failures exhaust the same 60-retry budget and preserve the final error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const failure = new TypeError('Failed to fetch');
  globalThis.fetch = async () => { calls++; throw failure; };
  const pending = fetchWithRetry('https://example.test/search');
  const rejected = assert.rejects(pending, error => error === failure);
  for (let retry = 0; retry < 60; retry++) {
    await flush();
    t.mock.timers.tick(1000);
  }
  await rejected;
  assert.equal(calls, 61);
});

test('cancels network retries and does not retry aborts or other exceptions', async () => {
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('Failed to fetch'); };
  const pending = fetchWithRetry('https://example.test/search', { signal: controller.signal });
  await flush();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);
  for (const error of [new Error('unexpected error'), new DOMException('Aborted', 'AbortError')]) {
    calls = 0;
    globalThis.fetch = async () => { calls++; throw error; };
    await assert.rejects(fetchWithRetry('https://example.test/search'), reason => reason === error);
    assert.equal(calls, 1);
  }
});
