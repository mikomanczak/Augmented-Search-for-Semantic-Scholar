import { fetchWithRetry, type RetryProgress } from '../../../../shared/retry.ts';
import type { Paper } from '../context/SearchContext';
import type { QueryResult } from './query-overlap';

export type FetchedPaper = Pick<Paper, 'paperId' | 'title'>;

export type SearchProgress = {
  completed: number;
  total: number;
  currentQuery: string | null;
};

export class SearchError extends Error {
  status: number;

  constructor(status: number) {
    super(status === 429
      ? 'Semantic Scholar rate limit reached.'
      : `Semantic Scholar search failed (${status}). Please try again.`);
    this.status = status;
  }
}

export interface QueryCacheStorage {
  load(): Promise<unknown>;
  save(entries: unknown): Promise<void>;
}

// IndexedDB uses structured cloning, so results need no synchronous JSON serialization.
export function indexedDBCacheStorage(): QueryCacheStorage | undefined {
  if (typeof indexedDB === 'undefined') return undefined;
  const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const request = indexedDB.open('augmented-search', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('query-cache');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Cache database is blocked'));
  });
  const transact = async (write: boolean, entries?: unknown): Promise<unknown> => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('query-cache', write ? 'readwrite' : 'readonly');
        const store = transaction.objectStore('query-cache');
        const request = write ? store.put(entries, 'entries') : store.get('entries');
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    load: () => transact(false),
    save: async entries => { await transact(true, entries); },
  };
}

// Browser-persisted, bounded cache. Only fully fetched and validated responses enter it.
export class SearchQueryCache {
  private entries = new Map<string, { papers: Paper[]; expiresAt: number }>();

  private readonly ttlMs: number;
  private readonly maxEntries: number;

  private readonly storage: QueryCacheStorage | undefined;

  constructor(ttlMs = 24 * 60 * 60 * 1000, maxEntries = 100, storage = indexedDBCacheStorage()) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.storage = storage;
    this.ready = this.restore();
    // Remove the obsolete result cache; preferences remain in localStorage.
    try {
      if (typeof window !== 'undefined') window.localStorage.removeItem('augmented-search:query-cache:v1');
    } catch { /* Browser storage may be disabled. */ }
  }

  private readonly ready: Promise<void>;

  private async restore(): Promise<void> {
    try {
      const saved = await this.storage?.load();
      if (!Array.isArray(saved)) return;
      for (const item of saved) {
        if (!Array.isArray(item) || item.length !== 2) continue;
        const [key, entry] = item;
        if (typeof key !== 'string' || !entry || typeof entry.expiresAt !== 'number' ||
            !Number.isFinite(entry.expiresAt) || entry.expiresAt <= Date.now() ||
            !Array.isArray(entry.papers) || !entry.papers.every((paper: unknown) =>
              paper !== null && typeof paper === 'object' &&
              'paperId' in paper && typeof paper.paperId === 'string' &&
              'title' in paper && typeof paper.title === 'string')) continue;
        this.entries.set(key, entry);
      }
      while (this.entries.size > this.maxEntries) {
        this.entries.delete(this.entries.keys().next().value!);
      }
    } catch {
      // Corrupt or unavailable storage must never prevent searching.
    }
  }

  private async persist(): Promise<void> {
    if (!this.storage) return;
    const entries = [...this.entries].filter(([, entry]) => entry.expiresAt > Date.now());
    try {
      await this.storage.save(entries);
    } catch {
      // Keep the memory cache usable if IndexedDB is unavailable or full.
    }
  }

  private key(query: string, filters: URLSearchParams): string {
    const params = new URLSearchParams(filters);
    params.set('query', query);
    params.sort();
    return params.toString();
  }

  async get(query: string, filters: URLSearchParams): Promise<Paper[] | undefined> {
    await this.ready;
    const key = this.key(query, filters);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      await this.persist();
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    await this.persist();
    return entry.papers;
  }

  async set(query: string, filters: URLSearchParams, papers: Paper[]): Promise<void> {
    await this.ready;
    const key = this.key(query, filters);
    this.entries.delete(key);
    this.entries.set(key, { papers, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    await this.persist();
  }
}

// Keep results private until every query has succeeded, including any retries.
export async function searchQueries(
  queries: string[],
  filters: URLSearchParams,
  apiKey?: string,
  onRetry?: (progress: RetryProgress | null) => void,
  onProgress?: (progress: SearchProgress) => void,
  onPapersFetched?: (papers: FetchedPaper[]) => void,
  signal?: AbortSignal,
  cache?: SearchQueryCache,
): Promise<{ queryResults: QueryResult[]; results: Paper[] }> {
  const queryResults: QueryResult[] = [];
  signal?.throwIfAborted();
  for (const query of queries) {
    signal?.throwIfAborted();
    onProgress?.({ completed: queryResults.length, total: queries.length, currentQuery: query });
    onRetry?.(null);
    let papers = cache ? await cache.get(query, filters) : undefined;
    signal?.throwIfAborted();
    if (papers === undefined) {
      const params = new URLSearchParams(filters);
      params.set('query', query);
      const response = await fetchWithRetry(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, {
        signal,
        headers: apiKey ? { 'x-api-key': apiKey } : undefined,
      }, onRetry);
      signal?.throwIfAborted();
      if (!response.ok) throw new SearchError(response.status);
      const payload = await response.json() as { data?: Paper[] };
      signal?.throwIfAborted();
      if (!Array.isArray(payload.data)) throw new Error('Semantic Scholar returned invalid search results. Please try again.');
      papers = payload.data;
      if (cache) await cache.set(query, filters, papers);
      signal?.throwIfAborted();
    }
    queryResults.push({ query, papers });
    onPapersFetched?.([...new Map(queryResults.flatMap(result => result.papers)
      .map(({ paperId, title }) => [paperId, { paperId, title }])).values()]);
    onProgress?.({ completed: queryResults.length, total: queries.length, currentQuery: null });
  }
  return {
    queryResults,
    results: [...new Map(queryResults.flatMap(result => result.papers).map(paper => [paper.paperId, paper])).values()],
  };
}
