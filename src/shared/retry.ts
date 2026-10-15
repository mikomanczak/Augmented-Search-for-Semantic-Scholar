const MAX_RETRIES = 60;
const MAX_DELAY_MS = 60_000;

export type RetryProgress = {
  attempt: number;
  maxRetries: number;
  retryAt: number;
  reason: 'rate-limit' | 'network';
};

function retryDelay(header: string | null): number {
  if (header?.trim()) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      if (seconds >= 0) return seconds * 1000;
    } else {
      const deadline = Date.parse(header);
      if (Number.isFinite(deadline)) return Math.max(0, deadline - Date.now());
    }
  }
  return 1000;
}

function wait(delay: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function retryRequest<T extends { status: number }>(
  request: () => Promise<T>,
  retryAfter: (response: T) => string | null,
  signal?: AbortSignal,
  onRetry?: (progress: RetryProgress) => void,
  retryNetworkFailures = false,
): Promise<T> {
  for (let retry = 0; ; retry++) {
    signal?.throwIfAborted();
    let response: T;
    try {
      response = await request();
    } catch (error) {
      // Browsers expose network/CORS failures as TypeError, hiding any HTTP status.
      if (!retryNetworkFailures || !(error instanceof TypeError) || signal?.aborted || retry === MAX_RETRIES) throw error;
      const delay = retryDelay(null);
      onRetry?.({ attempt: retry + 1, maxRetries: MAX_RETRIES, retryAt: Date.now() + delay, reason: 'network' });
      await wait(delay, signal);
      continue;
    }
    if (response.status !== 429 || retry === MAX_RETRIES) return response;
    const delay = retryDelay(retryAfter(response));
    // Surface the rate-limit error instead of retrying before a long server deadline.
    if (delay > MAX_DELAY_MS) return response;
    onRetry?.({ attempt: retry + 1, maxRetries: MAX_RETRIES, retryAt: Date.now() + delay, reason: 'rate-limit' });
    await wait(delay, signal);
  }
}

/** Retry only HTTP 429, leaving final response/error handling to the caller. */
export function retryOn429<T extends { status: number }>(
  request: () => Promise<T>,
  retryAfter: (response: T) => string | null,
  signal?: AbortSignal,
  onRetry?: (progress: RetryProgress) => void,
): Promise<T> {
  return retryRequest(request, retryAfter, signal, onRetry);
}

/** For replayable search/embedding requests, including browser-hidden HTTP failures. */
export function fetchWithRetry(url: string, init: RequestInit = {}, onRetry?: (progress: RetryProgress) => void): Promise<Response> {
  return retryRequest(() => fetch(url, init), response => response.headers.get('Retry-After'), init.signal ?? undefined, onRetry, true);
}
