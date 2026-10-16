import test from 'node:test';
import assert from 'node:assert/strict';
import { recordsFrom, flatten, filterRecords, observation, summary, boundedRuns } from '../shared/data.mjs';
test('product explorer preserves real response fields and filters only returned records', () => {
  const rows = recordsFrom({ products: [{ title: 'Record one', price: '£1.00', availability: 'Available', url: 'https://example.invalid/one' }, { title: 'Record two' }], metadata: { heading: 'Fixture catalog' } });
  assert.equal(rows.length, 2); assert.equal(filterRecords(rows, 'ONE')[0].price, '£1.00'); assert.equal(filterRecords(rows, 'absent').length, 0);
});
test('JSON explorer and records dashboard keep nested fields, arrays and optional absence', () => {
  const rows = recordsFrom({ quotes: [{ text: 'Fixture text', author: { name: 'Fixture author' }, tags: ['one', 'two'] }, { text: 'Another fixture' }] });
  assert.deepEqual(flatten(rows[0]), { text: 'Fixture text', 'author.name': 'Fixture author', tags: ['one', 'two'] }); assert.equal(flatten(rows[1])['author.name'], undefined);
});
test('change detector compares canonical verified data and refuses failed observations', () => {
  const first = observation(null, { id: 'run_1', status: 'succeeded', result: { a: 1, b: 2 }, verification: { checks: ['fixture'] } }, {});
  assert.equal(first.state, 'First observation');
  assert.equal(observation(first, { id: 'run_2', status: 'succeeded', result: { b: 2, a: 1 }, verification: {} }, {}).state, 'Unchanged');
  assert.equal(observation(first, { id: 'run_3', status: 'succeeded', result: { a: 3 }, verification: {} }, {}).state, 'Changed');
  assert.throws(() => observation(first, { status: 'failed', result: { a: 3 } }, {}), /Only verified/);
});
test('reliability statistics classify uncertainty, request failure and absent durations accurately', () => {
  assert.deepEqual(summary([{ status: 'succeeded', verified: true, duration_ms: 10 }, { status: 'failed', duration_ms: 20 }, { status: 'request_failed' }, { status: 'succeeded', verified: false }]), { requests: 4, verified: 1, unsuccessful: 3, average_duration_ms: 15 });
});
test('stress budgets reject high load without submitting requests', async () => {
  let calls = 0;
  for (const [count, concurrency, intervalMs] of [[7, 1, 1500], [2, 3, 1500], [2, 2, 0], [0, 1, 1500]]) await assert.rejects(boundedRuns({ count, concurrency, intervalMs, task: async () => { calls++; } }));
  assert.equal(calls, 0);
});
test('stress lab returns actual task errors and honors stopped admissions', async () => {
  const values = await boundedRuns({ count: 1, concurrency: 1, task: async () => { throw Object.assign(Error('Invalid scoped key'), { code: 'UNAUTHORIZED' }); } });
  assert.equal(values[0].status, 'request_failed'); assert.equal(values[0].code, 'UNAUTHORIZED');
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await boundedRuns({ count: 2, concurrency: 1, signal: controller.signal, task: async () => assert.fail('Must not submit') }), []);
});
