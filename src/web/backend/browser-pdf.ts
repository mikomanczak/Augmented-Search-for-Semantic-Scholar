import { chromium, type Download, type Page } from 'playwright';
import { articleLinks } from './article-links';
import { createBrowserProxy } from './browser-proxy';
import { MAX_PDF_BYTES, PdfError } from './pdf';

export type BrowserPdf = { bytes: Buffer; url: string };

// Experimental only: callers must impose a deadline and serialize browser jobs.
// It uses a fresh profile, never the user's Chrome session or stored credentials.
export async function browserPdf(url: string, signal: AbortSignal, options: {
  createProxy?: typeof createBrowserProxy;
  renderWaitMs?: number;
} = {}): Promise<BrowserPdf> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new PdfError('Invalid browser article URL.', 400);
  signal.throwIfAborted();
  const proxy = await (options.createProxy ?? createBrowserProxy)(signal);
  let browser;
  try {
    browser = await chromium.launch({
      headless: true, chromiumSandbox: true, proxy: proxy.proxy, timeout: 15_000,
      args: ['--proxy-bypass-list=<-loopback>', '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
    });
    if (signal.aborted) { await browser.close(); signal.throwIfAborted(); }
    const close = () => { void browser!.close().catch(() => {}); };
    signal.addEventListener('abort', close, { once: true });
    try {
      const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
      await context.route('**/*', async route => {
        const request = route.request();
        const resource = new URL(request.url());
        if (!['http:', 'https:'].includes(resource.protocol) || !['GET', 'HEAD'].includes(request.method())
          || ['font', 'media'].includes(request.resourceType())) await route.abort();
        else await route.continue();
      });
      await context.routeWebSocket('**/*', socket => socket.close());
      let found: BrowserPdf | undefined;
      let lastError = 'The browser could not find a downloadable PDF.';
      let finish!: (result: BrowserPdf) => void;
      const completed = new Promise<BrowserPdf>(resolve => { finish = resolve; });
      function accept(bytes: Buffer, source: string) {
        if (bytes.length > MAX_PDF_BYTES) { lastError = 'Browser PDF exceeds the 20 MB file limit.'; return; }
        if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return;
        if (!found) { found = { bytes, url: source }; finish(found); }
      }
      async function capture(download: Download, page: Page) {
        try {
          const stream = await download.createReadStream();
          if (!stream) return;
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of stream) {
            size += chunk.length;
            if (size > MAX_PDF_BYTES) { await download.cancel(); lastError = 'Browser PDF exceeds the 20 MB file limit.'; return; }
            chunks.push(Buffer.from(chunk));
          }
          accept(Buffer.concat(chunks, size), download.url().startsWith('blob:') ? page.url() : download.url());
        } catch { /* Failed or cancelled downloads are reflected in the final result. */ }
      }
      context.on('page', page => page.on('download', download => { void capture(download, page); }));
      context.on('response', response => {
        if (!(response.headers()['content-type'] ?? '').toLowerCase().includes('application/pdf')) return;
        if (Number(response.headers()['content-length']) > MAX_PDF_BYTES) { lastError = 'Browser PDF exceeds the 20 MB file limit.'; return; }
        void response.body().then(bytes => accept(bytes, response.url())).catch(() => {});
      });
      const page = await context.newPage();
      const queue = [url];
      const seen = new Set<string>();
      for (let attempt = 0; attempt < 3 && queue.length && !found; attempt++) {
        signal.throwIfAborted();
        const target = queue.shift()!;
        if (seen.has(target)) { attempt--; continue; }
        seen.add(target);
        try {
          const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 10_000 });
          if (response && response.status() >= 400) lastError = `Browser navigation returned HTTP ${response.status()}.`;
        } catch (error) {
          lastError = error instanceof Error ? error.message.split('\n')[0] : lastError;
        }
        await Promise.race([completed, page.waitForTimeout(options.renderWaitMs ?? 2_000)]);
        if (found) break;
        const captcha = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha, input[name="cf-turnstile-response"]').count();
        if (captcha) throw new PdfError('The publisher requires a CAPTCHA; browser fallback stopped.');
        const content = await page.content();
        queue.unshift(...articleLinks(content, page.url()).urls.filter(link => !seen.has(link)));
        const buttons = page.getByRole('button', { name: /download.*pdf|pdf.*download|download (?:article|full text)/i });
        if (await buttons.count() && await buttons.first().isVisible()) {
          await buttons.first().click({ timeout: 2_000 }).catch(() => {});
          await Promise.race([completed, page.waitForTimeout(2_000)]);
        }
      }
      if (found) return found;
      signal.throwIfAborted();
      if (proxy.blocked.length) lastError += ` ${proxy.blocked[0]}`;
      throw new PdfError(lastError);
    } finally {
      signal.removeEventListener('abort', close);
      await browser.close();
    }
  } finally { proxy.close(); }
}
