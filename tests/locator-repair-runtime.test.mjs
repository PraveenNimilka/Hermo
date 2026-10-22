import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/index.mjs';
import { createBrowserEngine } from '../server/browser.mjs';

const pause = ms => new Promise(done => setTimeout(done, ms));
const withoutTarget = step => Object.fromEntries(Object.entries(step).filter(([key]) => !['selector', 'locators', 'frame_path'].includes(key)));

// Real Chromium and a controlled Hermo-owned GET fixture. HTTP provisions every
// connection/workflow; store reads below assert invariants without seeding data.
test('owner locator repair observes the authorized page and changes only a reviewed draft target', { timeout: 90000 }, async t => {
  const previousMaster = process.env.HERMO_MASTER_KEY;
  process.env.HERMO_MASTER_KEY = randomBytes(32).toString('base64');
  const port = 4509, contexts = [];
  let state, cookie = '', csrf = '', changed = false, stall = false, submissions = 0;
  const password = 'controlled-locator-repair-owner';
  try {
    state = await createApp({ port, dataDir: resolve('work/locator-repair-runtime', randomBytes(8).toString('hex')), browserEngineFactory: (proxy, origin, options) => createBrowserEngine(proxy, origin, {
      ...options, launchBrowser: async options => {
        const browser = await chromium.launch(options), newContext = browser.newContext.bind(browser);
        browser.newContext = async options => { const context = await newContext(options); contexts.push(context); return context; };
        return browser;
      },
    }) });
    const { app, origin, store } = state;
    app.get('/sandbox/locator-repair', async (req, reply) => {
      const query = req.query['query-old'] ?? req.query['query-new'] ?? '';
      if (query) submissions++;
      const field = changed ? 'query-new' : 'query-old', safe = ['alpha', 'beta'].includes(query) ? query : '';
      return reply.type('text/html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Controlled locator repair</title></head><body><main><h1>Catalog lookup</h1><p>This controlled practice catalog supports repeatable browser recording, inspection and verification. Its search field can change its identifier while keeping its visible label, so repairs can be tested without contacting another website.</p><form method="get" action="/sandbox/locator-repair"><label for="${field}">Search query</label><input id="${field}" name="${field}" value="${safe}"><button type="submit" aria-label="Search catalog">Search catalog</button></form><label for="private-field">Unrelated field</label><input id="private-field" value="PRIVATE_UNRELATED_FORM_VALUE"><div id="ready"${stall ? ' hidden' : ''}>Ready for lookup.</div>${safe ? `<dl><dt>Query</dt><dd data-testid="query-result">${safe}</dd></dl>` : ''}</main></body></html>`);
    });
    await app.listen({ host: '127.0.0.1', port });
    const call = async (path, body, extra = {}) => {
      const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...cookie ? { cookie } : {}, ...body === undefined ? {} : { 'content-type': 'application/json', 'x-hermo-csrf': csrf }, ...extra }, ...body === undefined ? {} : { body: JSON.stringify(body) } });
      const owner = response.headers.get('set-cookie'); if (owner?.startsWith(`hermo_owner_${port}=`)) cookie = owner.split(';')[0];
      return { status: response.status, value: await response.json() };
    };
    const ok = async (...args) => { const result = await call(...args); assert.ok(result.status < 300, `${args[0]}: ${result.status} ${JSON.stringify(result.value)}`); return result.value; };
    const waitFor = async check => { const end = Date.now() + 20000; while (Date.now() < end) { const value = await check(); if (value) return value; await pause(100); } assert.fail('Locator repair controlled run did not settle.'); };
    const finish = rid => waitFor(async () => { const run = await ok('/studio/runs/' + rid); return ['succeeded', 'failed', 'cancelled'].includes(run.status) && run; });
    const snap = cid => ok(`/studio/connections/${cid}/browser`);
    const control = (cid, item, kind, value, recording, parameter) => {
      assert.ok(item, 'Actual browser control must be detected');
      return ok(`/studio/connections/${cid}/control`, { element_id: item.id, kind, ...value === undefined ? {} : { value }, ...recording ? { recording_id: recording } : {}, ...parameter ? { parameter } : {} });
    };
    csrf = (await ok('/studio/session')).csrf; csrf = (await ok('/studio/setup', { password })).csrf;
    const connection = (await ok('/studio/connections', { name: 'Locator repair catalog', url: origin + '/sandbox/locator-repair', browser_mode: 'isolated', access: 'public', authorized: true })).connection;
    const open = () => ok(`/studio/connections/${connection.id}/open`, {});
    await open(); await ok(`/studio/connections/${connection.id}/confirm`, { public_source: true });
    const recording = await ok('/studio/recordings', { connection_id: connection.id, name: 'Repairable catalog lookup', slug: 'repair.catalog', action_type: 'custom' });
    let view = await snap(connection.id);
    await control(connection.id, view.elements.find(item => item.label === 'Search query'), 'fill', 'alpha', recording.id, 'query');
    view = await snap(connection.id); await control(connection.id, view.elements.find(item => item.kind === 'button' && item.label === 'Search catalog'), 'click', undefined, recording.id);
    view = await snap(connection.id); const output = view.elements.find(item => item.kind === 'output' && item.preview === 'alpha'); assert.ok(output);
    await ok(`/studio/recordings/${recording.id}/output`, { element_id: output.id, name: 'query' });
    const workflow = (await ok(`/studio/recordings/${recording.id}/finish`, { verifiers: [{ output: 'query', input: 'query' }], timeout_seconds: 15 })).workflow;
    const base = `/studio/workflows/${workflow.id}`, initial = await ok(base + '/editor');
    const steps = initial.definition.steps.map(step => step.op === 'fill' ? { ...step, risk: 'low', label: 'Enter catalog query', approval_required: false, timeout_ms: 300 } : step);
    steps.splice(1, 0, { op: 'wait_element', selector: '#ready', state: 'visible', timeout_ms: 30000 });
    const edited = await ok(base + '/editor', { expected_version: initial.version, steps, inputs: initial.definition.inputs, outputs: initial.definition.outputs, verifiers: initial.definition.verifiers, timeout_seconds: 15, approval_policy: { mode: 'none' } });
    const successful = await finish((await ok(base + '/test', { input: { query: 'alpha' } })).run_id); assert.equal(successful.status, 'succeeded', JSON.stringify(successful));
    const review = await ok(base + '/permissions'), publication = await ok(base + '/publish', { expected_version: review.version, permission_fingerprint: review.fingerprint });
    const key = publication.key, consumer = { authorization: 'Bearer ' + key, cookie: '' };
    const versionOne = store.db.prepare('SELECT payload,version FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(workflow.id);
    await ok(base + '/draft', { expected_version: edited.version });
    let editor = await ok(base + '/editor'), fill = editor.definition.steps.find(step => step.op === 'fill');
    assert.match(fill.id, /^step_/);
    const repair = base + '/locator-repair', input = () => ({ expected_version: editor.version, step_id: fill.id });
    await t.test('closed browsers, active accepted execution and recording deny inspection without opening or submitting', async () => {
      assert.equal((await call(repair + '/suggestions', input())).value.error.code, 'BROWSER_CLOSED');
      stall = true;
      const receipt = await ok('/v1/actions/repair.catalog/versions/1/runs', { input: { query: 'beta' } }, { ...consumer, 'idempotency-key': 'active-repair-guard' });
      await waitFor(async () => { const run = await ok('/studio/runs/' + receipt.run_id); return run.current_step?.operation === 'wait_element'; });
      const before = submissions; assert.equal((await call(repair + '/suggestions', input())).status, 409); assert.equal(submissions, before);
      await ok('/v1/runs/' + receipt.run_id + '/cancel', {}, consumer); assert.equal((await finish(receipt.run_id)).status, 'cancelled'); stall = false;
      await waitFor(async()=>!(await ok(`/studio/connections/${connection.id}/managed-profile`)).busy);
      const demonstration = await ok('/studio/recordings', { connection_id: connection.id, name: 'Recording inspection guard', slug: 'repair.guard', action_type: 'read_data' });
      assert.equal((await call(repair + '/suggestions', input())).value.error.code, 'RECORDING_ACTIVE');
      await ok(`/studio/recordings/${demonstration.id}/discard`, {});
    });
    // Another real recorded draft supplies a different workflow/step binding.
    const otherRecording = await ok('/studio/recordings', { connection_id: connection.id, name: 'Other draft', slug: 'repair.other', action_type: 'custom' });
    view = await snap(connection.id); await control(connection.id, view.elements.find(item => item.label === 'Search query'), 'fill', 'beta', otherRecording.id, 'query');
    view = await snap(connection.id); const readyOutput = view.elements.find(item => item.kind === 'output' && item.preview === 'Ready for lookup.'); assert.ok(readyOutput);
    await ok(`/studio/recordings/${otherRecording.id}/output`, { element_id: readyOutput.id, name: 'ready' });
    const other = (await ok(`/studio/recordings/${otherRecording.id}/finish`, { verifiers: [{ kind: 'nonempty', output: 'ready' }] })).workflow;
    const otherEditor = await ok(`/studio/workflows/${other.id}/editor`), otherFill = otherEditor.definition.steps.find(step => step.op === 'fill');
    changed = true;
    const failed = await finish((await ok(base + '/test', { input: { query: 'beta' } })).run_id);
    assert.equal(failed.status, 'failed'); assert.equal(failed.steps.find(step => step.status === 'failed')?.step_id, fill.id); assert.equal(failed.result, undefined);
    await open();
    const studioPage = () => contexts.flatMap(context => context.pages()).find(page => !page.isClosed() && page.url().startsWith(origin + '/sandbox/locator-repair'));
    assert.ok(studioPage());
    let observation, candidate;
    const observe = async () => {
      observation = await ok(repair + '/suggestions', input());
      candidate = observation.candidates.find(item => item.name === 'Search query' && item.locators.some(locator => locator.kind === 'label' && locator.value === 'Search query'));
      assert.ok(candidate, 'replacement is grounded in its actual associated field label');
      return { ...input(), ticket: observation.ticket, candidate_id: candidate.id };
    };
    const applyBody = body => ({ ...body, repair_fingerprint: candidate.repair_fingerprint, authorized: true });
    const beforeRepair = submissions;
    await t.test('owner scope, CSRF, strict bodies, versions and observation binding reject stale or foreign repairs', async () => {
      assert.equal((await call(repair + '/suggestions', input(), consumer)).status, 401);
      assert.equal((await call(repair + '/suggestions', input(), { 'x-hermo-csrf': 'wrong' })).status, 403);
      assert.equal((await call(repair + '/suggestions', { ...input(), surprise: true })).status, 400);
      assert.equal((await call(repair + '/suggestions', { ...input(), expected_version: 'stale' })).value.error.code, 'VERSION_CHANGED');
      const body = await observe();
      assert.ok(!JSON.stringify(observation).includes('PRIVATE_UNRELATED_FORM_VALUE'));
      assert.equal((await call(repair + '/probe', { ...body, ticket: 'repair_missing' })).value.error.code, 'REPAIR_OBSERVATION_CHANGED');
      assert.equal((await call(`/studio/workflows/${other.id}/locator-repair/probe`, { ...body, expected_version: otherEditor.version, step_id: otherFill.id })).value.error.code, 'REPAIR_OBSERVATION_CHANGED');
      assert.equal((await call(repair + '/probe', { ...body, value: 'never fill this' })).status, 400);
      assert.equal((await call(repair + '/apply', { ...body, repair_fingerprint: candidate.repair_fingerprint })).status, 400);
      assert.equal((await call(repair + '/apply', { ...applyBody(body), repair_fingerprint: '0'.repeat(64) })).value.error.code, 'REPAIR_OBSERVATION_CHANGED');
      assert.equal(submissions, beforeRepair);
    });
    await t.test('expired inspection tickets cannot probe or apply a target',async()=>{
      const body=await observe(),now=Date.now;
      try{
        Date.now=()=>now()+61000;
        assert.equal((await call(repair+'/probe',body)).value.error.code,'REPAIR_OBSERVATION_CHANGED');
        assert.equal((await call(repair+'/apply',applyBody(body))).value.error.code,'REPAIR_OBSERVATION_CHANGED');
      }finally{Date.now=now;}
      assert.equal(submissions,beforeRepair);
    });
    await t.test('managed probes use an isolated registry and reject identical node replacement or document navigation', async () => {
      let body = await observe();
      await studioPage().evaluate(() => {
        const target = document.querySelector('[name="query-new"]'), nodes = new WeakMap(); nodes.set(target, '11111111-1111-4111-8111-111111111111');
        globalThis[Symbol.for('hermo.locator.probe.v1')] = { document, id: '22222222-2222-4222-8222-222222222222', nodes };
      });
      assert.deepEqual(await ok(repair + '/probe', body), { matches: 1, visible: true, enabled: true, semantic_match: true, unchanged: true });
      await studioPage().evaluate(() => { const target = document.querySelector('[name="query-new"]'); target.replaceWith(target.cloneNode(true)); });
      assert.equal((await ok(repair + '/probe', body)).unchanged, false);
      assert.equal((await call(repair + '/apply', applyBody(body))).value.error.code, 'REPAIR_OBSERVATION_CHANGED');
      body = await observe(); await studioPage().goto(origin + '/sandbox/locator-repair?new-document=1');
      assert.equal((await ok(repair + '/probe', body)).unchanged, false);
      assert.equal((await call(repair + '/apply', applyBody(body))).value.error.code, 'REPAIR_OBSERVATION_CHANGED');
      assert.equal(submissions, beforeRepair);
    });
    await t.test('explicit reviewed repair edits only locator fields, invalidates draft evidence and preserves published revision one', async () => {
      const before = await ok(base + '/editor'), connectionBefore = store.db.prepare('SELECT payload FROM connections WHERE id=?').get(connection.id).payload;
      assert.equal(store.db.prepare('SELECT count(*) n FROM workflow_test_evidence WHERE workflow_id=?').get(workflow.id).n, 0, 'opening the draft and failing verification already invalidated its old test evidence');
      const body = await observe(); assert.deepEqual(await ok(repair + '/probe', body), { matches: 1, visible: true, enabled: true, semantic_match: true, unchanged: true });
      const applied = await ok(repair + '/apply', applyBody(body)); assert.equal(applied.workflow.tested, false);
      const after = await ok(base + '/editor'), fixed = after.definition.steps.find(step => step.id === fill.id);
      assert.notEqual(after.version, before.version); assert.deepEqual(withoutTarget(fixed), withoutTarget(before.definition.steps.find(step => step.id === fill.id)));
      assert.deepEqual(after.definition.steps.filter(step => step.id !== fill.id), before.definition.steps.filter(step => step.id !== fill.id));
      for (const field of ['inputs', 'outputs', 'verifiers', 'approval_policy', 'effect', 'timeout_ms']) assert.deepEqual(after.definition[field], before.definition[field]);
      assert.equal(store.db.prepare('SELECT payload FROM connections WHERE id=?').get(connection.id).payload, connectionBefore);
      assert.equal(store.db.prepare('SELECT test_version FROM workflows WHERE id=?').get(workflow.id).test_version, null);
      assert.equal(store.db.prepare('SELECT count(*) n FROM workflow_test_evidence WHERE workflow_id=?').get(workflow.id).n, 0);
      assert.deepEqual(store.db.prepare('SELECT payload,version FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(workflow.id), versionOne);
      assert.equal((await call(repair + '/apply', applyBody(body))).value.error.code, 'VERSION_CHANGED');
      assert.equal(submissions, beforeRepair, 'suggestions, probes and apply never submit the fixture form');
      editor = after; fill = fixed;
    });
    await t.test('the repaired draft runs normally, requires fresh publication consent and publishes an immutable second revision', async () => {
      const before = submissions, run = await finish((await ok(base + '/test', { input: { query: 'beta' } })).run_id);
      assert.equal(run.status, 'succeeded', JSON.stringify(run)); assert.deepEqual(run.result, { query: 'beta' }); assert.equal(submissions, before + 1, 'only the newly authorized execution submits once');
      assert.equal((await call(base + '/publish', {})).value.error.code, 'PERMISSION_REVIEW_REQUIRED');
      const review = await ok(base + '/permissions'), next = await ok(base + '/publish', { expected_version: review.version, permission_fingerprint: review.fingerprint, ...review.changes?.breaking ? { change_fingerprint: review.changes.fingerprint, accept_breaking: true } : {} });
      assert.equal(next.workflow.published_revision, 2);
      assert.deepEqual(store.db.prepare('SELECT payload,version FROM workflow_revisions WHERE workflow_id=? AND revision=1').get(workflow.id), versionOne);
    });
  } finally {
    await state?.app.close();
    if (previousMaster === undefined) delete process.env.HERMO_MASTER_KEY; else process.env.HERMO_MASTER_KEY = previousMaster;
  }
});
