import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { app } from './index';
import { fetchPdf, isPublicAddress, MAX_PDF_BYTES } from './pdf';

test('rejects private, loopback, link-local, mapped and reserved addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '224.0.0.1', '192.0.2.1', '::1', '::', 'fc00::1', 'fe80::1',
    '::ffff:127.0.0.1', '::ffff:10.1.2.3', '2001:db8::1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('downloads PDFs and validates every redirect and response', async t => {
  const pdf = Buffer.from('%PDF-1.4\nfixture\n%%EOF');
  const server = createServer((req, res) => {
    switch (req.url) {
      case '/pdf': res.end(pdf); break;
      case '/redirect': res.writeHead(302, { Location: '/pdf' }); res.end(); break;
      case '/private': res.writeHead(302, { Location: 'http://127.0.0.1/pdf' }); res.end(); break;
      case '/loop': res.writeHead(302, { Location: '/loop' }); res.end(); break;
      case '/html': res.end('<html>Publisher landing page</html>'); break;
      case '/missing': res.writeHead(403); res.end(); break;
      case '/large': res.writeHead(200, { 'Content-Length': MAX_PDF_BYTES + 1 }); res.end(); break;
      case '/large-stream': res.write('%PDF-'); res.end(Buffer.alloc(MAX_PDF_BYTES)); break;
      case '/slow': break;
      default: res.writeHead(404); res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const resolved: string[] = [];
  const dependencies = {
    resolve: async (hostname: string) => {
      resolved.push(hostname);
      return [{ address: '8.8.8.8', family: 4 }];
    },
    // Only tests route the validated public target to this local fixture server.
    request: (url: URL, options: Parameters<typeof httpRequest>[1]) => {
      assert.equal(typeof options.lookup, 'function');
      assert.equal(options.family, 4);
      return httpRequest(`http://127.0.0.1:${port}${url.pathname}`, { ...options, lookup: undefined });
    },
  };
  const get = (path: string) => fetchPdf(`https://publisher.example${path}`, new AbortController().signal, dependencies);
  try {
    await t.test('returns PDF bytes and follows relative redirects', async () => {
      assert.deepEqual(await get('/redirect'), pdf);
      assert.equal(resolved.length, 2);
    });
    await t.test('rejects HTML, publisher errors and oversized files', async () => {
      await assert.rejects(get('/html'), /non-PDF/);
      await assert.rejects(get('/missing'), /HTTP 403/);
      await assert.rejects(get('/large'), /20 MB/);
      await assert.rejects(get('/large-stream'), /20 MB/);
    });
    await t.test('rejects private redirects, mixed DNS results and redirect loops', async () => {
      await assert.rejects(get('/private'), /Private or reserved/);
      await assert.rejects(get('/loop'), /too many/);
      await assert.rejects(fetchPdf('https://publisher.example/pdf', new AbortController().signal, {
        ...dependencies,
        resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }],
      }), /Private or reserved/);
    });
    await t.test('rejects unsupported protocols, credentials and ports', async () => {
      for (const url of ['file:///etc/passwd', 'http://user:pass@publisher.example/', 'https://publisher.example:8443/', 'invalid']) {
        await assert.rejects(fetchPdf(url, new AbortController().signal, dependencies));
      }
    });
    await t.test('aborts a stalled publisher request', async () => {
      await assert.rejects(fetchPdf('https://publisher.example/slow', AbortSignal.timeout(30), dependencies), /abort/i);
    });
    await t.test('aborts a stalled DNS lookup', async () => {
      await assert.rejects(fetchPdf('https://publisher.example/pdf', AbortSignal.timeout(30), {
        ...dependencies, resolve: () => new Promise(() => {}),
      }), /timeout/i);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('API rejects invalid requests and unapproved browser origins', async () => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/pdfs`;
  try {
    const blocked = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://unapproved.example' } });
    assert.equal(blocked.status, 403);
    const allowed = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const invalid = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(invalid.status, 400);
    const privateUrl = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'http://127.0.0.1/' }),
    });
    assert.equal(privateUrl.status, 400);
    assert.match((await privateUrl.json() as { error: string }).error, /Private or reserved/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
