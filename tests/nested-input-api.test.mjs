import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';
import {validateWorkflowContract,convertOutputs,browserInputValue} from '../server/workflow-contract.mjs';
import {verifyResult} from '../server/verification.mjs';

// Actual owner/consumer HTTP handlers, encrypted persistence, immutable versions,
// queue and MCP transport. The adapter is controlled; DOM replay is covered by
// separate real-browser tests and is not claimed by this acceptance fixture.
test('nested input REST and MCP contracts share normalized admission, scope and immutable revisions',{timeout:45000},async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4496,executed=[];
  const engine={isOpen:()=>true,closeAll:async()=>{},closeStudios:async()=>{},execute:async(_connection,definition,input,progress)=>{
    const bindings=[];
    for(const[index,step]of definition.steps.entries()){
      progress(index,definition.steps.length);
      if(step.parameter)bindings.push(browserInputValue(definition.inputs[step.parameter],input[step.parameter],step.op,step.value_path??[]));
      progress(index,definition.steps.length,{phase:'completed'});
    }
    progress(definition.steps.length,definition.steps.length,{phase:'verifying'});
    executed.push({version:definition.version,input:structuredClone(input),bindings});
    const raw=input.request?{echo:input.request.query,metadata:{limit:String(input.request.options.limit),enabled:String(input.request.options.enabled),note:input.request.note??null,codes:input.request.rows.map(row=>row.code)}}:{echo:input.query};
    return {result:convertOutputs(definition.outputs,raw),verification:verifyResult(definition,raw,input,'controlled_nested_input_adapter')};
  }};
  const {app,store}=await createApp({port,dataDir:resolve('work/nested-input-api',randomUUID()),browserEngineFactory:async()=>engine});
  let cookie='',csrf='',rpcId=0;
  const call=async(path,body,headers={})=>{
    const response=await app.inject({url:path,method:body===undefined?'GET':'POST',headers:{host:'127.0.0.1:'+port,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...headers},...body===undefined?{}:{payload:body}});
    if(response.headers['set-cookie']?.startsWith('hermo_owner_'))cookie=response.headers['set-cookie'].split(';')[0];
    return {status:response.statusCode,value:response.json()};
  };
  const ok=async(...args)=>{const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.value;};
  const finish=async id=>{for(let count=0;count<500;count++){const run=await ok('/studio/runs/'+id);if(['succeeded','failed','cancelled'].includes(run.status))return run;await new Promise(done=>setTimeout(done,20));}assert.fail('Controlled nested input execution did not finish');};
  const publish=async base=>{const review=await ok(base+'/permissions');return ok(base+'/publish',{expected_version:review.version,permission_fingerprint:review.fingerprint,...review.changes?.breaking?{accept_breaking:true,change_fingerprint:review.changes.fingerprint}:{}});};
  const mcpHeaders=auth=>({...auth,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'});
  const rpcEnvelope=(name,args)=>({jsonrpc:'2.0',id:++rpcId,method:'tools/call',params:{name,arguments:args}});
  const rpc=async(name,args,auth)=>{const response=await ok('/mcp',rpcEnvelope(name,args),mcpHeaders(auth));assert.equal(response.result?.isError,undefined,JSON.stringify(response));return response.result.structuredContent;};
  const input={request:{query:' books ',options:{limit:'3',enabled:'false'},rows:[{code:'first'},{code:'second'}],note:null}};
  const base='/studio/workflows/wf_nested',endpoint='/v1/actions/nested.fixture/versions/1/runs';
  const submit=(value,id,auth,path=endpoint)=>ok(path,{input:value},{...auth,'idempotency-key':id});
  try{
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-nested-input-owner-password'})).csrf;
    const when=new Date().toISOString(),config={url:'https://fixture.test/',origins:['https://fixture.test'],access:'public',browser_mode:'isolated',identity:{kind:'public_origin',origin:'https://fixture.test'}};
    store.db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run('conn_nested','Nested input fixture',config.url,'connected',store.seal(config),when);
    const request={type:'object',properties:{query:{type:'string',normalization:'trim',default:'books'},options:{type:'object',default:{},properties:{limit:{type:'integer',coercion:'number',minimum:1,maximum:10,default:'2'},enabled:{type:'boolean',coercion:'boolean',default:false}}},rows:{type:'array',minItems:1,maxItems:3,items:{type:'object',properties:{code:{type:'string'}}}},note:{type:'string',nullable:true,required:false}}};
    const definition=validateWorkflowContract({contract_version:'2',effect:'retrieval',inputs:{request},steps:[{op:'fill',selector:'#query',parameter:'request',value_path:['query']},{op:'fill',selector:'#count',parameter:'request',value_path:['options','limit']}],outputs:[{name:'echo',type:'string',selector:'#echo'},{name:'metadata',type:'object',selector:'#metadata',fields:[{name:'limit',type:'integer',selector:'.limit'},{name:'enabled',type:'boolean',selector:'.enabled'},{name:'note',type:'string',nullable:true,selector:'.note'},{name:'codes',type:'array',selector:'.code',minItems:1,maxItems:3,items:{type:'string'}}]}],verifiers:[{kind:'nonempty',output:'echo'}],timeout_ms:15000});
    definition.version=hash(JSON.stringify(definition));
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_nested','conn_nested','Nested input fixture','nested.fixture','draft',definition.version,store.seal(definition),null,when);
    await t.test('owner test receives normalized nested values and defaults without collection stringification',async()=>{
      const run=await finish((await ok(base+'/test',{input})).run_id);assert.equal(run.status,'succeeded',JSON.stringify(run));
      assert.deepEqual(run.input,{request:{query:'books',options:{limit:3,enabled:false},rows:[{code:'first'},{code:'second'}],note:null}});
      assert.deepEqual(executed.at(-1).bindings,['books','3']);
      const defaulted=await finish((await ok(base+'/test',{input:{request:{rows:[{code:'default'}]}}})).run_id);
      assert.equal(defaulted.status,'succeeded');assert.deepEqual(defaulted.input.request.options,{limit:2,enabled:false});
      assert.equal(defaulted.input.request.note,undefined);assert.deepEqual(defaulted.result.metadata,{limit:2,enabled:false,note:null,codes:['default']});
      for(const value of [{request:{rows:[{code:'bad'}],options:{limit:'NaN'}}},{request:{rows:[],options:{}}},{request:{rows:[{code:'bad'}],options:{},undeclared:'private'}},{request:null}])assert.equal((await call(base+'/test',{input:value})).status,400);
    });
    const publication=await publish(base),auth={authorization:'Bearer '+publication.key,cookie:''},originalSnapshot=store.db.prepare('SELECT payload FROM workflow_revisions WHERE workflow_id=? AND revision=1').get('wf_nested').payload;
    await t.test('generated OpenAPI, selected REST contract and MCP expose the same nested schema',async()=>{
      const contract=await ok('/v1/action-contract',undefined,auth),mcp=await rpc('get_contract',{},auth),spec=await ok(base+'/openapi');
      assert.deepEqual(mcp.input_schema,contract.input_schema);assert.deepEqual(mcp.output_schema,contract.output_schema);
      const schema=spec.paths[endpoint].post.requestBody.content['application/json'].schema.properties.input;assert.deepEqual(schema,contract.input_schema);
      assert.equal(schema.properties.request.additionalProperties,false);assert.equal(schema.properties.request.properties.rows.items.properties.code.type,'string');
      assert.deepEqual(schema.properties.request.properties.note.anyOf,[{type:'string',minLength:1,maxLength:4096},{type:'null'}]);
      assert.equal(schema.properties.request.properties.options.properties.limit.default,2);
      assert.equal(contract.output_schema.properties.metadata.properties.limit.type,'integer');assert.equal(contract.output_schema.properties.metadata.properties.enabled.type,'boolean');
      const tools=await ok('/mcp',{jsonrpc:'2.0',id:++rpcId,method:'tools/list',params:{}},mcpHeaders(auth));
      assert.deepEqual(tools.result.tools.find(value=>value.name==='action_nested_fixture').inputSchema.properties.input,contract.input_schema);
      assert.doesNotMatch(JSON.stringify(contract),/#query|#count|synthetic-nested-input-owner-password/);
    });
    let rest;
    await t.test('REST and MCP admit equivalent normalized objects with order-insensitive object idempotency',async()=>{
      rest=await submit(input,'nested-order',auth);const run=await finish(rest.run_id);assert.equal(run.status,'succeeded');
      const reordered={request:{note:null,rows:[{code:'first'},{code:'second'}],options:{enabled:false,limit:3},query:'books'}};
      const count=executed.length,reused=await submit(reordered,'nested-order',auth);assert.equal(reused.run_id,rest.run_id);assert.equal(reused.reused,true);assert.equal(executed.length,count);
      const changed=await call(endpoint,{input:{request:{...reordered.request,rows:[{code:'second'},{code:'first'}]}}},{...auth,'idempotency-key':'nested-order'});assert.equal(changed.status,409);assert.equal(changed.value.error.code,'IDEMPOTENCY_CONFLICT');
      const mcp=await rpc('action_nested_fixture',{input,request_id:'nested-mcp'},auth),mcpRun=await finish(mcp.run_id);assert.equal(mcpRun.status,'succeeded');assert.deepEqual(mcpRun.result,run.result);
      assert.equal((await ok('/v1/runs/'+run.id,undefined,auth)).input,undefined);
      const rejected=await ok('/mcp',rpcEnvelope('action_nested_fixture',{input:{request:{rows:[{code:'bad'}],options:{limit:'NaN'}}},request_id:'nested-invalid-mcp'}),mcpHeaders(auth));
      assert.equal(rejected.result?.isError,true);assert.doesNotMatch(JSON.stringify(rejected),/synthetic-nested-input-owner-password/);
    });
    await t.test('MCP rejects excessive argument elements before stripping unknown keys or enqueueing',async()=>{
      const before=store.db.prepare('SELECT count(*) n FROM runs').get().n;
      const rejected=await ok('/mcp',rpcEnvelope('action_nested_fixture',{input,request_id:'excessive-elements',padding:Array(11000).fill(0)}),mcpHeaders(auth));
      assert.ok(rejected.result?.isError||rejected.error,JSON.stringify(rejected));
      assert.equal(store.db.prepare('SELECT count(*) n FROM runs').get().n,before);
    });
    await t.test('editing and publishing a new nested default keeps historical contracts and accepted receipts immutable',async()=>{
      await ok(base+'/draft',{expected_version:definition.version});const editor=await ok(base+'/editor');
      const inputs=structuredClone(editor.definition.inputs);inputs.request.properties.options.properties.limit.default=7;inputs.request.properties.options.default={};
      const changed=await ok(base+'/editor',{expected_version:editor.version,steps:editor.definition.steps,inputs,outputs:editor.definition.outputs,verifiers:editor.definition.verifiers,timeout_seconds:15});
      const draftInput={request:{rows:[{code:'revision'}]}};assert.equal((await finish((await ok(base+'/test',{input:draftInput})).run_id)).status,'succeeded');
      assert.equal((await publish(base)).workflow.published_revision,2);
      assert.equal(store.db.prepare('SELECT payload FROM workflow_revisions WHERE workflow_id=? AND revision=1').get('wf_nested').payload,originalSnapshot);
      assert.equal((await ok('/v1/action-contract?revision=1',undefined,auth)).input_schema.properties.request.properties.options.properties.limit.default,2);
      assert.equal((await ok('/v1/action-contract?revision=2',undefined,auth)).input_schema.properties.request.properties.options.properties.limit.default,7);
      const old=await finish((await submit(draftInput,'nested-old-revision',auth,'/v1/actions/nested.fixture/revisions/1/runs')).run_id);assert.equal(old.result.metadata.limit,2);assert.equal(old.workflow_revision,1);
      const current=await finish((await submit(draftInput,'nested-current-revision',auth)).run_id);assert.equal(current.result.metadata.limit,7);assert.equal(current.workflow_version,changed.version);
      const historical=await rpc('invoke_revision',{revision:1,input:draftInput,request_id:'nested-history-mcp'},auth);assert.equal((await finish(historical.run_id)).result.metadata.limit,2);
      assert.equal((await submit(input,'nested-order',auth)).run_id,rest.run_id);
    });
    await t.test('structured equals_input is rejected and unrelated keys cannot invoke or inspect nested runs',async()=>{
      const current=await ok(base+'/editor');
      await ok(base+'/draft',{expected_version:current.version});
      for(const inputField of ['request','nullable_note','nothing']){
        const inputs={...current.definition.inputs,...inputField==='nullable_note'?{nullable_note:{type:'string',nullable:true,default:null}}:inputField==='nothing'?{nothing:{type:'null',default:null}}:{}};
        const response=await call(base+'/editor',{expected_version:current.version,steps:current.definition.steps,inputs,outputs:current.definition.outputs,verifiers:[{kind:'equals_input',output:'echo',input:inputField}],timeout_seconds:15});
        assert.equal(response.status,400);assert.equal(response.value.error.code,'INVALID_WORKFLOW_CONTRACT');
      }
      const scalar=validateWorkflowContract({contract_version:'2',effect:'retrieval',inputs:{query:{type:'string',required:false,default:'legacy'}},steps:[{op:'fill',selector:'#query',parameter:'query'}],outputs:[{name:'echo',selector:'#echo',type:'string'}],verifiers:[{kind:'equals_input',input:'query',output:'echo'}]});scalar.version=hash(JSON.stringify(scalar));
      store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_nested_scalar','conn_nested','Scalar fixture','nested.scalar','draft',scalar.version,store.seal(scalar),null,when);
      const scalarBase='/studio/workflows/wf_nested_scalar';assert.equal((await finish((await ok(scalarBase+'/test',{input:{}})).run_id)).status,'succeeded');
      const foreign=await publish(scalarBase),foreignAuth={authorization:'Bearer '+foreign.key,cookie:''};
      assert.equal((await call(endpoint,{input},{...foreignAuth,'idempotency-key':'wrong-workflow'})).status,403);
      assert.equal((await call('/v1/runs/'+rest.run_id,undefined,foreignAuth)).status,404);
      const legacy=await submit({},'legacy-default',foreignAuth,'/v1/actions/nested.scalar/versions/1/runs');assert.deepEqual((await finish(legacy.run_id)).result,{echo:'legacy'});
      assert.equal((await submit({query:'legacy'},'legacy-default',foreignAuth,'/v1/actions/nested.scalar/versions/1/runs')).run_id,legacy.run_id);
      assert.equal((await call('/v1/actions/nested.scalar/versions/1/runs',{input:{query:3}},{...foreignAuth,'idempotency-key':'legacy-number'})).status,400);
    });
  }finally{await app.close();}
});
