import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request } from 'node:http';
import { connect, createServer as tcpServer } from 'node:net';
import { once } from 'node:events';
import { createBrowserProxy, publicProxyTarget } from './browser-proxy';

test('browser proxy rejects private addresses, mixed DNS, credentials and nonstandard ports', async () => {
  for (const value of ['http://127.0.0.1/', 'https://[::1]/', 'http://169.254.169.254/', 'http://192.168.0.1/',
    'https://user:pass@example.org/', 'https://example.org:8443/', 'file:///etc/passwd']) {
    await assert.rejects(publicProxyTarget(new URL(value)));
  }
  await assert.rejects(publicProxyTarget(new URL('https://public.example'), {
    resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }], connect: (host, port) => connect({ host, port }), request,
  }), /Private or reserved/);
});

test('HTTP forwarding pins checked DNS, requires proxy authentication and rechecks redirects', async () => {
  const fixture = createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://127.0.0.1/private' }); res.end(); }
    else res.end('public fixture');
  });
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const port = (fixture.address() as { port: number }).port;
  let forwarded = 0;
  const proxy = await createBrowserProxy(new AbortController().signal, {
    resolve: async () => [{ address: '8.8.8.8', family: 4 }], connect: (host, port) => connect({ host, port }),
    request: (url, options, callback) => {
      assert.equal(typeof options.lookup, 'function');
      assert.equal(options.family, 4);
      forwarded++;
      return request(`http://127.0.0.1:${port}${url.pathname}`, { ...options, lookup: undefined }, callback);
    },
  });
  const address = new URL(proxy.proxy.server);
  const auth = `Basic ${Buffer.from(`${proxy.proxy.username}:${proxy.proxy.password}`).toString('base64')}`;
  const get = (url: string, authorized = true) => new Promise<number>((resolve, reject) => {
    const req = request({ hostname: address.hostname, port: address.port, path: url,
      headers: authorized ? { 'Proxy-Authorization': auth } : {} }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
    req.on('error', reject); req.end();
  });
  try {
    assert.equal(await get('http://public.example/file', false), 407);
    assert.equal(forwarded, 0);
    assert.equal(await get('http://public.example/file'), 200);
    assert.equal(await get('http://public.example/redirect'), 302);
    assert.equal(await get('http://127.0.0.1/private'), 403);
    assert.equal(forwarded, 2);
  } finally { proxy.close(); fixture.closeAllConnections(); fixture.close(); }
});

test('TLS tunnels pin the checked public address and reject private targets before dialing', async () => {
  const fixture = tcpServer(socket => socket.on('data', chunk => socket.write(chunk)));
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const port = (fixture.address() as { port: number }).port;
  const dialed: string[] = [];
  const controller = new AbortController();
  const proxy = await createBrowserProxy(controller.signal, {
    resolve: async () => [{ address: '8.8.8.8', family: 4 }], request,
    connect: (address, targetPort) => { dialed.push(address); assert.equal(targetPort, 443); return connect({ host: '127.0.0.1', port }); },
  });
  const auth = `Basic ${Buffer.from(`${proxy.proxy.username}:${proxy.proxy.password}`).toString('base64')}`;
  async function tunnel(target: string) {
    const address = new URL(proxy.proxy.server);
    const socket = connect({ host: address.hostname, port: Number(address.port) });
    await once(socket, 'connect');
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: ${auth}\r\n\r\n`);
    const [data] = await once(socket, 'data');
    return { socket, status: data.toString() };
  }
  try {
    const blocked = await tunnel('127.0.0.1:443');
    assert.match(blocked.status, /403/); blocked.socket.destroy();
    assert.equal(dialed.length, 0);
    const allowed = await tunnel('public.example:443');
    assert.match(allowed.status, /200 Connection Established/);
    allowed.socket.write('test');
    assert.equal((await once(allowed.socket, 'data'))[0].toString(), 'test');
    assert.deepEqual(dialed, ['8.8.8.8']);
    const closed = once(allowed.socket, 'close');
    controller.abort();
    await closed;
  } finally { proxy.close(); fixture.close(); }
});
