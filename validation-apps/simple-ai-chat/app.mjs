import { browserTransport, makeClient, terminal, verified } from '/shared/client.mjs';
import { resolveEndpoint, messageFields, buildInput, replyText } from '/simple-ai-chat/chat.mjs';

const $ = id => document.getElementById(id);
const config = await fetch('/config').then(response => response.json());
$('runtime').textContent = config.runtime;
let client, contract, attempt, busy = false, controller;

function status(text) { $('run-status').textContent = text; }
function controls() {
  const locked = busy || !!attempt;
  $('connection-fields').disabled = locked;
  for (const id of ['prompt-field', 'response-field', 'extra-inputs']) $(id).disabled = locked;
  $('message').disabled = !client || locked;
  $('send').disabled = !client || locked;
  $('clear').disabled = locked;
  $('stop').hidden = !busy || !attempt;
  $('recovery').hidden = busy || !attempt;
  $('cancel').hidden = !attempt?.runId;
  $('resume').textContent = attempt?.runId ? 'Resume checking' : 'Recover same request';
}
function errorText(error) { return `${error.code ? error.code + ': ' : ''}${error.message}`; }
function disconnect() {
  client = contract = undefined;
  $('connection-state').textContent = 'Not connected';
  $('connection-state').classList.remove('connected');
  $('mapping').hidden = true;
  $('connect').textContent = 'Connect key';
  controls();
  status('Connect your API key to get started.');
}
for (const id of ['api-key', 'endpoint']) $(id).addEventListener('input', disconnect);
$('show-key').addEventListener('click', () => {
  const show = $('api-key').type === 'password';
  $('api-key').type = show ? 'text' : 'password';
  $('show-key').textContent = show ? 'Hide' : 'Show';
  $('show-key').setAttribute('aria-pressed', String(show));
});
function options(select, names, preferred, all = false) {
  select.replaceChildren();
  for (const [value, label] of [...(all ? [['', 'Entire result (JSON)']] : []), ...names.map(name => [name, name])]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
  }
  select.value = preferred.find(name => names.includes(name)) ?? (all ? '' : names[0]);
}
$('connection-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || attempt) return;
  busy = true; controls(); $('connection-error').textContent = ''; $('chat-error').textContent = '';
  $('connect').textContent = 'Checking key…';
  try {
    const key = $('api-key').value.trim();
    if (!/^hm_live_[A-Za-z0-9_-]{1,300}$/.test(key)) throw Error('Enter a scoped Hermo key beginning with hm_live_.');
    const loaded = await browserTransport({ key, path: '/v1/action-contract', method: 'GET' });
    const endpoint = resolveEndpoint($('endpoint').value.trim(), config.runtime, loaded.action);
    const fields = messageFields(loaded);
    if (!fields.length) throw Error('This workflow has no string input. Publish a workflow with a prompt or message input.');
    contract = loaded;
    client = makeClient({ key, endpoint, timeoutMs: Math.min(310000, Math.max(30000, ((contract.timeout_seconds ?? 45) + 15) * 1000)), transport: request => browserTransport({ ...request, ...(request.idempotency && contract.revision ? { body: { ...request.body, expected_revision: contract.revision } } : {}) }) });
    options($('prompt-field'), fields, ['prompt', 'message', 'question', 'text', 'input']);
    options($('response-field'), Object.keys(loaded.output_schema?.properties ?? {}), ['response', 'answer', 'reply', 'text', 'output'], true);
    const extras = Object.fromEntries(Object.entries(loaded.input_schema.properties).filter(([name, rule]) => name !== $('prompt-field').value && rule.default !== undefined).map(([name, rule]) => [name, rule.default]));
    $('extra-inputs').value = JSON.stringify(extras, null, 2);
    $('workflow-name').textContent = loaded.action;
    $('contract-json').textContent = JSON.stringify(loaded, null, 2);
    $('mapping').hidden = false;
    $('connection-state').textContent = 'Connected';
    $('connection-state').classList.add('connected');
    $('connect').textContent = 'Check key again';
    status('Connected to ' + loaded.action + '. Ready for a message.');
  } catch (error) {
    disconnect(); $('connection-error').textContent = errorText(error);
  } finally { busy = false; controls(); if (client) $('message').focus(); }
});
function bubble(role, text) {
  $('welcome').hidden = true;
  const article = document.createElement('article'); article.className = 'message ' + role;
  const speaker = document.createElement('p'); speaker.className = 'speaker'; speaker.textContent = role === 'user' ? 'You' : 'Workflow reply';
  const content = document.createElement('div'); content.className = 'content'; content.textContent = text;
  article.append(speaker, content); $('messages').append(article);
  article.scrollIntoView({ block: 'nearest' }); return article;
}
function finish(run) {
  const current = attempt;
  if (verified(run)) {
    const article = bubble('assistant', replyText(run.result, current.output));
    const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
    summary.textContent = 'Raw response · ' + run.id;
    pre.tabIndex = 0; pre.textContent = JSON.stringify(run, null, 2);
    details.append(summary, pre); article.append(details);
    status('Succeeded · ' + current.runId);
  } else {
    $('chat-error').textContent = run.error ? `${run.error.code ?? run.status}: ${run.error.message ?? 'Inspect this run in Hermo.'}` : run.status === 'succeeded' ? 'The run returned no verified result. Inspect this run in Hermo.' : `Run ${run.status}. Inspect this run in Hermo.`;
    status(run.status + ' · ' + current.runId);
  }
  attempt = undefined;
}
async function execute() {
  if (busy || !attempt) return;
  busy = true; controls(); $('chat-error').textContent = '';
  controller = new AbortController(); const signal = controller.signal;
  try {
    if (!attempt.runId) {
      status('Submitting message…');
      const receipt = await client.admit(attempt.input, attempt.requestId);
      if (typeof receipt.run_id !== 'string' || !receipt.run_id) throw Error('No run receipt returned. Recover the same request before sending another message.');
      attempt.runId = receipt.run_id;
    }
    const run = await client.wait(attempt.runId, { signal, onStatus: run => { if (!signal.aborted) status(`${run.status.replaceAll('_', ' ')} · ${attempt.runId}`); } });
    if (!signal.aborted && terminal(run)) {
      try { finish(run); } catch (error) {
        // A completed workflow with an unsuitable output must not be resubmitted.
        const article = bubble('assistant', 'The run finished, but the selected reply could not be displayed.');
        const pre = document.createElement('pre'); pre.textContent = JSON.stringify(run, null, 2); article.append(pre);
        attempt = undefined; throw error;
      }
    }
  } catch (error) {
    if (signal.aborted) status('Stopped waiting locally. The workflow may still be running. Resume checking or request cancellation.');
    else {
      $('chat-error').textContent = errorText(error);
      if (['INVALID_INPUT', 'INVALID_KEY', 'KEY_REVOKED', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'VERSION_CHANGED', 'WORKFLOW_NOT_PUBLISHED', 'RATE_LIMITED', 'ACTION_PAUSED', 'AUTH_REQUIRED', 'CONNECTION_STOPPED', 'CONNECTION_REMOVING', 'BROWSER_BUSY', 'RECORDING_ACTIVE', 'REVISION_PERMISSION_CHANGED', 'IDEMPOTENCY_CONFLICT', 'VALIDATION_ERROR'].includes(error.code) && !attempt?.runId) {
        attempt = undefined; status('Request was rejected. Fix the error before sending another message.');
      }
      if (attempt) status(attempt.runId ? 'Waiting paused. Resume checking this run before sending another message.' : 'Receipt not confirmed. Recovering reuses the same request ID and message.');
    }
  } finally { busy = false; controller = undefined; controls(); if (!attempt) $('message').focus(); }
}
$('message-form').addEventListener('submit', event => {
  event.preventDefault(); if (!client || busy || attempt) return;
  $('chat-error').textContent = '';
  try {
    const text = $('message').value;
    const input = buildInput(text, $('prompt-field').value, $('extra-inputs').value, contract.input_schema);
    attempt = { input, output: $('response-field').value, requestId: crypto.randomUUID() };
    bubble('user', text.trim()); $('message').value = ''; void execute();
  } catch (error) { $('chat-error').textContent = errorText(error); }
});
$('message').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('message-form').requestSubmit(); }
});
$('stop').addEventListener('click', () => {
  controller?.abort();
  status('Stopping local observation. This does not cancel the workflow.');
});
$('resume').addEventListener('click', () => void execute());
$('cancel').addEventListener('click', async () => {
  if (!attempt?.runId || busy) return;
  busy = true; controls(); $('chat-error').textContent = '';
  try {
    const run = await client.cancel(attempt.runId);
    if (terminal(run)) finish(run);
    else status('Cancellation requested. Resume checking to confirm the outcome.');
  } catch (error) { $('chat-error').textContent = errorText(error); }
  finally { busy = false; controls(); }
});
$('clear').addEventListener('click', () => {
  if (busy || attempt) return;
  $('messages').replaceChildren(); $('welcome').hidden = false; $('chat-error').textContent = '';
  status(client ? 'Chat cleared. Ready for a message.' : 'Connect your API key to get started.');
});
controls();
