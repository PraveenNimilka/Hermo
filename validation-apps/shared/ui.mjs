import { makeClient, browserTransport, parseInput, validateInput, verified } from './client.mjs';
import { flatten } from './data.mjs';
export const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) { if (name === 'class') node.className = value; else if (name.startsWith('on')) node.addEventListener(name.slice(2).toLowerCase(), value); else if (value !== undefined) node.setAttribute(name, String(value)); }
  for (const child of children.flat()) if (child != null) node.append(child?.nodeType ? child : document.createTextNode(String(child)));
  return node;
};
export const jsonView = value => el('pre', { class: 'json' }, JSON.stringify(value, null, 2));
export function download(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = el('a', { href: url, download: name }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function table(records, columns) {
  if (!records.length) return el('p', { class: 'empty' }, 'No matching records in this verified response.');
  const flattened = records.map(record => flatten(record));
  const keys = columns ?? [...new Set(flattened.flatMap(record => Object.keys(record)))];
  return el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, keys.map(key => el('th', { scope: 'col' }, key)))), el('tbody', {}, flattened.map(record => el('tr', {}, keys.map(key => {
    const value = record[key];
    const display = value == null ? el('span', { class: 'muted' }, 'Not provided') : typeof value === 'string' && /^https?:\/\//.test(value) ? el('a', { href: value, target: '_blank', rel: 'noreferrer' }, value) : typeof value === 'object' ? el('pre', {}, JSON.stringify(value, null, 2)) : String(value);
    return el('td', {}, display);
  }))))));
}
export async function bootstrap(spec, mount) {
  const config = await (await fetch('/config')).json();
  document.title = spec.title + ' · Hermo';
  const root = document.getElementById('app');
  const endpoint = el('input', { id: 'endpoint', value: spec.endpoint, spellcheck: 'false', required: '', 'aria-describedby': 'endpoint-help' });
  const key = el('input', { id: 'api-key', type: 'password', autocomplete: 'off', placeholder: 'hm_live_…', spellcheck: 'false', required: '' });
  const inputs = el('textarea', { id: 'inputs', rows: '5', spellcheck: 'false', 'aria-label': 'Workflow input JSON' }, JSON.stringify(spec.input ?? {}, null, 2));
  const status = el('div', { id: 'status', role: 'status', 'aria-live': 'polite', class: 'notice' }, 'Configure your published endpoint and its scoped key to begin.');
  const contractBox = el('div');
  const resultBox = el('div', { id: 'result', class: 'output' });
  const recordsBox = el('div', { id: 'records', class: 'stack' });
  const appControls = el('div', { id: 'app-controls', class: 'stack' });
  const load = el('button', { id: 'load-contract', type: 'button' }, 'Load published contract');
  const run = el('button', { id: 'run', class: 'primary', type: 'button' }, spec.runLabel ?? 'Run workflow');
  const cancel = el('button', { id: 'cancel', type: 'button', disabled: '' }, 'Cancel run');
  const example = el('pre', { id: 'request-example', class: 'json' });
  let currentClient, contract, activeId, busy = false;
  const fields = el('div', { class: 'stack' }, el('div', { class: 'field' }, el('label', { for: 'endpoint' }, 'Published endpoint'), endpoint, el('small', { id: 'endpoint-help' }, 'The host forwards only to ', config.runtime, '.')), el('div', { class: 'field' }, el('label', { for: 'api-key' }, 'Workflow API key'), key, el('small', {}, 'Kept in browser memory. Never saved to local storage.')), load, contractBox);
  root.append(el('main', { class: 'shell' }, el('header', { class: 'masthead' }, el('span', { class: 'brand' }, 'hermo / consumers'), el('small', { id: 'runtime-name' }, 'Local runtime ', config.runtime)), el('div', { class: 'intro' }, el('h1', {}, spec.title), el('p', { class: 'muted' }, spec.description)), el('div', { class: 'layout' }, el('aside', { class: 'panel stack', 'aria-label': 'Workflow configuration' }, el('h2', {}, 'Connect your API'), fields, el('hr', { class: 'divider' }), appControls, el('div', { class: 'field' }, el('label', { for: 'inputs' }, 'Dynamic inputs'), inputs), el('div', { class: 'row' }, run, cancel), el('details', {}, el('summary', {}, 'Request example'), example)), el('section', { class: 'panel stack', 'aria-label': 'Live execution results' }, el('h2', {}, 'Execution'), status, resultBox, recordsBox)), el('footer', {}, 'Results come from your published Hermo workflow. The runtime and an authorized browser executor must remain available. ' + (spec.footer ?? ''))));
  const statusText = (text, error = false) => { status.textContent = text; status.className = 'notice' + (error ? ' error' : ''); status.setAttribute('role', error ? 'alert' : 'status'); };
  const refreshExample = () => {
    const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
    let path = endpoint.value;
    try { if (path.startsWith('http')) path = new URL(path).pathname; } catch { path = '/v1/actions/YOUR_ACTION/versions/1/runs'; }
    const body = JSON.stringify({ input: (() => { try { return parseInput(inputs.value); } catch { return {}; } })() });
    example.textContent = `curl ${quote(config.runtime + path)} \\\n  -H 'Authorization: Bearer YOUR_HERMO_KEY' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Idempotency-Key: YOUR_UNIQUE_REQUEST_ID' \\\n  -d ${quote(body)}`;
  };
  inputs.addEventListener('input', refreshExample); endpoint.addEventListener('change', refreshExample); refreshExample();
  const client = () => { currentClient = makeClient({ key: key.value.trim(), endpoint: endpoint.value.trim(), transport: browserTransport, timeoutMs: Math.max(240000, ((contract?.timeout_seconds ?? 0) + 60) * 1000) }); return currentClient; };
  const loadContract = async () => {
    const value = await client().contract(); contract = value;
    contractBox.replaceChildren(el('small', {}, 'Published revision ', value.revision ?? 'legacy', ' · ', value.action), el('details', {}, el('summary', {}, 'Input and output schemas'), jsonView({ input: value.input_schema, output: value.output_schema })));
    statusText('Published contract loaded. Review the dynamic inputs, then run the workflow.'); return value;
  };
  const renderRun = value => {
    activeId = value.id ?? activeId; cancel.disabled = ['succeeded', 'failed', 'cancelled', 'timed_out', 'disconnected'].includes(value.status);
    statusText(`${value.status}${value.phase ? ' · ' + value.phase : ''}${value.current_step ? ' · step ' + value.current_step.number + ' of ' + value.current_step.total : ''}`, ['failed', 'cancelled', 'timed_out', 'disconnected'].includes(value.status));
    const metric = (name, val) => el('div', {}, el('dt', {}, name), el('dd', {}, val ?? 'Not available'));
    resultBox.replaceChildren(el('dl', { class: 'stats' }, metric('Run ID', value.id), metric('Published revision', value.workflow_revision), metric('Execution mode', value.execution_mode), metric('Queue wait', value.queue_duration_ms == null ? null : value.queue_duration_ms + ' ms'), metric('Execution duration', value.execution_ms == null ? null : value.execution_ms + ' ms'), metric('Verification', verified(value) ? 'Verified result' : value.status === 'succeeded' ? 'Missing verification evidence' : 'Not yet verified')));
    if (value.error) resultBox.append(el('div', { class: 'notice error', role: 'alert' }, value.error.code + ': ' + value.error.message), el('details', {}, el('summary', {}, 'Failure details'), jsonView(value.error)));
    if (verified(value)) resultBox.append(el('details', { open: '' }, el('summary', {}, 'Verified output JSON'), jsonView(value.result)), el('details', {}, el('summary', {}, 'Verification evidence'), jsonView(value.verification)));
    resultBox.append(el('details', {}, el('summary', {}, 'Complete execution record'), jsonView(value)));
  };
  const ctx = { spec, config, el, table, jsonView, download, controls: appControls, records: recordsBox, statusText, client, get contract() { return contract; }, getInput: () => parseInput(inputs.value), setInput: value => { inputs.value = JSON.stringify(value, null, 2); refreshExample(); }, loadContract, renderRun, async standard(input, options = {}) { const c = client(); return c.run(input, { ...options, onAdmission: receipt => { activeId = receipt.run_id; cancel.disabled = false; statusText('Queued · ' + activeId); options.onAdmission?.(receipt); }, onStatus: value => { renderRun(value); options.onStatus?.(value); } }); }, onResult: () => {}, execute: null, setRunLabel: value => { run.textContent = value; } };
  mount(ctx);
  const guard = async fn => { if (busy) return; busy = true; run.disabled = load.disabled = endpoint.disabled = key.disabled = true; try { await fn(); } catch (error) { statusText(`${error.code ?? 'REQUEST_FAILED'}: ${error.message}`, true); } finally { busy = false; run.disabled = load.disabled = endpoint.disabled = key.disabled = false; } };
  load.onclick = () => guard(loadContract);
  const reset = () => { contract = undefined; currentClient = undefined; contractBox.replaceChildren(); };
  key.addEventListener('change', reset); endpoint.addEventListener('change', reset);
  run.onclick = () => guard(async () => { recordsBox.replaceChildren(); resultBox.replaceChildren(); if (!contract) await loadContract(); const input = ctx.getInput(); if (!spec.skipInputValidation) validateInput(input, contract.input_schema); statusText('Submitting a new request…'); const result = await (ctx.execute ? ctx.execute(input) : ctx.standard(input)); if (result) { renderRun(result); if (verified(result)) ctx.onResult(result, input); } });
  cancel.onclick = async () => { try { if (activeId) renderRun(await currentClient.cancel(activeId)); } catch (error) { statusText(error.code + ': ' + error.message, true); } };
  return ctx;
}
