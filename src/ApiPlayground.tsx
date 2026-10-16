import {MediaResults} from './MediaResults';
import {useEffect,useId,useRef,useState} from 'react';
import {TypedInputFields,exampleInput,initialInputValues,typedInput,type InputDefinition,type Scalar} from './WorkflowContract';

type Workflow={id:string;name:string;slug:string;status:string;version:string;published_revision?:number|null};
type SchemaField={type?:string;enum?:string[];default?:Scalar;minimum?:number;maximum?:number;minLength?:number;maxLength?:number;pattern?:string;'x-hermo-normalization'?:'trim'};
type Contract={action:string;version:string;revision?:number;active_revision?:number;timeout_seconds?:number;input_schema:{properties?:Record<string,SchemaField>;required?:string[]};output_schema?:unknown};
type Run={id:string;status:string;duration_ms?:number;progress?:number;result?:Record<string,unknown>;verification?:{verified_at?:string};error?:{code?:string;message?:string};execution?:unknown};
type Attempt={input:Record<string,Scalar>;idempotency:string;revision?:number;runId?:string};
type Request=<T=any>(path:string,body?:unknown)=>Promise<T>;
const terminal=(run:Run|null)=>!!run&&['succeeded','failed','cancelled','timed_out','disconnected'].includes(run.status);

