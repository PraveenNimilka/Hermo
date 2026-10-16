import { bootstrap, el, table, download } from '/shared/ui.mjs';
import { observation, canonical } from '/shared/data.mjs';
const storageKey = 'hermo-consumer-observations-v1';
const read = () => { try { const history = JSON.parse(localStorage.getItem(storageKey) ?? '[]'); return Array.isArray(history) ? history.slice(-100) : []; } catch { return []; } };
bootstrap({ title: 'Website Change Detector', description: 'Compare freshly verified website responses and keep a timestamped observation history on this device. No website content is modified.', endpoint: '/v1/actions/validation.products/versions/1/runs', input: { category: 'travel_2' }, runLabel: 'Observe website', footer: 'Observation history stores extracted website data locally. API keys are excluded.' }, ctx => {
  const historyBox = el('div', { class: 'stack' });
  const save = el('input', { id: 'save-observation', type: 'checkbox', checked: '' });
  ctx.controls.append(el('p', { class: 'notice' }, 'Managed Local Browser can run after the original browser closes. Connected Chrome still needs its authorized tab. The execution record identifies the actual mode.'), el('label', { class: 'check', for: 'save-observation' }, save, 'Save verified observations in this browser'));
  const draw = () => { const history = read(); historyBox.replaceChildren(el('h2', {}, 'Saved observations'), history.length ? table(history.slice().reverse().map(({ observed_at, run_id, revision, execution_mode, state }) => ({ observed_at, run_id, revision, execution_mode, state }))) : el('p', { class: 'empty' }, 'Run an observation to start your local history.')); };
  const exportButton = el('button', { type: 'button' }, 'Export observation history'); exportButton.onclick = () => download(read(), 'hermo-observations.json');
  ctx.controls.append(exportButton, historyBox); draw();
  ctx.onResult = (run, input) => {
    const history = read(), sameTarget = history.filter(item => item.workflow_id === run.workflow_id && canonical(item.input) === canonical(input));
    const value = observation(sameTarget.at(-1), run, input);
    ctx.records.append(el('h2', {}, value.state), el('p', { class: 'muted' }, 'Compared with the previous successful observation of this workflow and these inputs. An unchanged website is a valid result.'));
    if (save.checked) { try { localStorage.setItem(storageKey, JSON.stringify([...history, value].slice(-100))); draw(); } catch { ctx.records.append(el('p', { class: 'notice error' }, 'The observation succeeded, but local storage is full or unavailable. Export this response to keep it.')); } }
  };
});
