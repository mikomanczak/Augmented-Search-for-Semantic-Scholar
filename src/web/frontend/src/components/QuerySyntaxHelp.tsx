import { PointerEvent, useRef } from 'react';

const OPERATORS = [
  ['+', 'require both terms (AND)'],
  ['|', 'match either term (OR)'],
  ['-', 'exclude a term'],
  ['" "', 'match an exact phrase'],
  ['*', 'match a word prefix'],
  ['( )', 'group terms'],
  ['~N', 'allow N edits to a word (default: 2)'],
  ['"..."~N', 'allow up to N words between phrase terms'],
];

const EXAMPLES = [
  ['fish ladder', 'both “fish” and “ladder”'],
  ['fish -ladder', '“fish” without “ladder”'],
  ['fish | ladder', '“fish” or “ladder”'],
  ['"fish ladder"', 'exact phrase “fish ladder”'],
  ['(fish ladder) | outflow', 'both “fish” and “ladder”, or “outflow”'],
  ['fish~', '“fish”, “fist”, “fihs”, etc.'],
  ['"fish ladder"~3', '“fish ladder” or “fish is on a ladder”'],
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
    if (event.button !== 0) return;
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
        <span className="syntax-help__title">SYNTAX CHEATSHEET</span>
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
