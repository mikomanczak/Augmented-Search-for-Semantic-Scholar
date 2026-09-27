import { useState } from 'react';

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

export default function QuerySyntaxHelp() {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <aside className={`syntax-help${isCollapsed ? ' syntax-help--collapsed' : ''}`} aria-label="Query syntax help">
      <div
        className="syntax-help__header"
        onClick={isCollapsed ? () => setIsCollapsed(false) : undefined}
        onKeyDown={isCollapsed ? event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setIsCollapsed(false);
          }
        } : undefined}
        role={isCollapsed ? 'button' : undefined}
        tabIndex={isCollapsed ? 0 : undefined}
        aria-label={isCollapsed ? 'Expand syntax help' : undefined}
      >
        <span className="syntax-help__title">QUERY SYNTAX</span>
        {isCollapsed ? (
          <span className="syntax-help__toggle" aria-hidden="true">‹</span>
        ) : (
          <button
            className="syntax-help__toggle"
            type="button"
            aria-label="Collapse syntax help"
            aria-expanded="true"
            onClick={() => setIsCollapsed(true)}
          >
            <span aria-hidden="true">›</span>
          </button>
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
