import {MediaResults} from './MediaResults';
import {useEffect,useId,useRef,useState} from 'react';
import {TypedInputFields,initialInputValues,typedInput,inputDefinitionFromSchema,type InputDefinition,type JsonValue} from './WorkflowContract';
import {jsonRequestInput,sanitizedExamples,type ExampleLanguage} from './api-examples';
import './api-playground-extras.css';

type Workflow={id:string;name:string;slug:string;status:string;version:string;published_revision?:number|null};
type SchemaField={type?:string;enum?:string[];default?:JsonValue;minimum?:number;maximum?:number;minLength?:number;maxLength?:number;pattern?:string;'x-hermo-normalization'?:'trim'};
type Contract={action:string;version:string;revision?:number;active_revision?:number;timeout_seconds?:number;input_schema:{properties?:Record<string,SchemaField>;required?:string[]};output_schema?:unknown};
type Revisions={active_revision:number|null;revisions:{revision:number;version:string;active:boolean}[]};
type Run={id:string;status:string;execution_status?:string;phase?:string;duration_ms?:number;progress?:number;result?:Record<string,unknown>;verification?:{verified_at?:string};error?:{code?:string;message?:string;retry_safe?:boolean};execution?:unknown};
type Attempt={input:Record<string,JsonValue>;idempotency:string;revision?:number;route:string;explicitRevision:boolean;timeoutSeconds:number;runId?:string};
type Request=<T=any>(path:string,body?:unknown)=>Promise<T>;
const terminal=(run:Run|null)=>!!run&&['succeeded','failed','uncertain','cancelled','timed_out','disconnected'].includes(run.status);

