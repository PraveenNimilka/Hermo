import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';

export const apps = Object.freeze(['product-search', 'change-detector', 'json-explorer', 'mcp-tools', 'website-dashboard', 'reliability-lab', 'simple-ai-chat', 'approval-console']);
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
export function validateRuntime(value) {
  const runtime = new URL(value);
  if (runtime.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(runtime.hostname) || runtime.username || runtime.password || runtime.pathname !== '/' || runtime.search || runtime.hash) throw Error('Runtime must be an http://127.0.0.1:PORT loopback origin.');
  return runtime.origin;
}
export function allowedRequest(request) {
  if (!request || typeof request !== 'object' || typeof request.path !== 'string' || request.path.length > 250 || !/^hm_live_[A-Za-z0-9_-]{1,300}$/.test(request.key ?? '')) return false;
  if (request.method === 'GET') return request.path === '/v1/action-contract' || /^\/v1\/runs\/[a-zA-Z0-9_-]{1,100}$/.test(request.path);
  if (request.method !== 'POST') return false;
  if (/^\/v1\/actions\/[a-zA-Z0-9_.-]{1,150}\/versions\/1\/runs$/.test(request.path)) return typeof request.idempotency === 'string' && request.idempotency.length > 0 && request.idempotency.length <= 200 && !/[\r\n]/.test(request.idempotency);
  if (/^\/v1\/runs\/[a-zA-Z0-9_-]{1,100}\/cancel$/.test(request.path)) return true;
  return request.path === '/mcp' && request.body?.jsonrpc === '2.0' && ['initialize', 'tools/list', 'tools/call'].includes(request.body.method);
}
export function createConsumerHost({ app, runtime = 'http://127.0.0.1:4318', port = 4501, fetchImpl = fetch }) {
  if (!apps.includes(app)) throw Error('Choose a supported consumer application.');
  const target = validateRuntime(runtime);
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };
    const send = (status, value, type = 'application/json') => { res.writeHead(status, { ...headers, 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(value) : value); };
    if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: { code: 'ORIGIN_DENIED', message: 'Open this app from its printed loopback address.' } });
    try {
      const url = new URL(req.url, origin);
      if (url.pathname === '/api/request' && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: { code: 'JSON_REQUIRED', message: 'Send application/json.' } });
        const parts = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 131072) return send(413, { error: { code: 'REQUEST_TOO_LARGE', message: 'Limit inputs to 128 KiB.' } }); parts.push(chunk); }
        let request; try { request = JSON.parse(Buffer.concat(parts).toString()); } catch { return send(400, { error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } }); }
        if (!allowedRequest(request)) return send(400, { error: { code: 'REQUEST_DENIED', message: 'Only scoped Hermo REST and MCP consumer requests are supported.' } });
        const upstream = await fetchImpl(target + request.path, { method: request.method, headers: { Authorization: 'Bearer ' + request.key, Accept: 'application/json, text/event-stream', ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...(request.path === '/mcp' ? { 'MCP-Protocol-Version': '2025-03-26' } : {}), ...(request.idempotency ? { 'Idempotency-Key': request.idempotency } : {}) }, ...(request.method === 'POST' ? { body: JSON.stringify(request.body ?? {}) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) });
        const text = await upstream.text();
        let value; try { value = JSON.parse(text); } catch { return send(502, { error: { code: 'INVALID_RUNTIME_RESPONSE', message: 'Hermo returned an unreadable response.' } }); }
        return send(upstream.status, value);
      }
      if (req.method !== 'GET') return send(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not supported.' } });
      if (url.pathname === '/config') return send(200, { app, runtime: target });
      const pathname = url.pathname === '/' ? (app === 'simple-ai-chat' ? '/simple-ai-chat/index.html' : '/shared/index.html') : url.pathname === '/app.mjs' ? '/' + app + '/app.mjs' : url.pathname;
      const appAsset = pathname.startsWith('/' + app + '/') && /^\/[a-z-]+\/[a-z-]+\.(mjs|css|html)$/.test(pathname);
      if (!/^\/shared\/[a-z-]+\.(mjs|css|html)$/.test(pathname) && !appAsset) return send(404, { error: { code: 'NOT_FOUND', message: 'File not found.' } });
      const path = resolve(root, '.' + pathname);
      if (!path.startsWith(root + sep) || pathname.endsWith('host.mjs')) return send(404, { error: { code: 'NOT_FOUND', message: 'File not found.' } });
      const contents = await readFile(path);
      send(200, contents, ({ '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8' })[extname(path)]);
    } catch (error) {
      send(error.code === 'ENOENT' ? 404 : 502, { error: { code: error.code === 'ENOENT' ? 'NOT_FOUND' : 'RUNTIME_UNAVAILABLE', message: error.code === 'ENOENT' ? 'File not found.' : 'Cannot reach the configured local Hermo runtime. Check its process and port.' } });
    }
  });
  server.requestTimeout = 40000; server.headersTimeout = 10000;
  return { server, listen: () => new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => accept(`http://127.0.0.1:${server.address().port}`)); }) };
}
