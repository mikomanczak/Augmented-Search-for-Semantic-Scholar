import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browserPdf } from './browser-pdf';

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: npm run experiment:browser -- <comparison-report.json> <output-directory>');
  const report = JSON.parse(await readFile(input, 'utf8'));
  const renderWaitMs = Math.min(8_000, Math.max(1_000, Number(process.env.BROWSER_RENDER_WAIT_MS) || 2_000));
  const papers = (report.modes?.backend?.papers ?? report.papers).filter((paper: { status: string }) => paper.status === 'failed');
  await mkdir(output, { recursive: true });
  const results: Record<string, unknown>[] = [];
  for (const [index, paper] of papers.entries()) {
    const start = Date.now();
    const record: Record<string, unknown> = { paperId: paper.paperId, title: paper.title, url: paper.url };
    try {
      const pdf = await browserPdf(paper.url, AbortSignal.timeout(20_000), { renderWaitMs });
      const filename = `${String(index + 1).padStart(3, '0')}-${String(paper.paperId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100)}.pdf`;
      await writeFile(join(output, filename), pdf.bytes);
      Object.assign(record, { status: 'downloaded', filename, resolvedUrl: pdf.url, bytes: pdf.bytes.length });
    } catch (error) {
      Object.assign(record, { status: 'failed', reason: error instanceof Error ? error.message.split('\n')[0] : 'Browser download failed.' });
    }
    record.elapsedSeconds = Math.round((Date.now() - start) / 100) / 10;
    results.push(record);
    const downloaded = results.filter(result => result.status === 'downloaded').length;
    await writeFile(join(output, 'browser-fallback-report.json'), JSON.stringify({ createdAt: new Date().toISOString(), renderWaitMs, total: papers.length, completed: results.length, downloaded, papers: results }, null, 2));
    console.log(JSON.stringify({ completed: results.length, total: papers.length, downloaded, ...record }));
  }
  console.log(`Report saved to ${resolve(output, 'browser-fallback-report.json')}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
