import type { Paper } from '../context/SearchContext';

function escapeBibtex(value: string): string {
  const escapes: Record<string, string> = {
    '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}',
    '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_',
    '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
  };
  return value.replace(/[\\{}&%$#_~^]/g, character => escapes[character]).replace(/\s+/g, ' ').trim();
}

export function toBibtex(papers: Paper[]): string {
  const usedKeys = new Set<string>();
  return papers.map((paper, index) => {
    // Prefer specific container types over broader classifications on mixed records.
    const types = paper.publicationTypes ?? [];
    const entryType = types.includes('Conference') ? 'inproceedings'
      : types.includes('BookSection') ? 'incollection'
        : types.includes('Book') ? 'book'
          : types.includes('JournalArticle') ? 'article' : 'misc';
    const venueField = entryType === 'article' ? 'journal'
      : entryType === 'inproceedings' || entryType === 'incollection' ? 'booktitle'
        : 'howpublished';
    const baseKey = `s2_${paper.paperId.replace(/[^a-zA-Z0-9_-]/g, '') || index + 1}`;
    let key = baseKey;
    for (let suffix = 2; usedKeys.has(key); suffix++) key = `${baseKey}_${suffix}`;
    usedKeys.add(key);
    const fields: [string, string | number | null | undefined][] = [
      ['title', paper.title],
      ['author', paper.authors?.map(author => escapeBibtex(author.name)).filter(Boolean).join(' and ')],
      ['year', paper.year],
      [venueField, paper.venue],
      ['abstract', paper.abstract],
      ['doi', paper.externalIds?.DOI],
      ['url', paper.url],
      ['eprint', paper.externalIds?.ArXiv],
      ['archivePrefix', paper.externalIds?.ArXiv ? 'arXiv' : undefined],
    ];
    const content = fields
      .filter(([, value]) => value != null && String(value).trim() !== '')
      .map(([name, value]) => `  ${name} = {${name === 'author' ? value : escapeBibtex(String(value))}}`);
    return `@${entryType}{${key},\n${content.join(',\n')}\n}`;
  }).join('\n\n');
}
