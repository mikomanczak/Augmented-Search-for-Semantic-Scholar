import { useId, useMemo, useState } from 'react';
import { getOverlapPapers, getQueryOverlap, type QueryResult } from '../lib/query-overlap';

const positions: Record<number, [number, number]> = {
  1: [116, 106], 2: [284, 106], 3: [200, 99],
  4: [200, 260], 5: [146, 188], 6: [254, 188], 7: [200, 166],
};
const circles = [
  { cx: 152, cy: 132, name: 'a' },
  { cx: 248, cy: 132, name: 'b' },
  { cx: 200, cy: 216, name: 'c' },
];

export default function QueryOverlap({ queries }: { queries: QueryResult[] }) {
  const diagramId = useId();
  const overlap = useMemo(() => getQueryOverlap(queries), [queries]);
  const [selection, setSelection] = useState(() => ({
    mask: overlap.regions.find(region => region.papers.length > 0 && (region.mask & (region.mask - 1)) !== 0)?.mask ?? 1,
    exact: true,
  }));
  const selectedPapers = getOverlapPapers(overlap.regions, selection.mask, selection.exact);
  const label = (mask: number) => queries.filter((_, index) => mask & (1 << index)).map(query => query.query).join(' + ');

  return (
    <section className="query-overlap" aria-label="Query result overlap">
      <div className="query-overlap__heading">
        <div><h2>How your queries connect</h2><p>Explore unique and shared papers across three queries.</p></div>
        <span>{overlap.total} unique <span aria-hidden="true">·</span> {overlap.shared} shared</span>
      </div>
      <div className="query-overlap__body">
        <figure className="query-overlap__figure">
          <svg viewBox="0 0 400 330" role="group" aria-label="Venn diagram of exact paper counts. Select a region to explore it.">
            <defs>
              {circles.map(({ cx, cy, name }) => (
                <clipPath key={name} id={`${diagramId}-${name}`} clipPathUnits="userSpaceOnUse">
                  <circle cx={cx} cy={cy} r="100" />
                </clipPath>
              ))}
              <mask id={`${diagramId}-selection`} maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="330">
                <rect width="400" height="330" fill="white" />
                {selection.exact && circles.map(({ cx, cy, name }, index) => (
                  !(selection.mask & (1 << index)) && <circle key={name} cx={cx} cy={cy} r="100" fill="black" />
                ))}
              </mask>
            </defs>
            {circles.map(({ cx, cy, name }) => (
              <circle key={name} className={`query-overlap__circle query-overlap__circle--${name}`} cx={cx} cy={cy} r="100" />
            ))}
            <g mask={`url(#${diagramId}-selection)`} aria-hidden="true" pointerEvents="none">
              {circles.reduce((region, { name }, index) => (
                selection.mask & (1 << index)
                  ? <g clipPath={`url(#${diagramId}-${name})`}>{region}</g>
                  : region
              ), <rect className="query-overlap__selection" width="400" height="330" />)}
            </g>
            {queries.map(({ query }, index) => {
              const [x, y] = [[112, 58], [288, 58], [200, 292]][index];
              return (
                <text key={query} className={`query-overlap__label query-overlap__label--${index}`} x={x} y={y}>
                  <title>{query}: {overlap.matrix[index][index]} total papers</title>
                  <tspan x={x}>{query}</tspan>
                  <tspan className="query-overlap__label-total" x={x} dy="14">{overlap.matrix[index][index]} papers</tspan>
                </text>
              );
            })}
            {overlap.regions.map(({ mask, papers }) => {
              const [x, y] = positions[mask];
              return (
                <g key={mask} className="query-overlap__region" role="button" tabIndex={0}
                  aria-label={`${label(mask)} only: ${papers.length} ${papers.length === 1 ? 'paper' : 'papers'}`}
                  aria-pressed={selection.exact ? selection.mask === mask : (mask & selection.mask) === selection.mask}
                  aria-controls="query-overlap-detail"
                  onClick={() => setSelection({ mask, exact: true })}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelection({ mask, exact: true }); } }}>
                  <title>{label(mask)} only: {papers.length} papers</title>
                  <rect x={x - 21} y={y - 21} width="42" height="42" rx="21" />
                  <text x={x} y={y} dominantBaseline="central">{papers.length}</text>
                </g>
              );
            })}
          </svg>
          <figcaption>Counts show exact intersections; circle sizes are illustrative.</figcaption>
        </figure>
        <div className="query-overlap__aside">
          <div className="query-overlap__matrix">
            <h3>Overlap matrix</h3>
            <table>
              <thead>
                <tr><td />{queries.map(({ query }) => <th scope="col" key={query}>{query}</th>)}</tr>
              </thead>
              <tbody>
                {overlap.matrix.map((row, rowIndex) => (
                  <tr key={queries[rowIndex].query}>
                    <th scope="row">{queries[rowIndex].query}</th>
                    {row.map((count, columnIndex) => (
                      <td key={columnIndex}
                        className={`query-overlap__cell${rowIndex === columnIndex ? ' query-overlap__cell--total' : ''}`}
                        style={{ backgroundColor: `rgb(88 166 255 / ${count === 0 ? 0 : 0.08 + (count / Math.max(1, ...overlap.matrix.flat())) * 0.32})` }}
                        title={rowIndex === columnIndex
                          ? `${queries[rowIndex].query}: ${count} total papers`
                          : `${queries[rowIndex].query} + ${queries[columnIndex].query}: ${count} shared papers`}>
                        <button className="query-overlap__cell-button" type="button"
                          aria-label={rowIndex === columnIndex
                            ? `${queries[rowIndex].query}: ${count} total papers`
                            : `${queries[rowIndex].query} + ${queries[columnIndex].query}: ${count} shared papers`}
                          aria-pressed={selection.mask === ((1 << rowIndex) | (1 << columnIndex))
                            || (selection.exact && rowIndex !== columnIndex
                              && (selection.mask & ((1 << rowIndex) | (1 << columnIndex))) === ((1 << rowIndex) | (1 << columnIndex)))}
                          aria-controls="query-overlap-detail"
                          onClick={() => setSelection({ mask: (1 << rowIndex) | (1 << columnIndex), exact: false })}>
                          {count}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="query-overlap__detail" id="query-overlap-detail" aria-live="polite">
            <span className="query-overlap__eyebrow">Selected intersection</span>
            <h3>{label(selection.mask)}</h3>
            <p>{selectedPapers.length} {selectedPapers.length === 1 ? 'paper' : 'papers'} {selection.exact
              ? 'in this region only'
              : (selection.mask & (selection.mask - 1)) === 0 ? 'matching this query' : 'shared by these queries'}</p>
            {selectedPapers.length ? <ul>{selectedPapers.slice(0, 3).map(paper => <li key={paper.paperId}>{paper.title}</li>)}</ul>
              : <p className="query-overlap__empty">No papers match this selection.</p>}
            {selectedPapers.length > 3 && <p>+ {selectedPapers.length - 3} more papers</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
