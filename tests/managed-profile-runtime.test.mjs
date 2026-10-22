import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/index.mjs';
import { createBrowserEngine } from '../server/browser.mjs';

const pause = ms => new Promise(done => setTimeout(done, ms));

// An authenticated, Hermo-owned fixture. Its website session service deliberately
// outlives a Hermo restart; the built-in demo portal's in-memory sessions do not.
// All connection/workflow changes go through HTTP owner routes, never DB seeds.
test('managed sessions remain isolated and encrypted across independent API execution and runtime restart', { timeout: 150000 }, async t => {
  const priorMaster = process.env.HERMO_MASTER_KEY;
  process.env.HERMO_MASTER_KEY = randomBytes(32).toString('base64');
  const port = 4499, dataDir = resolve('work/managed-profile-runtime', randomBytes(8).toString('hex'));
  const password = 'controlled-managed-profile-owner';
  const websiteSessions = new Set(), contexts = [], launches = [];
  let state, origin, cookie = '', csrf = '', connection, workflow, apiKey, alternateWorkflow, alternateKey, alternateRevisions;
  let account = 'Alex Morgan · Profile fixture', mode = 'ready', visits = 0;
  const page = body => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Managed profile fixture</title></head><body><main>${body}</main></body></html>`;
  const waitFor = async (check, timeout = 25000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const result = await check(); if (result) return result; await pause(100); }
    assert.fail('Managed profile fixture did not settle within its bounded deadline.');
  };
  async function start() {
    state = await createApp({ port, dataDir, browserEngineFactory: (proxy, sandboxOrigin, options) => createBrowserEngine(proxy, sandboxOrigin, {
      ...options,
      launchPersistentContext: async (directory, options) => {
        launches.push({headless:options.headless});assert.equal(options.offline,true);
        const context=await chromium.launchPersistentContext(directory,options);contexts.push(context);return context;
      },
      launchBrowser: async options => {
        launches.push({ headless: options.headless });
        const browser = await chromium.launch(options), newContext = browser.newContext.bind(browser);
        browser.newContext = async options => {
          assert.equal(options.offline, true, 'each real managed context starts offline until its guards are installed');
          const context = await newContext(options); contexts.push(context); return context;
        };
        return browser;
      },
    }) });
    origin = state.origin;
    state.app.get('/sandbox/profile-login', async (req, reply) => websiteSessions.has(req.cookies.profile_fixture)
      ? reply.redirect('/sandbox/profile-data')
      : reply.type('text/html').send(page('<h1>Controlled account sign-in</h1><form method="post" action="/sandbox/profile-login"><label for="email">Email</label><input id="email" name="email" type="email" required><label for="password">Password</label><input id="password" name="password" type="password" required><button type="submit">Sign in</button></form>')));
    state.app.post('/sandbox/profile-login', async (req, reply) => {
      const fields = new URLSearchParams(typeof req.body === 'string' ? req.body : '');
      if (fields.get('email') !== 'alex@profile.example' || fields.get('password') !== 'synthetic-profile-password') return reply.code(401).send('Synthetic account credentials rejected');
      const token = randomBytes(24).toString('hex'); websiteSessions.add(token);
      return reply.setCookie('profile_fixture', token, { path: '/sandbox', httpOnly: true, sameSite: 'strict', maxAge: 3600 }).redirect('/sandbox/profile-data');
    });
    state.app.get('/sandbox/profile-data', async (req, reply) => {
      if (!websiteSessions.has(req.cookies.profile_fixture)) return reply.redirect('/sandbox/profile-login');
      visits++;
      const order = ['ORD-2041', 'ORD-2042'].includes(req.query.order_id) ? req.query.order_id : '';
      return reply.type('text/html').send(page(`<header><div data-testid="account-identity">${account}</div></header><h1>Controlled orders</h1><form method="get" action="/sandbox/profile-data"><label for="order">Order ID</label><input id="order" name="order_id" value="${order}"><button type="submit">Search orders</button></form>${order ? `<dl><dt>Order ID</dt><dd data-testid="order-id">${order}</dd><dt>Status</dt><dd data-testid="order-status">${order === 'ORD-2041' ? 'Shipped' : 'Processing'}</dd></dl>` : ''}<div id="ready"${mode === 'stall' ? ' hidden' : ''}>Ready</div>`));
    });
    await state.app.listen({ host: '127.0.0.1', port });
  }
  const call = async (path, body, extra = {}) => {
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: {connection:'close',
      ...cookie ? { cookie } : {}, ...body === undefined ? {} : { 'content-type': 'application/json', 'x-hermo-csrf': csrf }, ...extra,
    }, ...body === undefined ? {} : { body: JSON.stringify(body) } });
    const owner = response.headers.get('set-cookie'); if (owner?.startsWith(`hermo_owner_${port}=`)) cookie = owner.split(';')[0];
    return { status: response.status, value: await response.json() };
  };
  const ok = async (...args) => { const result = await call(...args); assert.ok(result.status < 300, `${args[0]}: ${result.status} ${JSON.stringify(result.value)}`); return result.value; };
  const auth = () => ({ authorization: 'Bearer ' + apiKey });
  const snapshot = cid => ok(`/studio/connections/${cid}/browser`);
  const control = (cid, item, kind, value, recordingId, parameter) => {
    assert.ok(item, `Actual ${kind} control must be detected`);
    return ok(`/studio/connections/${cid}/control`, { element_id: item.id, kind, ...value === undefined ? {} : { value }, ...recordingId ? { recording_id: recordingId } : {}, ...parameter ? { parameter } : {} });
  };
  const finish = (rid, consumer = false) => waitFor(async () => {
    const run = await ok((consumer ? '/v1/runs/' : '/studio/runs/') + rid, undefined, consumer ? auth() : {});
    return ['succeeded', 'failed', 'cancelled'].includes(run.status) && run;
  });
  const invoke = async order => ok('/v1/actions/profiles.orders/versions/1/runs', { input: { order_id: order } }, { ...auth(), 'idempotency-key': randomBytes(12).toString('hex') });
  async function authenticate(cid) {
    await ok(`/studio/connections/${cid}/open`, {});
    let view = await snapshot(cid);
    if (!view.elements.some(item => item.preview === account)) {
      await control(cid, view.elements.find(item => item.label === 'Email'), 'fill', 'alex@profile.example');
      view = await snapshot(cid); await control(cid, view.elements.find(item => item.label === 'Password'), 'fill', 'synthetic-profile-password');
      view = await snapshot(cid); await control(cid, view.elements.find(item => item.kind === 'button' && item.label === 'Sign in'), 'click');
      view = await snapshot(cid);
    }
    const marker = view.elements.find(item => item.kind === 'output' && item.preview === account); assert.ok(marker, 'real authenticated identity must be visible');
    await ok(`/studio/connections/${cid}/confirm`, { element_id: marker.id });
  }
  try {
    await start();
    csrf = (await ok('/studio/session')).csrf;
    csrf = (await ok('/studio/setup', { password })).csrf;
    connection = (await ok('/studio/connections', { name: 'Managed account fixture', url: origin + '/sandbox/profile-login', browser_mode: 'isolated', access: 'account', authorized: true })).connection;
    const base = `/studio/connections/${connection.id}/managed-profile`;
    await t.test('owner scope, CSRF, explicit visibility, honest capabilities and browser-mode checks', async () => {
      assert.equal((await call(base, undefined, { cookie: '' })).status, 401);
      assert.equal((await call(base, { visibility: 'visible' }, { 'x-hermo-csrf': 'wrong' })).status, 403);
      assert.equal((await call(base, { visibility: 'visible', executablePath: 'untrusted' })).status, 400);
      assert.equal((await ok(base, { visibility: 'visible' })).visibility, 'visible');
      assert.equal((await ok(base, { visibility: 'headless' })).visibility, 'headless');
      const profile = await ok(base);
      assert.equal(profile.storage, 'encrypted_profile'); assert.equal(profile.capabilities.persistent_profile_directory, true); assert.equal(profile.capabilities.network_policy, 'workflow_defined');
      const connected = (await ok('/studio/connections', { name: 'Selected tab fixture', url: origin + '/sandbox/profile-login', browser_mode: 'connected', authorized: true })).connection;
      for (const [suffix, body] of [['', undefined], ['', { visibility: 'visible' }], ['/reset', { confirmation: 'Reset "Selected tab fixture"' }]]) {
        const denied = await call(`/studio/connections/${connected.id}/managed-profile${suffix}`, body);
        assert.equal(denied.status, 409); assert.equal(denied.value.error.code, 'MANAGED_BROWSER_REQUIRED');
      }
    });
    await authenticate(connection.id);
    await t.test('two account connections do not share cookies, and session plaintext is absent from stored payloads', async () => {
      const second = (await ok('/studio/connections', { name: 'Separate account fixture', url: origin + '/sandbox/profile-login', browser_mode: 'isolated', authorized: true })).connection;
      await ok(`/studio/connections/${second.id}/open`, {});
      const view = await snapshot(second.id);
      assert.ok(view.elements.some(item => item.label === 'Email')); assert.ok(!view.elements.some(item => item.preview === account));
      await ok(`/studio/connections/${second.id}/close`, {});
      const row = state.store.db.prepare('SELECT payload FROM connections WHERE id=?').get(connection.id);
      const decrypted = state.store.unseal(row.payload), token = decrypted.storageState.cookies.find(item => item.name === 'profile_fixture')?.value;
      assert.ok(token); assert.ok(!row.payload.includes(token)); assert.ok(!row.payload.includes('profile_fixture')); assert.ok(!row.payload.includes(account));
      assert.equal((await ok(base)).session_saved, true);
    });
    const recording = await ok('/studio/recordings', { connection_id: connection.id, name: 'Managed account order lookup', slug: 'profiles.orders', action_type: 'custom' });
    await t.test('recording blocks session reset and visibility changes', async () => {
      assert.equal((await call(base, { visibility: 'visible' })).status, 409);
      assert.equal((await call(base + '/reset', { confirmation: 'Reset "Managed account fixture"' })).status, 409);
    });
    let view = await snapshot(connection.id);
    await control(connection.id, view.elements.find(item => item.label === 'Order ID'), 'fill', 'ORD-2041', recording.id, 'order_id');
    view = await snapshot(connection.id); await control(connection.id, view.elements.find(item => item.kind === 'button' && item.label === 'Search orders'), 'click', undefined, recording.id);
    view = await snapshot(connection.id);
    for (const [name, value] of [['order_id', 'ORD-2041'], ['status', 'Shipped']]) {
      const item = view.elements.find(item => item.kind === 'output' && item.preview === value); assert.ok(item);
      await ok(`/studio/recordings/${recording.id}/output`, { element_id: item.id, name });
    }
    workflow = (await ok(`/studio/recordings/${recording.id}/finish`, { verifiers: [{ output: 'order_id', input: 'order_id' }], timeout_seconds: 15 })).workflow;
    const editor = await ok(`/studio/workflows/${workflow.id}/editor`);
    await ok(`/studio/workflows/${workflow.id}/editor`, { expected_version: editor.version, inputs: editor.definition.inputs, outputs: editor.definition.outputs, steps: [...editor.definition.steps, { op: 'wait_element', selector: '#ready', state: 'visible', timeout_ms: 30000 }], verifiers: editor.definition.verifiers, timeout_seconds: 15 });
    const tested = await finish((await ok(`/studio/workflows/${workflow.id}/test`, { input: { order_id: 'ORD-2041' } })).run_id);
    assert.equal(tested.status, 'succeeded', JSON.stringify(tested));
    const review = await ok(`/studio/workflows/${workflow.id}/permissions`);
    apiKey = (await ok(`/studio/workflows/${workflow.id}/publish`, { expected_version: review.version, permission_fingerprint: review.fingerprint })).key;
    const revisionsBefore = await ok(`/studio/workflows/${workflow.id}/revisions`);
    await t.test('API execution closes an idle studio and uses its saved account without dashboard requests', async () => {
      // Leave the studio open: replay must release that idle lease before taking its own.
      const before = contexts.length, receipt = await invoke('ORD-2042'), run = await finish(receipt.run_id, true);
      assert.equal(run.status, 'succeeded', JSON.stringify(run)); assert.deepEqual(run.result, { order_id: 'ORD-2042', status: 'Processing' });
      assert.equal(run.execution_mode, 'managed_local'); assert.equal(run.workflow_revision, 1); assert.ok(contexts.length > before);
      assert.equal((await call(`/studio/connections/${connection.id}/browser`)).value.error.code, 'BROWSER_CLOSED');
      assert.ok(launches.every(item => item.headless === true));
    });
    await t.test('accepted active execution blocks reset and visibility changes without interrupting its result', async () => {
      mode = 'stall'; visits = 0;
      const receipt = await invoke('ORD-2041');
      await waitFor(async () => { const run = await ok('/v1/runs/' + receipt.run_id, undefined, auth()); return run.current_step?.number === 4 && visits > 0; });
      for (const [path, body] of [[base, { visibility: 'visible' }], [base + '/reset', { confirmation: 'Reset "Managed account fixture"' }]]) assert.equal((await call(path, body)).status, 409);
      assert.equal((await ok(base)).busy, true);
      await ok('/v1/runs/' + receipt.run_id + '/cancel', {}, auth());
      assert.equal((await finish(receipt.run_id, true)).status, 'cancelled'); mode = 'ready';
      assert.equal((await finish((await invoke('ORD-2042')).run_id, true)).status, 'succeeded');
    });
    await t.test('encrypted account sessions survive a Hermo restart while the website session service remains valid', async () => {
      await state.app.close(); state = undefined; cookie = ''; csrf = '';
      await start();
      assert.equal((await call('/studio/overview')).status, 401, 'dashboard remains locked after restart');
      const run = await finish((await invoke('ORD-2041')).run_id, true);
      assert.equal(run.status, 'succeeded', JSON.stringify(run)); assert.deepEqual(run.result, { order_id: 'ORD-2041', status: 'Shipped' });
      csrf = (await ok('/studio/session')).csrf; csrf = (await ok('/studio/login', { password })).csrf;
      assert.deepEqual((await ok(`/studio/workflows/${workflow.id}/revisions`)).revisions.map(item => [item.revision, item.version]), revisionsBefore.revisions.map(item => [item.revision, item.version]));
    });
    await t.test('changed account identity and expired website sessions fail closed, then explicit reconnection recovers', async () => {
      account = 'Different Account · Profile fixture';
      let run = await finish((await invoke('ORD-2041')).run_id, true);
      assert.equal(run.status, 'failed'); assert.equal(run.error.code, 'AUTH_REQUIRED'); assert.equal(run.result, undefined);
      account = 'Alex Morgan · Profile fixture'; await authenticate(connection.id); await ok(`/studio/connections/${connection.id}/close`, {});
      websiteSessions.clear();
      run = await finish((await invoke('ORD-2042')).run_id, true);
      assert.equal(run.status, 'failed'); assert.equal(run.error.code, 'AUTH_REQUIRED'); assert.equal(run.result, undefined);
      await authenticate(connection.id); await ok(`/studio/connections/${connection.id}/close`, {});
      assert.equal((await finish((await invoke('ORD-2042')).run_id, true)).status, 'succeeded');
    });
    await t.test('a workflow recorded on another connection can explicitly bind and verify this managed execution target', async () => {
      const source = (await ok('/studio/connections', { name: 'Alternate recording source', url: origin + '/sandbox/profile-login', browser_mode: 'isolated', access: 'account', authorized: true })).connection;
      await authenticate(source.id);
      const recording = await ok('/studio/recordings', { connection_id: source.id, name: 'Alternate source account read', slug: 'profiles.alternate', action_type: 'read_data' });
      const view = await snapshot(source.id), marker = view.elements.find(item => item.kind === 'output' && item.preview === account); assert.ok(marker);
      await ok(`/studio/recordings/${recording.id}/output`, { element_id: marker.id, name: 'account_name' });
      alternateWorkflow = (await ok(`/studio/recordings/${recording.id}/finish`, { verifiers: [{ kind: 'nonempty', output: 'account_name' }], timeout_seconds: 15 })).workflow;
      const editor = await ok(`/studio/workflows/${alternateWorkflow.id}/editor`);
      await ok(`/studio/workflows/${alternateWorkflow.id}/execution`, { expected_version: editor.version, connection_id: connection.id, authorized: true });
      assert.equal((await ok(`/studio/workflows/${alternateWorkflow.id}/execution`)).selected_connection_id, connection.id);
      const verified = await finish((await ok(`/studio/workflows/${alternateWorkflow.id}/test`, { input: {} })).run_id);
      assert.equal(verified.status, 'succeeded', JSON.stringify(verified)); assert.deepEqual(verified.result, { account_name: account });
      const review = await ok(`/studio/workflows/${alternateWorkflow.id}/permissions`);
      alternateKey = (await ok(`/studio/workflows/${alternateWorkflow.id}/publish`, { expected_version: review.version, permission_fingerprint: review.fingerprint })).key;
      alternateRevisions = await ok(`/studio/workflows/${alternateWorkflow.id}/revisions`);
      const stored = state.store.db.prepare('SELECT connection_id,test_version FROM workflows WHERE id=?').get(alternateWorkflow.id);
      assert.equal(stored.connection_id, source.id, 'the original source stays distinct from the selected execution connection');
      assert.ok(stored.test_version);
      assert.equal(state.store.db.prepare('SELECT count(*) n FROM workflow_test_evidence WHERE workflow_id=?').get(alternateWorkflow.id).n, 1);
      assert.equal((await call('/v1/action-contract', undefined, { authorization: 'Bearer ' + alternateKey })).status, 200);
    });
    await t.test('explicit reset clears only session authority and revokes keys while preserving workflow and immutable history', async () => {
      assert.equal((await call(base + '/reset', { confirmation: 'Reset another account' })).status, 400);
      await authenticate(connection.id);
      const reset = await ok(base + '/reset', { confirmation: 'Reset "Managed account fixture"' });
      assert.equal(reset.retest_required, true); assert.equal(reset.session_saved, false); assert.equal(reset.identity_verified, false);
      assert.equal((await call('/v1/action-contract', undefined, auth())).status, 401);
      assert.equal((await call('/v1/action-contract', undefined, { authorization: 'Bearer ' + alternateKey })).status, 401, 'reset revokes the separately recorded workflow bound to this execution target');
      const after = await ok(`/studio/workflows/${workflow.id}/revisions`);
      assert.deepEqual(after.revisions.map(item => [item.revision, item.version]), revisionsBefore.revisions.map(item => [item.revision, item.version]));
      const overview = await ok('/studio/overview');
      assert.equal(overview.workflows.find(item => item.id === workflow.id).status, 'draft');
      assert.equal(overview.workflows.find(item => item.id === alternateWorkflow.id).status, 'draft');
      const alternateAfter = await ok(`/studio/workflows/${alternateWorkflow.id}/revisions`);
      assert.deepEqual(alternateAfter.revisions.map(item => [item.revision, item.version]), alternateRevisions.revisions.map(item => [item.revision, item.version]));
      for (const wid of [workflow.id, alternateWorkflow.id]) {
        assert.equal(state.store.db.prepare('SELECT test_version FROM workflows WHERE id=?').get(wid).test_version, null);
        assert.equal(state.store.db.prepare('SELECT count(*) n FROM workflow_test_evidence WHERE workflow_id=?').get(wid).n, 0);
      }
      assert.equal(overview.connections.find(item => item.id === connection.id).status, 'auth_required');
      const payload = state.store.unseal(state.store.db.prepare('SELECT payload FROM connections WHERE id=?').get(connection.id).payload);
      for (const key of ['storageState', 'studioState', 'checkpoint', 'identity']) assert.equal(payload[key], undefined);
      assert.equal((await call(`/studio/connections/${connection.id}/browser`)).value.error.code, 'BROWSER_CLOSED');
      await authenticate(connection.id);
      assert.equal((await call('/v1/action-contract', undefined, auth())).status, 401, 'reconfirming the same account cannot resurrect its old key');
      assert.equal((await call('/v1/action-contract', undefined, { authorization: 'Bearer ' + alternateKey })).status, 401, 'reconfirming the same execution target cannot resurrect dependent workflow authority');
      await ok(`/studio/connections/${connection.id}/close`, {});
    });
  } finally {
    await state?.app.close();
    if (priorMaster === undefined) delete process.env.HERMO_MASTER_KEY; else process.env.HERMO_MASTER_KEY = priorMaster;
  }
});
