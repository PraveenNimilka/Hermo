import {usesStructuredExtraction,observationSignature,observationChanged,extractionReady} from './output-mappings.mjs';
import {randomBytes} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {hash,id,passwordMatches} from './store.mjs';
import {pageTemplate,pageParameter} from './page-template.mjs';
import {invalidAccountMarker} from './account-marker.mjs';
import {verifyResult} from './verification.mjs';
import {browserInputValue,convertOutputs} from './workflow-contract.mjs';

const routes=new Set(['/companion/browser/pair','/companion/browser/poll','/companion/browser/reply','/companion/browser/authorize','/companion/browser/disconnect']);
const extensionOrigin=value=>typeof value==='string'&&/^chrome-extension:\/\/[a-p]{32}$/.test(value);
export function isBrowserCompanionRequest(req,path){
  if(!routes.has(path))return false;if(req.method==='OPTIONS')return extensionOrigin(req.headers.origin);
  const extension=req.headers['x-hermo-extension-id'];
  return req.method==='POST'&&typeof extension==='string'&&/^[a-p]{32}$/.test(extension)&&(!req.headers.origin||req.headers.origin==='chrome-extension://'+extension)&&(!req.headers['sec-fetch-site']||req.headers['sec-fetch-site']==='none'||extensionOrigin(req.headers.origin));
}
const selector=z.string().min(1).max(3000);
const output=z.object({kind:z.literal('output'),selector,read_mode:z.literal('last').optional(),read_attribute:z.enum(['src','href','alt','download','poster']).optional(),identity_eligible:z.boolean().optional(),semantic_role:z.enum(['user','assistant','identity','data','media']).optional(),label:z.string().max(100),preview:z.string().max(600),type:z.string().max(100),disabled:z.boolean()}).strict();
const control=z.object({kind:z.enum(['input','button','select','check']),selector,label:z.string().max(100),type:z.string().max(100),disabled:z.boolean(),secondary:z.boolean().optional(),checked:z.boolean().optional(),value:z.string().max(1000).optional(),options:z.array(z.object({value:z.string().max(1000),label:z.string().max(100),disabled:z.boolean()}).strict()).max(100).optional()}).strict();
const documentSchema=z.object({elements:z.array(z.union([output,control])).max(180),challenge:z.boolean(),denied:z.boolean(),authRejected:z.boolean(),networkError:z.boolean(),login:z.boolean(),credentials:z.boolean(),textLength:z.number().finite().nonnegative(),readyState:z.string().max(30)}).strict();
const previewSchema=z.object({state:z.enum(['disabled','starting','live','unavailable','blocked','snapshot']),captured_at:z.number().finite().optional(),width:z.number().int().positive().max(4096).optional(),height:z.number().int().positive().max(4096).optional()}).strict();
const snapshotSchema=z.object({url:z.string().max(2048),title:z.string().max(300),doc:documentSchema,image:z.string().max(600000).regex(/^[A-Za-z0-9+/=]*$/).optional(),preview:previewSchema.optional()}).strict();