export function ApiPlayground({workflow,onRun}:{workflow:Workflow;request:Request;onRun?:(runId:string)=>void}){
  const[retryConcern,setRetryConcern]=useState<string|null>(null),[retryAcknowledged,setRetryAcknowledged]=useState(false);
  const[revisions,setRevisions]=useState<Revisions|null>(null),[selectedRevision,setSelectedRevision]=useState('active');
  const[inputMode,setInputMode]=useState<'form'|'json'>('form'),[jsonDraft,setJsonDraft]=useState(''),[jsonError,setJsonError]=useState('');
  const id=useId(),credential=useRef(''),controller=useRef<AbortController|null>(null),mounted=useRef(true);
  const[key,setKey]=useState(''),[contract,setContract]=useState<Contract|null>(null),[inputs,setInputs]=useState<Record<string,InputDefinition>>({}),[values,setValues]=useState<Record<string,string>>({}),[omitted,setOmitted]=useState<Record<string,boolean>>({}),[fieldErrors,setFieldErrors]=useState<Record<string,string>>({}),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState<Attempt|null>(null),[run,setRun]=useState<Run|null>(null),[copied,setCopied]=useState(''),[example,setExample]=useState<ExampleLanguage>('curl');
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();credential.current='';};},[]);
  const route=`/v1/actions/${encodeURIComponent(workflow.slug)}/${selectedRevision==='active'?'versions/1':`revisions/${selectedRevision}`}/runs`,endpoint=location.origin+route,unresolved=!!attempt&&!terminal(run);
  const currentInput=typedInput(inputs,values,omitted),requestJson=attempt?JSON.stringify({input:attempt.input},null,2):inputMode==='json'?jsonDraft:JSON.stringify({input:currentInput.input},null,2);
  const samples=contract?sanitizedExamples({origin:location.origin,slug:workflow.slug,revision:contract.revision??contract.active_revision??1,inputSchema:contract.input_schema,outputSchema:contract.output_schema}):null,code=samples?.code[example]??'';
  function switchInputMode(mode:'form'|'json'){if(busy||unresolved||mode===inputMode)return;if(mode==='json'){setJsonDraft(JSON.stringify({input:currentInput.input},null,2));setJsonError('');setInputMode(mode);return;}try{const parsed=jsonRequestInput(jsonDraft,inputs,(next,skip)=>typedInput(inputs,next,skip));setValues(parsed.values);setOmitted(parsed.omitted);setJsonError('');setInputMode(mode);}catch(cause){setJsonError(message(cause));}}
  function download(format:'markdown'|'json'|'curl'|'client'){if(!samples)return;const text=format==='markdown'?samples.markdown:format==='json'?samples.json:format==='curl'?samples.code.curl:samples.code.javascript,extension={markdown:'md',json:'json',curl:'sh',client:'mjs'}[format],url=URL.createObjectURL(new Blob([text],{type:format==='json'?'application/json':'text/plain;charset=utf-8'})),anchor=document.createElement('a');anchor.href=url;anchor.download=`hermo-api-example.${extension}`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setCopied('download-'+format);}
  function begin(){controller.current?.abort();const active=new AbortController();controller.current=active;setBusy(true);setError('');setNotice('');return active;}
  function finish(active:AbortController){if(mounted.current&&controller.current===active){controller.current=null;setBusy(false);}}
  async function connect(event:React.FormEvent){event.preventDefault();if(busy||unresolved)return;const pasted=key.trim();setKey('');credential.current='';setContract(null);setRevisions(null);setSelectedRevision('active');setAttempt(null);setRun(null);const active=begin();try{
    if(!/^hm_live_[A-Za-z0-9_-]{43}$/.test(pasted))throw Error('Paste a scoped API key created for this published workflow.');
    const received=await consumer<Contract>('/v1/action-contract',pasted,active.signal);
    if(received.action!==workflow.slug)throw Error('This key belongs to another workflow. Use a key scoped to this workflow.');
    const revision=received.active_revision??received.revision;
    if(workflow.published_revision!=null&&revision!==workflow.published_revision)throw Error('The published revision changed. Refresh API documentation before connecting this key.');
    const available=await consumer<Revisions>('/v1/action-revisions',pasted,active.signal);
    if(available.active_revision!==revision||!available.revisions.some(value=>value.revision===revision&&value.version===received.version))throw Error('The published revision changed while loading versions. Refresh API documentation before connecting this key.');
    const definitions=definitionsFrom(received);
    if(!mounted.current||active.signal.aborted)return;
    credential.current=pasted;setContract(received);setRevisions(available);setInputs(definitions);setValues(initialInputValues(definitions));setOmitted({});setFieldErrors({});setInputMode('form');setJsonError('');setNotice('Scoped key verified. Requests use the consumer API and its published contract.');
  }catch(cause){if(mounted.current&&!active.signal.aborted)setError(message(cause));}finally{finish(active);}}
  async function selectRevision(value:string){if(busy||unresolved||!credential.current||!revisions)return;
    if(value!=='active'&&!revisions.revisions.some(item=>String(item.revision)===value))return;
    const active=begin();try{
      const received=await consumer<Contract>(`/v1/action-contract${value==='active'?'':`?revision=${value}`}`,credential.current,active.signal);
      const expected=value==='active'?revisions.active_revision:Number(value),listed=revisions.revisions.find(item=>item.revision===expected);
      if(received.action!==workflow.slug||received.revision!==expected||!listed||listed.version!==received.version)throw Error('The selected published revision changed. Refresh API documentation before running.');
      const definitions=definitionsFrom(received);if(!mounted.current||active.signal.aborted)return;
      setSelectedRevision(value);setContract(received);setInputs(definitions);setValues(initialInputValues(definitions));setOmitted({});setFieldErrors({});setInputMode('form');setJsonError('');setAttempt(null);setRun(null);setCopied('');setRetryAcknowledged(false);
      setNotice(`Revision ${received.revision} loaded. Review its inputs before running.`);
    }catch(cause){if(mounted.current&&!active.signal.aborted)setError(message(cause));}finally{finish(active);}
  }
  async function poll(receipt:Attempt,active:AbortController){
    const deadline=Date.now()+Math.min(305000,Math.max(20000,receipt.timeoutSeconds*1000+10000));
    while(!active.signal.aborted){
      const observed=await consumer<Run>(`/v1/runs/${encodeURIComponent(receipt.runId!)}`,credential.current,active.signal);
      if(!mounted.current||active.signal.aborted)return;setRun(observed);
      if(terminal(observed)){
        if(observed.error?.retry_safe===false){setRetryConcern(observed.id);setRetryAcknowledged(false);}
        if(observed.status==='succeeded'&&!observed.verification?.verified_at)throw Error('The runtime returned success without verification evidence. Inspect the run before using this result.');
        setNotice(observed.status==='succeeded'?'Verified result received.':observed.status==='cancelled'?'The run was cancelled. Website changes may already have occurred.':observed.execution_status==='uncertain'?'The website outcome is uncertain. Inspect the website before authorizing another execution.':observed.execution_status==='timed_out'?'The execution timed out. Inspect its error and run details.':'The run finished with a failure. Inspect its error and run details.');return;
      }
      if(Date.now()>=deadline)throw Error('Stopped waiting for a final result. The run may still be active. Resume checking this run before starting another.');
      await pause(700,active.signal);
    }
  }
  async function execute(previous?:Attempt){if(busy||!contract||!credential.current)return;
    if(!previous&&retryConcern&&!retryAcknowledged){setError('Inspect the website and confirm another execution before starting a new request.');return;}
    let parsed=currentInput;if(!previous&&inputMode==='json'){try{parsed=jsonRequestInput(jsonDraft,inputs,(next,skip)=>typedInput(inputs,next,skip));setJsonError('');}catch(cause){setJsonError(message(cause));return;}}if(!previous&&Object.keys(parsed.errors).length){setFieldErrors(parsed.errors);setError('Review the input fields before running.');return;}
    const selected=previous??{input:parsed.input,idempotency:crypto.randomUUID(),revision:contract.revision??contract.active_revision,route,explicitRevision:selectedRevision!=='active',timeoutSeconds:contract.timeout_seconds??45};setAttempt(selected);if(!previous)setRun(null);setFieldErrors({});const active=begin();let receiptAccepted=!!selected.runId;
    try{
      let accepted=selected;
      if(!accepted.runId){
        const receipt=await consumer<{run_id:string}>(accepted.route,credential.current,active.signal,{input:accepted.input,...!accepted.explicitRevision&&accepted.revision?{expected_revision:accepted.revision}:{}},accepted.idempotency);
        if(typeof receipt.run_id!=='string'||!receipt.run_id)throw Error('The runtime did not return a run receipt. Retry this same request to recover its receipt.');
        accepted={...accepted,runId:receipt.run_id};receiptAccepted=true;if(!mounted.current||active.signal.aborted)return;setAttempt(accepted);setRetryConcern(null);setRetryAcknowledged(false);
      }
      await poll(accepted,active);
    }catch(cause){if(mounted.current&&!active.signal.aborted){if(!receiptAccepted&&cause instanceof ConsumerError&&cause.status>=400&&cause.status<500)setAttempt(null);setError(message(cause));}}finally{finish(active);}
  }
  function stopWaiting(){controller.current?.abort();controller.current=null;setBusy(false);setNotice('Stopped waiting locally. This does not cancel the submitted run. Resume checking before starting another request.');}
  async function cancel(){if(busy||!attempt?.runId||terminal(run))return;const active=begin();try{
    const cancelled=await consumer<Run>(`/v1/runs/${encodeURIComponent(attempt.runId)}/cancel`,credential.current,active.signal,{});
    if(mounted.current&&!active.signal.aborted){setRun(cancelled);if(cancelled.error?.retry_safe===false){setRetryConcern(cancelled.id);setRetryAcknowledged(false);}setNotice('Cancellation requested. It cannot undo website changes already made.');}
  }catch(cause){if(mounted.current&&!active.signal.aborted)setError(message(cause));}finally{finish(active);}}
  async function copy(label:string,value:string){try{await navigator.clipboard.writeText(value);if(mounted.current)setCopied(label);}catch{if(mounted.current)setError('Clipboard access failed. Select and copy the text manually.');}}
  return <section className="api-playground" aria-labelledby={id+'-title'}>
    <header><div><h2 id={id+'-title'}>API playground</h2><p>Call the published API with a scoped key, using the same permissions as your application.</p></div>{contract&&<span className="pill quiet">{contract.revision??contract.active_revision?`Revision ${contract.revision??contract.active_revision}`:'Published contract'}</span>}</header>
    <p className="api-playground-requirements">Keep the local runtime and authorized browser session available. Connected Chrome also requires its paired website tab. Closing this panel stops waiting; it does not stop an accepted run.</p>
    <div className="api-playground-endpoint"><span>POST</span><code>{endpoint}</code><button className="button ghost" type="button" onClick={()=>void copy('endpoint',endpoint)}>{copied==='endpoint'?'Copied':'Copy URL'}</button></div>
    <form className="api-playground-key field" onSubmit={connect}><label className="api-playground-key-label" htmlFor={id+'-key'}>Scoped API key</label><input id={id+'-key'} aria-label="Scoped API key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={event=>setKey(event.target.value)} disabled={busy||unresolved} placeholder={contract?'Paste another key to replace this connection':'hm_live_…'} required aria-describedby={id+'-key-hint'}/><small id={id+'-key-hint'}>Kept in memory only. Never included in examples or saved in browser storage.</small><button className="button secondary" disabled={busy||unresolved} type="submit">{busy&&!attempt?'Checking key…':contract?'Replace key':'Connect key'}</button></form>
    {error&&<p className="api-playground-message" role="alert">{error}{unresolved&&!attempt?.runId?' The request may already have been accepted. Use “Retry same request” to preserve its idempotency key.':''}</p>}
    {notice&&<p className="api-playground-message" role="status">{notice}</p>}
    {contract&&<>
      <label className="field"><span>Published revision</span><select aria-label="Published revision" value={selectedRevision} disabled={busy||unresolved} onChange={event=>void selectRevision(event.target.value)}><option value="active">Active revision{revisions?.active_revision?` · ${revisions.active_revision}`:''}</option>{revisions?.revisions.map(value=><option key={value.revision} value={value.revision}>Revision {value.revision}{value.active?' · active':''}</option>)}</select><small>Active requests follow the live API. Choosing a numbered revision uses its immutable contract and endpoint.</small></label>
      <div className="api-playground-columns"><div><h3>Request inputs</h3><div className="api-input-mode" role="group" aria-label="Input editor"><button type="button" className="button secondary" aria-pressed={inputMode==='form'} disabled={busy||unresolved} onClick={()=>switchInputMode('form')}>Form fields</button><button type="button" className="button secondary" aria-pressed={inputMode==='json'} disabled={busy||unresolved} onClick={()=>switchInputMode('json')}>JSON editor</button></div>{inputMode==='json'?<label className="field api-json-editor"><span>Request JSON editor</span><textarea aria-label="Request JSON editor" rows={12} maxLength={24576} value={jsonDraft} spellCheck={false} disabled={busy||unresolved} aria-invalid={!!jsonError} aria-describedby={id+'-json-hint'} onChange={event=>{setJsonDraft(event.target.value);setJsonError('');setAttempt(null);setRun(null);}}/><small id={id+'-json-hint'}>Use an input object matching this published revision. Undeclared fields, incorrect types and invalid constraints are rejected before submission.</small></label>:<fieldset disabled={busy||unresolved} className="api-playground-fields"><legend className="sr-only">Inputs for {workflow.name}</legend>{Object.keys(inputs).length?<TypedInputFields inputs={inputs} values={values} omitted={omitted} errors={fieldErrors} disabled={busy||unresolved} onChange={(name,value)=>{setValues(current=>({...current,[name]:value}));setAttempt(null);setRun(null);setCopied('');}} onOmit={(name,value)=>{setOmitted(current=>({...current,[name]:value}));setAttempt(null);setRun(null);setCopied('');}}/>:<p>This workflow needs no input.</p>}</fieldset>}{jsonError&&<p className="field-error" role="alert">{jsonError}</p>}<div className="api-playground-controls">{retryConcern&&!unresolved&&<label className="checkbox-row"><input type="checkbox" checked={retryAcknowledged} onChange={event=>setRetryAcknowledged(event.target.checked)}/><span>I inspected the website outcome of <code>{retryConcern}</code> and authorize another execution. It may repeat a website change.</span></label>}{!unresolved&&<button className="button primary" type="button" disabled={busy||!!retryConcern&&!retryAcknowledged} onClick={()=>void execute()}>Run API request</button>}{unresolved&&!busy&&<button type="button" className="button primary" onClick={()=>void execute(attempt!)}>{attempt?.runId?'Resume checking run':'Retry same request'}</button>}{busy&&attempt&&<button type="button" className="button secondary" onClick={stopWaiting}>Stop waiting</button>}{attempt?.runId&&!terminal(run)&&!busy&&<button type="button" className="button secondary" onClick={()=>void cancel()}>Cancel run</button>}</div></div>
      <div><div className="api-playground-code-heading"><h3>Request JSON</h3><button className="button ghost" type="button" onClick={()=>void copy('request',requestJson)}>{copied==='request'?'Copied':'Copy JSON'}</button></div><pre tabIndex={0} aria-label="Request JSON">{requestJson}</pre></div></div>
      <div className="api-playground-result" aria-busy={busy&&!!attempt}><div className="api-playground-code-heading"><h3>Response</h3>{run&&<button className="button ghost" type="button" onClick={()=>void copy('response',JSON.stringify(run,null,2))}>{copied==='response'?'Copied':'Copy JSON'}</button>}</div><dl className="api-playground-status"><div><dt>Status</dt><dd>{(run?.phase==='awaiting_approval'?'Awaiting owner approval':(run?.execution_status??run?.status)?.replaceAll('_',' '))??(attempt?attempt.runId?'Accepted':'Submitting or awaiting receipt':'Not run')}</dd></div>{run?.duration_ms!==undefined&&<div><dt>Duration</dt><dd>{(run.duration_ms/1000).toFixed(2)} s</dd></div>}{attempt?.runId&&<div><dt>Run ID</dt><dd><code>{attempt.runId}</code>{onRun&&<button type="button" className="button ghost" onClick={()=>onRun(attempt.runId!)}>View run details</button>}</dd></div>}</dl>{run?.phase==='awaiting_approval'&&<p role="status">This run needs approval in the unlocked owner dashboard. This API key can observe or cancel it; waiting counts toward its total timeout.</p>}{run?<pre tabIndex={0} aria-label="API response JSON">{JSON.stringify(run,null,2)}</pre>:<p>{attempt?'Waiting for the runtime receipt or result.':'Run the API to see its actual response here.'}</p>}{run?.status==='succeeded'&&run.verification?.verified_at&&run.result&&!!contract.output_schema&&<MediaResults result={run.result} schema={contract.output_schema}/>}{attempt&&<details><summary>Request recovery</summary><p>This identifier recovers the same accepted request; it does not create a second run.</p><code>{attempt.idempotency}</code></details>}</div>
      <div className="api-playground-examples"><div className="api-playground-code-heading"><label className="field" htmlFor={id+'-language'}><span>Code example</span><select aria-label="Code example" id={id+'-language'} value={example} onChange={event=>setExample(event.target.value as typeof example)}><option value="curl">cURL</option><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option><option value="python">Python</option><option value="mcp">MCP tool call</option></select></label><button className="button ghost" type="button" onClick={()=>void copy('example',code)}>{copied==='example'?'Copied':'Copy example'}</button></div><pre tabIndex={0} aria-label={`${example} example`}>{code}</pre><p>{samples?.warning}</p><p>Recipient: <code>{location.origin}</code>. Shared loopback addresses refer to the recipient's own computer. A matching published action and revision, scoped key and authorized browser are required. MCP clients must initialize their connection and send a locally supplied Authorization header to <code>/mcp</code>.</p><div className="api-share-examples" role="group" aria-label="Download sanitized example"><button type="button" className="button secondary" onClick={()=>download('markdown')}>Download Markdown</button><button type="button" className="button secondary" onClick={()=>download('json')}>Download sample JSON</button><button type="button" className="button secondary" onClick={()=>download('curl')}>Download cURL</button><button type="button" className="button secondary" onClick={()=>download('client')}>Download Node.js client</button></div>{copied.startsWith('download-')&&<p role="status">Sanitized example downloaded. No actual request, response or key is included.</p>}</div>
    </>}
  </section>;
}

