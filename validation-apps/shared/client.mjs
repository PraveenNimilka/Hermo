// Consumer-only client: no dashboard credentials, runtime internals or target-site requests.
export class HermoError extends Error {
  constructor(code, message, details) { super(message); this.name = 'HermoError'; this.code = code; this.details = details; }
}
export const terminal = run => ['succeeded', 'failed', 'cancelled', 'timed_out', 'disconnected'].includes(run?.status);
export const verified = run => run?.status === 'succeeded' && run.result !== undefined && !!run.verification;
export function parseInput(text) {
  let input; try { input = JSON.parse(text); } catch { throw new HermoError('INVALID_JSON', 'Inputs must be a valid JSON object.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HermoError('INVALID_INPUT', 'Inputs must be a JSON object.');
  return input;
}
export function validateInput(input, schema = {}) {
  for (const name of schema.required ?? []) if (!(name in input)) throw new HermoError('INVALID_INPUT', `Required input: ${name}.`);
  for (const [name, value] of Object.entries(input)) {
    const rule = schema.properties?.[name];
    if (!rule) { if (schema.additionalProperties === false) throw new HermoError('INVALID_INPUT', `Unknown input: ${name}.`); continue; }
    if (rule.type === 'string' && typeof value !== 'string' || rule.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)) || rule.type === 'integer' && !Number.isInteger(value) || rule.type === 'boolean' && typeof value !== 'boolean') throw new HermoError('INVALID_INPUT', `${name} must be ${rule.type}.`);
    if (rule.enum && !rule.enum.includes(value)) throw new HermoError('INVALID_INPUT', `${name} must match one of its allowed values.`);
    if (typeof value === 'string' && (rule.minLength != null && value.length < rule.minLength || rule.maxLength != null && value.length > rule.maxLength || rule.pattern && !new RegExp(rule.pattern).test(value))) throw new HermoError('INVALID_INPUT', `${name} does not match its published constraints.`);
    if (typeof value === 'number' && (rule.minimum != null && value < rule.minimum || rule.maximum != null && value > rule.maximum)) throw new HermoError('INVALID_INPUT', `${name} is outside its published range.`);
  }
  return input;
}
export function actionPath(value) {
  let path = value;
  if (value.startsWith('http')) {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new HermoError('INVALID_ENDPOINT', 'Use the published local Hermo endpoint.');
    path = url.pathname;
  }
  if (!/^\/v1\/actions\/[a-zA-Z0-9_.-]{1,150}\/versions\/1\/runs$/.test(path)) throw new HermoError('INVALID_ENDPOINT', 'Paste a published Hermo /v1/actions/…/versions/1/runs endpoint.');
  return path;
}
export function makeClient({ key, endpoint, transport, pollMs = 1200, timeoutMs = 240000 }) {
  if (typeof key !== 'string' || !/^hm_live_[A-Za-z0-9_-]+$/.test(key)) throw new HermoError('INVALID_KEY', 'Enter a scoped Hermo API key.');
  const path = actionPath(endpoint);
  const request = async (route, method = 'GET', body, idempotency) => {
    const response = await transport({ path: route, method, body, key, idempotency });
    if (response?.error) throw new HermoError(response.error.code ?? 'REQUEST_FAILED', response.error.message ?? 'The Hermo request failed.', response.error);
    return response;
  };
  const wait = async (id, { signal, onStatus = () => {}, read = () => request('/v1/runs/' + encodeURIComponent(id)) } = {}) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) throw new HermoError('CLIENT_STOPPED', `Stopped watching ${id}. The runtime may still be executing; use Cancel run to request cancellation.`);
      const run = await read(); onStatus(run);
      if (terminal(run)) return run;
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
    throw new HermoError('CLIENT_WAIT_TIMEOUT', `Stopped waiting for ${id}. The runtime has not confirmed a terminal result; do not submit again blindly.`);
  };
  let rpcId = 0;
  const rpc = async (method, params) => {
    const value = await request('/mcp', 'POST', { jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) });
    if (value.error) throw new HermoError('MCP_ERROR', value.error.message);
    if (value.result?.isError) throw new HermoError('MCP_TOOL_FAILED', value.result.content?.map(x => x.text ?? '').join('\n') || 'MCP tool failed.');
    return value.result;
  };
  const unwrap = result => result?.structuredContent ?? JSON.parse(result?.content?.find(x => x.type === 'text')?.text ?? '{}');
  return {
    contract: () => request('/v1/action-contract'),
    admit: (input, requestId = crypto.randomUUID()) => request(path, 'POST', { input }, requestId),
    read: id => request('/v1/runs/' + encodeURIComponent(id)),
    cancel: id => request('/v1/runs/' + encodeURIComponent(id) + '/cancel', 'POST', {}),
    wait,
    async run(input, options = {}) { const receipt = await this.admit(input, options.requestId); options.onAdmission?.(receipt); return wait(receipt.run_id, options); },
    async discover() { await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'hermo-validation-consumer', version: '1.0.0' } }); return rpc('tools/list'); },
    async invoke(name, args) { return unwrap(await rpc('tools/call', { name, arguments: args })); },
    async runTool(name, input, options = {}) {
      const receipt = unwrap(await rpc('tools/call', { name, arguments: { input, request_id: options.requestId ?? crypto.randomUUID() } }));
      if (!receipt.run_id) throw new HermoError('MCP_RECEIPT_INVALID', 'The tool did not return a run ID.');
      options.onAdmission?.(receipt);
      return wait(receipt.run_id, { ...options, read: async () => unwrap(await rpc('tools/call', { name: 'get_run', arguments: { run_id: receipt.run_id } })) });
    }
  };
}
export async function browserTransport(request) {
  let response;
  try { response = await fetch('/api/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(35000) }); }
  catch { throw new HermoError('RUNTIME_UNAVAILABLE', 'Cannot reach the consumer host or Hermo runtime. Check both processes.'); }
  const value = await response.json();
  if (!response.ok) throw new HermoError(value.error?.code ?? 'HTTP_' + response.status, value.error?.message ?? 'The request failed.', value.error);
  return value;
}
