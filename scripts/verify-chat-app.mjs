// Disposable UI fixtures only: never connects to an owner's Hermo runtime or website.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createConsumerHost } from '../validation-apps/shared/host.mjs';

const admissions = [], runs = new Map();
let uncertain = false;
const contract = { action: 'fixture.chat', revision: 3, timeout_seconds: 5, input_schema: { type: 'object', properties: { prompt: { type: 'string', maxLength: 500 }, language: { type: 'string', default: 'English' } }, required: ['prompt', 'language'], additionalProperties: false }, output_schema: { type: 'object', properties: { response: { type: 'string' } } } };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const host = createConsumerHost({ app: 'simple-ai-chat', port: 0, fetchImpl: async (url, options) => {
  const path = new URL(url).pathname;
  if (options.headers.Authorization !== 'Bearer hm_live_fixture') return json({ error: { code: 'UNAUTHORIZED', message: 'Invalid fixture key.' } }, 401);
  if (path === '/v1/action-contract') return json(contract);
  if (path.startsWith('/v1/actions/')) {
    const body = JSON.parse(options.body), requestId = options.headers['Idempotency-Key'];
    admissions.push({ body, requestId });
    assert.equal(body.expected_revision, 3);
    let run = [...runs.values()].find(run => run.requestId === requestId);
    if (!run) { run = { id: 'run_' + runs.size, requestId, prompt: body.input.prompt, status: body.input.prompt === 'Wait' ? 'running' : 'succeeded', result: { response: 'Fixture reply: ' + body.input.prompt }, verification: { verified_at: new Date().toISOString() } }; runs.set(run.id, run); }
    if (body.input.prompt === 'Fail') { run.status = 'failed'; run.error = { code: 'FIXTURE_FAILURE', message: 'Disposable workflow failure.' }; delete run.result; }
    if (body.input.prompt === 'Missing') run.result = { different: 'No response field' };
    if (body.input.prompt === 'Recover' && !uncertain) { uncertain = true; throw Error('Simulated lost receipt'); }
    return json({ run_id: run.id }, 202);
  }
  const run = runs.get(path.split('/')[3]);
  if (!run) return json({ error: { code: 'NOT_FOUND', message: 'Unknown fixture run.' } }, 404);
  if (path.endsWith('/cancel')) { run.status = 'cancelled'; delete run.result; }
  return json(run);
} });
const origin = await host.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.HERMO_BROWSER_PATH ? { executablePath: process.env.HERMO_BROWSER_PATH } : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  assert.equal(await page.title(), 'Simple Ai chat test');
  assert.equal(await page.locator('#send').isDisabled(), true);
  await page.locator('#api-key').fill('hm_live_invalid'); await page.locator('#connect').click();
  await page.locator('#connection-error').filter({ hasText: 'UNAUTHORIZED' }).waitFor();
  await page.locator('#api-key').fill('hm_live_fixture'); await page.locator('#connect').click();
  await page.waitForFunction(() => !document.querySelector('#message').disabled);
  assert.equal(await page.locator('#prompt-field').inputValue(), 'prompt');
  assert.equal(await page.locator('#response-field').inputValue(), 'response');
  await page.locator('#message').fill('<img src=x onerror=alert(1)>'); await page.locator('#send').click();
  await page.locator('.message.assistant .content').filter({ hasText: 'Fixture reply:' }).waitFor();
  assert.equal(await page.locator('#messages img').count(), 0);
  assert.deepEqual(admissions[0].body.input, { language: 'English', prompt: '<img src=x onerror=alert(1)>' });
  await page.locator('#clear').click(); assert.equal(await page.locator('.message').count(), 0);
  await page.locator('.advanced').first().locator('summary').click();
  await page.locator('#extra-inputs').fill('{}'); await page.locator('#message').fill('Hello'); await page.locator('#send').click();
  await page.locator('#chat-error').filter({ hasText: 'language' }).waitFor(); assert.equal(admissions.length, 1);
  await page.locator('#extra-inputs').fill('{"language":"English"}');
  await page.locator('#message').fill('Recover'); await page.locator('#send').click();
  await page.locator('#resume').waitFor(); await page.locator('#resume').click();
  await page.locator('.message.assistant .content').filter({ hasText: 'Fixture reply: Recover' }).waitFor();
  assert.equal(admissions[1].requestId, admissions[2].requestId); assert.deepEqual(admissions[1].body, admissions[2].body);
  await page.locator('#message').fill('Wait'); await page.locator('#send').click();
  await page.locator('#run-status').filter({ hasText: 'running' }).waitFor(); await page.locator('#stop').click();
  await page.locator('#cancel').waitFor(); await page.locator('#cancel').click();
  await page.locator('#run-status').filter({ hasText: 'cancelled' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
  await page.locator('#message').fill('Fail'); await page.locator('#send').click();
  await page.locator('#chat-error').filter({ hasText: 'FIXTURE_FAILURE' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
  await page.locator('#message').fill('Missing'); await page.locator('#send').click();
  await page.locator('#chat-error').filter({ hasText: 'selected reply output is missing' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
  assert.equal(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes('hm_live_')), false);
  await page.locator('#clear').click();
  await page.locator('.advanced').first().locator('summary').click();
  await mkdir('work/simple-ai-chat', { recursive: true });
  await page.screenshot({ path: 'work/simple-ai-chat/desktop.png', fullPage: true });
  for (const width of [375, 768]) {
    await page.setViewportSize({ width, height: 812 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow at ' + width);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'work/simple-ai-chat/mobile.png', fullPage: true });
  await page.reload(); assert.equal(await page.locator('#api-key').inputValue(), '');
  assert.equal(await page.locator('.message').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Chat browser checks passed: invalid key, contract mapping, reply/XSS safety, validation, idempotent recovery, stop/cancel, failed runs, missing outputs, memory-only credentials, reload, desktop and mobile. Uses disposable fixtures; live AI compatibility is not asserted.');
} finally {
  await browser.close(); await new Promise(resolve => host.server.close(resolve));
}
