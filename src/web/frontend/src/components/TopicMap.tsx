import { useEffect, useMemo, useState } from 'react';
import type { Paper } from '../context/SearchContext';
import type { QueryResult } from '../lib/query-overlap';
import { fetchTopicEmbeddings, nearestTopics, normalizeVector, mapNeighborhoods, titleVectors } from '../lib/topic-map';
import type { RetryProgress } from '../../../../shared/retry.ts';
import RetryStatus from './RetryStatus';

const colors = ['#58a6ff', '#bc8cff', '#3fb950'];

export default function TopicMap({ papers, queries, isMock }: { papers: Paper[]; queries: QueryResult[]; isMock: boolean }) {
  const [embeddedPapers, setEmbeddedPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(!isMock);
  const [retryProgress, setRetryProgress] = useState<RetryProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState(papers[0]?.paperId ?? '');
  const [showSimilar, setShowSimilar] = useState(false);

  useEffect(() => {
    if (isMock) return;
    const controller = new AbortController();
    setLoading(true);
    setRetryProgress(null);
    setError(null);
    void fetchTopicEmbeddings(papers, controller.signal, import.meta.env.VITE_SEMANTIC_SCHOLAR_API_KEY, setRetryProgress)
      .then(data => { if (!controller.signal.aborted) setEmbeddedPapers(data); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load the topic map.'); })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); setRetryProgress(null); } });
    return () => controller.abort();
  }, [papers, isMock, attempt]);

  const points = useMemo(() => {
    if (isMock) return mapNeighborhoods(papers, titleVectors(papers));
    const available = embeddedPapers.filter(paper => paper.embedding && normalizeVector(paper.embedding.vector));
    // Never compare embeddings from different models or dimensions.
    const groups = new Map<string, Paper[]>();
    available.forEach(paper => {
      const key = `${paper.embedding!.model}:${paper.embedding!.vector.length}`;
      groups.set(key, [...(groups.get(key) ?? []), paper]);
    });
    const compatible = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    return mapNeighborhoods(compatible, compatible.map(paper => paper.embedding!.vector));
  }, [papers, embeddedPapers, isMock]);
  const selected = points.find(point => point.paper.paperId === selectedId) ?? points[0];
  const similar = useMemo(() => nearestTopics(points, selected?.paper.paperId ?? ''), [points, selected]);
  const membership = useMemo(() => {
    const map = new Map<string, number[]>();
    queries.forEach((query, index) => query.papers.forEach(paper => {
      map.set(paper.paperId, [...new Set([...(map.get(paper.paperId) ?? []), index])]);
    }));
    return map;
  }, [queries]);
  const maxCitations = Math.max(1, ...papers.map(paper => Math.max(0, paper.citationCount ?? 0)));
  const choosePaper = (id: string) => { setSelectedId(id); setShowSimilar(false); };
  const queryNames = (paper: Paper) => membership.get(paper.paperId)?.map(index => queries[index].query).join(' + ') ?? 'Combined search';

  return (
    <section className="topic-map" aria-labelledby="topic-map-heading">
      <header className="topic-map__header">
        <div><h2 id="topic-map-heading">Topic map</h2><p>Explore papers by similarity</p></div>
        <div className="topic-map__controls">
          {isMock && <span className="topic-map__badge">Title similarity preview</span>}
        </div>
      </header>
      {loading ? (retryProgress ? <RetryStatus progress={retryProgress} /> : <p className="topic-map__status" role="status">Loading paper embeddings…</p>)
        : error ? <div className="topic-map__status" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry loading map</button></div>
        : !points.length ? <p className="topic-map__status">No embeddings are available for these papers.</p>
        : <>
          <div className="topic-map__legend" aria-label="Map color legend">
            {queries.length ? queries.map(({ query }, index) =>
              <span key={query}><i style={{ background: colors[index % colors.length] }} />{query}</span>)
              : <span><i style={{ background: colors[0] }} />Combined search</span>}
            {queries.length > 1 && <span><i className="topic-map__shared-key" />Multiple queries</span>}
          </div>
          <div className="topic-map__body">
            <div className="topic-map__plot">
              <svg viewBox="0 0 760 520" role="group" aria-label="Topic map. Select a paper to see details. Nearby dots have similar content.">
                {points.map(point => {
                  const { paper } = point;
                  const x = 380 + point.x * 225;
                  const y = 260 + point.y * 225;
                  const size = 5 + Math.sqrt(Math.log1p(Math.max(0, paper.citationCount ?? 0)) / Math.log1p(maxCitations)) * 8;
                  const memberships = membership.get(paper.paperId) ?? [0];
                  const isSelected = selected?.paper.paperId === paper.paperId;
                  return (
                    <g className="topic-map__point" key={paper.paperId} role="button" tabIndex={0}
                      aria-label={`${paper.title}, ${paper.year ?? 'year unknown'}, ${paper.citationCount == null ? 'citations unknown' : `${paper.citationCount} citations`}, ${queryNames(paper)}`}
                      aria-pressed={isSelected} onClick={() => choosePaper(paper.paperId)}
                      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choosePaper(paper.paperId); } }}>
                      <title>{paper.title} · {queryNames(paper)}</title>
                      <circle className="topic-map__focus" cx={x} cy={y} r={size + 5} />
                      <circle cx={x} cy={y} r={size} fill={colors[memberships[0] % colors.length]}
                        stroke={memberships.length > 1 ? colors[memberships[1] % colors.length] : 'var(--topic-surface)'}
                        strokeWidth={memberships.length > 1 ? 3 : 1} />
                    </g>
                  );
                })}
              </svg>
              <p className="topic-map__explanation">{isMock ? 'Preview based on words in paper titles; Semantic Scholar embeddings are not included in the mock data.' : 'SPECTER2 embeddings arranged by local similarity. Nearby dots suggest related content; distances between groups are approximate.'} Dot size reflects citations on a compressed scale.</p>
              {!isMock && points.length < papers.length && <p className="topic-map__explanation">{points.length} of {papers.length} papers mapped; {papers.length - points.length} lack compatible embeddings.</p>}
            </div>
            <aside className="topic-map__detail" aria-label="Selected paper">
              <label className="topic-map__picker">Selected paper
                <select aria-label="Select a paper on the topic map" value={selected?.paper.paperId ?? ''} onChange={event => choosePaper(event.target.value)}>
                  {points.map(({ paper }) => <option key={paper.paperId} value={paper.paperId}>{paper.title}</option>)}
                </select>
              </label>
              {selected && <div aria-live="polite">
                <h3>{selected.paper.title}</h3>
                <p>{selected.paper.year ?? 'Year unknown'} · {selected.paper.citationCount?.toLocaleString() ?? 'Unknown'} citations</p>
                <div className="topic-map__tags">{(membership.get(selected.paper.paperId) ?? []).map(index => <span key={index} style={{ borderColor: colors[index % colors.length] }}>{queries[index].query}</span>)}</div>
                {selected.paper.url && <a className="topic-map__paper-link" href={selected.paper.url} target="_blank" rel="noreferrer">View paper ↗</a>}
                <button className="topic-map__similar-button" type="button" onClick={() => setShowSimilar(value => !value)} aria-expanded={showSimilar}>Find similar papers</button>
                {showSimilar && <div className="topic-map__similar"><p>Closest {isMock ? 'by title similarity' : 'in embedding space'} among these results:</p>
                  {similar.length ? <ul>{similar.map(({ paper }) => <li key={paper.paperId}><button type="button" onClick={() => choosePaper(paper.paperId)}>{paper.title}</button></li>)}</ul> : <p>No other papers available.</p>}
                </div>}
              </div>}
            </aside>
          </div>
        </>}
    </section>
  );
}
