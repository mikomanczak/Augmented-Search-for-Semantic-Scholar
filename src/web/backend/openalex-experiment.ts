import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeDoi, openAlexSources } from './openalex';
import { resolvePdf, ResolutionError } from './resolve-pdf';

async function main() {
  const [input, locationsFile, output] = process.argv.slice(2);
  if (!input || !locationsFile || !output) throw new Error('Usage: npm run experiment:openalex -- <download-report.json> <openalex-response.json> <output-directory>');
  const baseline = JSON.parse(await readFile(input, 'utf8'));
  const data = JSON.parse(await readFile(locationsFile, 'utf8'));
  const works = new Map(data.results.map((work: { doi: string }) => [normalizeDoi(work.doi), work]));
  const papers = (baseline.modes?.backend?.papers ?? baseline.papers).filter((paper: { status: string }) => paper.status === 'failed');
  const results: Record<string, unknown>[] = [];
  await mkdir(output, { recursive: true });
  const canonical = (value: string) => { try { const url = new URL(value); url.hash = ''; return url.href; } catch { return value; } };
  for (const [index, paper] of papers.entries()) {
    const doi = normalizeDoi(paper.externalIds?.DOI);
    const sources = openAlexSources(works.get(doi), doi ?? '');
    const seen = new Set<string>([canonical(paper.url), ...(paper.attempts ?? []).map((attempt: { url: string }) => canonical(attempt.url))]);
    const attempts: Record<string, unknown>[] = [];
    const record: Record<string, unknown> = { paperId: paper.paperId, title: paper.title, doi, matched: works.has(doi), sources, attempts, status: 'failed' };
    for (const source of sources) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      try {
        const pdf = await resolvePdf(source.url, AbortSignal.timeout(25_000));
        const filename = `${String(index + 1).padStart(3, '0')}-${String(paper.paperId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100)}.pdf`;
        await writeFile(join(output, filename), pdf.bytes);
        Object.assign(record, { status: 'downloaded', filename, bytes: pdf.bytes.length, resolvedUrl: pdf.url, location: source });
        attempts.push({ ...source, status: 'downloaded', resolvedUrl: pdf.url });
        break;
      } catch (error) {
        const detail = error instanceof ResolutionError ? error.attempts : [];
        detail.forEach(attempt => seen.add(canonical(attempt.url)));
        attempts.push({ ...source, status: 'failed', reason: error instanceof Error ? error.message : 'Download failed.', attempts: detail });
      }
    }
    results.push(record);
    const downloaded = results.filter(result => result.status === 'downloaded').length;
    await writeFile(join(output, 'openalex-download-report.json'), JSON.stringify({ createdAt: new Date().toISOString(), total: papers.length, completed: results.length, downloaded, papers: results }, null, 2));
    console.log(JSON.stringify({ completed: results.length, total: papers.length, downloaded, title: paper.title, status: record.status, sources: sources.length, attempted: attempts.length, resolvedUrl: record.resolvedUrl }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
