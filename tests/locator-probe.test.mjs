import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { managedBrowserInstallation } from '../server/managed-profile.mjs';
import { locatorProbeDocument } from '../companion/browser/locator-probe.mjs';
import { operateDocument } from '../companion/browser/commands.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Controlled locator fixture</title></head><body>
<form id="form"><label for="email">Email address</label><input id="email" name="email" value="PRIVATE_FIELD_VALUE">
<label>Password <input id="password" type="password" value="PRIVATE_PASSWORD_VALUE"></label>
<input id="otp" autocomplete="one-time-code" value="PRIVATE_OTP_VALUE"><input id="upload" type="file">
<input id="placeholder" placeholder="PRIVATE_PLACEHOLDER"><textarea id="textarea">PRIVATE_TEXTAREA_VALUE</textarea>
<div id="editor" contenteditable="true">PRIVATE_EDITABLE_CONTENT</div><div id="named-editor" role="textbox" contenteditable="true" aria-label="Message">PRIVATE_NAMED_EDITOR_CONTENT</div>
<label for="choice">Shipping method</label><select id="choice"><option value="PRIVATE_OPTION_VALUE">Courier</option></select>
<label><input id="check" type="checkbox">Remember preference</label>
<input id="native-submit" type="submit" value="PRIVATE_SUBMIT_VALUE">
<button id="changed" data-testid="purchase">Delete account</button><button id="correct" data-testid="new-purchase" aria-label="Buy">Purchase</button>
<button class="duplicate">Continue</button><button class="duplicate">Continue</button>
<button data-testid="duplicate-id">First duplicate ID</button><button data-testid="duplicate-id">Second duplicate ID</button>
<button id="disabled" disabled>Disabled action</button><div aria-hidden="true"><button id="aria-hidden">Hidden action</button></div>
<button id="hidden" hidden>Other hidden action</button>
</form><div data-hermo-ui><button id="hermo-own">Own interface</button><div id="own-shadow"></div></div>
<div id="shadow-host"></div><script>
globalThis.fixtureEvents=[];globalThis.valueReads=0;globalThis.fixtureMutations=0;
for(const event of ['click','input','change','focus','focusin','submit','keydown','scroll'])addEventListener(event,()=>fixtureEvents.push(event),true);
document.querySelector('#form').addEventListener('submit',event=>event.preventDefault());
document.querySelector('#shadow-host').attachShadow({mode:'open'}).innerHTML='<label for="search">Search catalog</label><input id="search"><button data-testid="shadow-go">Search</button>';
document.querySelector('#own-shadow').attachShadow({mode:'open'}).innerHTML='<button>Private companion interface</button>';
for(const element of document.querySelectorAll('input,textarea,select')){const prototype=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;const descriptor=Object.getOwnPropertyDescriptor(prototype,'value');Object.defineProperty(element,'value',{get(){valueReads++;return descriptor.get.call(this)},set(value){return descriptor.set.call(this,value)}})}
new MutationObserver(records=>fixtureMutations+=records.length).observe(document.documentElement,{subtree:true,attributes:true,childList:true,characterData:true});
</script></body></html>`;

test('deterministic locator probes observe actual Chromium documents without issuing actions or reading values', { timeout: 30000 }, async t => {
  const server = createServer((_req, reply) => { reply.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); reply.end(html); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: managedBrowserInstallation().executablePath });
  const page = await browser.newPage();
  const fresh = () => page.goto(origin + '/fixture');
  const probe = payload => page.evaluate(locatorProbeDocument, payload);
  const ready = payload => ({ mode: 'probe', operation: 'click', ...payload });
  try {
    await t.test('payload and trusted execution scope fail closed before inspecting the document', async () => {
      await fresh();
      for (const payload of [null, {}, { mode: 'probe' }, ready({ selector: '#correct', extra: true }), ready({ selector: 'xpath=//button' }), ready({ selector: 'button >> text=Buy' }), ready({ selector: '#correct', limit: 9 }), ready({ selector: '#correct', limit: 0 }), ready({ selector: '#correct', locators: [] }), ready({ selector: '#correct', locators: [{ kind: 'role', role: 'button', name: 'Buy', value: 'extra' }] }), ready({ selector: '#correct', locators: [{ kind: 'label', value: 'a'.repeat(161) }] }), ready({ selector: '#correct', operation: 'navigate' })]) assert.deepEqual(await probe(payload), { hermo_error: 'INVALID_PROBE' });
      for (const payload of [ready({ selector: '#correct', origin: 'https://unrelated.example' }), ready({ selector: '#correct', path_prefix: '/other/' }), ready({ selector: '#correct', expires_at: Date.now() - 1 })]) assert.deepEqual(await probe(payload), { hermo_error: 'PROBE_UNAVAILABLE' });
      const scoped = await probe(ready({ selector: '#correct', origin, path_prefix: '/fixture', expires_at: Date.now() + 10000 })); assert.equal(scoped.matches, 1); assert.match(scoped.document_id, uuid);
      assert.equal(await page.evaluate(() => globalThis.valueReads), 0);
    });
    await t.test('trusted readiness guard rejects visible credential/challenge controls without reading values', async () => {
      await fresh();
      assert.deepEqual(await probe({mode:'probe',selector:'#correct',operation:'click',require_ready:true}),{hermo_error:'PROBE_UNAVAILABLE'});
      assert.equal(await page.evaluate(()=>valueReads),0);
      await page.locator('#password').evaluate(node=>node.hidden=true);await page.locator('#otp').evaluate(node=>node.hidden=true);
      assert.equal((await probe({mode:'probe',selector:'#correct',operation:'click',require_ready:true})).matches,1);
      await page.locator('body').evaluate(node=>node.insertAdjacentHTML('beforeend','<div data-sitekey="controlled-captcha" style="width:30px;height:30px"></div>'));
      assert.deepEqual(await probe({mode:'probe',selector:'#correct',operation:'click',require_ready:true}),{hermo_error:'PROBE_UNAVAILABLE'});
      assert.equal(await page.evaluate(()=>valueReads),0);
    });
    await t.test('ambiguous stronger locators never select the first node or fall through to unique CSS', async () => {
      await fresh();
      for (const locators of [[{ kind: 'role', role: 'button', name: 'Continue' }], [{ kind: 'testId', value: 'duplicate-id' }]]) {
        const result = await probe(ready({ selector: '#correct', locators }));
        assert.equal(result.matches, 2); assert.equal(result.visible, false); assert.equal(result.enabled, false); assert.equal(result.semantic_match, false); assert.equal(result.element_id, undefined);
      }
      assert.equal((await probe(ready({ selector: '.absent' }))).matches, 0);
    });
    await t.test('reused identifiers retain semantic mismatch and exact semantic replacements rank first', async () => {
      await fresh();
      const payload = { mode: 'candidates', operation: 'click', selector: '#changed', locators: [{ kind: 'testId', value: 'purchase' }, { kind: 'role', role: 'button', name: 'Buy' }], limit: 8 };
      const result = await probe(payload);
      assert.equal(result.matches, 1); assert.equal(result.name, 'Delete account'); assert.equal(result.semantic_match, false);
      assert.equal(result.candidates[0].name, 'Buy'); assert.equal(result.candidates[0].score, 100); assert.ok(result.candidates[0].reasons.includes('EXACT_SEMANTIC_MATCH'));
      assert.ok(result.candidates.some(item => item.name === 'Delete account' && item.score === 90));
      for (const candidate of result.candidates) {
        const tested = await probe(ready({ selector: candidate.selector, locators: candidate.locators }));
        assert.equal(tested.matches, 1); assert.equal(tested.semantic_match, true); assert.equal(tested.element_id, candidate.element_id);
      }
      assert.deepEqual((await probe(payload)).candidates, result.candidates, 'identical observation yields deterministic ordering and IDs');
    });
    await t.test('candidate kinds are compatible, bounded and exclude credentials, hidden elements and companion UI', async () => {
      await fresh();
      for (const [operation, expected] of [['select', '#choice'], ['check', '#check']]) {
        const result = await probe({ mode: 'candidates', selector: expected, operation, limit: 8 });
        assert.equal(result.matches, 1); assert.ok(result.candidates.length >= 1);
        assert.ok(result.candidates.every(item => item.locators.some(locator => locator.kind === 'css' && locator.value === expected)));
      }
      const clicks = await probe({ mode: 'candidates', selector: '#correct', operation: 'click', limit: 2 }); assert.equal(clicks.candidates.length, 2);
      const fills = await probe({ mode: 'candidates', selector: '#email', operation: 'fill', limit: 8 });
      assert.ok(fills.candidates.some(item => item.locators.some(locator => locator.kind === 'label' && locator.value === 'Email address')));
      assert.ok(!fills.candidates.some(item => /Password|upload|otp/i.test(JSON.stringify(item))));
      const all = JSON.stringify([clicks, fills]);
      for (const secret of ['PRIVATE_FIELD_VALUE', 'PRIVATE_PASSWORD_VALUE', 'PRIVATE_OTP_VALUE', 'PRIVATE_PLACEHOLDER', 'PRIVATE_TEXTAREA_VALUE', 'PRIVATE_EDITABLE_CONTENT', 'PRIVATE_NAMED_EDITOR_CONTENT', 'PRIVATE_SUBMIT_VALUE', 'PRIVATE_OPTION_VALUE', 'Own interface', 'Private companion interface']) assert.ok(!all.includes(secret), secret);
      assert.ok(!fills.candidates.find(item => item.selector === '#placeholder')?.name, 'placeholder text is not an accessible name');
      for (const selector of ['#password', '#otp', '#upload', '#hermo-own']) { const result = await probe({ mode: 'probe', selector, operation: 'fill' }); assert.equal(result.element_id, undefined); assert.equal(result.semantic_match, false); }
      for (const selector of ['#hidden', '#aria-hidden']) assert.equal((await probe(ready({ selector }))).visible, false);
      assert.equal((await probe(ready({ selector: '#disabled' }))).enabled, false);
      assert.equal(await page.evaluate(() => globalThis.valueReads), 0);
    });
    await t.test('open shadow targets resolve by the same role, label and anchored CSS semantics as companion readiness', async () => {
      await fresh(); await page.evaluate(() => { document.querySelector('#password').hidden = true; });
      const result = await probe({ mode: 'candidates', operation: 'click', selector: '#missing', locators: [{ kind: 'role', role: 'button', name: 'Search' }], limit: 8 });
      assert.equal(result.matches, 1); assert.equal(result.name, 'Search'); assert.equal(result.semantic_match, true);
      const candidate = result.candidates.find(item => item.name === 'Search'); assert.ok(candidate); assert.ok(candidate.selector.startsWith('#shadow-host '));
      assert.equal((await probe(ready({ selector: candidate.selector }))).element_id, candidate.element_id);
      assert.equal(await page.evaluate(operateDocument, { op: 'ready', selector: candidate.selector, locators: candidate.locators }), true);
      const field = await probe({ mode: 'probe', operation: 'fill', locators: [{ kind: 'label', value: 'Search catalog' }] }); assert.equal(field.matches, 1); assert.equal(field.semantic_match, true);
    });
    await t.test('document IDs persist only within a document and node IDs detect identical DOM replacements', async () => {
      await fresh();
      const before = await probe(ready({ selector: '#correct' })), same = await probe(ready({ selector: '#correct' }));
      assert.match(before.element_id, uuid); assert.equal(same.document_id, before.document_id); assert.equal(same.element_id, before.element_id);
      await page.evaluate(() => { const old = document.querySelector('#correct'); old.replaceWith(old.cloneNode(true)); });
      const replaced = await probe(ready({ selector: '#correct' })); assert.equal(replaced.document_id, before.document_id); assert.notEqual(replaced.element_id, before.element_id);
      await page.goto(origin + '/fixture?fresh-document=1');
      const navigated = await probe(ready({ selector: '#correct' })); assert.notEqual(navigated.document_id, before.document_id); assert.notEqual(navigated.element_id, before.element_id);
    });
    await t.test('probes and suggestions do not emit input/navigation events, mutate DOM, change focus or read values', async () => {
      await fresh();
      const before = await page.evaluate(() => ({ url: location.href, focus: document.activeElement.tagName, x: scrollX, y: scrollY, dom: document.documentElement.outerHTML, events: fixtureEvents, mutations: fixtureMutations, reads: valueReads }));
      await probe({ mode: 'candidates', selector: '#email', operation: 'fill', locators: [{ kind: 'label', value: 'Email address' }], limit: 8 });
      await probe({ mode: 'candidates', selector: '#correct', operation: 'click', limit: 8 });
      await probe({ mode: 'probe', selector: '#choice', operation: 'select' });
      await probe({ mode: 'probe', selector: '#check', operation: 'check' });
      const after = await page.evaluate(() => ({ url: location.href, focus: document.activeElement.tagName, x: scrollX, y: scrollY, dom: document.documentElement.outerHTML, events: fixtureEvents, mutations: fixtureMutations, reads: valueReads }));
      assert.deepEqual(after, before);
    });
    await t.test('pathological document size fails closed instead of guessing uniqueness', async () => {
      await fresh(); await page.evaluate(() => { const content = document.createElement('div'); content.innerHTML = '<span></span>'.repeat(15001); document.body.append(content); });
      assert.deepEqual(await probe(ready({ selector: '#correct' })), { hermo_error: 'PROBE_LIMIT' });
    });
  } finally {
    await browser.close(); await new Promise(done => server.close(done));
  }
});
