import type { Paper } from '../context/SearchContext';
import { fetchWithRetry, type RetryProgress } from '../../../../shared/retry.ts';

export type TopicPoint = { paper: Paper; vector: number[]; x: number; y: number };
const stopWords = new Set('a an the of in on for to and or with using from by as at is are we this that based study analysis approach new'.split(' '));

export function normalizeVector(vector: number[]): number[] | null {
  if (!vector.length || vector.some(value => !Number.isFinite(value))) return null;
  const norm = Math.hypot(...vector);
  return norm > 0 && Number.isFinite(norm) ? vector.map(value => value / norm) : null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  return a.length === b.length ? a.reduce((sum, value, index) => sum + value * b[index], 0) : 0;
}

// Mock fixtures have no embeddings. TF-IDF uses their actual titles, without invented topics.
export function titleVectors(papers: Paper[]): number[][] {
  const tokens = papers.map(paper => paper.title.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.filter(word => !stopWords.has(word)) ?? []);
  const vocabulary = [...new Set(tokens.flat())].sort();
  const frequency = vocabulary.map(word => tokens.filter(title => title.includes(word)).length);
  return tokens.map(title => normalizeVector(vocabulary.map((word, index) =>
    title.filter(token => token === word).length * (1 + Math.log((1 + papers.length) / (1 + frequency[index]))),
  )) ?? vocabulary.map(() => 0));
}

// PCA on the centered Gram matrix: operates on paper count rather than embedding dimension.
export function projectTopics(papers: Paper[], vectors: number[][]): TopicPoint[] {
  if (!papers.length) return [];
  if (vectors.length !== papers.length || vectors.some(vector => vector.length !== vectors[0].length)) {
    throw new Error('Topic vectors must have equal dimensions and match the paper count.');
  }
  const normalized = vectors.map(vector => normalizeVector(vector) ?? vector.map(() => 0));
  const n = papers.length;
  const gram = normalized.map(a => normalized.map(b => cosineSimilarity(a, b)));
  const means = gram.map(row => row.reduce((sum, value) => sum + value, 0) / n);
  const mean = means.reduce((sum, value) => sum + value, 0) / n;
  const centered = gram.map((row, i) => row.map((value, j) => value - means[i] - means[j] + mean));
  const axes: number[][] = [];
  for (let axis = 0; axis < 2; axis++) {
    let direction = normalizeVector(papers.map((_, index) => Math.sin((index + 1) * (axis + 1) * 1.618)))!;
    for (let step = 0; step < 100; step++) {
      let next = centered.map(row => cosineSimilarity(row, direction));
      for (const previous of axes) {
        const dot = cosineSimilarity(next, previous);
        next = next.map((value, index) => value - dot * previous[index]);
      }
      const unit = normalizeVector(next);
      if (!unit) { direction = papers.map(() => 0); break; }
      direction = unit;
    }
    axes.push(direction);
  }
  const coordinates = axes.map(axis => {
    const eigenvalue = Math.max(0, cosineSimilarity(axis, centered.map(row => cosineSimilarity(row, axis))));
    return axis.map(value => value * Math.sqrt(eigenvalue));
  });
  // A common scale for both axes preserves projected distance proportions.
  const extent = Math.max(1e-9, ...coordinates.flat().map(Math.abs));
  return papers.map((paper, index) => ({ paper, vector: normalized[index], x: coordinates[0][index] / extent, y: coordinates[1][index] / extent }));
}

export function nearestTopics(points: TopicPoint[], paperId: string, count = 3): TopicPoint[] {
  const selected = points.find(point => point.paper.paperId === paperId);
  if (!selected) return [];
  return points.filter(point => point !== selected)
    .sort((a, b) => cosineSimilarity(selected.vector, b.vector) - cosineSimilarity(selected.vector, a.vector))
    .slice(0, count);
}

