import { bootstrap, el, table, download } from '/shared/ui.mjs';
import { recordsFrom, filterRecords } from '/shared/data.mjs';
bootstrap({ title: 'Website-to-JSON Explorer', description: 'Inspect repeated records, nested objects, optional fields and arrays extracted from Quotes to Scrape through Hermo.', endpoint: '/v1/actions/validation.quotes/versions/1/runs', input: { page: '1' } }, ctx => {
  ctx.controls.append(el('p', { class: 'muted' }, 'Use a supported page in the dynamic inputs. Filtering below searches only the returned verified records.'));
  ctx.onResult = run => {
    const records = recordsFrom(run.result), target = el('div');
    const filter = el('input', { id: 'filter', type: 'search', placeholder: 'Filter quotes, authors or tags', 'aria-label': 'Filter extracted records' });
    const draw = () => target.replaceChildren(table(filterRecords(records, filter.value)));
    filter.oninput = draw; draw();
    const exportButton = el('button', { type: 'button' }, 'Export verified JSON'); exportButton.onclick = () => download({ run_id: run.id, revision: run.workflow_revision, verification: run.verification, result: run.result }, 'hermo-website-data.json');
    ctx.records.append(el('div', { class: 'section-head' }, el('h2', {}, `${records.length} extracted records`), filter), target, exportButton);
  };
});
