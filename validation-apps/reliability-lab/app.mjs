import { bootstrap, el, table, download } from '/shared/ui.mjs';
import { boundedRuns, summary } from '/shared/data.mjs';
import { verified } from '/shared/client.mjs';
bootstrap({ title: 'Hermo Reliability Lab', description: 'Measure real scoped API admissions, queue wait, execution time, revision and verification. Public-site budgets are capped at six requests and two concurrent calls.', endpoint: '/v1/actions/validation.products/versions/1/runs', input: { category: 'travel_2' }, runLabel: 'Start bounded test', skipInputValidation: true }, ctx => {
  const count = el('input', { id: 'request-count', type: 'number', min: '1', max: '6', value: '2', step: '1' });
  const concurrency = el('select', { id: 'concurrency' }, el('option', { value: '1' }, '1 request at a time'), el('option', { value: '2' }, '2 requests at a time'));
  const scenario = el('select', { id: 'scenario' }, el('option', { value: 'normal' }, 'Fresh request IDs'), el('option', { value: 'idempotency' }, 'Reuse one idempotency key'));
  const stop = el('button', { type: 'button', disabled: '' }, 'Stop further admissions');
  let controller, results = [];
  stop.onclick = () => { controller?.abort(); stop.disabled = true; ctx.statusText('No further requests will be admitted. Already admitted requests continue to a terminal result.'); };
  const exportButton = el('button', { type: 'button' }, 'Export measured results'); exportButton.onclick = () => download({ captured_at: new Date().toISOString(), summary: summary(results), results }, 'hermo-reliability-results.json');
  ctx.controls.append(el('div', { class: 'two-col' }, el('div', { class: 'field' }, el('label', { for: 'request-count' }, 'Request budget'), count), el('div', { class: 'field' }, el('label', { for: 'concurrency' }, 'Concurrency'), concurrency)), el('div', { class: 'field' }, el('label', { for: 'scenario' }, 'Admission scenario'), scenario), stop, exportButton, el('p', { class: 'notice' }, 'Admissions are at least 1.5 seconds apart. Test invalid/revoked keys, wrong scope or invalid inputs with a single request using the corresponding configuration. Crash and restart scenarios belong in the isolated validation harness, never against your working browser.'));
  ctx.execute = async input => {
    const budget = Number(count.value), parallel = Number(concurrency.value), c = ctx.client();
    if (!Number.isInteger(budget) || budget < 1 || budget > 6) throw Error('Use a request budget from 1 to 6.');
    controller = new AbortController(); stop.disabled = false; results = [];
    const requestId = crypto.randomUUID();
    const statsBox = el('div'), recordsBox = el('div'); ctx.records.append(el('h2', {}, 'Measured requests'), statsBox, recordsBox);
    const draw = () => { statsBox.replaceChildren(ctx.jsonView(summary(results))); recordsBox.replaceChildren(table(results)); };
    try {
      await boundedRuns({ count: budget, concurrency: parallel, signal: controller.signal, task: async () => {
        const started = Date.now(), run = await c.run(input, { requestId: scenario.value === 'idempotency' ? requestId : crypto.randomUUID(), onStatus: ctx.renderRun });
        return { run_id: run.id, status: run.status, verified: verified(run), revision: run.workflow_revision, execution_mode: run.execution_mode, queue_ms: run.queue_duration_ms, execution_ms: run.execution_ms, duration_ms: run.duration_ms, wall_ms: Date.now() - started, code: run.error?.code ?? '', verification: run.verification ?? null };
      }, onResult: value => { results.push(value); draw(); } });
      ctx.statusText(`Finished ${results.length} measured requests. ${summary(results).verified} verified responses.`, results.some(row => !row.verified));
    } finally { stop.disabled = true; }
    return null;
  };
});
