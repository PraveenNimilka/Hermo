import test from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, parseInput, validateInput, actionPath, verified, HermoError } from '../shared/client.mjs';
const key = 'hm_live_consumer_fixture';
const endpoint = '/v1/actions/validation.products/versions/1/runs';
// These isolated tests use an explicit transport fixture. Live acceptance is recorded separately.
test('published contract input constraints reject malformed, wrong-type and extra inputs', () => {
  assert.throws(() => parseInput('['), /valid JSON/);
  assert.throws(() => parseInput('[]'), /JSON object/);
  const schema = { required: ['category'], additionalProperties: false, properties: { category: { type: 'string', pattern: '^[a-z]+_[0-9]+$' }, limit: { type: 'integer', minimum: 1, maximum: 5 }, enabled: { type: 'boolean' } } };
  assert.deepEqual(validateInput({ category: 'travel_2', limit: 2, enabled: true }, schema), { category: 'travel_2', limit: 2, enabled: true });
  for (const input of [{}, { category: 1 }, { category: '../' }, { category: 'travel_2', extra: 1 }, { category: 'travel_2', limit: 0 }, { category: 'travel_2', enabled: 'true' }]) assert.throws(() => validateInput(input, schema), HermoError);
});
test('consumer endpoints cannot redirect keys to arbitrary remote or owner routes', () => {
  assert.equal(actionPath('http://127.0.0.1:4318' + endpoint), endpoint);
  for (const path of ['https://evil.example' + endpoint, '/studio/export', '/v1/actions/a/versions/1/runs?x=1', 'http://user:secret@localhost' + endpoint]) assert.throws(() => actionPath(path));
});
test('REST client preserves admission idempotency, polls actual run and carries scoped key', async () => {
  const requests = [], run = { id: 'run_fixture', status: 'succeeded', result: { products: [{ title: 'Transport fixture' }] }, verification: { checks: ['schema'] } };
  let polls = 0;
  const transport = async request => { requests.push(request); if (request.method === 'POST') return { run_id: run.id }; return ++polls === 1 ? { id: run.id, status: 'running' } : run; };
  const client = makeClient({ key, endpoint, transport, pollMs: 1 });
  const statuses = [], value = await client.run({ category: 'travel_2' }, { requestId: 'stable-request', onStatus: row => statuses.push(row.status) });
  assert.equal(value, run); assert.deepEqual(statuses, ['running', 'succeeded']);
  assert.equal(requests[0].idempotency, 'stable-request'); assert.deepEqual(requests[0].body, { input: { category: 'travel_2' } }); assert.ok(requests.every(request => request.key === key));
});
test('failed and unverified results never qualify as verified observations', async () => {
  for (const run of [{ status: 'failed', result: { data: 'stale' }, verification: {} }, { status: 'succeeded', result: {} }, { status: 'running' }, { status: 'succeeded', verification: {} }]) assert.equal(verified(run), false);
  const client = makeClient({ key, endpoint, transport: async () => ({ error: { code: 'KEY_REVOKED', message: 'Revoked scoped key.' } }) });
  await assert.rejects(client.admit({}), error => error.code === 'KEY_REVOKED');
});
test('poll timeout remains uncertain and does not automatically readmit a workflow', async () => {
  let admissions = 0;
  const client = makeClient({ key, endpoint, timeoutMs: 4, pollMs: 2, transport: async request => request.method === 'POST' ? (admissions++, { run_id: 'run_pending' }) : { id: 'run_pending', status: 'running' } });
  await assert.rejects(client.run({}), error => error.code === 'CLIENT_WAIT_TIMEOUT'); assert.equal(admissions, 1);
});
test('MCP consumer discovers schemas, invokes actual protocol and polls get_run through MCP', async () => {
  const requests = [];
  const transport = async request => {
    requests.push(request); const body = request.body;
    let result;
    if (body.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } };
    if (body.method === 'tools/list') result = { tools: [{ name: 'action_validation_quotes', inputSchema: { type: 'object' } }] };
    if (body.method === 'tools/call') result = { structuredContent: body.params.name === 'get_run' ? { id: 'run_mcp', status: 'succeeded', result: { quotes: [] }, verification: { checks: ['fixture'] } } : { run_id: 'run_mcp' } };
    return { jsonrpc: '2.0', id: body.id, result };
  };
  const client = makeClient({ key, endpoint, transport });
  assert.equal((await client.discover()).tools[0].name, 'action_validation_quotes');
  assert.equal((await client.runTool('action_validation_quotes', { page: '1' }, { requestId: 'mcp-stable' })).id, 'run_mcp');
  assert.ok(requests.every(request => request.path === '/mcp'));
  assert.equal(requests[2].body.params.arguments.request_id, 'mcp-stable'); assert.equal(requests[3].body.params.name, 'get_run');
});
test('MCP tool errors propagate without manufacturing a run', async () => {
  const client = makeClient({ key, endpoint, transport: async () => ({ result: { isError: true, content: [{ type: 'text', text: 'Invalid inputs' }] } }) });
  await assert.rejects(client.runTool('action_fixture', {}), error => error.code === 'MCP_TOOL_FAILED' && error.message === 'Invalid inputs');
});
