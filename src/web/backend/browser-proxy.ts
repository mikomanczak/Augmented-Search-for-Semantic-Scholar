import { lookup } from 'node:dns/promises';
import { createServer, request, type IncomingMessage, type RequestOptions, type ClientRequest } from 'node:http';
import { connect, isIP, type Socket } from 'node:net';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { isPublicAddress, PdfError } from './pdf';

type ProxyDependencies = {
  resolve: (host: string) => Promise<{ address: string; family: number }[]>;
  connect: (address: string, port: number) => Socket;
  request: (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
};
const defaults: ProxyDependencies = {
  resolve: host => lookup(host, { all: true }),
  connect: (host, port) => connect({ host, port }),
  request,
};

export async function publicProxyTarget(url: URL, dependencies = defaults) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))) {
    throw new PdfError('Browser requests require public HTTP(S) URLs on standard ports.', 400);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await dependencies.resolve(host);
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) {
    throw new PdfError('Private or reserved browser destinations are not allowed.', 400);
  }
  return addresses.find(entry => entry.family === 4) ?? addresses[0];
}

// All Chromium HTTP traffic and TLS tunnels pass through this authenticated,
// loopback-only proxy. DNS is checked and pinned before opening each connection.
export async function createBrowserProxy(signal: AbortSignal, dependencies = defaults) {
  signal.throwIfAborted();
  const username = 'pdf-browser';
  const password = randomBytes(24).toString('hex');
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const sockets = new Set<Socket>();
  const blocked: string[] = [];
  let bytes = 0;
  let connections = 0;
  let closed = false;
  const server = createServer();
  const stop = () => {
    if (closed) return;
    closed = true;
    for (const socket of sockets) socket.destroy();
    server.close();
  };
  function track(socket: Socket) {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(10_000, () => socket.destroy());
    socket.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 50 * 1024 * 1024) { blocked.push('Browser exceeded the 50 MB transfer limit.'); stop(); }
    });
    return socket;
  }
  server.on('connection', socket => track(socket));
  const authorized = (req: IncomingMessage) => req.headers['proxy-authorization'] === authorization;
  function reject(socket: Socket, status: number) {
    socket.end(`HTTP/1.1 ${status} ${status === 407 ? 'Proxy Authentication Required' : 'Forbidden'}\r\n${status === 407 ? 'Proxy-Authenticate: Basic realm="PDF browser"\r\n' : ''}Connection: close\r\nContent-Length: 0\r\n\r\n`);
  }
  server.on('connect', (req, client, head) => {
    const socket = client as Socket;
    if (!authorized(req)) { reject(socket, 407); return; }
    void (async () => {
      const url = new URL(`https://${req.url}`);
      if (url.pathname !== '/' || url.search || url.hash || ++connections > 100) throw new Error('Invalid browser tunnel.');
      const target = await publicProxyTarget(url, dependencies);
      signal.throwIfAborted();
      if (closed || socket.destroyed) return;
      const upstream = track(dependencies.connect(target.address, 443));
      socket.once('close', () => upstream.destroy());
      upstream.once('close', () => socket.destroy());
      await once(upstream, 'connect');
      if (closed || socket.destroyed) { upstream.destroy(); return; }
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    })().catch(error => { blocked.push(error instanceof Error ? error.message : 'Browser tunnel blocked.'); reject(socket, 403); });
  });
  server.on('request', (req, res) => {
    if (!authorized(req)) { res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="PDF browser"' }); res.end(); return; }
    void (async () => {
      if (!['GET', 'HEAD'].includes(req.method ?? '') || ++connections > 100) throw new Error('Browser method or connection limit rejected.');
      const url = new URL(req.url!);
      if (url.protocol !== 'http:') throw new Error('Use a TLS tunnel for HTTPS.');
      const target = await publicProxyTarget(url, dependencies);
      signal.throwIfAborted();
      if (closed || res.destroyed) return;
      const headers: typeof req.headers = { ...req.headers, host: url.host };
      delete headers['proxy-authorization'];
      delete headers['proxy-connection'];
      const upstream = dependencies.request(url, {
        method: req.method, headers, agent: false, signal,
        family: target.family,
        lookup: (_host, _options, callback) => callback(null, target.address, target.family),
      }, response => { res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res); });
      upstream.on('socket', socket => track(socket));
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      res.once('close', () => upstream.destroy());
      upstream.end();
    })().catch(error => {
      blocked.push(error instanceof Error ? error.message : 'Browser request blocked.');
      if (!res.headersSent) res.writeHead(403);
      res.end();
    });
  });
  signal.addEventListener('abort', stop, { once: true });
  server.listen(0, '127.0.0.1');
  try { await once(server, 'listening'); }
  catch (error) { signal.removeEventListener('abort', stop); stop(); throw error; }
  return {
    proxy: { server: `http://127.0.0.1:${(server.address() as { port: number }).port}`, username, password },
    blocked,
    close: () => { signal.removeEventListener('abort', stop); stop(); },
  };
}
