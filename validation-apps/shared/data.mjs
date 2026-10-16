export function recordsFrom(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return value == null ? [] : [{ value }];
  for (const candidate of ['products', 'quotes', 'records', 'items', 'rows', 'results']) if (Array.isArray(value[candidate])) return value[candidate];
  for (const child of Object.values(value)) if (Array.isArray(child)) return child;
  return [value];
}
export function flatten(record, prefix = '', result = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) { result[prefix || 'value'] = record; return result; }
  for (const [name, value] of Object.entries(record)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, key, result); else result[key] = value;
  }
  return result;
}
export const filterRecords = (records, query) => records.filter(row => JSON.stringify(row).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function observation(previous, run, input) {
  if (run.status !== 'succeeded' || run.result === undefined || !run.verification) throw Error('Only verified successful runs can become observations.');
  return { observed_at: new Date().toISOString(), run_id: run.id, workflow_id: run.workflow_id, revision: run.workflow_revision, execution_mode: run.execution_mode, input, result: run.result, verification: run.verification, state: !previous ? 'First observation' : canonical(previous.result) === canonical(run.result) ? 'Unchanged' : 'Changed' };
}
export function summary(rows) {
  const succeeded = rows.filter(row => row.status === 'succeeded' && row.verified).length;
  const ms = rows.map(row => row.duration_ms).filter(Number.isFinite);
  return { requests: rows.length, verified: succeeded, unsuccessful: rows.length - succeeded, average_duration_ms: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null };
}
export async function boundedRuns({ count, concurrency, intervalMs = 1500, task, onResult = () => {}, signal }) {
  if (!Number.isInteger(count) || count < 1 || count > 6 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) throw Error('Use 1–6 requests and concurrency 1–2.');
  if (!Number.isFinite(intervalMs) || intervalMs < 1500) throw Error('Leave at least 1500 ms between request admissions.');
  let next = 0, nextAt = Date.now(); const results = [];
  const worker = async () => {
    while (!signal?.aborted) {
      const index = next++; if (index >= count) return;
      const admittedAt = nextAt; nextAt += intervalMs;
      await new Promise(resolve => setTimeout(resolve, Math.max(0, admittedAt - Date.now())));
      if (signal?.aborted) return;
      let result;
      try { result = await task(index); } catch (error) { result = { status: 'request_failed', code: error.code ?? 'CLIENT_ERROR', message: error.message }; }
      results.push(result); onResult(result, index);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker)); return results;
}