class ConsumerError extends Error{constructor(message:string,public status:number){super(message);}}
async function consumer<T>(path:string,key:string,signal:AbortSignal,body?:unknown,idempotency?:string):Promise<T>{
  const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]),headers:{Authorization:`Bearer ${key}`,...body===undefined?{}:{'Content-Type':'application/json'},...idempotency?{'Idempotency-Key':idempotency}:{}},...body===undefined?{}:{body:JSON.stringify(body)}});
  let value;try{value=await response.json();}catch{throw Error('The local runtime returned an unreadable response. Keep its receipt and retry safely.');}
  if(!response.ok)throw new ConsumerError(`${value.error?.code?`${value.error.code}: `:''}${value.error?.message??`The runtime rejected this request (${response.status}).`}`,response.status);
  return value;
}
function definitionsFrom(contract:Contract):Record<string,InputDefinition>{
  if(!contract.input_schema||typeof contract.input_schema!=='object')throw Error('The published input schema is unavailable.');
  return Object.fromEntries(Object.entries(contract.input_schema.properties??{}).map(([name,field])=>{
    return [name,inputDefinitionFromSchema(field,contract.input_schema.required?.includes(name)===true)];
  }));
}
const message=(cause:unknown)=>cause instanceof Error?cause.message:'The local API request failed. Keep the runtime running and resume this request.';
function pause(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{if(signal.aborted){reject(signal.reason);return;}const aborted=()=>{clearTimeout(timer);reject(signal.reason);},timer=setTimeout(()=>{signal.removeEventListener('abort',aborted);resolve();},ms);signal.addEventListener('abort',aborted,{once:true});});}
