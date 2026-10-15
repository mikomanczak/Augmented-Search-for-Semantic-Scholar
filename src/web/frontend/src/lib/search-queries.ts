import { fetchWithRetry, type RetryProgress } from '../../../../shared/retry.ts';
import type { Paper } from '../context/SearchContext';
import type { QueryResult } from './query-overlap';

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
): Promise<{ queryResults: QueryResult[]; results: Paper[] }> {
  const queryResults: QueryResult[] = [];
  for (const query of queries) {
    onRetry?.(null);
    const params = new URLSearchParams(filters);
    params.set('query', query);
    const response = await fetchWithRetry(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, {
      headers: apiKey ? { 'x-api-key': apiKey } : undefined,
    }, onRetry);
    if (!response.ok) throw new SearchError(response.status);
    const payload = await response.json() as { data?: Paper[] };
    if (!Array.isArray(payload.data)) throw new Error('Semantic Scholar returned invalid search results. Please try again.');
    queryResults.push({ query, papers: payload.data });
  }
  return {
    queryResults,
    results: [...new Map(queryResults.flatMap(result => result.papers).map(paper => [paper.paperId, paper])).values()],
  };
}
