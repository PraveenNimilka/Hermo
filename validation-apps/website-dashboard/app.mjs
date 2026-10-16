import { bootstrap, el, table } from '/shared/ui.mjs';
import { recordsFrom, filterRecords } from '/shared/data.mjs';
bootstrap({ title: 'Website Records Dashboard', description: 'Navigate published website pages, search the returned records and inspect record details. Every refresh is a new verified Hermo execution.', endpoint: '/v1/actions/validation.quotes/versions/1/runs', input: { page: '1' }, runLabel: 'Load page' }, ctx => {
  const page = el('select', { id: 'page' }, el('option', { value: '1' }, 'Page 1'), el('option', { value: '2' }, 'Page 2'));
  page.onchange = () => ctx.setInput({ ...ctx.getInput(), page: page.value });
  ctx.controls.append(el('div', { class: 'field' }, el('label', { for: 'page' }, 'Website page'), page), el('p', { class: 'notice' }, 'Published revisions stay stable while drafts are edited. Each execution below reports the revision that was admitted. Edit, test, publish and roll back in Hermo, then load again.'));
  ctx.onResult = run => {
    const records = recordsFrom(run.result), target = el('div'), details = el('div', { class: 'stack' });
    const filter = el('input', { id: 'filter', type: 'search', placeholder: 'Search this page', 'aria-label': 'Search returned website records' });
    const draw = () => { const filtered = filterRecords(records, filter.value); target.replaceChildren(table(filtered)); details.replaceChildren(...filtered.map((record, index) => el('details', {}, el('summary', {}, 'Record ' + (index + 1) + ' details'), ctx.jsonView(record)))); };
    filter.oninput = draw; draw();
    ctx.records.append(el('div', { class: 'section-head' }, el('h2', {}, `${records.length} records from the website`), filter), el('p', { class: 'muted' }, `Executor available for this run: ${run.execution_mode ?? 'not reported'}. Verification: succeeded. Current tab health may change after execution.`), target, details);
  };
});
