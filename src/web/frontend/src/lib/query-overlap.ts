import type { Paper } from '../context/SearchContext';

export type QueryResult = { query: string; papers: Paper[] };

// Each bit records membership in a query; every paper belongs to one exact region.
export function getQueryOverlap(queries: QueryResult[]) {
  const memberships = new Map<string, { paper: Paper; mask: number }>();
  queries.forEach(({ papers }, index) => {
    papers.forEach(paper => {
      const entry = memberships.get(paper.paperId);
      memberships.set(paper.paperId, { paper, mask: (entry?.mask ?? 0) | (1 << index) });
    });
  });
  const regions = Array.from({ length: 7 }, (_, index) => ({
    mask: index + 1,
    papers: [...memberships.values()].filter(entry => entry.mask === index + 1).map(entry => entry.paper),
  }));
  return {
    regions,
    matrix: queries.map((_, row) => queries.map((_, column) => {
      const mask = (1 << row) | (1 << column);
      return [...memberships.values()].filter(entry => (entry.mask & mask) === mask).length;
    })),
    total: memberships.size,
    shared: [...memberships.values()].filter(entry => (entry.mask & (entry.mask - 1)) !== 0).length,
  };
}