export function installConnectedBrowser(app,{origin,store,session,sessions,ownerCookie,connection,saveConnection,invalidate,recordings,fail,rate,stopRuns,browserWorkspaces,connectionBusy,isRecording,baseEngine}){
  const grants=new Map(),links=new Map(),views=new Map(),pairings=new Map();let closed=false;
  const parse=(schema,value)=>{const r=schema.safeParse(value);if(!r.success)fail('INVALID_REQUEST','The browser companion request was not accepted.');return r.data;};
  const live=link=>!closed&&link&&links.get(link.cid)===link&&sessions.get(link.owner)?.authenticated&&sessions.get(link.owner).expires>Date.now()&&Date.now()-link.seen<60000;
  const rejectJobs=(link,reason)=>{for(const task of link.jobs.values()){clearTimeout(task.timer);task.reject(Error(reason));}link.jobs.clear();link.queue=[];link.waiter?.({type:'closed'});link.waiter=undefined;};
  function detach(cid,stop=false,reason='BROWSER_DISCONNECTED'){const link=links.get(cid);if(stop&&link){stopRuns(cid,reason);try{saveConnection(connection(cid),{},'stopped');}catch{}}if(link){links.delete(cid);rejectJobs(link,reason);}views.delete(cid);}
  const get=cid=>{const link=links.get(cid);if(!live(link)){detach(cid,false);throw Error('BROWSER_DISCONNECTED');}return link;};
  const scopedURL=(value,link)=>{const url=new URL(value);if(url.origin!==link.origin||url.username||url.password||!url.pathname.startsWith(link.pathPrefix))throw Error('POLICY_BLOCKED');return url.href;};
  function rpc(cid,command){command={...command,public_source:connection(cid).access==='public'};
    const link=get(cid);if(command.op==='extract'&&!link.capabilities.includes('structured_outputs')||command.op==='observe'&&!link.capabilities.includes('workflow_waits'))throw Error('COMPANION_UPDATE_REQUIRED');if(link.jobs.size>=8)throw Error('BROWSER_BUSY');
    const taskId=id('cmd');return new Promise((resolve,reject)=>{
      const duration=command.timeout_ms===undefined?15000:Math.min(30000,Math.max(100,command.timeout_ms)),expiresAt=Date.now()+duration;
      const task={resolve,reject,command,expiresAt,timer:setTimeout(()=>{link.jobs.delete(taskId);reject(Error('BROWSER_DISCONNECTED'));detach(cid);},duration)};
      link.jobs.set(taskId,task);const message={type:'command',id:taskId,origin:link.origin,path_prefix:link.pathPrefix,expires_at:expiresAt,command};
      if(link.waiter){const send=link.waiter;link.waiter=undefined;send(message);}else link.queue.push(message);
    });
  }
  function companion(req){
    const token=req.headers.authorization?.match(/^Bearer (hb_session_[A-Za-z0-9_-]{43})$/)?.[1];
    const link=token&&[...links.values()].find(value=>value.secret===hash(token)&&value.extension===req.headers['x-hermo-extension-id']);
    if(!live(link))fail('BROWSER_LINK_EXPIRED','The browser connection ended. Unlock Hermo and connect the selected tab again.',401);link.seen=Date.now();return link;
  }
  for(const path of routes)app.options(path,async(req,reply)=>{
    if(!isBrowserCompanionRequest(req,path))fail('ORIGIN_BLOCKED','Only the local browser companion can use this route.',403);
    reply.header('Access-Control-Allow-Origin',req.headers.origin).header('Vary','Origin').header('Access-Control-Allow-Methods','POST').header('Access-Control-Allow-Headers','authorization, content-type, x-hermo-extension-id');return reply.code(204).send();
  });
  app.post('/studio/connections/:cid/browser-link',async req=>{
    rate('browser-link-start',10,600000);const c=connection(req.params.cid),body=parse(z.object({password:z.string().min(1).max(128).optional(),authorized:z.literal(true)}).strict(),req.body);
    if(connectionBusy(c.id)||pairings.has(c.id))fail('BROWSER_BUSY','Finish or cancel accepted runs before replacing their authorized browser tab.',409);
    if([...recordings.values()].some(value=>value.connectionId===c.id))fail('RECORDING_ACTIVE','Finish the current recording before changing browser mode.',409);
    if(body.password&&!await passwordMatches(body.password,store.getSetting('owner_password')))fail('INVALID_CREDENTIALS','Confirm your workspace password.',401);
    if(connectionBusy(c.id)||isRecording(c.id))fail('BROWSER_BUSY','Finish the recording or accepted runs before replacing this browser.',409);
    const owner=hash(req.cookies[ownerCookie]??'');for(const [key,value]of grants)if(value.cid===c.id||value.expires<Date.now())grants.delete(key);
    const code='hb_pair_'+randomBytes(32).toString('base64url'),expires=Date.now()+600000;grants.set(hash(code),{owner,cid:c.id,origin:new URL(c.url).origin,expires});
    return {code,expires_at:new Date(expires).toISOString(),website_origin:new URL(c.url).origin,workspace_origin:origin,extension_directory:resolve(dirname(fileURLToPath(import.meta.url)),'../companion/browser')};
  });
  app.get('/studio/connections/:cid/browser-link',async req=>{
    let c=connection(req.params.cid);const link=links.get(c.id);
    // A live, authorized tab is the binding. Profile text is optional website content.
    if(live(link)&&(c.status!=='connected'||c.identity?.kind!=='selected_tab')){
      saveConnection(c,{identity:{kind:'selected_tab',origin:link.origin}},'connected');c=connection(c.id);
      link.waiter?.({type:'idle'});
    }
    return {mode:c.browser_mode??'isolated',linked:!!live(link),confirmed:!!live(link)&&c.status==='connected',pairing_pending:[...grants.values()].some(value=>value.cid===c.id&&value.expires>Date.now()),website_origin:new URL(c.url).origin,website_url:c.url,browser_workspace_id:c.browser_workspace_id,browser_kind:c.browser_workspace_id?browserWorkspaces.get(c.browser_workspace_id).kind:undefined};
  });
  app.post('/companion/browser/pair',async req=>{
    if(!isBrowserCompanionRequest(req,'/companion/browser/pair'))fail('ORIGIN_BLOCKED','Only the local browser companion can pair.',403);
    rate('browser-pair',20);const body=parse(z.object({code:z.string().regex(/^hb_pair_[A-Za-z0-9_-]{43}$/),origin:z.string().max(500),authorized:z.literal(true),protocol:z.number().int().optional(),capabilities:z.array(z.enum(['panel','read_data','saved_browser','command_guard','workflow_waits','structured_outputs','live_preview'])).max(7).optional(),tab_id:z.number().int().positive().optional(),context_id:z.string().regex(/^bc_[A-Za-z0-9_-]{36}$/).optional()}).strict(),req.body),grant=grants.get(hash(body.code));
    if(!grant||grant.expires<Date.now()||!sessions.get(grant.owner)?.authenticated||sessions.get(grant.owner).expires<Date.now())fail('BROWSER_LINK_EXPIRED','Pairing expired. Generate a new code after unlocking Hermo.',401);
    if(body.origin!==grant.origin)fail('WRONG_BROWSER_TAB','Open the exact website shown in Hermo and pair its tab. Nothing was attached.',403);
    if(body.protocol!==2||!body.context_id||!body.tab_id||!['panel','read_data','saved_browser','command_guard'].every(x=>body.capabilities?.includes(x)))fail('COMPANION_UPDATE_REQUIRED','Reload Hermo companion 0.7.0 in chrome://extensions, then connect this tab again.',426);
    const c=connection(grant.cid);if([...recordings.values()].some(value=>value.connectionId===c.id))fail('RECORDING_ACTIVE','Finish the current recording first.',409);
    if(connectionBusy(c.id)||isRecording(c.id)||pairings.has(c.id))fail('BROWSER_BUSY','Finish or cancel accepted runs before replacing their browser tab.',409);
    const tabTaken=()=>[...links.values()].some(link=>live(link)&&link.cid!==c.id&&link.context===body.context_id&&link.tab===body.tab_id)||[...pairings.values()].some(pair=>pair.cid!==c.id&&pair.context===body.context_id&&pair.tab===body.tab_id);
    if(tabTaken())fail('TAB_ALREADY_CONNECTED','This tab is connected to another app. Stop that connection or choose another website tab.',409);
    // Consume and reserve before the first await. One code and one physical tab
    // cannot create competing grants while an isolated browser is closing.
    grants.delete(hash(body.code));const pending={cid:c.id,context:body.context_id,tab:body.tab_id,cancelled:false};pairings.set(c.id,pending);
    try{
      if(c.browser_workspace_id)browserWorkspaces.bind(c.browser_workspace_id,body.context_id);
      await baseEngine.close(c.id);
      if(closed||pending.cancelled||!sessions.get(grant.owner)?.authenticated||sessions.get(grant.owner).expires<=Date.now())fail('BROWSER_LINK_EXPIRED','Pairing ended. Unlock Hermo and generate a new code.',401);
      connection(c.id); // Deletion while closing must not resurrect a connection.
      if(connectionBusy(c.id)||isRecording(c.id))fail('BROWSER_BUSY','A run started before pairing finished. Finish it before replacing the browser.',409);
      if(tabTaken())fail('TAB_ALREADY_CONNECTED','This tab is already connected to another app.',409);
      detach(c.id);
      const pathPrefix=grant.origin===origin?'/sandbox/':'/',token='hb_session_'+randomBytes(32).toString('base64url');links.set(c.id,{cid:c.id,origin:grant.origin,pathPrefix,owner:grant.owner,context:body.context_id,tab:body.tab_id,extension:req.headers['x-hermo-extension-id'],secret:hash(token),guarded:true,capabilities:[...new Set(body.capabilities)],seen:Date.now(),queue:[{type:'idle'}],jobs:new Map()});
      saveConnection(c,{browser_mode:'connected',identity:{kind:'selected_tab',origin:grant.origin},storageState:undefined,studioState:undefined},'connected');if(c.browser_mode!=='connected')invalidate(c.id);
      store.audit('browser.tab_paired',c.id);
      return {token,connection_status:'connected',protocol:2,capabilities:[...new Set(body.capabilities)],lease_expires_at:sessions.get(grant.owner).expires,app_name:c.name,connection_id:c.id,website_origin:grant.origin,path_prefix:pathPrefix};
    }finally{if(pairings.get(c.id)===pending)pairings.delete(c.id);}
  });
  app.post('/companion/browser/poll',async(req,reply)=>{
    const link=companion(req);parse(z.object({}).strict(),req.body);
    if(link.waiter)fail('BROWSER_POLL_ACTIVE','One controller per paired tab is supported.',409);
    const meta=value=>{if(value.type==='closed')return value;try{const c=connection(link.cid);return {...value,connection_status:c.status,app_name:c.name};}catch{return {type:'closed'};}};
    if(link.queue.length)return meta(link.queue.shift());
    return new Promise(resolve=>{
      let settled=false;const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);if(link.waiter===finish)link.waiter=undefined;resolve(meta(value));};
      const timer=setTimeout(()=>finish({type:'idle'}),18000);link.waiter=finish;
      reply.raw.once('close',()=>finish({type:'closed'}));
    });
  });
  app.post('/companion/browser/reply',{bodyLimit:1048576},async req=>{
    const link=companion(req),body=parse(z.object({id:z.string().max(80),ok:z.boolean(),value:z.unknown().optional(),error:z.enum(['TAB_CLOSED','ORIGIN_CHANGED','LOGIN_REQUIRED','ACTION_UNAVAILABLE','ELEMENT_AMBIGUOUS','OUTPUT_LIMIT_EXCEEDED','UNSUPPORTED_FRAME','PERMISSION_REVOKED','PAGE_READ_FAILED','TIMEOUT']).optional()}).strict(),req.body),task=link.jobs.get(body.id);
    if(!task)fail('BROWSER_COMMAND_EXPIRED','The command expired or was already completed.',409);
    link.jobs.delete(body.id);clearTimeout(task.timer);
    if(!body.ok){task.reject(body.error==='LOGIN_REQUIRED'?Object.assign(Error('AUTH_REQUIRED'),{phase:'website_session'}):Error(body.error==='ORIGIN_CHANGED'?'POLICY_BLOCKED':body.error??'ACTION_UNAVAILABLE'));return {ok:true};}
    try{
      let value;
      if(task.command.op==='snapshot'){value=snapshotSchema.parse(body.value);value.url=scopedURL(value.url,link);}
      else if(task.command.op==='extract'){
        value=z.object({value:z.unknown().optional(),count:z.number().int().min(0).max(100),streaming:z.boolean(),identity:z.string().max(24000).optional()}).strict().parse(body.value);
        let count=0,size=0;const inspect=(raw,depth=0)=>{if(depth>4||++count>2000)throw Error('INVALID');if(raw===undefined||raw===null)return;if(typeof raw==='string'){size+=raw.length;if(raw.length>4096||size>131072)throw Error('INVALID');return;}if(Array.isArray(raw)){if(raw.length>100)throw Error('INVALID');for(const child of raw)inspect(child,depth+1);return;}if(typeof raw==='object'&&(Object.getPrototypeOf(raw)===Object.prototype||Object.getPrototypeOf(raw)===null)){if(Object.keys(raw).length>16)throw Error('INVALID');for(const [name,child]of Object.entries(raw)){if(!/^[a-z][a-z0-9_]{1,39}$/.test(name))throw Error('INVALID');inspect(child,depth+1);}return;}throw Error('INVALID');};inspect(value.value);
      }
      else if(task.command.op==='read')value=task.command.details?z.object({text:z.string().max(4096),count:z.number().int().min(1).max(15000),streaming:z.boolean(),identity:z.string().max(24000).optional()}).strict().parse(body.value):z.string().max(4096).parse(body.value);
      else value=task.command.op==='observe'?z.boolean().parse(body.value):z.literal(true).parse(body.value);
      task.resolve(value);
    }catch{task.reject(Error('BROWSER_REPLY_INVALID'));detach(link.cid);fail('INVALID_REQUEST','The browser response was rejected.',400);}
    return {ok:true};
  });
  app.post('/companion/browser/authorize',async req=>{const link=companion(req),body=parse(z.object({id:z.string().max(80)}).strict(),req.body),task=link.jobs.get(body.id);if(!task||task.expiresAt<=Date.now())fail('BROWSER_COMMAND_EXPIRED','This command is no longer authorized.',409);return {authorized:true};});
  app.post('/companion/browser/disconnect',async req=>{const link=companion(req),body=parse(z.object({reason:z.enum(['user','tab_closed','origin_changed','permission_revoked','transport_lost','outcome_unknown']).optional()}).strict(),req.body);const reason={tab_closed:'TAB_CLOSED',origin_changed:'POLICY_BLOCKED',permission_revoked:'PERMISSION_REVOKED',transport_lost:'BROWSER_DISCONNECTED',outcome_unknown:'EXECUTION_OUTCOME_UNKNOWN'}[body.reason]??'CONNECTION_STOPPED';detach(link.cid,true,reason);return {ok:true};});
  const normal=cid=>views.get(cid)??(()=>{const value={elements:new Map(),busy:false};views.set(cid,value);return value;})();
  async function capture(cid,visual=false){
    const link=get(cid),value=await rpc(cid,{op:'snapshot',visual}),doc=value.doc,v=normal(cid);
    if(connection(cid).access==='public'&&!doc.credentials)doc.login=false;
    const state=doc.authRejected?'auth_rejected':doc.challenge?'challenge':doc.networkError?'network_error':doc.denied?'denied':doc.credentials||doc.login?'sign_in':doc.elements.some(item=>item.kind!=='output')?'ready':'read_only';
    const safe=['ready','read_only'].includes(state),old=new Map([...v.elements].map(([key,item])=>[item.selector+'|'+item.kind+'|'+(item.read_attribute??''),key]));v.elements=new Map();
    const elements=doc.elements.filter(item=>safe||item.kind!=='output').filter(item=>item.type!=='password').map(item=>{const key=old.get(item.selector+'|'+item.kind+'|'+(item.read_attribute??''))??id('el');v.elements.set(key,{...item,frame_path:[]});const {selector,...visible}=item;return {...visible,id:key,framed:false,...item.kind==='output'?{identity_eligible:item.identity_eligible===true&&!invalidAccountMarker(item.preview)}:{}};});
    v.last={url:value.url,title:value.title,image:safe?(value.image??''):'',preview:safe?value.preview:{state:'blocked'},state,mode:'connected',elements,viewport:{width:value.preview?.width??1100,height:value.preview?.height??720},approved_origins:[link.origin],can_confirm:safe,diagnostics:{blocked:[],failed:[],http_status:0},tabs:[{id:'paired',url:value.url,active:true}]};return v.last;
  }
  async function exclusive(cid,fn){const v=normal(cid);get(cid);if(v.busy)throw Error('BROWSER_BUSY');v.busy=true;try{if(v.snapshot)await v.snapshot;return await fn(v);}finally{v.busy=false;}}
  async function snapshot(cid){const v=normal(cid);if(v.busy){if(v.last)return v.last;throw Error('BROWSER_BUSY');}if(v.snapshot)return v.snapshot;v.snapshot=capture(cid,true);try{return await v.snapshot;}finally{v.snapshot=undefined;}}
  async function visit(cid,url){const link=get(cid),target=scopedURL(url,link);await rpc(cid,{op:'navigate',url:target});normal(cid).last=undefined;}
  async function navigate(cid,url){return exclusive(cid,()=>visit(cid,url));}
  async function read(cid,item){if(item.frame_path?.length)throw Error('UNSUPPORTED_FRAME');return rpc(cid,{op:'read',selector:item.selector,...item.read_mode?{read_mode:item.read_mode}:{},...item.read_attribute?{read_attribute:item.read_attribute}:{}});}
  const readLegacyState=(cid,item)=>rpc(cid,{op:'read',selector:item.selector,read_mode:item.read_mode,...item.read_attribute?{read_attribute:item.read_attribute}:{},details:true});
  const readState=async(cid,item)=>{
    if(item.frame_path?.length)throw Error('UNSUPPORTED_FRAME');
    if(usesStructuredExtraction(item)&&!item.selector?.startsWith(':hermo-')){
      const {frame_path,...mapping}=item,value=await rpc(cid,{op:'extract',mapping});return {text:value.value,count:value.count,streaming:value.streaming,identity:value.identity};
    }
    try{return await readLegacyState(cid,item);}catch(error){if(error.message!=='ACTION_UNAVAILABLE'||item.required!==false&&!item.nullable)throw error;return {count:0,streaming:false};}
  };
  async function operate(cid,item,operation,value){return exclusive(cid,async v=>{if(item.frame_path?.length||item.type==='password')throw Error('ACTION_UNAVAILABLE');await rpc(cid,{op:'operate',selector:item.selector,kind:operation,...value===undefined?{}:{value}});v.last=undefined;});}
  const connected={
    async open(cid){get(cid);return normal(cid);},isOpen(cid){return !!live(links.get(cid));},snapshot,
    element(cid,eid,kind){const item=normal(cid).elements.get(eid);if(!item||kind&&item.kind!==kind)throw Error('ELEMENT_CHANGED');return item;},read,operate,navigate,
    async openDesktop(cid){await rpc(cid,{op:'focus'});},allowOrigins(){/* A paired tab remains bound to its original exact origin. */},
    async save(cid){const value=await snapshot(cid);if(!value.can_confirm)throw Error('CONNECTION_NOT_READY');return {checkpoint:value.url,browser_mode:'connected'};},
    async interact(cid,action){if(action.op==='tab')return;if(action.op==='home')return navigate(cid,connection(cid).url);if(!['reload','retry','scroll'].includes(action.op))throw Error('ACTION_UNAVAILABLE');return exclusive(cid,async v=>{await rpc(cid,{op:action.op==='retry'?'reload':action.op,...action.op==='scroll'?{delta:action.delta}:{}});v.last=undefined;});},
    async addTab(){throw Error('NORMAL_BROWSER_LOGIN_REQUIRED');},async demoLogin(){throw Error('NORMAL_BROWSER_LOGIN_REQUIRED');},
    async execute(c,definition,input,onProgress,signal){return exclusive(c.id,async()=>{
      const link=get(c.id),abort=()=>detach(c.id,false,signal.reason?.message??'WORKFLOW_CANCELLED'),baselines=new Map(),priorMediaURLs=new Set(),observations={},deadline=Date.now()+(definition.timeout_ms?Math.min(300000,Math.max(15000,definition.timeout_ms))-1000:25000);signal?.addEventListener('abort',abort,{once:true});
      const check=()=>{if(signal?.aborted)throw signal.reason??Error('WORKFLOW_CANCELLED');if(get(c.id)!==link)throw Error('BROWSER_DISCONNECTED');};
      const generated=definition.action_type==='generate_media',hasMutation=definition.steps.some(step=>step.enabled!==false&&['fill','select','check','click'].includes(step.op)),hasMediaURL=definition.outputs.some(field=>['src','href','poster'].includes(field.read_attribute));
      const freshFields=new Set(definition.outputs.filter(field=>field.read_mode==='last'&&hasMutation||definition.verifiers.some(rule=>rule.kind==='changed'&&rule.output===field.name)||generated&&(hasMediaURL?['src','href','poster'].includes(field.read_attribute):true)).map(field=>field.name));
      const captureBaselines=async()=>{
        if(baselines.size)return;
        for(const field of definition.outputs.filter(field=>freshFields.has(field.name))){try{baselines.set(field.name,await readState(c.id,field));}catch(error){if(error.message!=='ACTION_UNAVAILABLE')throw error;baselines.set(field.name,{text:'',count:0});}}
        if(generated&&hasMediaURL){const snap=await capture(c.id);for(const item of snap.elements.filter(item=>['src','href','poster'].includes(item.read_attribute))){const field=normal(c.id).elements.get(item.id);try{const value=await readState(c.id,field);if(value.text)priorMediaURLs.add(value.text);}catch(error){if(error.message!=='ACTION_UNAVAILABLE')throw error;}}}
      };
      const websiteReady=async()=>{try{
        const snap=await capture(c.id);
        if(!snap.can_confirm)throw Error('AUTH_REQUIRED');
        if(new URL(snap.url).origin!==link.origin)throw Error('POLICY_BLOCKED');
      }catch(error){if(['ACTION_UNAVAILABLE','AUTH_REQUIRED'].includes(error.message))throw Object.assign(Error('AUTH_REQUIRED'),{phase:'website_session'});throw error;}};
      try{
        check();await websiteReady();
        if(!hasMutation)await captureBaselines();
        for(let index=0;index<definition.steps.length;index++){
          check();const step=definition.steps[index];onProgress(index,definition.steps.length);
          if(step.enabled===false){onProgress(index,definition.steps.length,{phase:'skipped'});continue;}
          if(step.op==='navigate'){const url=step.path_parameter?pageTemplate(step.template,step.path_parameter,input[step.path_parameter]).url:step.url;await visit(c.id,url);if(hasMutation){baselines.clear();priorMediaURLs.clear();}}
          else if(['wait_element','wait_text','wait_url'].includes(step.op)){
            if(step.frame_path?.length)throw Error('UNSUPPORTED_FRAME');
            const stepDeadline=Math.min(deadline,Date.now()+(step.timeout_ms??5000)),command=step.op==='wait_url'?{op:'observe',kind:'url',url:scopedURL(step.url,link),match:step.match??'exact'}:{op:'observe',kind:step.op==='wait_text'?'text':'element',selector:step.selector,locators:step.locators,...step.op==='wait_text'?{text:step.text}:{state:step.state}};
            while(true){check();if(Date.now()>=stepDeadline)throw Object.assign(Error('TIMEOUT'),{phase:'step_wait'});const observed=await rpc(c.id,{...command,timeout_ms:Math.max(100,Math.min(15000,stepDeadline-Date.now()))});check();if(Date.now()>=stepDeadline)throw Object.assign(Error('TIMEOUT'),{phase:'step_wait'});if(observed)break;await new Promise(done=>setTimeout(done,Math.min(100,Math.max(1,stepDeadline-Date.now()))));}
          }
          else{if(step.frame_path?.length)throw Error('ACTION_UNAVAILABLE');await captureBaselines();check();onProgress(index,definition.steps.length,{phase:'issuing'});await rpc(c.id,{op:'operate',selector:step.selector,...step.locators?{locators:step.locators}:{},...step.timeout_ms?{timeout_ms:Math.min(step.timeout_ms,Math.max(100,deadline-Date.now()))}:{},kind:step.op,...step.op!=='click'?{value:step.parameter?browserInputValue(definition.inputs[step.parameter],input[step.parameter],step.op):step.value}:{}});}
          onProgress(index,definition.steps.length,{phase:'completed'});
        }
        onProgress(definition.steps.length,definition.steps.length,{phase:'verifying'});
        await websiteReady();const result={},current=normal(c.id).last;
        for(const field of definition.outputs){
          if(field.source!=='url_parameter'){
            const baseline=baselines.get(field.name)??{text:'',count:0},fieldDeadline=generated||freshFields.has(field.name)?deadline:Math.min(deadline,Date.now()+8000);let previous,stableSince=Date.now(),value,settled=false;
            while(Date.now()<fieldDeadline){check();try{value=await readState(c.id,field);}catch(error){if(error.message!=='ACTION_UNAVAILABLE')throw error;value=undefined;}
              const signature=observationSignature(value);if(signature!==previous){previous=signature;stableSince=Date.now();}
              const fresh=observationChanged(value,baseline)&&!(generated&&['src','href','poster'].includes(field.read_attribute)&&priorMediaURLs.has(value.text));
              if(extractionReady(field,value)&&!value.streaming&&(!freshFields.has(field.name)||fresh)&&Date.now()-stableSince>=600){if(value.text!==undefined)result[field.name]=value.text;observations[field.name]={fresh:!!fresh};settled=true;break;}
              await new Promise(done=>setTimeout(done,250));
            }
            if(!settled)throw Object.assign(Error('VERIFICATION_FAILED'),{verification:{output:field.name,reason:!extractionReady(field,value)?'missing_output':value.streaming?'still_streaming':freshFields.has(field.name)&&((!observationChanged(value,baseline))||(generated&&['src','href','poster'].includes(field.read_attribute)&&priorMediaURLs.has(value.text)))?'not_fresh':'not_settled'}});
          }else result[field.name]=pageParameter(current.url,field.template,field.parameter);
          if(field.source==='url_parameter'&&!result[field.name])throw Object.assign(Error('VERIFICATION_FAILED'),{verification:{output:field.name,reason:'missing_output'}});
        }
        await websiteReady();
        const verification=verifyResult(definition,result,input,c.access==='public'?'public_source_origin':'selected_tab_origin',observations);
        if(generated){if(![...freshFields].some(name=>observations[name]?.fresh))throw Object.assign(Error('VERIFICATION_FAILED'),{verification:{output:definition.outputs[0]?.name,reason:'not_fresh'}});verification.checks.push('fresh_generated_outputs');}
        return {result:convertOutputs(definition.outputs,result),verification};
      }finally{signal?.removeEventListener('abort',abort);}
    });}
  };
  const selected=cid=>connection(cid).browser_mode==='connected'?connected:baseEngine;
  const engine={...baseEngine};
  engine.isPairing=cid=>pairings.has(cid);
  engine.connectionHealth=cid=>{const link=links.get(cid);return {last_activity_at:link?new Date(link.seen).toISOString():null,authorization_expires_at:link&&sessions.get(link.owner)?new Date(sessions.get(link.owner).expires).toISOString():null,command_guard:!!link?.guarded};};
  for(const method of ['open','openDesktop','isOpen','snapshot','element','read','operate','save','navigate','interact','addTab','demoLogin','allowOrigins'])engine[method]=function(cid,...args){return selected(cid)[method](cid,...args);};
  engine.statusChanged=cid=>links.get(cid)?.waiter?.({type:'idle'});
  engine.execute=(c,...args)=>(c.browser_mode==='connected'?connected:baseEngine).execute(c,...args);
  engine.close=async cid=>{if(pairings.has(cid))pairings.get(cid).cancelled=true;detach(cid,true,'CONNECTION_STOPPED');for(const [key,value]of grants)if(value.cid===cid)grants.delete(key);await baseEngine.close(cid);};
  engine.closeStudios=async()=>{for(const pending of pairings.values())pending.cancelled=true;for(const cid of [...links.keys()])detach(cid,true,'CONNECTION_STOPPED');grants.clear();await baseEngine.closeStudios();};
  engine.closeAll=async()=>{closed=true;for(const pending of pairings.values())pending.cancelled=true;for(const cid of [...links.keys()])detach(cid);grants.clear();await baseEngine.closeAll();};
  return engine;
}
