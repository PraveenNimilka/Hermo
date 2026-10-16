import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {installCompatibilityFixture} from './compatibility-fixture.mjs';

test('modern browser compatibility and permission boundaries',{timeout:180000},async t=>{
  process.env.HERMO_MASTER_KEY=randomBytes(32).toString('base64');
  const {app,origin,store}=await createApp({port:4331,dataDir:resolve('work/hermo-browser-tests',randomBytes(6).toString('hex'))});
  installCompatibilityFixture(app);await app.listen({port:4331,host:'127.0.0.1'});
  let cookie='',csrf='',connection,workflow,key;
  const call=async(path,body,extra={})=>{const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...body===undefined?{}:{'Content-Type':'application/json','X-Hermo-CSRF':csrf},...extra},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,value:await r.json()};};
  const ok=async(path,body)=>{const r=await call(path,body);assert.ok(r.status<300,JSON.stringify({path,...r}));return r.value;};
  const snap=()=>ok(`/studio/connections/${connection.id}/browser`);
  const interact=body=>ok(`/studio/connections/${connection.id}/interact`,body);
  const control=(element,kind,value,recording,parameter)=>ok(`/studio/connections/${connection.id}/control`,{element_id:element.id,kind,...value===undefined?{}:{value},...recording?{recording_id:recording}:{},...parameter?{parameter}:{}});
  const finish=async id=>{for(let i=0;i<100;i++){const r=await ok('/studio/runs/'+id);if(['succeeded','failed','cancelled'].includes(r.status))return r;await new Promise(r=>setTimeout(r,200));}assert.fail('Run timed out');};
  try {
    csrf=(await ok('/studio/session')).csrf;csrf=(await ok('/studio/setup',{password:'synthetic-browser-test-password'})).csrf;
    connection=(await ok('/studio/connections',{name:'Compatibility lab',url:origin+'/sandbox/compat',authorized:true})).connection;
    await ok(`/studio/connections/${connection.id}/open`,{});
    await t.test('delayed hydration, editors, open shadow roots, frames and stable identifiers',async()=>{
      const first=await snap();assert.equal(first.state,'ready');
      for(const label of ['Rich editor','Shadow input','Reference','Plan','Confirmed'])assert.ok(first.elements.some(e=>e.label===label),label);
      assert.equal(first.elements.find(e=>e.label==='Reference').framed,true);
      const second=await snap();assert.equal(first.elements.find(e=>e.label==='Reference').id,second.elements.find(e=>e.label==='Reference').id);
      await control(second.elements.find(e=>e.label==='Rich editor'),'fill','Edited text');
      await control(second.elements.find(e=>e.label==='Shadow input'),'fill','Shadow text');
      const marker=second.elements.find(e=>e.preview==='Compatibility test account');await ok(`/studio/connections/${connection.id}/confirm`,{element_id:marker.id});
    });
    await t.test('frame actions, native select and checkbox replay with verified output',async()=>{
      const recording=await ok('/studio/recordings',{connection_id:connection.id,name:'Frame lookup',slug:'frames.lookup'});
      let s=await snap();await control(s.elements.find(e=>e.label==='Reference'),'fill','ABC-1',recording.id,'reference');
      assert.equal((await call(`/studio/connections/${connection.id}/control`,{element_id:s.elements.find(e=>e.label==='Reference').id,kind:'fill',value:'unrecorded'})).status,409);
      await control(s.elements.find(e=>e.label==='Plan'),'select','pro',recording.id,'plan');
      await control(s.elements.find(e=>e.label==='Confirmed'),'check','true',recording.id,'confirmed');
      assert.equal((await call(`/studio/connections/${connection.id}/interact`,{op:'type',value:'unrecorded'})).status,409);
      assert.equal((await call(`/studio/connections/${connection.id}/origins`,{origins:['https://example.com'],authorized:true})).status,409);
      await control(s.elements.find(e=>e.label==='Lookup reference'),'click',undefined,recording.id);
      s=await snap();for(const [name,value]of [['reference','ABC-1'],['plan','pro'],['confirmed','true']]){const output=s.elements.find(e=>e.preview===value&&e.framed);assert.ok(output,JSON.stringify({value,elements:s.elements,diagnostics:s.diagnostics}));await ok(`/studio/recordings/${recording.id}/output`,{name,element_id:output.id});}
      workflow=(await ok(`/studio/recordings/${recording.id}/finish`,{verifiers:[{output:'reference',input:'reference'},{output:'plan',input:'plan'},{output:'confirmed',input:'confirmed'}]})).workflow;
      for(const input of [{reference:'ABC-2',plan:'basic',confirmed:'false'},{reference:'ABC-3',plan:'pro',confirmed:'true'}]){const run=await finish((await ok(`/studio/workflows/${workflow.id}/test`,{input})).run_id);assert.equal(run.status,'succeeded',JSON.stringify(run));assert.deepEqual(run.result,input);}
      key=await ok(`/studio/workflows/${workflow.id}/publish`,{});
      const d=store.unseal(store.db.prepare('SELECT payload FROM workflows WHERE id=?').get(workflow.id).payload);assert.equal(d.steps.filter(s=>s.frame_path?.length).length,4);
    });
    await t.test('manual typing, popup switching, scroll, reload and input validation',async()=>{
      await ok(`/studio/connections/${connection.id}/open`,{});let s=await snap();
      await interact({op:'click',x:50,y:110});await interact({op:'type',value:' Manual input'});assert.ok((await snap()).elements.some(e=>e.label?.includes('Manual input')||e.preview?.includes('Manual input')));
      await ok(`/studio/connections/${connection.id}/open`,{resume:true});assert.ok((await snap()).elements.some(e=>e.label?.includes('Manual input')||e.preview?.includes('Manual input')));assert.equal((await call(`/studio/connections/${connection.id}/open`,{resume:'yes'})).status,400);
      await interact({op:'press',key:'Tab'});await interact({op:'scroll',delta:300});await interact({op:'reload'});
      s=await snap();await control(s.elements.find(e=>e.label==='Open login popup'),'click');s=await snap();assert.equal(s.tabs.length,2);
      await interact({op:'tab',tab_id:s.tabs.find(tab=>!tab.active).id});assert.ok((await snap()).elements.some(e=>e.label==='Popup field'));
      await interact({op:'tab',tab_id:s.tabs.find(tab=>tab.active).id});
      assert.equal((await call(`/studio/connections/${connection.id}/interact`,{op:'click',x:1100,y:0})).status,400);
      assert.equal((await call(`/studio/connections/${connection.id}/interact`,{op:'press',key:'Control+R'})).status,400);
      assert.equal((await call(`/studio/connections/${connection.id}/interact`,{op:'type',value:'x'},{'X-Hermo-CSRF':'wrong'})).status,403);
    });
    await t.test('blocked domain diagnostics redact queries and challenge pages are explicit',async()=>{
      for(const [path,state]of [['compat-blocked','blocked'],['compat-challenge','challenge']]){const c=(await ok('/studio/connections',{name:path,url:origin+'/sandbox/'+path,authorized:true})).connection;await ok(`/studio/connections/${c.id}/open`,{});const s=await ok(`/studio/connections/${c.id}/browser`);assert.equal(s.state,state);assert.equal(s.can_confirm,false);assert.equal(s.elements.some(item=>item.kind==='output'),false);if(state==='blocked'){const asset=s.diagnostics.blocked.find(d=>d.origin==='https://assets.example.com');assert.ok(asset);assert.equal(asset.resource,'script');assert.equal(JSON.stringify(s.diagnostics).includes('DO_NOT_DISCLOSE'),false);}}
    });
    await t.test('login redirects and error pages cannot be confirmed as accounts',async()=>{
      for(const [path,state]of [['compat-error','network_error'],['compat-denied','denied'],['compat-challenge','challenge'],['compat-redirect','blocked'],['compat-login','sign_in']]){
        const c=(await ok('/studio/connections',{name:path,url:origin+'/sandbox/'+path,authorized:true})).connection;await ok(`/studio/connections/${c.id}/open`,{});
        const s=await ok(`/studio/connections/${c.id}/browser`);assert.equal(s.state,state,JSON.stringify({path,state:s.state,diagnostics:s.diagnostics}));assert.equal(s.can_confirm,false);assert.equal(s.elements.some(e=>e.kind==='output'),false);
        assert.equal(s.url.startsWith('null'),false);assert.equal(s.url.includes('DO_NOT_DISCLOSE'),false);
        assert.equal((await call(`/studio/connections/${c.id}/confirm`,{element_id:'error-page-marker'})).status,409);
        if(path==='compat-error'){const row=store.db.prepare('SELECT payload FROM connections WHERE id=?').get(c.id),data=store.unseal(row.payload);data.checkpoint='chrome-error://chromewebdata/';store.db.prepare('UPDATE connections SET payload=? WHERE id=?').run(store.seal(data),c.id);await ok(`/studio/connections/${c.id}/open`,{});assert.equal((await ok(`/studio/connections/${c.id}/browser`)).url,origin+'/sandbox/compat-error');}
        if(path==='compat-redirect'){assert.ok(s.diagnostics.blocked.some(d=>d.origin==='https://accounts.google.com'));assert.equal(JSON.stringify(s.diagnostics).includes('DO_NOT_DISCLOSE'),false);await ok(`/studio/connections/${c.id}/interact`,{op:'retry'});assert.equal((await ok(`/studio/connections/${c.id}/browser`)).url,'https://accounts.google.com/');}
        if(path==='compat-login'){
          const signIn=s.elements.find(e=>e.kind==='button'&&e.label==='Sign in');await ok(`/studio/connections/${c.id}/control`,{element_id:signIn.id,kind:'click'});
          let failed;for(let attempt=0;attempt<10;attempt++){failed=await ok(`/studio/connections/${c.id}/browser`);if(failed.diagnostics.blocked.some(d=>d.origin==='https://auth.openai.com'))break;await new Promise(r=>setTimeout(r,100));}
          assert.ok(failed.diagnostics.blocked.some(d=>d.origin==='https://auth.openai.com'),JSON.stringify(failed.diagnostics));assert.equal(JSON.stringify(failed.diagnostics).includes('DO_NOT_DISCLOSE'),false);assert.equal(failed.can_confirm,false);
          const popup=failed.elements.find(e=>e.label==='Google sign-in popup');await ok(`/studio/connections/${c.id}/control`,{element_id:popup.id,kind:'click'});let tabs;
          for(let attempt=0;attempt<10;attempt++){tabs=await ok(`/studio/connections/${c.id}/browser`);if(tabs.tabs.length>1)break;await new Promise(r=>setTimeout(r,100));}
          const google=tabs.tabs.find(t=>!t.active);assert.ok(google);assert.equal(google.url,'https://accounts.google.com/');
          assert.equal(tabs.url,origin+'/sandbox/compat-login');await ok(`/studio/connections/${c.id}/open`,{resume:true});const resumed=await ok(`/studio/connections/${c.id}/browser`);assert.equal(resumed.tabs.find(t=>!t.active).id,google.id);assert.equal(resumed.url,tabs.url);
          await ok(`/studio/connections/${c.id}/interact`,{op:'tab',tab_id:google.id});const selected=await ok(`/studio/connections/${c.id}/browser`);assert.equal(selected.url,'https://accounts.google.com/');assert.equal(selected.can_confirm,false);assert.equal(JSON.stringify(selected.diagnostics).includes('DO_NOT_DISCLOSE'),false);
          // Simulate a persisted approval whose active context has stale policy.
          const row=store.db.prepare('SELECT payload FROM connections WHERE id=?').get(c.id),saved=store.unseal(row.payload);saved.origins.push('https://www.google.com');store.db.prepare('UPDATE connections SET payload=? WHERE id=?').run(store.seal(saved),c.id);
          const reconciled=await ok(`/studio/connections/${c.id}/browser`);assert.ok(reconciled.approved_origins.includes('https://www.google.com'));assert.equal(reconciled.approved_origins.includes('https://accounts.google.com'),false);
          await ok(`/studio/connections/${c.id}/interact`,{op:'retry'});const retried=await ok(`/studio/connections/${c.id}/browser`);assert.equal(retried.url,'https://accounts.google.com/');assert.equal(retried.state,'blocked');assert.equal(retried.tabs.find(t=>t.active).id,google.id);assert.equal(retried.tabs.find(t=>!t.active).url,tabs.url);assert.ok(retried.approved_origins.includes('https://www.google.com'));assert.equal(retried.approved_origins.includes('https://accounts.google.com'),false);
        }
      }
      const framed=(await ok('/studio/connections',{name:'Error frame',url:origin+'/sandbox/compat-error-frame',authorized:true})).connection;await ok(`/studio/connections/${framed.id}/open`,{});const fs=await ok(`/studio/connections/${framed.id}/browser`);assert.equal(fs.state,'read_only');assert.equal(fs.can_confirm,true);assert.ok(fs.elements.some(e=>e.preview==='Frame error test account'));assert.equal(fs.elements.some(e=>e.kind==='output'&&e.framed),false);
    });
    await t.test('origin expansion rejects private hosts and invalidates published access',async()=>{
      assert.equal((await call('/studio/connections',{name:'Public to local',url:'https://example.com',extra_origins:[origin+'/sandbox/'],authorized:true})).status,400);
      for(const forbidden of ['http://169.254.169.254','https://127.0.0.1','https://10.0.0.1','https://example.com:444'])assert.equal((await call(`/studio/connections/${connection.id}/origins`,{origins:[forbidden],authorized:true})).status,400);
      const result=await ok(`/studio/connections/${connection.id}/origins`,{origins:['https://example.com'],authorized:true});assert.equal(result.retest_required,true);
      const view=await ok('/studio/overview');const w=view.workflows.find(w=>w.id===workflow.id);assert.equal(w.status,'draft');assert.equal(w.tested,false);
      assert.equal((await call('/v1/actions/frames.lookup/versions/1/runs',{input:{reference:'ABC',plan:'basic',confirmed:'true'}},{Authorization:'Bearer '+key.key})).status,401);
      assert.equal((await call(`/studio/workflows/${workflow.id}/publish`,{})).status,409);
    });
    await t.test('desktop handoff survives concurrent preview reads and reopens a closed session',async()=>{
      await ok(`/studio/connections/${connection.id}/open`,{resume:true});
      const reads=[snap(),snap()];await ok(`/studio/connections/${connection.id}/desktop`,{});await Promise.all(reads);assert.equal((await snap()).mode,'desktop');
      assert.equal((await call(`/studio/connections/${connection.id}/close`,{unexpected:true})).status,400);
      await ok(`/studio/connections/${connection.id}/close`,{});assert.equal((await call(`/studio/connections/${connection.id}/browser`)).value.error.code,'BROWSER_CLOSED');
      await ok(`/studio/connections/${connection.id}/desktop`,{});const restored=await snap();assert.equal(restored.mode,'desktop');assert.ok(restored.elements.some(e=>e.label==='Reference'));
      await ok(`/studio/connections/${connection.id}/open`,{});assert.equal((await snap()).mode,'preview');
    });
  }finally{await app.close();}
});
