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

// Keep results private until every query has succeeded, including any retries.
export async function searchQueries(
  queries: string[],
  filters: URLSearchParams,
  apiKey?: string,
  onRetry?: (progress: RetryProgress | null) => void,
  onProgress?: (progress: SearchProgress) => void,
  onPapersFetched?: (papers: FetchedPaper[]) => void,
  signal?: AbortSignal,
): Promise<{ queryResults: QueryResult[]; results: Paper[] }> {
  const queryResults: QueryResult[] = [];
  signal?.throwIfAborted();
  for (const query of queries) {
    signal?.throwIfAborted();
    onProgress?.({ completed: queryResults.length, total: queries.length, currentQuery: query });
    onRetry?.(null);
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
    queryResults.push({ query, papers: payload.data });
    onPapersFetched?.([...new Map(queryResults.flatMap(result => result.papers)
      .map(({ paperId, title }) => [paperId, { paperId, title }])).values()]);
    onProgress?.({ completed: queryResults.length, total: queries.length, currentQuery: null });
  }
  return {
    queryResults,
    results: [...new Map(queryResults.flatMap(result => result.papers).map(paper => [paper.paperId, paper])).values()],
  };
}