export async function fetchTopicEmbeddings(papers: Paper[], signal: AbortSignal, apiKey?: string, onRetry?: (progress: RetryProgress) => void): Promise<Paper[]> {
  const response = await fetchWithRetry('https://api.semanticscholar.org/graph/v1/paper/batch?fields=embedding.specter_v2', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
    body: JSON.stringify({ ids: papers.map(paper => paper.paperId) }),
  }, onRetry);
  if (!response.ok) throw new Error(response.status === 429
    ? 'Semantic Scholar rate limit reached. Try loading the map again in a moment.'
    : `Could not load paper embeddings (${response.status}).`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('The embedding service returned an unexpected response.');
  const embeddings = new Map<string, { model: string; vector: number[] }>();
  for (const entry of payload) {
    if (entry && typeof entry.paperId === 'string' && typeof entry.embedding?.model === 'string' &&
      Array.isArray(entry.embedding.vector) && entry.embedding.vector.every((value: unknown) => typeof value === 'number') &&
      normalizeVector(entry.embedding.vector)) {
      embeddings.set(entry.paperId, entry.embedding);
    }
  }
  return papers.map(paper => ({ ...paper, embedding: embeddings.get(paper.paperId) ?? null }));
}

// t-SNE emphasizes local neighborhoods when two PCA axes would collapse most papers.
export function mapNeighborhoods(papers: Paper[], vectors: number[][]): TopicPoint[] {
  const points = projectTopics(papers, vectors);
  const n = points.length;
  if (n < 4 || points.every(point => point.x === 0 && point.y === 0)) return points;
  const perplexity = Math.min(20, (n - 1) / 3);
  const conditional = points.map((point, i) => {
    const distances = points.map(other => Math.max(0, 2 - 2 * cosineSimilarity(point.vector, other.vector)));
    let beta = 1, lower = 0, upper = Infinity;
    let probabilities: number[] = [];
    for (let step = 0; step < 40; step++) {
      const weights = distances.map((distance, j) => i === j ? 0 : Math.exp(-distance * beta));
      const total = weights.reduce((sum, value) => sum + value, 0) || 1e-300;
      probabilities = weights.map(value => value / total);
      const entropy = probabilities.reduce((sum, value) => sum - (value > 0 ? value * Math.log(value) : 0), 0);
      if (Math.abs(entropy - Math.log(perplexity)) < 1e-5) break;
      if (entropy > Math.log(perplexity)) { lower = beta; beta = upper === Infinity ? beta * 2 : (beta + upper) / 2; }
      else { upper = beta; beta = (beta + lower) / 2; }
    }
    return probabilities;
  });
  const probabilities = conditional.map((row, i) => row.map((value, j) => (value + conditional[j][i]) / (2 * n)));
  const coordinates = points.map((point, i) => [point.x * 0.01 + Math.sin(i * 3.17) * 0.001, point.y * 0.01 + Math.cos(i * 2.71) * 0.001]);
  const velocity = points.map(() => [0, 0]);
  for (let iteration = 0; iteration < 350; iteration++) {
    const affinities = coordinates.map((a, i) => coordinates.map((b, j) => i === j ? 0 : 1 / (1 + (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)));
    const sum = affinities.reduce((total, row) => total + row.reduce((subtotal, value) => subtotal + value, 0), 0);
    const gradient = points.map(() => [0, 0]);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const weight = 4 * ((iteration < 75 ? 4 : 1) * probabilities[i][j] - affinities[i][j] / sum) * affinities[i][j];
      gradient[i][0] += weight * (coordinates[i][0] - coordinates[j][0]);
      gradient[i][1] += weight * (coordinates[i][1] - coordinates[j][1]);
    }
    for (let i = 0; i < n; i++) for (let axis = 0; axis < 2; axis++) {
      velocity[i][axis] = (iteration < 75 ? 0.5 : 0.8) * velocity[i][axis] - 60 * gradient[i][axis];
      coordinates[i][axis] += velocity[i][axis];
    }
    for (let axis = 0; axis < 2; axis++) {
      const mean = coordinates.reduce((sum, point) => sum + point[axis], 0) / n;
      coordinates.forEach(point => { point[axis] -= mean; });
    }
  }
  const extent = Math.max(1e-9, ...coordinates.flat().map(Math.abs));
  return points.map((point, i) => ({ ...point, x: coordinates[i][0] / extent, y: coordinates[i][1] / extent }));
}