export function ApiPlayground({workflow,onRun}:{workflow:Workflow;request:Request;onRun?:(runId:string)=>void}){
  const id=useId(),credential=useRef(''),controller=useRef<AbortController|null>(null),mounted=useRef(true);
  const[key,setKey]=useState(''),[contract,setContract]=useState<Contract|null>(null),[inputs,setInputs]=useState<Record<string,InputDefinition>>({}),[values,setValues]=useState<Record<string,string>>({}),[omitted,setOmitted]=useState<Record<string,boolean>>({}),[fieldErrors,setFieldErrors]=useState<Record<string,string>>({}),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState<Attempt|null>(null),[run,setRun]=useState<Run|null>(null),[copied,setCopied]=useState(''),[example,setExample]=useState<'curl'|'javascript'|'python'>('curl');
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();credential.current='';};},[]);
  const endpoint=`${location.origin}/v1/actions/${encodeURIComponent(workflow.slug)}/versions/1/runs`,unresolved=!!attempt&&!terminal(run);
  const currentInput=typedInput(inputs,values,omitted),requestJson=JSON.stringify({input:attempt?.input??currentInput.input},null,2),code=examples(endpoint,exampleInput(inputs))[example];
  function begin(){controller.current?.abort();const active=new AbortController();controller.current=active;setBusy(true);setError('');setNotice('');return active;}
  function finish(active:AbortController){if(mounted.current&&controller.current===active){controller.current=null;setBusy(false);}}
  async function connect(event:React.FormEvent){event.preventDefault();if(busy||unresolved)return;const pasted=key.trim();setKey('');credential.current='';setContract(null);setAttempt(null);setRun(null);const active=begin();try{
    if(!/^hm_live_[A-Za-z0-9_-]{43}$/.test(pasted))throw Error('Paste a scoped API key created for this published workflow.');
    const received=await consumer<Contract>('/v1/action-contract',pasted,active.signal);
    if(received.action!==workflow.slug)throw Error('This key belongs to another workflow. Use a key scoped to this workflow.');
    const revision=received.active_revision??received.revision;
    if(workflow.published_revision!=null&&revision!==workflow.published_revision)throw Error('The published revision changed. Refresh API documentation before connecting this key.');
    const definitions=definitionsFrom(received);
    if(!mounted.current||active.signal.aborted)return;
    credential.current=pasted;setContract(received);setInputs(definitions);setValues(initialInputValues(definitions));setOmitted({});setFieldErrors({});setNotice('Scoped key verified. Requests use the consumer API and its published contract.');
  }catch(cause){if(mounted.current&&!active.signal.aborted)setError(message(cause));}finally{finish(active);}}
  async function poll(receipt:Attempt,active:AbortController){
    const deadline=Date.now()+Math.min(305000,Math.max(20000,(contract?.timeout_seconds??45)*1000+10000));
    while(!active.signal.aborted){
      const observed=await consumer<Run>(`/v1/runs/${encodeURIComponent(receipt.runId!)}`,credential.current,active.signal);
      if(!mounted.current||active.signal.aborted)return;setRun(observed);
      if(terminal(observed)){
        if(observed.status==='succeeded'&&!observed.verification?.verified_at)throw Error('The runtime returned success without verification evidence. Inspect the run before using this result.');
        setNotice(observed.status==='succeeded'?'Verified result received.':observed.status==='cancelled'?'The run was cancelled. Website changes may already have occurred.':'The run finished with a failure. Inspect its error and run details.');return;
      }
      if(Date.now()>=deadline)throw Error('Stopped waiting for a final result. The run may still be active. Resume checking this run before starting another.');
      await pause(700,active.signal);
    }
  }
  async function execute(previous?:Attempt){if(busy||!contract||!credential.current)return;
    const parsed=typedInput(inputs,values,omitted);if(!previous&&Object.keys(parsed.errors).length){setFieldErrors(parsed.errors);setError('Review the input fields before running.');return;}
    const selected=previous??{input:parsed.input,idempotency:crypto.randomUUID(),revision:contract.active_revision??contract.revision};setAttempt(selected);if(!previous)setRun(null);setFieldErrors({});const active=begin();let receiptAccepted=!!selected.runId;
    try{
      let accepted=selected;
      if(!accepted.runId){
        const receipt=await consumer<{run_id:string}>(`/v1/actions/${encodeURIComponent(workflow.slug)}/versions/1/runs`,credential.current,active.signal,{input:accepted.input,...accepted.revision?{expected_revision:accepted.revision}:{}},accepted.idempotency);
        if(typeof receipt.run_id!=='string'||!receipt.run_id)throw Error('The runtime did not return a run receipt. Retry this same request to recover its receipt.');
        accepted={...accepted,runId:receipt.run_id};receiptAccepted=true;if(!mounted.current||active.signal.aborted)return;setAttempt(accepted);
      }
      await poll(accepted,active);
    }catch(cause){if(mounted.current&&!active.signal.aborted){if(!receiptAccepted&&cause instanceof ConsumerError&&cause.status>=400&&cause.status<500)setAttempt(null);setError(message(cause));}}finally{finish(active);}
  }
  function stopWaiting(){controller.current?.abort();controller.current=null;setBusy(false);setNotice('Stopped waiting locally. This does not cancel the submitted run. Resume checking before starting another request.');}
  async function cancel(){if(busy||!attempt?.runId||terminal(run))return;const active=begin();try{
    const cancelled=await consumer<Run>(`/v1/runs/${encodeURIComponent(attempt.runId)}/cancel`,credential.current,active.signal,{});
    if(mounted.current&&!active.signal.aborted){setRun(cancelled);setNotice('Cancellation requested. It cannot undo website changes already made.');}
  }catch(cause){if(mounted.current&&!active.signal.aborted)setError(message(cause));}finally{finish(active);}}
  async function copy(label:string,value:string){try{await navigator.clipboard.writeText(value);if(mounted.current)setCopied(label);}catch{if(mounted.current)setError('Clipboard access failed. Select and copy the text manually.');}}
  return <section className="api-playground" aria-labelledby={id+'-title'}>
    <header><div><h2 id={id+'-title'}>API playground</h2><p>Call the published API with a scoped key, using the same permissions as your application.</p></div>{contract&&<span className="pill quiet">{contract.active_revision??contract.revision?`Revision ${contract.active_revision??contract.revision}`:'Published contract'}</span>}</header>
    <p className="api-playground-requirements">Keep the local runtime and authorized browser session available. Connected Chrome also requires its paired website tab. Closing this panel stops waiting; it does not stop an accepted run.</p>
    <div className="api-playground-endpoint"><span>POST</span><code>{endpoint}</code><button className="button ghost" type="button" onClick={()=>void copy('endpoint',endpoint)}>{copied==='endpoint'?'Copied':'Copy URL'}</button></div>
    <form className="api-playground-key field" onSubmit={connect}><label className="api-playground-key-label" htmlFor={id+'-key'}>Scoped API key</label><input id={id+'-key'} aria-label="Scoped API key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={event=>setKey(event.target.value)} disabled={busy||unresolved} placeholder={contract?'Paste another key to replace this connection':'hm_live_…'} required aria-describedby={id+'-key-hint'}/><small id={id+'-key-hint'}>Kept in memory only. Never included in examples or saved in browser storage.</small><button className="button secondary" disabled={busy||unresolved} type="submit">{busy&&!attempt?'Checking key…':contract?'Replace key':'Connect key'}</button></form>
    {error&&<p className="api-playground-message" role="alert">{error}{unresolved&&!attempt?.runId?' The request may already have been accepted. Use “Retry same request” to preserve its idempotency key.':''}</p>}
    {notice&&<p className="api-playground-message" role="status">{notice}</p>}
    {contract&&<>
      <div className="api-playground-columns"><div><h3>Request inputs</h3><fieldset disabled={busy||unresolved} className="api-playground-fields"><legend className="sr-only">Inputs for {workflow.name}</legend>{Object.keys(inputs).length?<TypedInputFields inputs={inputs} values={values} omitted={omitted} errors={fieldErrors} disabled={busy||unresolved} onChange={(name,value)=>{setValues(current=>({...current,[name]:value}));setAttempt(null);setRun(null);setCopied('');}} onOmit={(name,value)=>{setOmitted(current=>({...current,[name]:value}));setAttempt(null);setRun(null);setCopied('');}}/>:<p>This workflow needs no input.</p>}</fieldset><div className="api-playground-controls">{!unresolved&&<button className="button primary" type="button" disabled={busy} onClick={()=>void execute()}>Run API request</button>}{unresolved&&!busy&&<button type="button" className="button primary" onClick={()=>void execute(attempt!)}>{attempt?.runId?'Resume checking run':'Retry same request'}</button>}{busy&&attempt&&<button type="button" className="button secondary" onClick={stopWaiting}>Stop waiting</button>}{attempt?.runId&&!terminal(run)&&!busy&&<button type="button" className="button secondary" onClick={()=>void cancel()}>Cancel run</button>}</div></div>
      <div><div className="api-playground-code-heading"><h3>Request JSON</h3><button className="button ghost" type="button" onClick={()=>void copy('request',requestJson)}>{copied==='request'?'Copied':'Copy JSON'}</button></div><pre tabIndex={0} aria-label="Request JSON">{requestJson}</pre></div></div>
      <div className="api-playground-result" aria-busy={busy&&!!attempt}><div className="api-playground-code-heading"><h3>Response</h3>{run&&<button className="button ghost" type="button" onClick={()=>void copy('response',JSON.stringify(run,null,2))}>{copied==='response'?'Copied':'Copy JSON'}</button>}</div><dl className="api-playground-status"><div><dt>Status</dt><dd>{run?.status.replaceAll('_',' ')??(attempt?attempt.runId?'Accepted':'Submitting or awaiting receipt':'Not run')}</dd></div>{run?.duration_ms!==undefined&&<div><dt>Duration</dt><dd>{(run.duration_ms/1000).toFixed(2)} s</dd></div>}{attempt?.runId&&<div><dt>Run ID</dt><dd><code>{attempt.runId}</code>{onRun&&<button type="button" className="button ghost" onClick={()=>onRun(attempt.runId!)}>View run details</button>}</dd></div>}</dl>{run?<pre tabIndex={0} aria-label="API response JSON">{JSON.stringify(run,null,2)}</pre>:<p>{attempt?'Waiting for the runtime receipt or result.':'Run the API to see its actual response here.'}</p>}{run?.status==='succeeded'&&run.verification?.verified_at&&run.result&&!!contract.output_schema&&<MediaResults result={run.result} schema={contract.output_schema}/>}{attempt&&<details><summary>Request recovery</summary><p>This identifier recovers the same accepted request; it does not create a second run.</p><code>{attempt.idempotency}</code></details>}</div>
      <div className="api-playground-examples"><div className="api-playground-code-heading"><label className="field" htmlFor={id+'-language'}><span>Code example</span><select id={id+'-language'} value={example} onChange={event=>setExample(event.target.value as typeof example)}><option value="curl">cURL</option><option value="javascript">JavaScript</option><option value="python">Python</option></select></label><button className="button ghost" type="button" onClick={()=>void copy('example',code)}>{copied==='example'?'Copied':'Copy example'}</button></div><pre tabIndex={0} aria-label={`${example} example`}>{code}</pre><p>Replace YOUR_HERMO_KEY locally. Submission returns a run ID; poll its status URL with the same key. Keep the same idempotency key when recovering a request whose receipt was lost.</p></div>
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
    if(!['string','number','boolean'].includes(field.type??''))throw Error(`The playground does not support the published input type for ${name}.`);
    return [name,{...field,type:field.type as InputDefinition['type'],required:contract.input_schema.required?.includes(name)===true,...field['x-hermo-normalization']==='trim'?{normalization:'trim' as const}:{}}];
  }));
}
const message=(cause:unknown)=>cause instanceof Error?cause.message:'The local API request failed. Keep the runtime running and resume this request.';
function pause(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{if(signal.aborted){reject(signal.reason);return;}const aborted=()=>{clearTimeout(timer);reject(signal.reason);},timer=setTimeout(()=>{signal.removeEventListener('abort',aborted);resolve();},ms);signal.addEventListener('abort',aborted,{once:true});});}
function examples(endpoint:string,input:Record<string,Scalar>){const body=JSON.stringify({input}),literal=JSON.stringify(endpoint);return {
  curl:`curl -X POST '${endpoint}' \\\n  -H 'Authorization: Bearer YOUR_HERMO_KEY' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Idempotency-Key: UNIQUE_KEY_FOR_THIS_LOGICAL_REQUEST' \\\n  --data '${body.replaceAll("'","'\\''")}'\n\n# Use a new idempotency key for each new request. Reuse it only for recovery.\n# Poll the returned status_url with the same Authorization header.`,
  javascript:`const key = 'YOUR_HERMO_KEY';\nconst idempotencyKey = crypto.randomUUID(); // Keep for request recovery.\nconst response = await fetch(${literal}, {\n  method: 'POST',\n  headers: {\n    Authorization: 'Bearer ' + key,\n    'Content-Type': 'application/json',\n    'Idempotency-Key': idempotencyKey\n  },\n  body: JSON.stringify(${body})\n});\nconst receipt = await response.json();\nif (!response.ok) throw new Error(receipt.error?.message);\n// Poll receipt.status_url with this same scoped key.`,
  python:`import json\nimport uuid\nimport requests\n\nkey = 'YOUR_HERMO_KEY'\nidempotency_key = str(uuid.uuid4())  # Keep for request recovery.\nresponse = requests.post(\n    ${literal},\n    headers={\n        'Authorization': 'Bearer ' + key,\n        'Idempotency-Key': idempotency_key\n    },\n    json=json.loads(${JSON.stringify(body)}),\n    timeout=15\n)\nresponse.raise_for_status()\nreceipt = response.json()\n# Poll receipt['status_url'] with this same scoped key.`
};}
