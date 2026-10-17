import express from 'express';
import { PdfError } from './pdf';
import { resolvePdf, ResolutionError } from './resolve-pdf';
import { readIdentifiers } from './repository-sources';

export const app = express();
const allowedOrigins = new Set((process.env.PDF_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean));
let activeDownloads = 0;

app.disable('x-powered-by');
app.use('/api/pdfs', (req, res, next) => {
  const origin = req.get('Origin');
  res.set('Cache-Control', 'no-store');
  res.vary('Origin');
  if (origin) {
    let localOrigin = false;
    try {
      const url = new URL(origin);
      localOrigin = ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    } catch { /* Reject malformed origins below. */ }
    if (!allowedOrigins.has(origin) && !localOrigin) {
      res.status(403).json({ error: 'This website is not allowed to use the PDF service.' });
      return;
    }
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Expose-Headers', 'X-Pdf-Source');
  }
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});
app.use(express.json({ limit: '8kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/pdfs', async (req, res) => {
  if (typeof req.body?.url !== 'string' || req.body.url.length > 4096) {
    res.status(400).json({ error: 'Provide a PDF URL.' });
    return;
  }
  let externalIds;
  try { externalIds = readIdentifiers(req.body.externalIds); }
  catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid article identifiers.' });
    return;
  }
  if (activeDownloads >= 6) {
    res.status(429).json({ error: 'PDF service is busy. Try again shortly.' });
    return;
  }
  activeDownloads++;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Publisher download timed out.')), 25_000);
  const disconnect = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', disconnect);
  try {
    const pdf = await resolvePdf(req.body.url, controller.signal, { externalIds });
    if (!res.destroyed) {
      res.set('Content-Type', 'application/pdf');
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('X-Pdf-Source', encodeURIComponent(pdf.url));
      res.send(pdf.bytes);
    }
  } catch (error) {
    if (!res.destroyed) {
      const message = controller.signal.aborted ? 'Publisher download timed out or was cancelled.'
        : error instanceof PdfError ? error.message : 'Could not connect to the publisher.';
      res.status(error instanceof PdfError ? error.status : 502).json({
        error: message, ...(error instanceof ResolutionError ? { attempts: error.attempts } : {}),
      });
    }
  } finally {
    clearTimeout(timeout);
    res.off('close', disconnect);
    activeDownloads--;
  }
});

if (require.main === module) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  app.listen(port, host, () => console.log(`PDF service listening on http://${host}:${port}`));
}
