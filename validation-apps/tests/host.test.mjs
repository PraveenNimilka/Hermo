import test from 'node:test';
import assert from 'node:assert/strict';
import { createConsumerHost, validateRuntime, allowedRequest, apps } from '../shared/host.mjs';
test('consumer proxy only allows an explicit loopback runtime and scoped public routes', () => {
  assert.equal(validateRuntime('http://localhost:4336'), 'http://localhost:4336');
  for (const runtime of ['https://example.com', 'http://127.0.0.1:4318/private', 'http://user:secret@localhost:4318', 'http://localhost:4318/?target=evil']) assert.throws(() => validateRuntime(runtime));
  const base = { key: 'hm_live_fixture', method: 'GET', path: '/v1/action-contract' };
  assert.equal(allowedRequest(base), true);
  for (const path of ['/studio/export', '/health', '/v1/runs/a/../../studio', '//evil.example/v1/action-contract', '/v1/runs/a?query=x']) assert.equal(allowedRequest({ ...base, path }), false);
  assert.equal(allowedRequest({ ...base, method: 'POST', path: '/mcp', body: { jsonrpc: '2.0', method: 'tools/list' } }), true);
  assert.equal(allowedRequest({ ...base, method: 'POST', path: '/mcp', body: { jsonrpc: '2.0', method: 'arbitrary/eval' } }), false);
});
test('each independent application serves its own source and shared assets', async t => {
  for (const app of apps) await t.test(app, async () => {
    const host = createConsumerHost({ app, port: 0 }); const origin = await host.listen();
    try {
      assert.equal((await fetch(origin)).status, 200);
      assert.equal((await (await fetch(origin + '/config')).json()).app, app);
      assert.equal((await fetch(origin + '/app.mjs')).status, 200);
      for (const asset of ['/shared/ui.mjs', '/shared/client.mjs', '/shared/data.mjs', '/shared/style.css']) assert.equal((await fetch(origin + asset)).status, 200);
      assert.equal((await fetch(origin + '/shared/host.mjs')).status, 404);
      assert.equal((await fetch(origin + '/server/index.mjs')).status, 404);
    } finally { await new Promise(resolve => host.server.close(resolve)); }
  });
});
test('proxy rejects cross-origin browser use and forwards only expected API headers without storing keys', async () => {
  let captured;
  const host = createConsumerHost({ app: 'product-search', port: 0, runtime: 'http://127.0.0.1:4336', fetchImpl: async (url, options) => { captured = { url, options }; return new Response(JSON.stringify({ run_id: 'run_fixture' }), { status: 202 }); } });
  const origin = await host.listen();
  const body = { method: 'POST', path: '/v1/actions/validation.products/versions/1/runs', key: 'hm_live_fixture', idempotency: 'fixture-id', body: { input: { category: 'travel_2' } } };
  try {
    const call = (value, headers = {}) => fetch(origin + '/api/request', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
    assert.equal((await call(body, { Origin: 'https://evil.example' })).status, 403); assert.equal(captured, undefined);
    assert.equal((await call({ ...body, path: '/studio/export' })).status, 400); assert.equal(captured, undefined);
    const response = await call(body, { Origin: origin }); assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { run_id: 'run_fixture' });
    assert.equal(captured.url, 'http://127.0.0.1:4336' + body.path); assert.equal(captured.options.headers.Authorization, 'Bearer hm_live_fixture'); assert.equal(captured.options.redirect, 'error'); assert.equal(captured.options.headers.Cookie, undefined); assert.equal(captured.options.headers.Origin, undefined);
    assert.equal((await fetch(origin + '/config')).headers.get('cache-control'), 'no-store');
  } finally { await new Promise(resolve => host.server.close(resolve)); }
});
