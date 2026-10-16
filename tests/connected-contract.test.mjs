import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hash} from '../server/store.mjs';
import {validateWorkflowContract} from '../server/workflow-contract.mjs';

const pause=ms=>new Promise(done=>setTimeout(done,ms));

test('authorized connected-adapter transport fixture replays scalar defaults, clears omitted text, and rejects invalid typed output',{timeout:25000},async()=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const port=4422,{app,origin,store}=await createApp({port,dataDir:resolve('work/connected-contract',randomBytes(6).toString('hex')),browserEngineFactory:async()=>({close:async()=>{},closeAll:async()=>{},closeStudios:async()=>{},isOpen:()=>false})});
  let cookie='',csrf='',stop=false,transport,transportError;
  const call=async(path,body,extra={})=>{
    const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:'127.0.0.1:'+port,cookie,...body===undefined?{}:{'x-hermo-csrf':csrf},...extra},...body===undefined?{}:{payload:body}});
    if(response.headers['set-cookie'])cookie=response.headers['set-cookie'].split(';')[0];
    return {status:response.statusCode,value:response.json()};
  };
  const ok=async(...args)=>{const response=await call(...args);assert.ok(response.status<300,JSON.stringify(response));return response.value;};
  const finish=async(id,auth)=>{
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){
      if(transportError)throw transportError;
      const run=await ok('/v1/runs/'+id,undefined,auth);
      if(['succeeded','failed','cancelled'].includes(run.status))return run;
      await pause(25);
    }
    assert.fail('Connected scalar execution did not finish');
  };
  try{
    csrf=(await ok('/studio/session')).csrf;
    csrf=(await ok('/studio/setup',{password:'synthetic-connected-scalar-password'})).csrf;
    const connection=(await ok('/studio/connections',{name:'Connected scalar fixture',url:origin+'/sandbox/scalar-transport',access:'public',browser_mode:'connected',authorized:true})).connection;
    const grant=await ok(`/studio/connections/${connection.id}/browser-link`,{authorized:true});
    const extension={'x-hermo-extension-id':'a'.repeat(32),origin:'chrome-extension://'+'a'.repeat(32),cookie:''};
    const paired=await ok('/companion/browser/pair',{code:grant.code,origin,authorized:true,protocol:2,capabilities:['panel','read_data','saved_browser','command_guard'],tab_id:1,context_id:'bc_'+'b'.repeat(36)},extension);
    const companionHeaders={...extension,authorization:'Bearer '+paired.token};
    assert.equal((await call('/companion/browser/poll',{},extension)).status,401,'transport requires its paired secret');

    // This is an adapter integration test, not a Chrome or real-website test.
    // Only DOM command replies are simulated. Owner authorization, pairing,
    // leases, command guards, replay, verification, API auth and storage are real.
    const state={quantity:'7',flag:true,colour:'blue',note:'previous browser text',invalidOutput:false},operations=[],authorized=[];
    const controls=[
      {kind:'input',selector:'#quantity',label:'Quantity',type:'number',disabled:false},
      {kind:'check',selector:'#flag',label:'Enabled',type:'checkbox',disabled:false},
      {kind:'select',selector:'#colour',label:'Colour',type:'select-one',disabled:false},
      {kind:'input',selector:'#note',label:'Note',type:'text',disabled:false}
    ];
    const rawOutput=selector=>({
      '#quantity-result':state.quantity,
      '#flag-result':String(state.flag),
      '#colour-result':state.colour,
      '#total-result':state.invalidOutput?'private-currency-value USD':'0'
    })[selector];
    const snapshot=()=>({url:origin+'/sandbox/scalar-transport',title:'Simulated scalar DOM fixture',doc:{elements:controls,challenge:false,denied:false,authRejected:false,networkError:false,login:false,credentials:false,textLength:40,readyState:'complete'}});
    transport=(async()=>{
      while(!stop){
        const message=await ok('/companion/browser/poll',{},companionHeaders);
        if(message.type==='closed')break;
        if(message.type==='idle')continue;
        assert.equal(message.type,'command');
        assert.equal(message.origin,origin);assert.equal(message.path_prefix,'/sandbox/');
        assert.ok(message.expires_at>Date.now(),'expired commands must not execute');
        assert.equal((await ok('/companion/browser/authorize',{id:message.id},companionHeaders)).authorized,true);
        authorized.push(message.id);
        const command=message.command;
        assert.equal(command.public_source,true);
        let value;
        if(command.op==='snapshot')value=snapshot();
        else if(command.op==='read'){
          const text=rawOutput(command.selector);assert.equal(typeof text,'string');
          value=command.details?{text,count:1,streaming:false}:text;
        }else{
          assert.equal(command.op,'operate');
          operations.push({selector:command.selector,kind:command.kind,value:command.value});
          if(command.selector==='#quantity'){assert.equal(command.kind,'fill');state.quantity=command.value;}
          else if(command.selector==='#flag'){assert.equal(command.kind,'check');assert.ok(['true','false'].includes(command.value));state.flag=command.value==='true';}
          else if(command.selector==='#colour'){assert.equal(command.kind,'select');state.colour=command.value;}
          else{assert.equal(command.selector,'#note');assert.equal(command.kind,'fill');state.note=command.value;}
          value=true;
        }
        await ok('/companion/browser/reply',{id:message.id,ok:true,value},companionHeaders);
      }
    })().catch(error=>{if(!stop)transportError=error;});

    // Seed a validated published fixture to isolate adapter execution from the
    // separately tested recording/editor/publish UI.
    const definition=validateWorkflowContract({contract_version:'2',version:'connected-scalar-fixture',effect:'recorded_browser_actions',timeout_ms:15000,
      inputs:{quantity:{type:'number',required:false,default:0,minimum:0,maximum:10},flag:{type:'boolean',required:false,default:false},colour:{type:'string',required:false,enum:['red','blue'],default:'red'},note:{type:'string',required:false}},
      steps:[{op:'fill',selector:'#quantity',parameter:'quantity'},{op:'check',selector:'#flag',parameter:'flag'},{op:'select',selector:'#colour',parameter:'colour'},{op:'fill',selector:'#note',parameter:'note'}],
      outputs:[{name:'quantity_result',selector:'#quantity-result',type:'number'},{name:'flag_result',selector:'#flag-result',type:'boolean'},{name:'colour_result',selector:'#colour-result',type:'string'},{name:'total_result',selector:'#total-result',type:'number'}],
      verifiers:[{kind:'equals_input',output:'quantity_result',input:'quantity'},{kind:'equals_input',output:'flag_result',input:'flag'},{kind:'equals_input',output:'colour_result',input:'colour'},{kind:'nonempty',output:'total_result'}]
    });
    const at=new Date().toISOString();
    store.db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run('wf_connected_scalars',connection.id,'Connected scalars','connected.scalars','published',definition.version,store.seal(definition),definition.version,at);
    const key='hm_live_'+randomBytes(32).toString('base64url');
    store.db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run('key_connected_scalars','Connected fixture key',hash(key),'suffix','wf_connected_scalars','2099-01-01T00:00:00.000Z',null,at);
    const auth={authorization:'Bearer '+key},path='/v1/actions/connected.scalars/versions/1/runs';
    const first=await ok(path,{input:{}},{...auth,'idempotency-key':'connected-defaults'});
    const success=await finish(first.run_id,auth);
    assert.equal(success.status,'succeeded',JSON.stringify(success));
    assert.deepEqual(success.result,{quantity_result:0,flag_result:false,colour_result:'red',total_result:0});
    assert.deepEqual(operations,[{selector:'#quantity',kind:'fill',value:'0'},{selector:'#flag',kind:'check',value:'false'},{selector:'#colour',kind:'select',value:'red'},{selector:'#note',kind:'fill',value:''}]);
    assert.equal(state.note,'','omitted optional text actively clears prior DOM text');
    assert.ok(success.verification.checks.includes('quantity_result_matches_quantity'));
    assert.ok(success.verification.checks.includes('flag_result_matches_flag'));
    assert.ok(success.verification.checks.includes('output_schema'));
    const persisted=await ok('/studio/runs/'+first.run_id);
    assert.deepEqual(persisted.input,{quantity:0,flag:false,colour:'red'});
    assert.ok(persisted.steps.every(step=>step.status==='succeeded'));

    state.note='stale text before next replay';state.invalidOutput=true;
    const second=await ok(path,{input:{quantity:0,flag:false}},{...auth,'idempotency-key':'connected-invalid-output'});
    const failure=await finish(second.run_id,auth);
    assert.equal(failure.status,'failed',JSON.stringify(failure));
    assert.equal(failure.error.category,'OUTPUT_VALIDATION_FAILED');
    assert.deepEqual(failure.error.verification,{output:'total_result',reason:'invalid_number'});
    assert.equal(failure.result,undefined);assert.equal(failure.verification,undefined);
    assert.equal(JSON.stringify(failure.error).includes('private-currency-value'),false);
    assert.equal(state.note,'');assert.equal(state.flag,false);assert.equal(state.quantity,'0');
    assert.equal(operations.length,8,'failed output validation never repeats browser operations');
    assert.ok(authorized.length>operations.length,'snapshot/read commands also retain command authorization');
    assert.equal((await ok(`/studio/connections/${connection.id}/browser-link`)).linked,true);
    assert.equal(transportError,undefined);
  }finally{
    stop=true;await app.close();await transport;
    if(transportError)throw transportError;
  }
});
