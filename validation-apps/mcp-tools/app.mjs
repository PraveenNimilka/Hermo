import { bootstrap, el, jsonView } from '/shared/ui.mjs';
bootstrap({ title: 'Hermo MCP Tools', description: 'Discover the tools your scoped API key can access, inspect their schemas and invoke them through Hermo’s actual MCP interface.', endpoint: '/v1/actions/validation.quotes/versions/1/runs', input: { page: '1' }, runLabel: 'Invoke workflow tool', footer: 'No conversational model is connected. These are actual MCP requests, not generated assistant answers.' }, ctx => {
  let tools = [], selected;
  const discover = el('button', { id: 'discover-tools', type: 'button' }, 'Discover authorized tools');
  const select = el('select', { id: 'tool-name', 'aria-label': 'Authorized workflow tool' });
  const count = el('select', { id: 'tool-count' }, el('option', {value:'1'}, 'One tool call'), el('option', {value:'2'}, 'Two concurrent tool calls'));
  const schemaBox = el('div', { class: 'tools' });
  const showSchema = () => { selected = tools.find(tool => tool.name === select.value); schemaBox.replaceChildren(...tools.map(tool => el('details', { class: 'tool' }, el('summary', {}, tool.name), el('p', { class: 'muted' }, tool.description ?? ''), jsonView(tool.inputSchema)))); };
  const discoverTools = async () => {
    const result = await ctx.client().discover(); tools = result.tools ?? [];
    select.replaceChildren(...tools.filter(tool => tool.name.startsWith('action_')).map(tool => el('option', { value: tool.name }, tool.title ?? tool.name)));
    showSchema(); ctx.statusText(`${tools.length} authorized tools discovered through MCP.`);
  };
  discover.onclick = async () => { discover.disabled = true; try { await discoverTools(); } catch (error) { ctx.statusText(`${error.code ?? 'MCP_FAILED'}: ${error.message}`, true); } finally { discover.disabled = false; } };
  select.onchange = showSchema;
  ctx.controls.append(discover, el('div', { class: 'field' }, el('label', { for: 'tool-name' }, 'Workflow tool'), select), el('div', {class:'field'}, el('label', {for:'tool-count'}, 'Execution budget'), count), schemaBox, el('p', { class: 'notice' }, 'Tool discovery, schemas, invocation and polling use /mcp. Two calls are admitted concurrently; Hermo serializes browser execution. A model provider is optional and is not configured here.'));
  ctx.execute = async input => {
    // Refresh under the current key; a previous key's tool catalog must not be reused.
    await discoverTools();
    if (!selected) throw Error('This key has no workflow execution tool.');
    const client=ctx.client(),name=selected.name,budget=count.value==='2'?2:1;
    const runs=await Promise.all(Array.from({length:budget},()=>client.runTool(name, input, { onStatus: ctx.renderRun, onAdmission: receipt => ctx.statusText('MCP queued · ' + receipt.run_id) })));
    if(budget>1)ctx.records.append(el('h2',{},'Concurrent tool calls'),ctx.table(runs.map(run=>({run_id:run.id,status:run.status,revision:run.workflow_revision,queue_ms:run.queue_duration_ms,verification:run.verification?'Present':'Not verified',error:run.error?.code??''}))));
    return runs.at(-1);
  };
});
