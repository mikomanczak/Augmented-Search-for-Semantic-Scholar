import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toBibtex } from '../src/lib/bibtex.ts';

test('exports available citation metadata and keeps author order', () => {
  const result = toBibtex([{
    paperId: 'abc', title: 'A paper', year: 2024,
    authors: [{ name: 'Jane Doe' }, { name: 'José Smith' }],
    venue: 'A conference', abstract: 'An abstract.',
    externalIds: { DOI: '10.1234/example', ArXiv: '2401.12345' },
    url: 'https://example.com/paper',
  }]);
  assert.equal(result, `@misc{s2_abc,
  title = {A paper},
  author = {Jane Doe and José Smith},
  year = {2024},
  howpublished = {A conference},
  abstract = {An abstract.},
  doi = {10.1234/example},
  url = {https://example.com/paper},
  eprint = {2401.12345},
  archivePrefix = {arXiv}
}`);
});

test('escapes TeX syntax and normalizes multiline metadata', () => {
  const result = toBibtex([{
    paperId: 'special', title: 'A {B} & 50% $x$ #1_a~b^c\\d\nnext',
    authors: [{ name: 'A & B' }],
  }]);
  assert.ok(result.includes(String.raw`title = {A \{B\} \& 50\% \$x\$ \#1\_a\textasciitilde{}b\textasciicircum{}c\textbackslash{}d next}`));
  assert.ok(result.includes(String.raw`author = {A \& B}`));
});

test('omits missing fields and produces unique safe citation keys', () => {
  assert.equal(toBibtex([]), '');
  const result = toBibtex([
    { paperId: 'a,b', title: 'First', year: null, abstract: '  ', authors: [] },
    { paperId: 'ab', title: 'Second' },
    { paperId: '', title: 'Third' },
  ]);
  assert.equal(result, '@misc{s2_ab,\n  title = {First}\n}\n\n@misc{s2_ab_2,\n  title = {Second}\n}\n\n@misc{s2_3,\n  title = {Third}\n}');
});

test('maps publication types and venue fields with deterministic precedence', () => {
  const cases: [string[] | null | undefined, string, string][] = [
    [['JournalArticle', 'Review'], 'article', 'journal'],
    [['Conference'], 'inproceedings', 'booktitle'],
    [['JournalArticle', 'Conference'], 'inproceedings', 'booktitle'],
    [['BookSection', 'Book'], 'incollection', 'booktitle'],
    [['Book'], 'book', 'howpublished'],
    [['Dataset'], 'misc', 'howpublished'],
    [['FutureType'], 'misc', 'howpublished'],
    [[], 'misc', 'howpublished'],
    [null, 'misc', 'howpublished'],
    [undefined, 'misc', 'howpublished'],
  ];
  for (const [publicationTypes, entryType, venueField] of cases) {
    assert.equal(toBibtex([{ paperId: 'abc', title: 'Example', publicationTypes, venue: 'Venue' }]),
      `@${entryType}{s2_abc,\n  title = {Example},\n  ${venueField} = {Venue}\n}`);
  }
});
