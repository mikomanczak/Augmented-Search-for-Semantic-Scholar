import { PointerEvent, useRef } from 'react';

const OPERATORS = [
  ['+', 'for AND operation'],
  ['|', 'for OR operation'],
  ['-', 'negates a term'],
  ['" "', 'collects terms into a phrase'],
  ['*', 'can be used to match a prefix'],
  ['( )', 'for precedence'],
  ['~N', 'after a word matches within the edit distance of N (Defaults to 2 if N is omitted)'],
  ['"..."~N', 'after a phrase matches with the phrase terms separated up to N terms apart'],
];

const EXAMPLES = [
  ['fish ladder', 'matches papers that contain “fish” and “ladder”'],
  ['fish -ladder', 'matches papers that contain “fish” but not “ladder”'],
  ['fish | ladder', 'matches papers that contain “fish” or “ladder”'],
  ['"fish ladder"', 'matches papers that contain the phrase “fish ladder”'],
  ['(fish ladder) | outflow', 'matches papers that contain “fish” and “ladder” OR “outflow”'],
  ['fish~', 'matches papers that contain “fish”, “fist”, “fihs”, etc.'],
  ['"fish ladder"~3', 'matches papers that contain the phrase “fish ladder” or “fish is on a ladder”'],
];

function SyntaxList({ items }: { items: string[][] }) {
  return (
    <ul className="syntax-list">
      {items.map(([syntax, description]) => (
        <li key={syntax}>
          <code>{syntax}</code>
          <span>{description}</span>
        </li>
      ))}
    </ul>
  );
}

export default function QuerySyntaxHelp({
  isCollapsed,
  onCollapsedChange,
  onDragExpand,
}: {
  isCollapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onDragExpand: (clientX: number) => void;
}) {
  const dragStartX = useRef<number | null>(null);
  const dragged = useRef(false);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isCollapsed || event.button !== 0) return;
    dragStartX.current = event.clientX;
    dragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null || event.buttons !== 1) return;
    if (Math.abs(event.clientX - dragStartX.current) < 4 && !dragged.current) return;
    dragged.current = true;
    onDragExpand(event.clientX);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current !== null && dragged.current) onDragExpand(event.clientX);
    dragStartX.current = null;
  };

  return (
    <aside className={`syntax-help${isCollapsed ? ' syntax-help--collapsed' : ''}`} aria-label="Query syntax help">
      <div
        className="syntax-help__header"
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          onCollapsedChange(!isCollapsed);
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onCollapsedChange(!isCollapsed);
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={isCollapsed ? 'Expand syntax help' : 'Collapse syntax help'}
        aria-expanded={!isCollapsed}
      >
        <span className="syntax-help__title">QUERY SYNTAX</span>
        {isCollapsed ? (
          <span className="syntax-help__toggle" aria-hidden="true">‹</span>
        ) : (
          <span className="syntax-help__toggle" aria-hidden="true">›</span>
        )}
      </div>
      {!isCollapsed && (
        <div className="syntax-help__content">
          <p className="syntax-heading">Queries support the following syntax:</p>
          <SyntaxList items={OPERATORS} />
          <p className="syntax-examples-heading">Examples:</p>
          <SyntaxList items={EXAMPLES} />
        </div>
      )}
    </aside>
  );
}
