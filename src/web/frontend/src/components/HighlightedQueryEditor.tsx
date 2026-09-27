import { UIEvent, useLayoutEffect, useRef } from 'react';

type TokenType =
  | 'and'
  | 'or'
  | 'not'
  | 'phrase'
  | 'phrase-open'
  | 'wildcard'
  | 'paren'
  | 'proximity'
  | 'term'
  | 'whitespace'
  | 'newline';

type Token = { type: TokenType; value: string };

export type QueryValidation = { line: number; message: string } | null;

export function validateQuery(input: string): QueryValidation {
  const lines = input.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].trim();
    if (!line) continue;
    let depth = 0;
    let inPhrase = false;
    let previous: 'operand' | 'operator' | 'open' | 'close' | null = null;
    const tokens = line.match(/"(?:[^"\\]|\\.)*"|"|\(|\)|\+|\||-|[^\s()+|*-]+|\*/g) ?? [];
    for (const token of tokens) {
      if (token.startsWith('"') && token.length > 1 && token.endsWith('"')) {
        if (previous === 'operand' || previous === 'close') return { line: lineIndex + 1, message: 'Add an operator between terms.' };
        previous = 'operand';
        continue;
      }
      if (token === '"') {
        inPhrase = !inPhrase;
        if (!inPhrase) previous = 'operand';
        continue;
      }
      if (inPhrase) continue;
      if (token === '(') {
        if (previous === 'operand' || previous === 'close') return { line: lineIndex + 1, message: 'Add an operator before “(”.' };
        depth++;
        previous = 'open';
      } else if (token === ')') {
        if (depth === 0) return { line: lineIndex + 1, message: 'Unexpected “)”.' };
        if (previous !== 'operand' && previous !== 'close') return { line: lineIndex + 1, message: 'Add a search term before “)”.' };
        depth--;
        previous = 'close';
      } else if (token === '+' || token === '|' || token === '-') {
        if (token === '-' && (previous === null || previous === 'operator' || previous === 'open')) {
          previous = 'operator';
          continue;
        }
        if (previous !== 'operand' && previous !== 'close') return { line: lineIndex + 1, message: `“${token}” needs a term before it.` };
        previous = 'operator';
      } else if (token === '*') {
        if (previous !== 'operand') return { line: lineIndex + 1, message: 'Use “*” after a search term.' };
      } else if (token) {
        if (previous === 'operand' || previous === 'close') return { line: lineIndex + 1, message: 'Add an operator between terms.' };
        previous = 'operand';
      }
    }
    if (inPhrase) return { line: lineIndex + 1, message: 'Close the unclosed quotation mark.' };
    if (depth > 0) return { line: lineIndex + 1, message: 'Close the unclosed parenthesis.' };
    if (previous === 'operator' || previous === 'open') return { line: lineIndex + 1, message: 'Finish the expression with a search term.' };
  }
  return null;
}

const TERM_STOP = /[\s+|\-()*~"\n]/;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];

    if (ch === '\n') {
      tokens.push({ type: 'newline', value: '\n' });
      i++;
      continue;
    }

    if (ch === ' ' || ch === '\t') {
      let j = i;
      while (j < input.length && (input[j] === ' ' || input[j] === '\t')) j++;
      tokens.push({ type: 'whitespace', value: input.slice(i, j) });
      i = j;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < input.length && input[j] !== '"' && input[j] !== '\n') j++;
      if (j < input.length && input[j] === '"') {
        j++;
        tokens.push({ type: 'phrase', value: input.slice(i, j) });
      } else {
        tokens.push({ type: 'phrase-open', value: input.slice(i, j) });
      }
      i = j;
      continue;
    }

    if (ch === '~') {
      let j = i + 1;
      while (j < input.length && /\d/.test(input[j])) j++;
      tokens.push({ type: 'proximity', value: input.slice(i, j) });
      i = j;
      continue;
    }

    if (ch === '+') {
      tokens.push({ type: 'and', value: ch });
      i++;
      continue;
    }
    if (ch === '|') {
      tokens.push({ type: 'or', value: ch });
      i++;
      continue;
    }
    if (ch === '-') {
      tokens.push({ type: 'not', value: ch });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i++;
      continue;
    }
    if (ch === '*') {
      tokens.push({ type: 'wildcard', value: ch });
      i++;
      continue;
    }

    let j = i;
    while (j < input.length && !TERM_STOP.test(input[j])) j++;
    if (j === i) j++;
    tokens.push({ type: 'term', value: input.slice(i, j) });
    i = j;
  }
  return tokens;
}

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export default function HighlightedQueryEditor({ id, value, onChange, placeholder }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const pre = preRef.current;
    if (!pre) return;
    pre.scrollTop = event.currentTarget.scrollTop;
    pre.scrollLeft = event.currentTarget.scrollLeft;
  };

  useLayoutEffect(() => {
    const pre = preRef.current;
    const textarea = textareaRef.current;
    if (!pre || !textarea) return;
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  }, [value]);

  const tokens = tokenize(value);
  const trailingNewline = value.endsWith('\n') ? '\n' : '';

  return (
    <div className="query-editor">
      <pre className="query-editor__highlight" aria-hidden="true" ref={preRef}>
        {tokens.map((token, index) => (
          <span key={index} className={`qtok qtok--${token.type}`}>
            {token.value}
          </span>
        ))}
        {trailingNewline}
      </pre>
      <textarea
        id={id}
        ref={textareaRef}
        className="query-editor__textarea"
        value={value}
        onChange={event => onChange(event.target.value)}
        onScroll={syncScroll}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
}
