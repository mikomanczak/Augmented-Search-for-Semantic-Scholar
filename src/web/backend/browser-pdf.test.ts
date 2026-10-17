import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { browserPdf } from './browser-pdf';
import { createBrowserProxy } from './browser-proxy';

test('headless browser downloads a PDF exposed only by a JavaScript button', { skip: process.env.RUN_BROWSER_TESTS !== '1' }, async () => {
  const pdf = Buffer.from('%PDF-1.4\nheadless fixture\n%%EOF');
  const fixture = createServer((req, res) => {
    if (req.url === '/file') { res.setHeader('Content-Type', 'application/pdf'); res.end(pdf); }
    else {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<script>setTimeout(()=>{const b=document.createElement('button');b.textContent='Download PDF';b.onclick=()=>location.href='/file';document.body.appendChild(b)},100)</script>`);
    }
  });
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const port = (fixture.address() as { port: number }).port;
  try {
    const result = await browserPdf('http://public.example/article', AbortSignal.timeout(20_000), {
      createProxy: signal => createBrowserProxy(signal, {
        resolve: async () => [{ address: '8.8.8.8', family: 4 }], connect: (host, port) => connect({ host, port }),
        request: (url, options, callback) => {
          assert.equal(typeof options.lookup, 'function');
          return request(`http://127.0.0.1:${port}${url.pathname}`, { ...options, lookup: undefined }, callback);
        },
      }),
    });
    assert.deepEqual(result.bytes, pdf);
    assert.equal(result.url, 'http://public.example/file');
  } finally { fixture.closeAllConnections(); fixture.close(); }
});
