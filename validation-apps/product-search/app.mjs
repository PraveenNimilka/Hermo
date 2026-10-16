import { bootstrap, el, table } from '/shared/ui.mjs';
import { recordsFrom, filterRecords } from '/shared/data.mjs';
bootstrap({ title: 'Product Search Explorer', description: 'Explore real Books to Scrape catalog records through your published Hermo API. Choose a supported category, then filter the returned titles locally.', endpoint: '/v1/actions/validation.products/versions/1/runs', input: { category: 'travel_2' } }, ctx => {
  const category = el('select', { id: 'category' }, el('option', { value: 'travel_2' }, 'Travel'), el('option', { value: 'mystery_3' }, 'Mystery'));
  category.onchange = () => ctx.setInput({ ...ctx.getInput(), category: category.value });
  ctx.controls.append(el('div', { class: 'field' }, el('label', { for: 'category' }, 'Catalog category'), category, el('small', {}, 'Books to Scrape has category navigation, not a native search box.')));
  ctx.onResult = run => {
    const rows = recordsFrom(run.result), target = el('div');
    const filter = el('input', { id: 'filter', type: 'search', placeholder: 'Filter returned product titles', 'aria-label': 'Filter returned products' });
    const draw = () => target.replaceChildren(table(filterRecords(rows, filter.value)));
    filter.oninput = draw; draw();
    ctx.records.append(el('div', { class: 'section-head' }, el('h2', {}, `${rows.length} catalog records`), filter), target);
  };
});
