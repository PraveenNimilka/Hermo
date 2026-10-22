import {installExecutionTargets} from './execution-targets.mjs';
import Fastify from 'fastify';
import cookies from '@fastify/cookie';
import staticFiles from '@fastify/static';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { openStore,id,hash,passwordHash,passwordMatches } from './store.mjs';
import { createEgressProxy,validateWebsite,publicAddress } from './network.mjs';
import { createBrowserEngine } from './browser.mjs';
import { installSandbox } from './sandbox.mjs';
import { installMcp } from './mcp.mjs';
import {installExamplePortals,installExamples} from './examples.mjs';
import {installPublicExamples} from './public-examples.mjs';
import {createGoogleProvider,installGoogle} from './google.mjs';
import {pageTemplate} from './page-template.mjs';
import {installBrowserProfiles,googleBrowserOrigins} from './browser-profiles.mjs';
import {installGoogleCompanion,isCompanionRequest} from './google-companion.mjs';
import {createNormalChromeLauncher} from './normal-chrome.mjs';
import {installConnectedBrowser,isBrowserCompanionRequest} from './connected-browser.mjs';
import {invalidAccountMarker} from './account-marker.mjs';
import {repairChatDefinition} from './repair-chat.mjs';
import {workflowInputSchema,chatPromptInputs,jsonInputSchema,canonicalInput} from './workflow-input.mjs';
import {inputFieldSchema,outputFieldSchema,validateWorkflowContract,inputJsonSchema,outputJsonSchema,validateConvertedOutputs} from './workflow-contract.mjs';
import {validateCompletionPolicy,verificationRuleSummaries} from './verification-rules.mjs';
import {outputConstraintKeys} from './output-constraints.mjs';
import {mediaOutputError} from './output-mappings.mjs';
import {installMediaAssets} from './media-assets.mjs';
import {workflowSpec} from './api-spec.mjs';
import {verifierSchema,validateVerifiers} from './verification.mjs';
import {installBrowserWorkspaces} from './browser-workspaces.mjs';
import {installResourceRemoval} from './resource-removal.mjs';
import {createWorkflowRevisions,executionConnection,snapshotConnection} from './workflow-revisions.mjs';
import {createRunSnapshots} from './run-snapshots.mjs';
import {installRevisionRoutes} from './revision-routes.mjs';
import {installWorkflowEditor} from './workflow-editor.mjs';
import {installProjects} from './projects.mjs';
import {installHealthRoutes} from './health-routes.mjs';
import {installWorkflowTemplates} from './workflow-templates.mjs';
import {activeRunStatuses,prepareRun,startRun,observeProgress,finishRun,runError,recoverInterruptedRuns,persistRun} from './run-state.mjs';
import {executionStatus,executionReceipt} from './execution-receipt.mjs';
import {workflowPermissions,publicWorkflowPermissions} from './workflow-permissions.mjs';
import {createRunApprovals,approvalWebsiteOrigin} from './run-approvals.mjs';
import {compileApprovalPolicy,effectiveApprovalSteps,requiresInvocationApproval} from './approval-policy.mjs';
import {installApprovalInbox} from './approval-inbox.mjs';
import {compareWorkflowChanges} from './workflow-changes.mjs';
import {installManagedProfiles} from './managed-profile.mjs';
import {assignStepIds} from './workflow-steps.mjs';
import {installLocatorRepair} from './locator-repair.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const now=()=>new Date().toISOString();
const fail=(code,message,status=400)=>{throw Object.assign(new Error(message),{publicCode:code,statusCode:status});};
const text=z.string().trim().min(1).max(100);
const fieldName=z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
const isBasicOutput=field=>['string','number','boolean','url'].includes(field.type??'string')&&field.required!==false&&!field.nullable&&!field.media_type&&outputConstraintKeys.every(key=>field[key]===undefined);
const slugSchema=z.string().regex(/^[a-z][a-z0-9.-]{2,59}$/);
const parse=(schema,value)=>{const result=schema.safeParse(value);if(!result.success)fail('INVALID_REQUEST','Check the required fields and try again.');return result.data;};
export async function createApp({port=Number(process.env.HERMO_PORT??4317),dataDir=process.env.HERMO_DATA_DIR??join(root,'.hermo'),googleProvider,browserEngineFactory=createBrowserEngine,normalBrowserLauncher=createNormalChromeLauncher(dataDir)}={}) {
  const origin=`http://127.0.0.1:${port}`,aliases=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
  const store=openStore(dataDir),{db,seal,unseal,getSetting,setSetting,audit}=store;
  let revisions,snapshots,projects,executionTargets,managedProfiles;
  googleProvider??=createGoogleProvider(getSetting('google_oauth_client')?unseal(getSetting('google_oauth_client')):undefined);
  const app=Fastify({logger:false,bodyLimit:24576,requestTimeout:20000,connectionTimeout:20000,trustProxy:false});
  await app.register(cookies);
  app.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string'},(_,body,done)=>done(null,body));
  const ownerCookie=`hermo_owner_${port}`;
  const sessions=new Map(),limits=new Map(),recordings=new Map(),controllers=new Map(),removing=new Set(),recordingStarts=new Set();
  const isRecording=cid=>recordingStarts.has(cid)||[...recordings.values()].some(recording=>recording.connectionId===cid);
  const acceptedOnConnection=cid=>db.prepare("SELECT r.id,r.workflow_id,w.connection_id FROM runs r JOIN workflows w ON w.id=r.workflow_id WHERE r.status IN ('queued','running','verifying')").all().filter(row=>(snapshots?.get(row.id)?.connection_config.id??row.connection_id)===cid);
  const connectionBusy=cid=>managedProfiles?.isChanging(cid)||acceptedOnConnection(cid).length>0||[...controllers.values()].some(active=>active.connectionId===cid)||!!db.prepare("SELECT r.id FROM runs r JOIN workflows w ON w.id=r.workflow_id WHERE w.connection_id=? AND r.status IN ('queued','running','verifying') LIMIT 1").get(cid);
  const assertConnectionIdle=cid=>{if(connectionBusy(cid)||engine.isPairing(cid)||managedProfiles?.isChanging(cid))fail('BROWSER_BUSY','This website is pairing or has an accepted or active run. Finish or cancel it before changing the browser.',409);};
  const rate=(name,max,window=60000)=>{const current=limits.get(name);if(!current||current.until<Date.now()){limits.set(name,{count:1,until:Date.now()+window});return;}if(++current.count>max)throw Object.assign(new Error('Too many requests. Try again shortly.'),{publicCode:'RATE_LIMITED',statusCode:429,retryAfter:Math.max(1,Math.ceil((current.until-Date.now())/1000))});};
  const newSession=(reply,authenticated)=>{
    for(const [key,value]of sessions)if(value.expires<=Date.now())sessions.delete(key);
    if(!authenticated){
      rate('anonymous-session',120);
      const anonymous=[...sessions].filter(([,value])=>!value.authenticated);
      for(const [key]of anonymous.slice(0,Math.max(0,anonymous.length-127)))sessions.delete(key);
    }
    const token=randomBytes(32).toString('base64url'), session={authenticated,csrf:randomBytes(24).toString('base64url'),expires:Date.now()+4*3600000};
    sessions.set(hash(token),session);reply.setCookie(ownerCookie,token,{path:'/studio',httpOnly:true,sameSite:'strict',maxAge:4*3600});return session;
  };
  function session(req){const value=sessions.get(hash(req.cookies[ownerCookie]??''));return value&&value.expires>Date.now()?value:undefined;}
  const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
  app.addHook('onRequest',async(req,reply)=>{
    const rawPath=req.raw.url.split('?')[0];
    if(/%|\\|\/\/|\.\./.test(rawPath))fail('PATH_BLOCKED','Non-canonical request paths are blocked.',400);
    if(!aliases.has(req.headers.host))fail('HOST_BLOCKED','Unrecognized local host.',403);
    // Fetch Metadata stays cross-site throughout Google's HTTP redirect chain.
    // Allow the public SPA document at the root to receive that return; it has
    // no owner data or side effects. Private APIs and embedded/fetch requests
    // keep the cross-site guard. The callback has its own one-use state checks.
    const oauthCallback=req.method==='GET'&&rawPath==='/oauth/google/callback';
    const publicNavigation=req.method==='GET'&&(rawPath==='/'||rawPath.startsWith('/sandbox/'))&&req.headers['sec-fetch-mode']==='navigate'&&req.headers['sec-fetch-dest']==='document';
    const companionRequest=isCompanionRequest(req,rawPath)||isBrowserCompanionRequest(req,rawPath);
    const mediaAssetRequest=['GET','HEAD'].includes(req.method)&&/^\/media\/assets\/[A-Za-z0-9_-]{43}$/.test(rawPath);
    if(mediaAssetRequest)reply.header('Access-Control-Allow-Origin','*');
    if(req.headers['sec-fetch-site']==='cross-site'&&!oauthCallback&&!publicNavigation&&!companionRequest&&!mediaAssetRequest)fail('ORIGIN_BLOCKED','Cross-site browser requests are blocked.',403);
    if(req.headers.origin&&!['http://'+req.headers.host].includes(req.headers.origin)&&!oauthCallback&&!companionRequest&&!mediaAssetRequest)fail('ORIGIN_BLOCKED','Cross-origin requests are blocked.',403);
    if(companionRequest&&req.headers.origin)reply.header('Access-Control-Allow-Origin',req.headers.origin).header('Vary','Origin');
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy',rawPath.startsWith('/sandbox/')?'same-origin':'no-referrer').header('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()')
      .header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:; font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'")
      .header('Cache-Control','no-store');
    if(req.url.startsWith('/studio/')) {
      const publicRoutes=['/studio/session','/studio/setup','/studio/login','/studio/google/start'];
      if(!publicRoutes.includes(req.url.split('?')[0])&&!session(req)?.authenticated)fail('UNAUTHORIZED','Unlock your workspace to continue.',401);
      if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!equal(req.headers['x-hermo-csrf'],session(req)?.csrf))fail('CSRF_BLOCKED','Refresh the page and try again.',403);
    }
    if(req.url.startsWith('/v1/')||req.url.startsWith('/mcp')){
      const key=req.headers.authorization?.match(/^Bearer (hm_live_[A-Za-z0-9_-]{43})$/)?.[1];
      const consumer=key&&db.prepare('SELECT * FROM api_keys WHERE hash=? AND revoked_at IS NULL AND expires_at>?').get(hash(key),now());
      if(!consumer)fail('UNAUTHORIZED','A valid scoped Hermo API key is required.',401);
      req.consumer=consumer;const polling=req.method==='GET'&&/^\/v1\/runs\/[^/]+(?:\/receipt)?$/.test(rawPath),mcp=rawPath==='/mcp';rate('key:'+(polling?'status':mcp?'transport':req.method==='POST'&&rawPath.startsWith('/v1/actions/')?'admit':'control')+':'+consumer.id,polling||mcp?300:60);
    }
  });
  app.setErrorHandler((error,req,reply)=>{
    const status=error.publicCode?error.statusCode:error.statusCode&&error.statusCode<500?error.statusCode:500;
    if(status===429)reply.header('Retry-After',String(error.retryAfter??2));reply.code(status).send({error:{code:error.publicCode??(status===500?'INTERNAL_ERROR':'INVALID_REQUEST'),message:error.publicCode?error.message:status===500?'The operation could not complete. No credentials were logged.':'The request was not accepted.'}});
  });
  const connection=(cid)=>{const row=db.prepare('SELECT * FROM connections WHERE id=?').get(cid);if(!row)fail('NOT_FOUND','Connection not found.',404);return {...row,...unseal(row.payload)};};
  const connectionPayload=c=>({url:c.url,origins:c.origins,access:c.access,storageState:c.storageState,checkpoint:c.checkpoint,identity:c.identity,studioState:c.studioState,browser_profile_id:c.browser_profile_id,browser_mode:c.browser_mode,browser_workspace_id:c.browser_workspace_id,managed_profile:c.managed_profile,session_generation:c.session_generation});
  const assertConnectionCurrent=c=>{
    const current=connection(c.id);
    if(current.session_generation!==c.session_generation||current.payload!==c.payload||current.status!==c.status)fail('CONNECTION_CHANGED','This browser connection changed. Reopen it before continuing.',409);
    return current;
  };
  const saveConnection=(c,changes={},status)=>{
    // An asynchronous operation holding an older session must fail after reset.
    // Never restore credentials copied before the owner's revocation decision.
    assertConnectionCurrent(c);
    db.prepare('UPDATE connections SET payload=?,status=? WHERE id=?').run(seal({...connectionPayload(c),...changes}),status??c.status,c.id);
  };
  const invalidate=cid=>{
    // Draft and historical execution targets retain authority independently of
    // the connection where a workflow was originally recorded. Reset/rebinding
    // must revoke those dependants too, even if the same account is later used.
    const affected=new Set(db.prepare('SELECT id FROM workflows WHERE connection_id=? OR id IN (SELECT workflow_id FROM workflow_execution_targets WHERE connection_id=?)').all(cid,cid).map(row=>row.id));
    const reset=db.prepare("UPDATE workflows SET status='draft',test_version=NULL WHERE id=?"),revoke=db.prepare('UPDATE api_keys SET revoked_at=? WHERE workflow_id=? AND revoked_at IS NULL');
    const at=now();for(const wid of affected){reset.run(wid);revoke.run(at,wid);snapshots.clear(wid);}
    for(const active of controllers.values())if(active.connectionId===cid||affected.has(active.workflowId))active.controller.abort(Error('PERMISSION_REVOKED'));
  };
  const workflow=(wid)=>{const row=db.prepare('SELECT * FROM workflows WHERE id=?').get(wid);if(!row)fail('NOT_FOUND','Action not found.',404);return {...row,definition:unseal(row.payload)};};
  const safeConnection=(row)=>{const c=row.payload?{...row,...unseal(row.payload)}:row,mode=c.browser_mode??'isolated',linked=mode==='connected'&&engine.isOpen(c.id);return {id:c.id,name:c.name,url:c.url,status:c.status,access:c.access??'account',browser_mode:mode,browser_linked:linked,browser_workspace_id:c.browser_workspace_id,project_id:projects.projectId(c.id),project_shared:c.project_shared===true,display_status:mode==='connected'?(linked?'connected':c.status==='stopped'?'stopped':'tab_offline'):c.status,created_at:c.created_at,...mode==='connected'?engine.connectionHealth(c.id):{}};};
  const outputSummary=x=>({name:x.name,...x.media_type?{media_type:x.media_type}:{},type:x.type??'string',...x.coercion?{coercion:x.coercion}:{},required:x.required!==false,...x.nullable?{nullable:true}:{},...x.fields?{fields:x.fields.map(outputSummary)}:{},...x.items?{items:outputSummary(x.items)}:{},...x.minItems!==undefined?{minItems:x.minItems}:{},...x.maxItems!==undefined?{maxItems:x.maxItems}:{},...Object.fromEntries(outputConstraintKeys.filter(key=>x[key]!==undefined).map(key=>[key,x[key]])),...x.read_attribute?{read_attribute:x.read_attribute}:{}});
  const contractSummary=d=>({action_type:d.action_type??'custom',timeout_seconds:Math.round((d.timeout_ms??45000)/1000),effect:d.effect??'retrieval',inputs:d.inputs,outputs:d.outputs.map(outputSummary),steps:d.steps.map(x=>({op:x.op,parameter:x.parameter,...x.approval_required?{approval_required:true}:{},...x.path_parameter?{path_parameter:x.path_parameter}:{},...x.enabled===false?{enabled:false}:{}})),verifiers:d.verifiers});
  const publishedWorkflow=(wid,selectedRevision)=>{const w=workflow(wid),active=revisions.ensureLegacy(w),revision=selectedRevision===undefined?active:revisions.get(w,selectedRevision);if(selectedRevision!==undefined&&!revision)fail('REVISION_NOT_FOUND','The selected published revision was not found.',404);if(selectedRevision!==undefined&&(revision.test_version!==revision.version||revision.proof?.kind==='legacy_unverified'))fail('TEST_REQUIRED','This historical revision requires a verified publication before invocation.',409);return revision?{...w,version:revision.version,definition:revision.definition,revision:revision.revision,connection_config:revision.connection_config}:w;};
  const validDraftEvidence=(row,definition)=>{try{return snapshots.isTested({...row,definition},executionTargets.source({...row,definition}));}catch{return false;}};
  const safeWorkflow=(row)=>{const d=unseal(row.payload),active=revisions?.ensureLegacy(row),draftOpen=revisions?.isDraftOpen(row)??false;return {id:row.id,name:row.name,slug:row.slug,connection_id:row.connection_id,status:row.status,version:row.version,tested:row.test_version===row.version&&(!draftOpen||validDraftEvidence(row,d)),created_at:row.created_at,project_id:projects.workflowProjectId(row),...contractSummary(d),published_revision:active?.revision??null,draft_open:draftOpen,has_draft_changes:!!active&&active.version!==row.version,published_contract:active?{version:active.version,...contractSummary(active.definition)}:null};};
  const safeRun=(row)=>{const p=unseal(row.payload);return {id:row.id,workflow_id:row.workflow_id,status:row.status,created_at:row.created_at,updated_at:row.updated_at,...p,execution_status:row.status==='succeeded'?executionReceipt(row,p).status:executionStatus(p,row.status)};};
  let proxy;try{proxy=await createEgressProxy(origin);}catch(error){store.close();throw error;}
  let engine;try{engine=await browserEngineFactory(proxy,origin,{dataDir,store,onSession:async(source,state)=>{
    const current=connection(source.id);
    executionConnection(current,{connection_config:snapshotConnection(source)});
    if(current.status!=='connected')throw Error('AUTH_REQUIRED');
    saveConnection(current,{storageState:state.storageState});
  }});}catch(error){await proxy.close();store.close();throw error;}
  const stopRuns=(cid,reason='CONNECTION_STOPPED')=>{
    for(const [rid,r]of recordings)if(r.connectionId===cid)recordings.delete(rid);
    for(const item of acceptedOnConnection(cid)){const row=db.prepare('SELECT * FROM runs WHERE id=?').get(item.id);
      const status=reason==='CONNECTION_STOPPED'?'cancelled':'failed',payload=unseal(row.payload);
      finishRun(payload,status,row.created_at,runError(Error(reason),payload));
      persistRun(store,row.id,status,payload);
    }
    for(const active of controllers.values())if(active.connectionId===cid)active.controller.abort(Error(reason));
  };
  const browserWorkspaces=installBrowserWorkspaces(app,{store,dataDir,connection,saveConnection,fail,normalBrowserLauncher,recordings,closeConnection:cid=>engine.close(cid)});
  // Freeze legacy browser bindings only after the existing workspace migration.
  try{revisions=createWorkflowRevisions(store);snapshots=createRunSnapshots(store);}catch(error){await engine.closeAll();await proxy.close();store.close();throw error;}
  const mediaAssets=installMediaAssets(app,{store,origin});
  engine=installConnectedBrowser(app,{origin,store,mediaAssets,session,sessions,ownerCookie,connection,saveConnection,invalidate,recordings,fail,rate,stopRuns,browserWorkspaces,connectionBusy,isRecording,baseEngine:engine});
  installRevisionRoutes(app,{store,revisions,snapshots,workflow,connection,safeWorkflow,assertConnectionIdle,isRecording,fail});
  installWorkflowEditor(app,{store,executionConnectionFor:w=>executionTargets.source(w),revisions,snapshots,workflow,connection,safeWorkflow,assertConnectionIdle,isRecording,fail,origin});
  installResourceRemoval(app,{store,fail,controllers,removing});
  const sandbox=installSandbox(app);
  installExamplePortals(app);
  installExamples(app,{origin,store,fail,rate});
  installPublicExamples(app,{origin,store,fail,rate});
  const google=installGoogle(app,{origin,provider:googleProvider,ownerCookie,store,session,newSession,sessions,hash,passwordMatches,fail,rate});
  const browserProfiles=installBrowserProfiles(app,{store,engine,connection,recordings,fail,rate,saveConnection,invalidate,assertConnectionIdle,assertConnectionCurrent});
  installGoogleCompanion(app,{origin,store,sessions,ownerCookie,session,fail,rate,normalBrowserLauncher});
  recoverInterruptedRuns(store);
  projects=installProjects(app,{store,fail});
  installHealthRoutes(app,{store,workflow,revisions,fail});
  installWorkflowTemplates(app,{store,workflow,connection,projects,safeWorkflow,fail,rate,origin});
  executionTargets=installExecutionTargets(app,{store,workflow,connection,projects,revisions,snapshots,assertConnectionIdle,isRecording,fail,origin});
  managedProfiles=installManagedProfiles(app,{store,connection,saveConnection,engine,assertConnectionIdle,isRecording,connectionBusy,invalidate,fail});
  installLocatorRepair(app,{store,workflow,executionConnectionFor:w=>executionTargets.source(w),connection,engine,revisions,snapshots,safeWorkflow,assertConnectionIdle,isRecording,fail,rate,origin});
  const approvals=createRunApprovals({store,fail});
  installApprovalInbox(app,{store,fail});
  const changeReview=(w,c)=>{const active=revisions.resolve(w);return active?compareWorkflowChanges({before:active.definition,after:w.definition,beforeConnection:active.connection_config,afterConnection:snapshotConnection(c)}):null;};
  const permissionReview=w=>{
    const current=w.connection_config?connection(w.connection_config.id):executionTargets.source(w),c=w.connection_config?{...current,...w.connection_config}:current;
    let unchanged=true;if(w.connection_config)try{executionConnection(current,{connection_config:w.connection_config});}catch{unchanged=false;}
    return {...workflowPermissions(w,{...c,available:unchanged&&current.status==='connected'&&(c.browser_mode!=='connected'||engine.isOpen(c.id))}),changes:changeReview(w,c)};
  };
  const permissionsFor=w=>publicWorkflowPermissions(w,w.connection_config??executionTargets.source(w));
  app.get('/studio/workflows/:wid/permissions',async req=>{
    const scope=parse(z.enum(['draft','published']).default('draft'),req.query.scope);
    return permissionReview(scope==='published'?publishedWorkflow(req.params.wid):workflow(req.params.wid));
  });
  app.post('/studio/runs/:rid/approval',async req=>approvals.decide(req.params.rid,req.body));
  const startedAt=now();let lastDispatchAt=null;
  app.get('/health',async(_,reply)=>{if(closing)reply.code(503);return {status:closing?'stopping':'ok',product:'hermo',mode:'local',runtime_version:'0.1.0',started_at:startedAt,uptime_seconds:Math.floor((Date.now()-Date.parse(startedAt))/1000),dashboard_required:false,browser_required:true};});
  const runtimeHealth=req=>({status:closing?'stopping':'ready',mode:'local',dashboard_required:false,browser_required:true,started_at:startedAt,last_dispatch_at:lastDispatchAt,queue_limit:30,concurrency:1,queue_depth:db.prepare("SELECT count(*) n FROM runs WHERE status='queued'").get().n,active_runs:controllers.size,authorization_expires_at:new Date(session(req).expires).toISOString(),companion_version:'0.7.10'});
  app.get('/studio/session',async(req,reply)=>{const s=session(req)??newSession(reply,false);return {authenticated:s.authenticated,setup_required:!getSetting('owner_password'),csrf:s.csrf,origin,google:google.status(s.authenticated)};});
  app.post('/studio/setup',async(req,reply)=>{
    rate('setup',5,900000);if(getSetting('owner_password'))fail('ALREADY_CONFIGURED','This workspace already has an owner.',409);
    const {password}=parse(z.object({password:z.string().min(12).max(128)}).strict(),req.body);
    const encoded=await passwordHash(password);
    if(getSetting('owner_password'))fail('ALREADY_CONFIGURED','This workspace already has an owner.',409);
    setSetting('owner_password',encoded);sessions.delete(hash(req.cookies[ownerCookie]??''));audit('workspace.created');const s=newSession(reply,true);return {authenticated:true,csrf:s.csrf};
  });
  app.post('/studio/login',async(req,reply)=>{
    rate('login',5,900000);const {password}=parse(z.object({password:z.string().min(1).max(128)}).strict(),req.body);
    const stored=getSetting('owner_password');if(!stored||!await passwordMatches(password,stored))fail('INVALID_CREDENTIALS','The workspace password is incorrect.',401);
    sessions.delete(hash(req.cookies[ownerCookie]??''));const s=newSession(reply,true);audit('workspace.unlocked');return {authenticated:true,csrf:s.csrf};
  });
  app.post('/studio/logout',async(req,reply)=>{const owner=hash(req.cookies[ownerCookie]??'');google.forget(owner);sessions.delete(owner);recordings.clear();await engine.closeStudios();reply.clearCookie(ownerCookie,{path:'/studio'});return {ok:true};});
  app.get('/studio/overview',async(req)=>{
    const scope=projects.scope(req.query.project_id);
    const scopedWorkflows=new Set(scope.workflows.map(w=>w.id));
    const allRuns=db.prepare('SELECT * FROM runs ORDER BY created_at DESC').all().filter(r=>scopedWorkflows.has(r.workflow_id));
    const runs=allRuns.slice(0,100).map(safeRun);
    const statuses=new Map(allRuns.map(row=>[row.id,executionReceipt(row,unseal(row.payload)).status]));
    const totals={total:allRuns.length,verified:allRuns.filter(r=>statuses.get(r.id)==='succeeded').length,failed:allRuns.filter(r=>statuses.get(r.id)==='failed').length,uncertain:allRuns.filter(r=>statuses.get(r.id)==='uncertain').length,timed_out:allRuns.filter(r=>statuses.get(r.id)==='timed_out').length,cancelled:allRuns.filter(r=>statuses.get(r.id)==='cancelled').length,active:allRuns.filter(r=>activeRunStatuses.includes(r.status)).length};
    const dates=Array.from({length:7},(_,i)=>new Date(Date.now()-(6-i)*86400000).toISOString().slice(0,10));
    const stats=dates.map(day=>({day,runs:allRuns.filter(r=>r.created_at.startsWith(day)).length,verified:allRuns.filter(r=>r.created_at.startsWith(day)&&statuses.get(r.id)==='succeeded').length}));
    return {projects:projects.list(),project_id:scope.project.id,connections:scope.connections.map(safeConnection),workflows:scope.workflows.map(safeWorkflow),runs,keys:db.prepare('SELECT id,name,suffix,workflow_id,expires_at,revoked_at,created_at FROM api_keys ORDER BY created_at DESC').all().filter(key=>scopedWorkflows.has(key.workflow_id)),totals,chart:dates.map(day=>({day,...stats.find(s=>s.day===day)??{runs:0,verified:0}})),runtime:runtimeHealth(req),settings:{retention_days:Number(getSetting('retention_days')??7),encryption:process.platform==='win32'?'AES-256-GCM · Windows DPAPI':'AES-256-GCM · external master key',network:'Loopback only',telemetry:false}};
  });
  app.post('/studio/connections',async(req)=>{
    rate('connections',10);
    const body=parse(z.object({project_id:z.string().max(100).optional(),name:text,url:z.string().max(2048),extra_origins:z.array(z.string().max(500)).max(31).default([]),access:z.enum(['account','public']).default('account'),browser_profile_id:z.string().max(80).optional(),browser_mode:z.enum(['isolated','connected']).default('isolated'),browser_workspace_id:z.string().max(80).optional(),authorized:z.literal(true)}).strict(),req.body);
    projects.assertAssignable(body.project_id);
    if(body.browser_profile_id&&body.browser_mode==='connected')fail('INVALID_REQUEST','A connected Chrome tab uses its own session and cannot import a Google profile.');
    if(body.browser_profile_id&&body.access==='public')fail('PUBLIC_PROFILE_BLOCKED','Public sources always use an anonymous browser.');
    const profile=body.browser_profile_id?browserProfiles.get(body.browser_profile_id):null;
    const browser=body.browser_workspace_id?browserWorkspaces.get(body.browser_workspace_id):body.browser_mode==='connected'?(browserWorkspaces.list().find(b=>b.kind==='current')??browserWorkspaces.create('My Chrome browser','current')):null;
    if(body.browser_mode==='isolated'&&browser)fail('INVALID_REQUEST','Saved Chrome browsers use the companion connection.');
    let url,origins;try{url=validateWebsite(body.url,origin);if(url.search&&body.browser_mode!=='connected')fail('INVALID_URL','Anonymous browser entry URLs do not support query parameters.');origins=[url.origin];for(const value of [...body.extra_origins,...profile?googleBrowserOrigins:[]]){const u=validateWebsite(value,origin);if(u.origin===origin&&url.origin!==origin)throw new Error('A public website cannot access the local sandbox.');if(u.origin!==origin)await publicAddress(u.hostname);origins.push(u.origin);}if(url.origin!==origin)await publicAddress(url.hostname);}catch(e){if(e.publicCode)throw e;fail('INVALID_URL',e.message);}
    origins=[...new Set(origins)];if(origins.length>32)fail('ORIGIN_LIMIT','Up to 32 exact origins are supported per connection.');
    if(browser)browserWorkspaces.get(browser.id);
    const cid=id('conn'),payload={url:url.href,origins,access:body.access,browser_mode:body.browser_mode,...browser?{browser_workspace_id:browser.id}:{},...profile?{browser_profile_id:profile.id,studioState:{storageState:profile.storageState,checkpoint:url.href}}:{}};
    db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?)').run(cid,body.name,url.href,'auth_required',seal(payload),now());projects.assign(cid,body.project_id);audit('connection.created',cid);
    return {connection:safeConnection(connection(cid))};
  });
  app.post('/studio/connections/:cid/open',async(req)=>{const c=connection(req.params.cid),options=parse(z.object({resume:z.boolean().default(false)}).strict().default({resume:false}),req.body);assertConnectionIdle(c.id);try{await engine.open(c.id,c,options);}catch(error){if(c.browser_mode==='connected')fail('BROWSER_LINK_REQUIRED','Connect this website tab using the browser companion. Keep its connected website tab open and Hermo unlocked.',409);if(error.message==='BROWSER_INSTALLATION_REQUIRED')fail('BROWSER_INSTALLATION_REQUIRED','Install Chromium with npx playwright install chromium, or configure HERMO_BROWSER_PATH to a trusted Chrome or Edge executable, then restart Hermo.',422);if(error.code==='MANAGED_PROFILE_STORAGE_INVALID')fail('MANAGED_PROFILE_STORAGE_INVALID','The managed profile could not be restored safely. Check disk space, profile limits and runtime-directory permissions before retrying.',422);if(error.code==='MANAGED_PROFILE_BUSY'||error.message==='BROWSER_BUSY')fail('BROWSER_BUSY','This managed session is already in use. Finish its browser operation before reopening it.',409);fail('BROWSER_UNAVAILABLE','The page could not open. Check the URL, allowed origins, and network.',422);}return {ok:true};});
  app.get('/studio/connections/:cid/browser',async(req)=>{const c=connection(req.params.cid);engine.allowOrigins(c.id,c.origins);try{return await engine.snapshot(req.params.cid);}catch(error){if(error.message==='BROWSER_BUSY')fail('BROWSER_BUSY','Wait for the current browser operation.',409);if(c.browser_mode==='connected'){const messages={PAGE_READ_FAILED:'Hermo could not inspect this page. Reload the updated browser companion in chrome://extensions, then pair the website tab again.',PERMISSION_REVOKED:'Chrome did not grant access to the selected website tab. Open the Hermo companion on that website tab again, then choose Refresh preview.',TAB_CLOSED:'The selected website tab was closed. Open it and pair that tab again.',POLICY_BLOCKED:'The website left the selected origin. Finish sign-in yourself, return to the selected website and open the companion there again.',TIMEOUT:'The selected website did not respond in time. Check its tab and retry.'};fail('BROWSER_TAB_UNAVAILABLE',messages[error.message]??'Keep the connected website tab open and Hermo unlocked. Complete sign-in or verification in the selected website tab, then refresh; pair again if the link ended.',422);}if(!engine.isOpen(req.params.cid))fail('BROWSER_CLOSED','The private browser was closed. Reopen it to continue.',409);fail('BROWSER_PREVIEW_FAILED','The browser is still open, but its preview could not refresh. Retry the preview or use the desktop window.',422);}});
  app.post('/studio/connections/:cid/interact',async(req)=>{
    const c=connection(req.params.cid);rate('browser-input',120);
    assertConnectionIdle(c.id);
    const coordinate=z.number().finite().min(0),body=parse(z.discriminatedUnion('op',[
        z.object({op:z.enum(['reload','back','forward','retry','home'])}).strict(),
      z.object({op:z.literal('click'),x:coordinate.max(1099),y:coordinate.max(719)}).strict(),
      z.object({op:z.literal('scroll'),delta:z.number().int().min(-2000).max(2000),x:coordinate.max(1099).optional(),y:coordinate.max(719).optional(),point:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1)}).strict().optional()}).strict(),
      z.object({op:z.literal('type'),value:z.string().min(1).max(4096)}).strict(),
      z.object({op:z.literal('press'),key:z.enum(['Enter','Tab','Escape','Backspace','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Space'])}).strict(),
      z.object({op:z.literal('tab'),tab_id:z.string().max(10)}).strict()
    ]),req.body);
    if(body.op!=='scroll'&&[...recordings.values()].some(r=>r.connectionId===req.params.cid))fail('USE_RECORDED_CONTROLS','Use detected controls while recording so each action can be replayed.',409);
    try{if(['retry','reload'].includes(body.op))engine.allowOrigins(c.id,c.origins);await engine.interact(req.params.cid,body);}catch{fail('BROWSER_ACTION_FAILED','The browser action did not complete. Check the live page and its network diagnostics.',422);}return {ok:true};
  });
    app.post('/studio/connections/:cid/desktop',async(req)=>{
      const c=connection(req.params.cid);parse(z.object({}).strict(),req.body);rate('desktop-browser',5);
      if(c.browser_mode!=='connected')assertConnectionIdle(c.id);
      if(c.browser_mode!=='connected'&&[...recordings.values()].some(r=>r.connectionId===req.params.cid))fail('RECORDING_ACTIVE','Finish or discard the recording before switching browsers.',409);
      try{await engine.open(c.id,c,{resume:true});await engine.openDesktop(c.id);}catch{if(c.browser_mode==='connected')fail('BROWSER_TAB_UNAVAILABLE','The selected Chrome tab is unavailable. Keep the website tab open, unlock Hermo, and pair again if needed.',422);fail('DESKTOP_UNAVAILABLE','The desktop browser could not open. Reopen the private browser and try again. A trusted Chrome or Edge installation is required.',422);}return {ok:true};
    });
  app.post('/studio/connections/:cid/close',async(req)=>{connection(req.params.cid);parse(z.object({}).strict(),req.body);if([...recordings.values()].some(r=>r.connectionId===req.params.cid))fail('RECORDING_ACTIVE','Finish or discard the recording first.',409);await engine.close(req.params.cid);return {ok:true};});
  app.post('/studio/connections/:cid/origins',async(req)=>{
    const c=connection(req.params.cid),body=parse(z.object({origins:z.array(z.string().max(500)).min(1).max(31),authorized:z.literal(true)}).strict(),req.body);
    assertConnectionIdle(c.id);
    if([...recordings.values()].some(r=>r.connectionId===c.id))fail('RECORDING_ACTIVE','Finish or discard recording before changing network permissions.',409);
    const additions=[];try{for(const value of body.origins){const u=validateWebsite(value,origin);if(u.origin===origin&&new URL(c.url).origin!==origin)throw new Error('A public website cannot access the local sandbox.');if(u.origin!==origin)await publicAddress(u.hostname);additions.push(u.origin);}}catch(e){fail('INVALID_ORIGIN',e.message);}
    assertConnectionIdle(c.id);
    const origins=[...new Set([...c.origins,...additions])];if(origins.length>32)fail('ORIGIN_LIMIT','Up to 32 exact origins are supported per connection.');
    if(origins.length===c.origins.length){engine.allowOrigins(c.id,origins);return {ok:true,origins};}
    saveConnection(c,{origins});
    db.prepare("UPDATE workflows SET status='draft',test_version=NULL WHERE connection_id=?").run(c.id);
    db.prepare('UPDATE api_keys SET revoked_at=? WHERE workflow_id IN (SELECT id FROM workflows WHERE connection_id=?) AND revoked_at IS NULL').run(now(),c.id);
    for(const active of controllers.values())if(active.connectionId===c.id)active.controller.abort(Error('PERMISSION_REVOKED'));
    engine.allowOrigins(c.id,origins);audit('connection.origins_approved',c.id);return {ok:true,origins,retest_required:true};
  });
  app.post('/studio/connections/:cid/preview-target',async req=>{
    const c=connection(req.params.cid);assertConnectionIdle(c.id);rate('browser-input',120);
    const body=parse(z.object({frame_id:z.string().uuid(),x:z.number().min(0).max(1),y:z.number().min(0).max(1)}).strict(),req.body);
    if(c.browser_mode!=='connected')fail('NORMAL_BROWSER_REQUIRED','Use a connected Chrome tab for live preview interaction.',409);
    try{return await engine.previewTarget(c.id,body);}catch(error){fail(error.message==='COMPANION_UPDATE_REQUIRED'?'COMPANION_UPDATE_REQUIRED':'PREVIEW_CHANGED',error.message==='COMPANION_UPDATE_REQUIRED'?'Reload companion 0.7.8 and reconnect this tab to interact with its preview.':'The preview changed or this point has no supported control. Refresh it and try again, or use the detected controls.',409);}
  });
  app.post('/studio/connections/:cid/control',async(req)=>{
    const c=connection(req.params.cid);const body=parse(z.object({element_id:z.string(),kind:z.enum(['fill','click','select','check']),value:z.string().max(4096).optional(),recording_id:z.string().optional(),parameter:fieldName.optional(),preview_guard:z.object({frame_id:z.string().uuid(),target_id:z.string().uuid(),x:z.number().min(0).max(1),y:z.number().min(0).max(1)}).strict().optional()}).strict(),req.body);
    if(body.preview_guard&&(c.browser_mode!=='connected'||body.kind!=='click'))fail('INVALID_REQUEST','Preview guards apply only to connected website clicks.');
    assertConnectionIdle(c.id);
    let item;try{item=engine.element(c.id,body.element_id,{fill:'input',click:'button',select:'select',check:'check'}[body.kind]);}catch{fail('ELEMENT_CHANGED','Refresh the browser preview and try again.',409);}
    const recording=body.recording_id&&recordings.get(body.recording_id);
    if(body.recording_id&&(!recording||recording.connectionId!==c.id))fail('NOT_FOUND','Recording not found.',404);
      if(!recording&&[...recordings.values()].some(r=>r.connectionId===c.id))fail('USE_RECORDED_CONTROLS','Use the active recording controls so each action can be replayed.',409);
    if(recording&&item.type==='password')fail('SECRET_BLOCKED','Passwords are only accepted while connecting, never in recorded actions.',403);
    if(body.kind!=='click'&&body.value===undefined)fail('INVALID_REQUEST','Enter a value for this control.');
    if(body.kind==='check'&&!['true','false'].includes(body.value))fail('INVALID_REQUEST','A checkbox value must be true or false.');
    if(body.kind==='click'&&body.parameter)fail('INVALID_REQUEST','Only field values can be API parameters.');
    if(recording&&recording.steps.length>=12)fail('STEP_LIMIT','This MVP supports at most twelve steps per action.');
    try{await engine.operate(c.id,item,body.kind,body.value,body.preview_guard);}catch{fail('ACTION_UNAVAILABLE','The control changed, is disabled, or could not complete. Refresh and try again.',422);}
    if(recording){const step={op:body.kind,selector:item.selector,frame_path:item.frame_path,...body.kind!=='click'?(body.parameter?{parameter:body.parameter}:{value:body.value}):{}};recording.steps.push(step);if(body.parameter)recording.inputs[body.parameter]={type:'string',example:body.value};}
    return {ok:true,steps:recording?.steps.length};
  });
  app.post('/studio/connections/:cid/demo-login',async(req)=>{const c=connection(req.params.cid);assertConnectionIdle(c.id);try{await engine.demoLogin(c.id);}catch{fail('SIGN_IN_FAILED','The sandbox sign-in did not complete.',422);}return {ok:true};});
  app.post('/studio/connections/:cid/confirm',async(req)=>{
    const c=connection(req.params.cid);const {element_id,public_source,expected_text}=parse(z.object({element_id:z.string().optional(),public_source:z.literal(true).optional(),expected_text:z.string().min(1).max(600).optional()}).strict(),req.body);
    if(c.browser_mode!=='connected')assertConnectionIdle(c.id);
    if(c.browser_mode==='connected'){
      if(!engine.isOpen(c.id))fail('AUTH_REQUIRED','Connect the website tab before continuing.',409);
      // Compatibility acknowledgment only: pairing already authorizes this exact tab.
      // Do not pin profile text or revoke tested actions when the website account changes.
      saveConnection(c,{identity:{kind:'selected_tab',origin:new URL(c.url).origin}},'connected');
      engine.statusChanged?.(c.id);return {ok:true};
    }
      const current=await engine.snapshot(c.id);if(!current.can_confirm)fail('CONNECTION_NOT_READY','Finish login and resolve verification or network errors before confirming an account.',409);
    if(c.access==='public'){
      if(!public_source||element_id||expected_text)fail('INVALID_REQUEST','Confirm the public source instead of an account marker.');
      const saved=await engine.save(c.id),source=new URL(saved.checkpoint).origin;
      if(source!==new URL(c.url).origin)fail('SOURCE_CHANGED','Return to the public website before confirming it.',409);
      saveConnection(c,{...saved,identity:{kind:'public_origin',origin:source}},'connected');engine.statusChanged?.(c.id);audit('connection.public_source_confirmed',c.id);return {ok:true};
    }
    if(!element_id||public_source)fail('INVALID_REQUEST','Select an account marker.');
    if(['accounts.google.com','myaccount.google.com'].includes(new URL(current.url).hostname)&&new URL(current.url).origin!==new URL(c.url).origin)fail('RETURN_TO_APP','Finish Google sign-in, return to the original app, and select that app account marker.',409);
    let item,text,saved;try{item=engine.element(c.id,element_id,'output');text=await engine.read(c.id,item);saved=await engine.save(c.id);}catch{fail('IDENTITY_UNAVAILABLE','Select a visible, stable account identity marker.',422);}
    if(expected_text!==undefined&&text!==expected_text)fail('ACCOUNT_CHANGED','The visible account changed. Select its current name or email again before confirming.',409);
    if(!text||text.length>300)fail('IDENTITY_UNAVAILABLE','Choose a short account identity marker.');
    if(item.identity_eligible===false||invalidAccountMarker(text))fail('INVALID_ACCOUNT_MARKER','Choose your account name or email. Navigation text such as New chat cannot identify an account.',422);
    if(c.identity&&c.identity.text!==text){db.prepare('UPDATE api_keys SET revoked_at=? WHERE workflow_id IN (SELECT id FROM workflows WHERE connection_id=?)').run(now(),c.id);db.prepare("UPDATE workflows SET status='draft',test_version=NULL WHERE connection_id=?").run(c.id);}
    saveConnection(c,{...saved,studioState:undefined,identity:{selector:item.selector,frame_path:item.frame_path,text}},'connected');engine.statusChanged?.(c.id);audit('connection.confirmed',c.id);return {ok:true};
  });
  app.post('/studio/connections/:cid/browser-workspace',async req=>{
    const c=connection(req.params.cid),body=parse(z.object({browser_workspace_id:z.string().max(80),authorized:z.literal(true)}).strict(),req.body);
    browserWorkspaces.get(body.browser_workspace_id);
    if(c.browser_mode!=='connected')fail('INVALID_REQUEST','Saved browsers are used with normal Chrome connections.');
    if([...recordings.values()].some(r=>r.connectionId===c.id)||db.prepare("SELECT count(*) n FROM runs WHERE workflow_id IN (SELECT id FROM workflows WHERE connection_id=?) AND status IN ('queued','running','verifying')").get(c.id).n)fail('BROWSER_BUSY','Finish or stop this app before changing its browser.',409);
    await engine.close(c.id);saveConnection(connection(c.id),{browser_workspace_id:body.browser_workspace_id},'stopped');audit('connection.browser_changed',c.id);return {ok:true};
  });
  app.post('/studio/connections/:cid/stop',async req=>{const c=connection(req.params.cid);parse(z.object({}).strict(),req.body);stopRuns(c.id);await engine.close(c.id);saveConnection(connection(c.id),{},'stopped');audit('connection.stopped',c.id);return {ok:true};});
  app.post('/studio/connections/:cid/disconnect',async(req)=>{
    const c=connection(req.params.cid),body=parse(z.object({confirmation:z.string().optional()}).strict(),req.body);if(body.confirmation!==undefined&&body.confirmation!==`Delete "${c.name}"`)fail('CONFIRMATION_REQUIRED','Type the exact confirmation shown before removing this account.');
    for(const [rid,r]of recordings)if(r.connectionId===c.id)recordings.delete(rid);
    await engine.close(c.id);engine.forgetProfile?.(c.id);saveConnection(connection(c.id),{storageState:undefined,studioState:undefined,checkpoint:undefined,identity:undefined,browser_profile_id:undefined,session_generation:id('session')},'auth_required');
    db.prepare('UPDATE api_keys SET revoked_at=? WHERE workflow_id IN (SELECT id FROM workflows WHERE connection_id=?) AND revoked_at IS NULL').run(now(),c.id);
    db.prepare("UPDATE workflows SET status='draft',test_version=NULL WHERE connection_id=?").run(c.id);
    for(const [rid,active]of controllers)if(active.connectionId===c.id)active.controller.abort(Error('CONNECTION_STOPPED'));audit('connection.disconnected',c.id);return {ok:true};
  });
  app.post('/studio/connections/:cid/remove',async req=>{
    const c=connection(req.params.cid),body=parse(z.object({authorized:z.literal(true),confirmation:z.string().optional()}).strict(),req.body);if(body.confirmation!==undefined&&body.confirmation!==`Delete "${c.name}"`)fail('CONFIRMATION_REQUIRED','Type the exact confirmation shown before deleting this connection.');
    if(removing.has(c.id))fail('CONNECTION_REMOVING','This connection is already being removed.',409);
    if([...controllers.values()].some(active=>active.connectionId===c.id)||db.prepare("SELECT r.id FROM runs r JOIN workflows w ON w.id=r.workflow_id WHERE w.connection_id=? AND r.status IN ('queued','running','verifying') LIMIT 1").get(c.id))fail('CONNECTION_BUSY','Cancel or finish this connection’s active runs before removing it.',409);
    executionTargets.assertRemovable(c.id);
    removing.add(c.id);
    try{
      await engine.close(c.id);for(const [rid,value]of recordings)if(value.connectionId===c.id)recordings.delete(rid);
      db.exec('BEGIN IMMEDIATE');
      try{
        db.prepare('DELETE FROM runs WHERE workflow_id IN (SELECT id FROM workflows WHERE connection_id=?)').run(c.id);
        db.prepare('DELETE FROM api_keys WHERE workflow_id IN (SELECT id FROM workflows WHERE connection_id=?)').run(c.id);
        db.prepare('DELETE FROM workflows WHERE connection_id=?').run(c.id);
        engine.forgetProfile?.(c.id);db.prepare('DELETE FROM connections WHERE id=?').run(c.id);
        audit('connection.removed',c.id);db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      return {ok:true};
    }finally{removing.delete(c.id);}
  });
  app.post('/studio/recordings',async(req)=>{
    const body=parse(z.object({connection_id:z.string(),name:text,slug:slugSchema,action_type:z.enum(['chat','generate_media','read','read_data','search_extract','submit_form','custom']).default('custom')}).strict(),req.body),c=connection(body.connection_id);
    assertConnectionIdle(c.id);
    if(c.status!=='connected')fail('AUTH_REQUIRED','Connect the website before recording.',409);
    if(db.prepare('SELECT id FROM workflows WHERE slug=?').get(body.slug))fail('SLUG_EXISTS','Choose a unique action name.',409);
    if(isRecording(c.id))fail('RECORDING_ACTIVE','Finish or discard the existing recording.',409);
    recordingStarts.add(c.id);
    try{
      await engine.open(c.id,c);if(c.browser_mode==='connected'&&!(await engine.snapshot(c.id)).can_confirm)fail('CONNECTION_NOT_READY','Complete website sign-in or verification in the selected tab before recording.',409);
      if(connection(c.id).status!=='connected')fail('CONNECTION_STOPPED','The connection ended while recording was starting.',409);
      const rid=id('rec'),continuePage=c.browser_mode==='connected'||['read','read_data'].includes(body.action_type);
      recordings.set(rid,{connectionId:c.id,name:body.name,slug:body.slug,action_type:body.action_type,steps:continuePage?[]:[{op:'navigate',url:c.checkpoint}],inputs:{},outputs:[],created:Date.now()});return {id:rid};
    }finally{recordingStarts.delete(c.id);}
  });
  app.post('/studio/recordings/:rid/output',async(req)=>{
    const recording=recordings.get(req.params.rid);if(!recording)fail('NOT_FOUND','Recording not found.',404);
    const body=parse(z.object({element_id:z.string().optional(),source:z.literal('url_parameter').optional(),name:fieldName}).strict(),req.body);
    if(recording.outputs.some(o=>o.name===body.name)||recording.outputs.length>=8)fail('OUTPUT_LIMIT','Use a unique output name; up to eight outputs are supported.');
    if(body.source){if(body.element_id)fail('INVALID_REQUEST','Choose one output source.');const step=recording.steps.findLast(s=>s.path_parameter===body.name);if(!step)fail('INVALID_REQUEST','Bind a page parameter before capturing its verified URL value.');recording.outputs.push({name:body.name,source:'url_parameter',template:step.template,parameter:body.name});return {outputs:recording.outputs.map(o=>({name:o.name}))};}
    if(!body.element_id)fail('INVALID_REQUEST','Choose an output element.');
    let item;try{item=engine.element(recording.connectionId,body.element_id,'output');}catch{fail('ELEMENT_CHANGED','Refresh the preview and choose the output again.',409);}
    const mediaType={image_url:'image',video_url:'video',audio_url:'audio',download_url:'file'}[item.type];
    recording.outputs.push({name:body.name,...mediaType?{type:'url',media_type:mediaType}:{},selector:item.selector,frame_path:item.frame_path,...item.read_mode?{read_mode:item.read_mode}:{},...item.read_attribute?{read_attribute:item.read_attribute}:{}});return {outputs:recording.outputs.map(o=>({name:o.name,...o.read_attribute?{read_attribute:o.read_attribute}:{}}))};
  });
  app.post('/studio/recordings/:rid/discard',async(req)=>{recordings.delete(req.params.rid);return {ok:true};});
  app.post('/studio/recordings/:rid/navigate',async(req)=>{
    const recording=recordings.get(req.params.rid);if(!recording)fail('NOT_FOUND','Recording not found.',404);
    const body=parse(z.object({template:z.string().max(2048),parameter:fieldName,example:z.string().max(120)}).strict(),req.body);
    if(recording.steps.length>=12)fail('STEP_LIMIT','Up to twelve steps are supported.');
    let target;try{target=pageTemplate(body.template,body.parameter,body.example);validateWebsite(target.url,origin);}catch{fail('INVALID_PAGE_TEMPLATE','Use one parameter as a complete public HTTPS path segment.');}
    const c=connection(recording.connectionId);if(!c.origins.includes(target.origin))fail('POLICY_BLOCKED','Approve the exact website origin first.',403);
    if(Object.hasOwn(recording.inputs,body.parameter))fail('INPUT_EXISTS','Use a new page parameter.');
    try{await engine.navigate(c.id,target.url);}catch{fail('PAGE_UNAVAILABLE','The page did not load. Check its URL and website status.',422);}
    recording.steps.push({op:'navigate',url:target.url,template:body.template,path_parameter:body.parameter});recording.inputs[body.parameter]={type:'string',example:body.example,pattern:'^[A-Za-z0-9_-]{1,120}$'};return {ok:true,steps:recording.steps.length};
  });
  app.post('/studio/recordings/:rid/finish',async(req)=>{
    const recording=recordings.get(req.params.rid);if(!recording)fail('NOT_FOUND','Recording not found.',404);
    const {verifiers,timeout_seconds}=parse(z.object({verifiers:z.array(verifierSchema).min(1).max(8),timeout_seconds:z.number().int().min(15).max(300).optional()}).strict(),req.body);
    if(!recording.outputs.length)fail('INCOMPLETE_ACTION','Choose at least one output.');
    const mediaError=mediaOutputError(recording);if(mediaError)fail('MEDIA_OUTPUT_REQUIRED',mediaError);
    if(recording.action_type==='chat'&&(!Object.keys(recording.inputs).length||!recording.steps.some(s=>s.op==='click')))fail('INCOMPLETE_ACTION','Record a message input, submit control, and reply outputs.');
    if(['generate_media','submit_form'].includes(recording.action_type)&&!recording.steps.some(s=>s.op==='click'))fail('INCOMPLETE_ACTION','Record the website submit or generate control and select its result.');
    if(!validateVerifiers(verifiers,recording.outputs,recording.inputs)||!validateCompletionPolicy({...recording,verifiers}))fail('INVALID_VERIFIER','Choose a recorded output and input to verify.');
    if(['search_extract','submit_form'].includes(recording.action_type)&&recording.steps.some(step=>['fill','select','check','click'].includes(step.op))&&recording.outputs.some(output=>!verifiers.some(rule=>rule.output===output.name&&['changed','equals_input','completion'].includes(rule.kind??'equals_input'))&&!verifiers.some(rule=>rule.kind==='completion'&&rule.evidence===output.name)))fail('FRESH_RESULT_REQUIRED','Request results require a changed result, explicit completion evidence or a match to their requested input. Text presence alone cannot confirm a new submission.',409);
    const source=connection(recording.connectionId),chat=source.browser_mode==='connected'&&new URL(source.url).origin==='https://chatgpt.com'&&recording.inputs.prompt&&!recording.inputs.prompt.pattern&&recording.outputs.some(x=>x.name==='prompt_echo')&&recording.outputs.some(x=>x.name==='response')&&verifiers.some(x=>x.output==='prompt_echo'&&x.input==='prompt');
    const wid=id('wf'),definition={steps:assignStepIds(recording.steps),inputs:chat?chatPromptInputs(recording.inputs):recording.inputs,outputs:recording.outputs,verifiers,action_type:recording.action_type??'custom',timeout_ms:(timeout_seconds??(recording.action_type==='generate_media'?180:45))*1000,effect:(source.browser_mode==='connected'||['submit_form','generate_media'].includes(recording.action_type))&&recording.steps.some(s=>s.op!=='navigate')?'recorded_browser_actions':'retrieval'};definition.version=hash(JSON.stringify(definition));
    db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,recording.connectionId,recording.name,recording.slug,'draft',definition.version,seal(definition),null,now());recordings.delete(req.params.rid);audit('action.drafted',wid);return {workflow:safeWorkflow(db.prepare('SELECT * FROM workflows WHERE id=?').get(wid))};
  });
  function validateInput(w,input){return parse(workflowInputSchema(w.definition.inputs),input);}
  function enqueue(w,input,consumerId,idem,expectedRevision,requestedRevision){
    if(removing.has(w.connection_id))fail('CONNECTION_REMOVING','This connection is being removed.',409);
    const existing=db.prepare('SELECT * FROM runs WHERE consumer_id=? AND workflow_id=? AND idem=?').get(consumerId,w.id,idem);
    const requestHashFor=value=>hash(JSON.stringify(Object.keys(value).sort().map(k=>[k,canonicalInput(value[k])])));
    if(existing){
      const saved=snapshots.get(existing.id),original=saved?{...w,definition:saved.definition}:w;
      if(requestedRevision!==undefined&&(saved?.workflow_revision??unseal(existing.payload).workflow_revision)!==requestedRevision)fail('IDEMPOTENCY_REVISION_CONFLICT','This request identifier belongs to a different immutable revision. Recover that receipt or use a new identifier for an explicitly new execution.',409);
      let normalized;try{normalized=validateInput(original,input);}catch{fail('IDEMPOTENCY_CONFLICT','This idempotency key belongs to a different input.',409);}
      if(existing.request_hash!==requestHashFor(normalized))fail('IDEMPOTENCY_CONFLICT','This idempotency key belongs to a different input.',409);
      return {run_id:existing.id,status_url:`${origin}/v1/runs/${existing.id}`,reused:true};
    }
    if(expectedRevision!==undefined&&expectedRevision!==w.revision)fail('VERSION_CHANGED','The published contract changed. Reload the consumer contract before submitting a new request.',409);
    const mediaError=mediaOutputError(w.definition);if(mediaError)fail('MEDIA_OUTPUT_REQUIRED',mediaError,409);
    input=validateInput(w,input);const requestHash=requestHashFor(input);
    if(engine.isPairing(w.connection_id))fail('BROWSER_BUSY','Finish connecting the browser before running an API against it.',409);
    if(isRecording(w.connection_id))fail('RECORDING_ACTIVE','Finish or discard the current recording before running an API against this website.',409);
    let source=executionTargets.source(w);
    if(removing.has(source.id))fail('CONNECTION_REMOVING','The execution connection is being removed.',409);
    if(engine.isPairing(source.id)||isRecording(source.id)||managedProfiles.isChanging(source.id))fail('BROWSER_BUSY','Finish pairing, recording or updating the execution connection.',409);
    if(w.connection_config){try{source=executionConnection(source,w);}catch{fail('REVISION_PERMISSION_CHANGED','This revision no longer matches its browser permissions. Restore and retest it before publishing.',409);}}
    if(source.status==='stopped')fail('CONNECTION_STOPPED','Open this saved app and reconnect its website tab.',409);if(source.browser_mode==='connected'&&!engine.isOpen(source.id))fail('AUTH_REQUIRED','Connect this action’s selected Chrome tab before running it.',409);
    if(source.browser_mode!=='connected'&&source.access==='account'&&invalidAccountMarker(source.identity?.text))fail('ACCOUNT_MARKER_REQUIRED','Open this connection, select Account marker, choose your actual account name or email, and Confirm this account. Navigation text such as New chat cannot identify your account.',409);
    if(source.status!=='connected')fail('AUTH_REQUIRED','Reconnect this account before running the action.',409);
    if(db.prepare("SELECT count(*) n FROM runs WHERE status IN ('queued','running','verifying')").get().n>=30)fail('QUEUE_FULL','The local run queue is full.',429);
    const rid=id('run'),payload={run_id:rid,phase:'queued',input,workflow_version:w.version,workflow_revision:w.revision??null,execution_mode:source.browser_mode==='connected'?'connected_chrome':'managed_local',contract_version:w.definition.contract_version??'1',action:w.slug,progress:0};
    db.exec('BEGIN IMMEDIATE');try{
      db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run(rid,w.id,consumerId,idem,requestHash,'queued',seal(payload),now(),now());
      snapshots.save(rid,w,source,w.revision??null);audit('run.accepted',rid);db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return {run_id:rid,status_url:`${origin}/v1/runs/${rid}`,reused:false};
  }
  function issueKey(w,name){if(w.status!=='published')fail('NOT_PUBLISHED','Publish this action before creating a consumer key.',409);const secret='hm_live_'+randomBytes(32).toString('base64url'),kid=id('key');
    db.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?)').run(kid,name,hash(secret),secret.slice(-6),w.id,new Date(Date.now()+30*86400000).toISOString(),null,now());audit('key.created',kid);return {id:kid,key:secret,expires_at:new Date(Date.now()+30*86400000).toISOString()};}
  const inputBody=jsonInputSchema;
  app.post('/studio/workflows/:wid/test',async(req,reply)=>{rate('test',30);const w=workflow(req.params.wid),body=parse(z.object({input:inputBody}).strict(),req.body);reply.code(202);return enqueue(w,body.input,'studio',id('test'));});
  app.post('/studio/workflows/:wid/contract',async req=>{
    const w=workflow(req.params.wid);
    const parsed=z.object({expected_version:z.string().min(1).max(100),inputs:z.record(fieldName,inputFieldSchema),outputs:z.array(outputFieldSchema).min(1).max(8)}).strict().safeParse(req.body);
    if(!parsed.success)fail('INVALID_WORKFLOW_CONTRACT','Check the contract types, names, bounds and defaults. Only recorded field metadata can be changed.');
    const body=parsed.data;
    if(w.status!=='draft'&&!revisions.isDraftOpen(w))fail('DRAFT_REQUIRED','Open an editable draft before changing this contract. Published revisions remain unchanged.',409);
    if(body.expected_version!==w.version)fail('VERSION_CHANGED','This draft changed. Reopen it before editing its contract.',409);
    assertConnectionIdle(w.connection_id);
    if(isRecording(w.connection_id))fail('RECORDING_ACTIVE','Finish or discard the active demonstration before editing this contract.',409);
    if(JSON.stringify(Object.keys(body.inputs).sort())!==JSON.stringify(Object.keys(w.definition.inputs).sort())||body.outputs.length!==w.definition.outputs.length||new Set(body.outputs.map(field=>field.name)).size!==body.outputs.length||body.outputs.some(field=>!w.definition.outputs.some(existing=>existing.name===field.name)))fail('INVALID_WORKFLOW_CONTRACT','Keep the recorded input and output names. This editor changes types and validation only.');
    const inputs=Object.fromEntries(Object.entries(body.inputs).map(([name,field])=>{
      const previous=w.definition.inputs[name];
      if(previous.pattern&&field.pattern!==previous.pattern)fail('INVALID_WORKFLOW_CONTRACT','A recorded URL parameter must retain its safe path pattern.');
      return [name,field];
    }));
    const {version:previousVersion,...previous}=w.definition;
    let definition;
    try{definition=validateWorkflowContract({...previous,contract_version:'2',inputs,outputs:w.definition.outputs.map(field=>isBasicOutput(field)?{...field,...body.outputs.find(candidate=>candidate.name===field.name)}:field)});}
    catch{fail('INVALID_WORKFLOW_CONTRACT','Check the types, choices, bounds and defaults. URL parameters must remain required text; optional selections need defaults, and matched inputs must be available.');}
    definition.steps=assignStepIds(definition.steps);definition.version=hash(JSON.stringify(definition));
    db.prepare('UPDATE workflows SET payload=?,version=?,test_version=NULL WHERE id=?').run(seal(definition),definition.version,w.id);
    audit('action.contract_updated',w.id);
    return {workflow:safeWorkflow(db.prepare('SELECT * FROM workflows WHERE id=?').get(w.id))};
  });
  app.post('/studio/workflows/:wid/repair-chat',async req=>{
    parse(z.object({authorized:z.literal(true)}).strict(),req.body);const w=workflow(req.params.wid),c=connection(w.connection_id);
    if(w.status!=='draft'||w.definition.effect!=='recorded_browser_actions'||c.browser_mode!=='connected')fail('CHAT_REPAIR_NOT_READY','Only a draft recorded chat action can be repaired here.',409);
    if(c.status!=='connected'||!engine.isOpen(c.id))fail('AUTH_REQUIRED','Connect the website tab before repairing this action.',409);
    if([...recordings.values()].some(r=>r.connectionId===c.id)||db.prepare("SELECT count(*) n FROM runs WHERE workflow_id IN (SELECT id FROM workflows WHERE connection_id=?) AND status IN ('queued','running','verifying')").get(c.id).n)fail('BROWSER_BUSY','Finish the active recording or run before repairing this action.',409);
    const snapshot=await engine.snapshot(c.id);if(!snapshot.can_confirm)fail('CHAT_REPAIR_NOT_READY','Complete sign-in in the selected tab before repairing this action.',409);
    let definition;try{definition=repairChatDefinition(w.definition,snapshot.elements.map(item=>({...item,...engine.element(c.id,item.id)})),{url:snapshot.url});}catch{fail('CHAT_REPAIR_NOT_READY','Repair has not completed; verification would still use the old recording. The selected tab needs one message editor and the recording needs one semantic Send click. For other websites, supported latest-message outputs must also be visible or already recorded.',422);}
    const currentWorkflow=workflow(w.id),currentConnection=connection(c.id);
    if(currentWorkflow.status!=='draft'||currentWorkflow.version!==w.version||currentConnection.status!=='connected'||!engine.isOpen(c.id)||currentConnection.url!==c.url)fail('CHAT_REPAIR_NOT_READY','The action or website connection changed during repair. Review it and try again.',409);
    if([...recordings.values()].some(r=>r.connectionId===c.id)||db.prepare("SELECT count(*) n FROM runs WHERE workflow_id IN (SELECT id FROM workflows WHERE connection_id=?) AND status IN ('queued','running','verifying')").get(c.id).n)fail('BROWSER_BUSY','A recording or run started during repair. Finish it before trying again.',409);
    definition.steps=assignStepIds(definition.steps);definition.version=hash(JSON.stringify(definition));
    db.prepare('UPDATE workflows SET payload=?,version=?,test_version=NULL WHERE id=?').run(seal(definition),definition.version,w.id);
    db.prepare('UPDATE api_keys SET revoked_at=? WHERE workflow_id=? AND revoked_at IS NULL').run(now(),w.id);audit('action.chat_repaired',w.id);
    return {workflow:safeWorkflow(db.prepare('SELECT * FROM workflows WHERE id=?').get(w.id))};
  });
  app.post('/studio/workflows/:wid/publish',async(req)=>{
    const w=workflow(req.params.wid),c=executionTargets.source(w),active=revisions.ensureLegacy(w);
    const review=parse(z.object({expected_version:z.string().optional(),permission_fingerprint:z.string().optional(),change_fingerprint:z.string().optional(),accept_breaking:z.boolean().optional()}).strict(),req.body??{});
    if(review.expected_version!==undefined&&review.expected_version!==w.version||review.permission_fingerprint!==undefined&&review.permission_fingerprint!==permissionReview(w).fingerprint)fail('PERMISSION_REVIEW_CHANGED','The workflow or browser scope changed. Review its permissions again before publishing.',409);
    if(w.test_version!==w.version)fail('TEST_REQUIRED','Pass a verified test of this draft before publishing.',409);
    if(!review.expected_version||!review.permission_fingerprint)fail('PERMISSION_REVIEW_REQUIRED','Review and acknowledge this exact workflow’s permissions before publishing. Fetch its current permissions and supply expected_version and permission_fingerprint.',409);
    const changes=changeReview(w,c);
    if(changes?.breaking&&(review.change_fingerprint!==changes.fingerprint||review.accept_breaking!==true))fail('BREAKING_CONTRACT_REVIEW_REQUIRED','This publication changes the accepted input or guaranteed output contract. Review the changes and explicitly acknowledge the current change fingerprint.',409);
    if(c.status!=='connected')fail('AUTH_REQUIRED','Reconnect this account first.',409);
    const unchanged=active&&active.version===w.version&&active.proof.kind!=='legacy_unverified'&&!revisions.isDraftOpen(w)&&JSON.stringify(active.connection_config)===JSON.stringify(snapshotConnection(c));
    if(!unchanged&&!snapshots.isTested(w,c))fail('TEST_REQUIRED','Test this exact draft and browser configuration before publishing.',409);
    db.exec('BEGIN IMMEDIATE');try{
      revisions.publish(w,c);db.prepare("UPDATE workflows SET status='published' WHERE id=?").run(w.id);audit('action.published',w.id);db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return {workflow:safeWorkflow(db.prepare('SELECT * FROM workflows WHERE id=?').get(w.id)),...issueKey(workflow(w.id),w.name+' key')};
  });
  app.post('/studio/workflows/:wid/pause',async(req)=>{const w=workflow(req.params.wid);db.prepare("UPDATE workflows SET status='paused' WHERE id=?").run(w.id);for(const [rid,active]of controllers)if(active.workflowId===w.id)active.controller.abort(Error('ACTION_PAUSED'));audit('action.paused',w.id);return {ok:true};});
  app.post('/studio/keys',async(req)=>{const body=parse(z.object({workflow_id:z.string(),name:text}).strict(),req.body);return issueKey(workflow(body.workflow_id),body.name);});
  app.get('/studio/workflows/:wid/keys',async req=>{workflow(req.params.wid);return {keys:db.prepare('SELECT id,name,suffix,workflow_id,expires_at,revoked_at,created_at FROM api_keys WHERE workflow_id=? ORDER BY created_at DESC').all(req.params.wid)};});
  function revokeKey(kid){
    db.prepare('UPDATE api_keys SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(now(),kid);
    for(const row of db.prepare("SELECT * FROM runs WHERE consumer_id=? AND status IN ('queued','running','verifying')").all(kid)){
      const payload=unseal(row.payload);finishRun(payload,'cancelled',row.created_at,runError(Error('ACTION_PAUSED'),payload));
      persistRun(store,row.id,'cancelled',payload);
    }
    audit('key.revoked',kid);
  }
  const abortKeyRuns=kid=>{for(const active of controllers.values())if(active.consumerId===kid)active.controller.abort(Error('ACTION_PAUSED'));};
  app.post('/studio/keys/:kid/revoke',async(req)=>{const key=db.prepare('SELECT name FROM api_keys WHERE id=?').get(req.params.kid);if(!key)fail('NOT_FOUND','API key not found.',404);const body=parse(z.object({confirmation:z.string().optional()}).strict(),req.body);if(body.confirmation!==undefined&&body.confirmation!==`Delete "${key.name}"`)fail('CONFIRMATION_REQUIRED','Type the exact confirmation shown before revoking this key.');revokeKey(req.params.kid);abortKeyRuns(req.params.kid);return {ok:true};});
  app.post('/studio/keys/:kid/rotate',async req=>{
    const key=db.prepare('SELECT * FROM api_keys WHERE id=? AND revoked_at IS NULL AND expires_at>?').get(req.params.kid,now());
    if(!key)fail('NOT_FOUND','An active API key is required for rotation.',404);
    parse(z.object({}).strict(),req.body);
    let replacement;db.exec('BEGIN IMMEDIATE');try{replacement=issueKey(workflow(key.workflow_id),key.name);revokeKey(key.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    abortKeyRuns(key.id);return replacement;
  });
  app.get('/studio/runs/:rid',async(req)=>{const row=db.prepare('SELECT * FROM runs WHERE id=?').get(req.params.rid);if(!row)fail('NOT_FOUND','Run not found.',404);return safeRun(row);});
  const cancel=async(rid,consumer)=>{const row=db.prepare('SELECT * FROM runs WHERE id=?').get(rid);if(!row||consumer&&row.consumer_id!==consumer)fail('NOT_FOUND','Run not found.',404);if(activeRunStatuses.includes(row.status)){const payload=unseal(row.payload);finishRun(payload,'cancelled',row.created_at,runError(Error('WORKFLOW_CANCELLED'),payload));persistRun(store,rid,'cancelled',payload);controllers.get(rid)?.controller.abort(Error('WORKFLOW_CANCELLED'));audit('run.cancelled',rid);}return safeRun(db.prepare('SELECT * FROM runs WHERE id=?').get(rid));};
  app.post('/studio/runs/:rid/cancel',async(req)=>cancel(req.params.rid));
  app.post('/v1/actions/:slug/versions/1/runs',async(req,reply)=>{
    const w=publishedWorkflow(req.consumer.workflow_id);if(w.slug!==req.params.slug)fail('FORBIDDEN','This key does not authorize that action.',403);if(w.status!=='published')fail('ACTION_PAUSED','This action is not currently published.',409);
    const body=parse(z.object({input:inputBody,connection_id:z.string().optional(),expected_revision:z.number().int().positive().optional()}).strict(),req.body);
    if(body.connection_id&&body.connection_id!==w.connection_id)fail('FORBIDDEN','This key does not authorize that connection.',403);
    const idem=parse(z.string().min(1).max(200),req.headers['idempotency-key']);reply.code(202);return enqueue(w,body.input,req.consumer.id,idem,body.expected_revision);
  });
  app.post('/v1/actions/:slug/revisions/:revision/runs',async(req,reply)=>{
    const current=publishedWorkflow(req.consumer.workflow_id);if(current.slug!==req.params.slug)fail('FORBIDDEN','This key does not authorize that action.',403);if(current.status!=='published')fail('ACTION_PAUSED','This action is not currently published.',409);
    const revision=parse(z.coerce.number().int().positive().max(1000000),req.params.revision),body=parse(z.object({input:inputBody}).strict(),req.body),selected=publishedWorkflow(current.id,revision);
    const idem=parse(z.string().min(1).max(200),req.headers['idempotency-key']);reply.code(202);return enqueue(selected,body.input,req.consumer.id,idem,undefined,revision);
  });
  app.get('/v1/action-revisions',async req=>{const w=publishedWorkflow(req.consumer.workflow_id);return {active_revision:w.revision??null,revisions:revisions.history(w).map(({revision,version,created_at,execution_mode,active})=>({revision,version,created_at,execution_mode,active}))};});
  app.get('/v1/runs/:rid',async(req)=>{const row=db.prepare('SELECT * FROM runs WHERE id=? AND consumer_id=?').get(req.params.rid,req.consumer.id);if(!row)fail('NOT_FOUND','Run not found.',404);const {input,...safe}=safeRun(row);return safe;});
  const receiptFor=(rid,consumerId)=>{const row=consumerId?db.prepare('SELECT * FROM runs WHERE id=? AND consumer_id=?').get(rid,consumerId):db.prepare('SELECT * FROM runs WHERE id=?').get(rid);if(!row)fail('NOT_FOUND','Run not found.',404);return executionReceipt(row,unseal(row.payload));};
  app.get('/v1/runs/:rid/receipt',async req=>receiptFor(req.params.rid,req.consumer.id));
  app.get('/studio/runs/:rid/receipt',async req=>receiptFor(req.params.rid));
  app.post('/v1/runs/:rid/cancel',async(req,reply)=>{reply.code(202);const {input,...safe}=await cancel(req.params.rid,req.consumer.id);return safe;});
  const generatedSpec=w=>workflowSpec(w,origin);
  app.get('/studio/workflows/:wid/openapi',async(req)=>generatedSpec(publishedWorkflow(req.params.wid)));
  installMcp(app,{origin,aliases,workflow:publishedWorkflow,enqueue,db,safeRun,cancel,fail,rate,receiptFor,permissionsFor});
  app.get('/v1/action-permissions',async req=>permissionsFor(publishedWorkflow(req.consumer.workflow_id)));
  app.get('/v1/action-contract',async req=>{const query=parse(z.object({revision:z.coerce.number().int().positive().max(1000000).optional()}).strict(),req.query);const w=publishedWorkflow(req.consumer.workflow_id,query.revision);return {action:w.slug,action_type:w.definition.action_type??'custom',inputs:w.definition.inputs?Object.keys(w.definition.inputs):[],outputs:w.definition.outputs.map(outputSummary),input_schema:inputJsonSchema(w.definition.inputs),output_schema:outputJsonSchema(w.definition.outputs),verification_rules:verificationRuleSummaries(w.definition.verifiers),approval_required_steps:effectiveApprovalSteps(w.definition),approval_invocation_required:requiresInvocationApproval(w.definition),timeout_seconds:Math.round((w.definition.timeout_ms??45000)/1000),version:w.version,revision:w.revision??null};});
  app.get('/studio/workflows/:wid/export',async(req)=>{const w=workflow(req.params.wid),d=w.definition;return {format:d.contract_version==='2'?'hermo.workflow.v0.2':'hermo.workflow.v0.1',...d.contract_version?{contract_version:d.contract_version}:{},action_type:d.action_type??'custom',name:w.name,slug:w.slug,version:w.version,effect:d.effect,steps:d.steps.map(s=>['fill','select','check'].includes(s.op)&&!s.parameter?{...s,value:'<redacted literal>'}:s),inputs:Object.fromEntries(Object.entries(d.inputs).map(([name,{example,...field}])=>[name,field])),outputs:d.outputs,verifiers:d.verifiers};});
  app.post('/studio/settings',async(req)=>{const body=parse(z.object({retention_days:z.union([z.literal(7),z.literal(30),z.literal(90)])}).strict(),req.body);setSetting('retention_days',String(body.retention_days));audit('privacy.updated');return {ok:true};});
  app.get('/studio/audit',async()=>({events:db.prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT 100').all()}));
  app.get('/studio/privacy-export',async()=>({exported_at:now(),connections:db.prepare('SELECT * FROM connections').all().map(safeConnection),workflows:db.prepare('SELECT * FROM workflows').all().map(safeWorkflow),runs:db.prepare('SELECT * FROM runs').all().map(safeRun),audit:db.prepare('SELECT * FROM audit').all(),includes:'Run inputs/results; no passwords, cookies, session files, or API key secrets.'}));
  let working=false,closing=false;
  async function tick(){
    if(working||closing)return;working=true;
    let row;
    try {
      row=db.prepare("SELECT * FROM runs WHERE status='queued' ORDER BY created_at,id").all().find(candidate=>{const cid=workflow(candidate.workflow_id).connection_id;return !isRecording(cid)&&!engine.isPairing(cid);});if(!row)return;
      lastDispatchAt=now();
      const currentWorkflow=workflow(row.workflow_id),saved=snapshots.get(row.id),payload=unseal(row.payload);
      const w=saved?{...currentWorkflow,version:saved.version,definition:saved.definition}:currentWorkflow;
      prepareRun(payload,row.created_at);
      if(!persistRun(store,row.id,'running',payload,['queued']))throw Error('WORKFLOW_CANCELLED');
      const liveConnection=saved?connection(saved.connection_config.id):executionTargets.source(w),c=saved?executionConnection(liveConnection,saved):liveConnection;
      payload.execution_mode=c.browser_mode==='connected'?'connected_chrome':'managed_local';
      if(row.consumer_id!=='studio') {const key=db.prepare('SELECT * FROM api_keys WHERE id=? AND revoked_at IS NULL AND expires_at>?').get(row.consumer_id,now());if(!key||w.status!=='published')throw new Error('ACTION_PAUSED');}
      if(c.status!=='connected')throw new Error('AUTH_REQUIRED');
      if(c.browser_mode==='connected'&&!engine.isOpen(c.id))throw Error('BROWSER_DISCONNECTED');
      if(payload.workflow_version!==w.version)throw new Error('VERSION_CHANGED');
      const controller=new AbortController();controllers.set(row.id,{controller,connectionId:c.id,consumerId:row.consumer_id,workflowId:w.id});
      const runBudget=Math.min(300000,Math.max(15000,w.definition.timeout_ms??45000));
      const timer=setTimeout(()=>controller.abort(new Error('TIMEOUT')),runBudget);
      const keyExpires=row.consumer_id==='studio'?Infinity:Date.parse(db.prepare('SELECT expires_at FROM api_keys WHERE id=?').get(row.consumer_id)?.expires_at??'');
      const keyTimer=Number.isFinite(keyExpires)&&keyExpires-Date.now()<=runBudget?setTimeout(()=>controller.abort(Error('ACTION_PAUSED')),Math.max(0,keyExpires-Date.now())):null;
      const expiresAt=Date.now()+runBudget;
      const authorize=()=>{
        if(controller.signal.aborted)throw controller.signal.reason;
        if(row.consumer_id!=='studio'){
          const key=db.prepare('SELECT id FROM api_keys WHERE id=? AND revoked_at IS NULL AND expires_at>?').get(row.consumer_id,now());
          if(!key||workflow(row.workflow_id).status!=='published')throw Error('ACTION_PAUSED');
        }
        const current=connection(c.id);executionConnection(current,{connection_config:snapshotConnection(c)});
        if(current.status!=='connected')throw Error('AUTH_REQUIRED');
        if(c.browser_mode==='connected'&&!engine.isOpen(c.id))throw Error('BROWSER_DISCONNECTED');
      };
      const executable=compileApprovalPolicy(w.definition);
      startRun(payload,executable,row.created_at);
      if(!persistRun(store,row.id,'running',payload,['running']))throw Error('WORKFLOW_CANCELLED');
      let value;try{value=await engine.execute({...c,run_id:row.id},executable,payload.input,(step,total,event)=>{
        if(!activeRunStatuses.includes(db.prepare('SELECT status FROM runs WHERE id=?').get(row.id)?.status)){if(event?.phase==='issuing')throw Error('WORKFLOW_CANCELLED');return;}
        if(event?.phase==='issuing')authorize();
        observeProgress(payload,w.definition,step,total,event);
        if(!persistRun(store,row.id,payload.phase==='verifying'?'verifying':'running',payload))throw Error('WORKFLOW_CANCELLED');
      },controller.signal,index=>{
        const step=index===-1?{op:'invocation',risk:'unspecified'}:w.definition.steps[index],target=step.locators?.find(locator=>locator.kind==='role');
        return approvals.wait({id:row.id,payload,index,operation:step.op,signal:controller.signal,expiresAt,authorize,context:{workflow_id:w.id,workflow_name:w.name,workflow_version:w.version,website_origin:index===-1?new URL(c.checkpoint??c.url).origin:approvalWebsiteOrigin(c,w.definition,index),execution_mode:payload.execution_mode,operation:step.op,...step.label?{description:step.label}:{},...step.parameter?{input_name:step.parameter}:{},target:{role:target?.role,name:target?.name,framed:!!step.frame_path?.length},risk:step.risk??(step.op==='navigate'?'navigation':'website_action'),proposed_value_redacted:true}});
      });if(controller.signal.aborted)throw controller.signal.reason;}finally{clearTimeout(timer);if(keyTimer)clearTimeout(keyTimer);}
      if(!activeRunStatuses.includes(db.prepare('SELECT status FROM runs WHERE id=?').get(row.id)?.status))return;
      validateConvertedOutputs(w.definition.outputs,value?.result);
      // Drivers return result/evidence only; provenance and lifecycle belong to
      // the runtime. A late or overbroad adapter response cannot rewrite them.
      if(payload.phase==='running'){observeProgress(payload,w.definition,w.definition.steps.length,w.definition.steps.length,{phase:'verifying'});if(!persistRun(store,row.id,'verifying',payload))return;}
      payload.result=value.result;payload.verification=value.verification;
      if(payload.verification)payload.verification={...payload.verification,status:'passed',run_id:row.id,workflow_version:w.version,workflow_revision:payload.workflow_revision,step_outcomes:payload.steps.map(step=>({number:step.number,...step.step_id?{step_id:step.step_id}:{},status:step.status})),rules:verificationRuleSummaries(w.definition.verifiers)};
      finishRun(payload,'succeeded',row.created_at,undefined,now(),{verifierVersion:w.version,observationWindow:true});
      if(!persistRun(store,row.id,'succeeded',payload))return;
      if(row.consumer_id==='studio'){
        db.prepare('UPDATE workflows SET test_version=? WHERE id=? AND version=?').run(w.version,w.id,w.version);
        snapshots.verified(w.id,row.id);
      }
      audit('run.verified',row.id);
    }catch(error){if(row){
      if(!activeRunStatuses.includes(db.prepare('SELECT status FROM runs WHERE id=?').get(row.id)?.status))return;
      const signal=controllers.get(row.id)?.controller.signal,cause=signal?.aborted?(signal.reason instanceof Error?signal.reason:Error('WORKFLOW_CANCELLED')):error;
      const payload=unseal(db.prepare('SELECT payload FROM runs WHERE id=?').get(row.id).payload);
      finishRun(payload,'failed',row.created_at,runError(cause,payload));
      persistRun(store,row.id,'failed',payload);
      if(payload.error.cause_code==='AUTH_REQUIRED'){const w=workflow(row.workflow_id),saved=snapshots.get(row.id),c=saved?connection(saved.connection_config.id):executionTargets.source(w);if(c.browser_mode!=='connected')db.prepare("UPDATE connections SET status='expired' WHERE id=?").run(c.id);else if(!engine.isOpen(c.id)&&c.status!=='stopped')saveConnection(c,{},'stopped');}
      audit('run.failed',row.id);
    }}finally{if(row)controllers.delete(row.id);working=false;}
  }
  const worker=setInterval(tick,250);
  const cleanup=setInterval(()=>{const expiry=new Date(Date.now()-Number(getSetting('retention_days')??7)*86400000).toISOString();db.prepare("DELETE FROM runs WHERE created_at<? AND status NOT IN ('queued','running','verifying')").run(expiry);db.prepare('DELETE FROM audit WHERE created_at<?').run(new Date(Date.now()-90*86400000).toISOString());for(const [k,v]of sessions)if(v.expires<Date.now())sessions.delete(k);for(const [k,v]of limits)if(v.until<Date.now())limits.delete(k);for(const [k,v]of recordings)if(v.created<Date.now()-3600000)recordings.delete(k);},60000);
  if(existsSync(join(root,'dist')))await app.register(staticFiles,{root:join(root,'dist'),prefix:'/',cacheControl:false});
  app.setNotFoundHandler((req,reply)=>{if(req.method==='GET'&&!/^\/(studio|v1|mcp|sandbox|oauth)(\/|$)/.test(req.url)&&!/^\/chatgpt-(plan\.html|example\.(html|js|css))(\?|$)/.test(req.url)&&existsSync(join(root,'dist','index.html')))return reply.sendFile('index.html');return reply.code(404).send({error:{code:'NOT_FOUND',message:'Route not found.'}});});
  const beginShutdown=()=>{closing=true;clearInterval(worker);clearInterval(cleanup);for(const v of controllers.values())v.controller.abort(Error('INTERRUPTED'));};
  // Fastify drains HTTP requests before onClose. Revoke commands and flush long
  // polls during preClose, then await browser teardown outside its hook timeout.
  let browserShutdown;
  app.addHook('preClose',async()=>{beginShutdown();browserShutdown=engine.closeAll();
    // onClose owns any teardown error; observe it while HTTP requests drain.
    void browserShutdown.catch(()=>{});
  });
  app.addHook('onClose',async()=>{beginShutdown();await (browserShutdown??engine.closeAll());await proxy.close();while(working)await new Promise(r=>setTimeout(r,20));store.close();});
  return {app,store,origin,sandbox,enqueue,workflow,generatedSpec};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {app,origin}=await createApp();await app.listen({port:Number(process.env.HERMO_PORT??4317),host:'127.0.0.1'});
  console.log(`Hermo is running at ${origin}. Local-only; no telemetry.`);
  for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>app.close().then(()=>process.exit(0)));
}
