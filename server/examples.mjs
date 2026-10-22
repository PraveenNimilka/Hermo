import {randomBytes} from 'node:crypto';

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const exampleApps=[
  {id:'orders',name:'Northstar Orders',path:'/sandbox/',label:'Order ID',parameter:'order_id',button:'Search orders',identity:'Alex Morgan · Northstar Supplies',email:'alex@northstar.example',password:'demo-only-local',samples:['ORD-2041','ORD-2042'],values:['Shipped','Processing'],output:'status'},
  {id:'shipping',name:'Harbor Shipping',path:'/sandbox/harbor/',label:'Tracking ID',parameter:'tracking_id',button:'Track shipment',identity:'Demo operator · Harbor Shipping',email:'operator@harbor.example',password:'demo-only-local',samples:['PKG-4101','PKG-4102'],values:['In transit','Delivered'],output:'delivery_status'},
  {id:'inventory',name:'Meadow Inventory',path:'/sandbox/meadow/',label:'Product SKU',parameter:'sku',button:'Check stock',identity:'Demo operator · Meadow Inventory',email:'operator@meadow.example',password:'demo-only-local',samples:['SKU-101','SKU-102'],values:['24','8'],output:'available_units'}
];

// These are three owned test applications, not imitations of provider APIs.
export function installExamplePortals(app){
  for(const spec of exampleApps.slice(1)){
    const sessions=new Map(),nonces=new Set(),cookie='hermo_'+spec.id;
    const page=(body,signedIn=false)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${spec.name} · local test app</title><link rel="stylesheet" href="/sandbox/style.css"></head><body><header><div class="logo">${spec.name}</div>${signedIn?`<div data-testid="account-identity">${spec.identity}</div>`:'<span class="tag">Synthetic test application</span>'}</header><main>${body}</main></body></html>`;
    app.get(spec.path,(req,reply)=>{
      if(sessions.has(req.cookies[cookie]))return reply.redirect(spec.path+'lookup');
      const nonce=randomBytes(20).toString('hex');nonces.add(nonce);if(nonces.size>1000)nonces.delete(nonces.values().next().value);
      return reply.type('text/html').send(page(`<h1>Sign in to ${spec.name}.</h1><p>Only synthetic data. This account is separate from the other demo portals.</p><div class="card"><form method="post" action="${spec.path}login"><input type="hidden" name="csrf" value="${nonce}"><label for="email">Email</label><input id="email" name="email" type="email" required><label for="password">Password</label><input id="password" name="password" type="password" required><button>Sign in</button></form><p><small>${spec.email} / ${spec.password}</small></p></div>`));
    });
    app.post(spec.path+'login',(req,reply)=>{
      const fields=new URLSearchParams(typeof req.body==='string'?req.body:'');
      if(!nonces.delete(fields.get('csrf'))||fields.get('email')!==spec.email||fields.get('password')!==spec.password)return reply.code(401).type('text/html').send(page('<h1>Sign-in failed.</h1>'));
      const token=randomBytes(24).toString('hex');sessions.set(token,Date.now());reply.setCookie(cookie,token,{path:spec.path,httpOnly:true,sameSite:'strict',maxAge:3600});return reply.redirect(spec.path+'lookup');
    });
    app.get(spec.path+'lookup',(req,reply)=>{
      const session=sessions.get(req.cookies[cookie]);if(!session||Date.now()-session>3600000)return reply.redirect(spec.path);
      const reference=String(req.query[spec.parameter]??'').slice(0,128),index=spec.samples.indexOf(reference);
      const result=reference?index<0?'<div class="card">No matching record.</div>':`<div class="card fields"><div><dt>${spec.label}</dt><dd data-testid="record-reference">${escape(reference)}</dd></div><div><dt>${spec.output.replaceAll('_',' ')}</dt><dd data-testid="record-value">${spec.values[index]}</dd></div></div>`:'';
      return reply.type('text/html').send(page(`<h1>${spec.id==='shipping'?'Track a shipment.':'Check product availability.'}</h1><p>A separate application with its own session and data.</p><div class="card"><form method="get" action="${spec.path}lookup"><label for="reference">${spec.label}</label><input id="reference" name="${spec.parameter}" value="${escape(reference)}" required><button>${spec.button}</button></form></div>${result}<p><small>Try ${spec.samples.join(' or ')}.</small></p>`,true));
    });
  }
}

export function installExamples(app,{origin,store,fail,rate},{specs=exampleApps,prefix='/studio/examples',setting='example_catalog'}={}){
  const {db,seal,unseal,getSetting,setSetting}=store;
  const matches=(spec,result,index)=>spec.fields?spec.fields.every(field=>result?.[field.name]===field.values[index]):result?.[spec.output]===spec.values[index];
  let job={status:'idle',stage:'Ready to build verified integrations',progress:0},setupTask;
  const catalog=()=>getSetting(setting)?unseal(getSetting(setting)):[];
  const save=items=>setSetting(setting,seal(items));
  const publicApps=()=>catalog().map(item=>{const spec=specs.find(s=>s.id===item.id);return {id:item.id,name:spec.name,website:spec.url??origin+spec.path,parameter:spec.parameter,samples:spec.samples,output:spec.output,workflow_id:item.workflow_id,key_id:item.key_id,endpoint:`${origin}/v1/actions/${item.slug}/versions/1/runs`};});
  const call=async(path,body,headers)=>{
    const response=await app.inject({method:body===undefined?'GET':'POST',url:path,headers:{host:new URL(origin).host,...headers,...body===undefined?{}:{'content-type':'application/json'}},...body===undefined?{}:{payload:body}}),data=response.json();
    if(response.statusCode>=300)throw Object.assign(new Error('Example request failed'),{code:data.error?.code??'EXAMPLE_FAILED',statusCode:response.statusCode});return data;
  };
  const wait=async(runId,headers,consumer=false)=>{const deadline=Date.now()+50000;while(Date.now()<deadline){const run=await call(`${consumer?'/v1':'/studio'}/runs/${runId}`,undefined,headers);if(['succeeded','failed','cancelled'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,consumer?1000:200));}throw new Error('EXAMPLE_TIMEOUT');};
  async function prepare(headers){
    const previous=catalog(),items=[];
    for(const [index,spec]of specs.entries()){
      job.stage=`Connecting ${spec.name}`;job.progress=Math.round(index*90/specs.length);
      const saved=previous.find(item=>item.id===spec.id),existing=saved&&db.prepare('SELECT id FROM connections WHERE id=?').get(saved.connection_id);
      const c=existing?{id:saved.connection_id}:(await call('/studio/connections',{name:spec.name+' · example',url:spec.url??origin+spec.path,access:spec.url?'public':'account',authorized:true},headers)).connection;
      await call(`/studio/connections/${c.id}/open`,{},headers);
      const snapshot=()=>call(`/studio/connections/${c.id}/browser`,undefined,headers);
      const control=(element,kind,value,recording,parameter)=>{if(!element)throw new Error('EXAMPLE_CONTROL_MISSING');return call(`/studio/connections/${c.id}/control`,{element_id:element.id,kind,...value===undefined?{}:{value},...recording?{recording_id:recording}:{},...parameter?{parameter}:{}},headers);};
      let s=await snapshot();
      if(!spec.url&&s.elements.some(e=>e.label==='Email')){
        await control(s.elements.find(e=>e.label==='Email'),'fill',spec.email);await control(s.elements.find(e=>e.label==='Password'),'fill',spec.password);await control(s.elements.find(e=>e.kind==='button'&&e.label==='Sign in'),'click');s=await snapshot();
      }
      if(spec.url)await call(`/studio/connections/${c.id}/confirm`,{public_source:true},headers);
      else{const identity=s.elements.find(e=>e.kind==='output'&&e.preview===spec.identity);if(!identity)throw new Error('EXAMPLE_IDENTITY_MISSING');await call(`/studio/connections/${c.id}/confirm`,{element_id:identity.id},headers);}
      let w=saved&&db.prepare('SELECT id,slug FROM workflows WHERE id=? AND connection_id=?').get(saved.workflow_id,c.id);
      if(!w){
        job.stage=`Recording ${spec.name}`;
        const recording=await call('/studio/recordings',{connection_id:c.id,name:spec.name+' lookup',slug:`example.${spec.id}.${randomBytes(4).toString('hex')}`},headers);
        if(spec.url){
          await call(`/studio/recordings/${recording.id}/navigate`,{template:spec.template,parameter:spec.parameter,example:spec.samples[0]},headers);s=await snapshot();
          await call(`/studio/recordings/${recording.id}/output`,{source:'url_parameter',name:spec.parameter},headers);
          for(const field of spec.fields){const element=s.elements.find(e=>e.kind==='output'&&e.preview===field.values[0]);if(!element)throw Object.assign(new Error('EXAMPLE_OUTPUT_MISSING'),{code:'OUTPUT_MISSING_'+field.name});await call(`/studio/recordings/${recording.id}/output`,{element_id:element.id,name:field.name},headers);}
        }else{
        s=await snapshot();await control(s.elements.find(e=>e.label===spec.label),'fill',spec.samples[0],recording.id,spec.parameter);s=await snapshot();await control(s.elements.find(e=>e.kind==='button'&&e.label===spec.button),'click',undefined,recording.id);s=await snapshot();
        for(const [name,value]of [[spec.parameter,spec.samples[0]],[spec.output,spec.values[0]]]){const element=s.elements.find(e=>e.kind==='output'&&e.preview===value);if(!element)throw new Error('EXAMPLE_OUTPUT_MISSING');await call(`/studio/recordings/${recording.id}/output`,{element_id:element.id,name},headers);}
        }
        w=(await call(`/studio/recordings/${recording.id}/finish`,{verifiers:[{output:spec.parameter,input:spec.parameter}]},headers)).workflow;
      }
      job.stage=`Verifying ${spec.name}`;
      const tested=await wait((await call(`/studio/workflows/${w.id}/test`,{input:{[spec.parameter]:spec.samples[1]}},headers)).run_id,headers);if(tested.status!=='succeeded'||!matches(spec,tested.result,1))throw new Error('EXAMPLE_VERIFICATION_FAILED');
      if(saved?.key_id)await call(`/studio/keys/${saved.key_id}/revoke`,{},headers);
      const permissions=await call(`/studio/workflows/${w.id}/permissions`,undefined,headers);
      // Setup explicitly authorizes these fixed practice integrations. Refuse
      // any expanded authority instead of treating a fetched manifest as consent
      // to arbitrary future changes in their definitions.
      const expectedOrigin=new URL(spec.url??origin+spec.path).origin;
      if(permissions.allowed_origins.length!==1||permissions.allowed_origins[0]!==expectedOrigin||permissions.connection.mode!=='managed_local'||permissions.approval_steps.length||permissions.allowed_actions.some(op=>!['navigate','fill','click'].includes(op))||permissions.changes?.breaking||permissions.changes?.permission_review_required)throw Object.assign(Error('EXAMPLE_PERMISSIONS_CHANGED'),{code:'EXAMPLE_PERMISSIONS_CHANGED'});
      const published=await call(`/studio/workflows/${w.id}/publish`,{expected_version:permissions.version,permission_fingerprint:permissions.fingerprint},headers),consumerHeaders={authorization:'Bearer '+published.key,'idempotency-key':randomBytes(16).toString('hex')};
      const item={id:spec.id,connection_id:c.id,workflow_id:w.id,slug:w.slug,key_id:published.id,key:published.key};items.push(item);save([...items,...previous.filter(p=>!items.some(i=>i.id===p.id))]);
      const verified=await wait((await call(`/v1/actions/${w.slug}/versions/1/runs`,{input:{[spec.parameter]:spec.samples[0]}},consumerHeaders)).run_id,consumerHeaders,true);if(verified.status!=='succeeded'||!matches(spec,verified.result,0))throw new Error('EXAMPLE_API_FAILED');
      await call(`/studio/connections/${c.id}/close`,{},headers);job.progress=Math.round((index+1)*90/specs.length);
    }
    save(items);job={status:'ready',stage:'Generated APIs verified through scoped consumer keys',progress:100};
  }
  app.get(prefix,async()=>({...job,apps:publicApps()}));
  app.post(prefix+'/setup',async(req,reply)=>{
    if(!req.body||req.body.authorized!==true||Object.keys(req.body).length!==1)fail('INVALID_REQUEST','Confirm creating the example integrations.');
    if(job.status==='building')return reply.code(202).send({...job});rate(prefix+'-setup',3);
    job={status:'building',stage:'Preparing the website integrations',progress:0};
    setupTask=prepare({cookie:req.headers.cookie,'x-hermo-csrf':req.headers['x-hermo-csrf']}).catch(error=>{job={...job,status:'failed',error:error.code??'EXAMPLE_SETUP_FAILED',stage:'Setup stopped. Inspect Runs and retry the example setup.'};});return reply.code(202).send({...job});
  });
  app.post(prefix+'/:id/run',async(req,reply)=>{
    rate(prefix+'-run',30);const spec=specs.find(s=>s.id===req.params.id),item=catalog().find(i=>i.id===req.params.id);if(!spec||!item)fail('NOT_FOUND','Build the examples first.',404);
    if(!req.body||typeof req.body.reference!=='string'||!req.body.reference.length||req.body.reference.length>128||Object.keys(req.body).length!==1)fail('INVALID_REQUEST','Enter a reference of up to 128 characters.');
    const receipt=await call(`/v1/actions/${item.slug}/versions/1/runs`,{input:{[spec.parameter]:req.body.reference}},{authorization:'Bearer '+item.key,'idempotency-key':randomBytes(16).toString('hex')}).catch(error=>fail(error.code,'The example API is unavailable. Rebuild examples or review its key and connection.',409));reply.code(202);return receipt;
  });
  app.get(prefix+'/:id/runs/:rid',async(req)=>{
    const item=catalog().find(i=>i.id===req.params.id);if(!item)fail('NOT_FOUND','Example not found.',404);
    return call('/v1/runs/'+encodeURIComponent(req.params.rid),undefined,{authorization:'Bearer '+item.key}).catch(error=>fail(error.code,error.statusCode===429?'Polling limit reached. Wait before checking the run again.':'Run unavailable for this example key.',error.statusCode??404));
  });
  app.addHook('onClose',async()=>{await setupTask;});
}
