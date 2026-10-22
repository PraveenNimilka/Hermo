import {extractOutputDocument,usesStructuredExtraction,observationSignature,observationChanged,extractionReady,browserOutputMapping} from './output-mappings.mjs';
import {verifyResult} from './verification.mjs';
import {compileApprovalPolicy,requiresInvocationApproval} from './approval-policy.mjs';
import {completionEvidenceFields,validateCompletionPolicy} from './verification-rules.mjs';
import {browserInputValue,convertOutputs} from './workflow-contract.mjs';
import { chromium } from 'playwright';
import { id } from './store.mjs';
import { validateWebsite } from './network.mjs';
import { inspectDocument } from '../companion/browser/inspect.mjs';
import {pageTemplate,pageParameter} from './page-template.mjs';
import {managedBrowserInstallation} from './managed-profile.mjs';
import {createManagedProfileLocks} from './managed-profile-locks.mjs';
import {createManagedProfileVault} from './managed-profile-vault.mjs';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {relaySandboxSocket} from './sandbox-socket.mjs';
import {locatorProbeDocument} from '../companion/browser/locator-probe.mjs';
import {runWorkflowWait,outputWaitMatches} from './workflow-waits.mjs';

export async function createBrowserEngine(proxy,sandboxOrigin,{launchBrowser=options=>chromium.launch(options),launchPersistentContext=(directory,options)=>chromium.launchPersistentContext(directory,options),idleTimeoutMs=60000,onSession=async()=>{},dataDir,store}={}) {
  const profileLocks=dataDir?createManagedProfileLocks(dataDir):undefined;
  const profileVault=store&&dataDir?createManagedProfileVault(store,dataDir):undefined;
  const launchOptions=headless=>{
    const installation=managedBrowserInstallation();
    if(!installation.available)throw Error('BROWSER_INSTALLATION_REQUIRED');
    return {headless,chromiumSandbox:true,executablePath:installation.executablePath,proxy:{server:proxy.url},args:['--proxy-bypass-list=<-loopback>','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--disable-quic','--disable-background-networking'],env:Object.fromEntries(Object.entries(process.env).filter(([name])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|HOME|DISPLAY|PLAYWRIGHT_BROWSERS_PATH)$/i.test(name)))};
  };
  const launch=headless=>launchBrowser(launchOptions(headless));
  const browsers=new Map(),starting=new Map(),contexts=new Set(),executing=new Set(),pendingContexts=new Set();let closed=false,idleTimer;
  function scheduleIdle(){clearTimeout(idleTimer);if(closed||contexts.size||starting.size)return;idleTimer=setTimeout(()=>{if(!contexts.size&&!starting.size){const idle=[...browsers.values()];browsers.clear();void Promise.allSettled(idle.map(browser=>browser.close()));}},Math.max(100,idleTimeoutMs));idleTimer.unref?.();}
  async function browserFor(desktop){
    clearTimeout(idleTimer);
    if(closed)throw Error('BROWSER_CLOSED');
    const current=browsers.get(desktop);if(current?.isConnected())return current;
    if(starting.has(desktop))return starting.get(desktop);
    const task=(async()=>{const browser=await launch(!desktop);if(closed){await browser.close();throw Error('BROWSER_CLOSED');}browsers.set(desktop,browser);return browser;})();
    starting.set(desktop,task);
    try{return await task;}finally{if(starting.get(desktop)===task)starting.delete(desktop);}
  }
  const studios=new Map(),openGenerations=new Map();let studioGeneration=0;
  function context(...args){const task=createContext(...args);pendingContexts.add(task);task.finally(()=>pendingContexts.delete(task)).catch(()=>{});return task;}
  async function createContext(connection,retrievalOnly=false,desktop=false,isCurrent=()=>!closed) {
    if(!isCurrent())throw Error('BROWSER_CLOSED');
    let releaseProfile;try{releaseProfile=profileLocks?.acquire(connection.id);}catch(error){if(error.code==='MANAGED_PROFILE_BUSY')throw Object.assign(Error('MANAGED_PROFILE_BUSY'),{code:error.code});throw error;}
    let credentials;
    try{const grant=proxy.register(connection.origins);let released=false;credentials={...grant,release(){if(!released){released=true;grant.release();}}};}catch(error){releaseProfile?.();throw error;}
    const allowed=new Set(connection.origins),observedOrigins=new Set();
    const diagnostics={blocked:new Map(),failed:new Map(),mainStatus:0};
    function blocked(url,reason,resource='document') {try{const u=new URL(url),origin=u.protocol==='wss:'?'https://'+u.host:u.origin;if(diagnostics.blocked.size<40||diagnostics.blocked.has(origin+'|'+reason)){const key=origin+'|'+reason,previous=diagnostics.blocked.get(key);diagnostics.blocked.set(key,{origin,reason,resource,count:(previous?.count??0)+1});}}catch{}}
    let ctx,profile;
    // Never archive or remove a directory while its Chromium may still write.
    // Failed closes revoke network authority immediately, but retain the lease
    // until an orderly close or an observed browser disconnect proves it stopped.
    async function discardAfterFailedClose(cleanup){
      credentials.release();
      await ctx?.setOffline(true).catch(()=>{});
      const browser=ctx?.browser?.();
      if(browser?.isConnected()){
        browser.once('disconnected',cleanup);
        try{await browser.close();}catch{/* Keep the directory and lease until disconnected. */}
        if(!browser.isConnected())cleanup();
      }else if(!ctx||browser)cleanup();
      else ctx.once('close',cleanup);
    }
    try{
      const options={viewport:{width:1100,height:720},proxy:{server:proxy.url,username:credentials.username,password:credentials.password},offline:true,serviceWorkers:'block',acceptDownloads:false};
      if(profileVault&&connection.access!=='public'){
        profile=profileVault.open(connection.id);
        ctx=await launchPersistentContext(profile.directory,{...launchOptions(!desktop),...options});
        if(!isCurrent())throw Error('BROWSER_CLOSED');
        // Migrate existing encrypted logical sessions only into a fresh profile.
        if(!profile.restored&&connection.storageState)await ctx.setStorageState(connection.storageState);
        const sessionFile=join(profile.directory,'hermo-session-cookies.json');
        if(profile.restored&&existsSync(sessionFile))await ctx.addCookies(JSON.parse(readFileSync(sessionFile,'utf8')));
      }else{
        const selectedBrowser=await browserFor(desktop);ctx=await selectedBrowser.newContext({...options,storageState:connection.access==='public'?undefined:connection.storageState??undefined});
      }
    }catch(error){
      let cleaned=false;const cleanup=()=>{if(cleaned)return;cleaned=true;try{profile?.finish({save:false});}finally{credentials.release();releaseProfile?.();contexts.delete(ctx);scheduleIdle();}};
      try{await ctx?.close();cleanup();}catch{contexts.add(ctx);await discardAfterFailedClose(cleanup);}
      throw error;
    }
    contexts.add(ctx);
    let disposed=false,closing,profileError;const dispose=(save=true)=>{if(disposed)return;disposed=true;try{profile?.finish({save});}catch(error){profileError=error;}finally{credentials.release();releaseProfile?.();contexts.delete(ctx);scheduleIdle();}};
    // Cancellation and execution cleanup can close the same context together.
    // Share that close promise and release the lease before either caller may
    // reopen it, rather than depending on close-event delivery timing alone.
    const closeContext=ctx.close.bind(ctx);ctx.close=(...args)=>closing??=(async()=>{
      try{
        // Chromium normally drops session-only cookies on process exit. Keep
        // their latest values with this profile, never an older DB snapshot.
        if(profile){try{const cookies=(await ctx.cookies()).filter(cookie=>cookie.expires===-1);writeFileSync(join(profile.directory,'hermo-session-cookies.json'),JSON.stringify(cookies),{mode:0o600});}catch{/* A crashed browser recovers its last committed snapshot. */}}
        await closeContext(...args);
      }catch(error){await discardAfterFailedClose(()=>dispose(false));throw error;}
      dispose();if(profileError)throw profileError;
    })();
    ctx.on('close',()=>{
      if(closing)return;
      // A browser crash did not flush a consistent directory. Preserve the last
      // committed encrypted snapshot rather than archiving partially written DBs.
      try{profile?.finish({save:false});}catch(error){profileError=error;}finally{profile=undefined;dispose();}
    });
    try{
    let serial=0;const pageIds=new Map(),pageState=new Map(),pendingNavigations=new Map();
    // A popup's first request precedes the Page event. Keep its metadata at context
    // scope until Playwright exposes the corresponding frame; never guess a tab.
    function trackNavigation(request,update={}) {
      if(!request.isNavigationRequest())return;
      const state={...(pendingNavigations.get(request)??{requestedUrl:request.url(),status:0}),...update};
      try{const frame=request.frame(),p=frame.page();if(frame===p.mainFrame()){pageState.set(p,{...(pageState.get(p)??{}),...state});}pendingNavigations.delete(request);}
      catch{if(pendingNavigations.size>=32&&!pendingNavigations.has(request))pendingNavigations.delete(pendingNavigations.keys().next().value);pendingNavigations.set(request,state);}
    }
    function syncNavigations(){for(const [request,state]of pendingNavigations)trackNavigation(request,state);}
    ctx.on('request',r=>{try{observedOrigins.add(new URL(r.url()).origin);}catch{}trackNavigation(r,{error:undefined});});
    ctx.on('response',r=>{trackNavigation(r.request(),{status:r.status(),error:undefined});});
    ctx.on('requestfailed',r=>{trackNavigation(r,{error:r.failure()?.errorText??'NETWORK_FAILED'});try{const origin=new URL(r.url()).origin,code=r.failure()?.errorText??'NETWORK_FAILED';if(!code.includes('BLOCKED_BY_CLIENT')&&diagnostics.failed.size<20)diagnostics.failed.set(origin,{origin,code:code.slice(0,100)});}catch{}});
    await ctx.route('**/*',async route=>{const request=route.request();try{const u=new URL(request.url());let reason;if(!['http:','https:'].includes(u.protocol))reason='UNSUPPORTED_PROTOCOL';else if(!allowed.has(u.origin))reason='ORIGIN_NOT_APPROVED';else if(u.origin===sandboxOrigin&&!u.pathname.startsWith('/sandbox/'))reason='PRIVATE_ROUTE_BLOCKED';else if(retrievalOnly&&!['GET','HEAD'].includes(request.method()))reason='METHOD_BLOCKED';if(reason){blocked(request.url(),reason,request.resourceType());return route.abort('blockedbyclient');}return route.continue();}catch{return route.abort('blockedbyclient');}});
    await ctx.routeWebSocket('**',ws=>{try{const u=new URL(ws.url()),origin=(u.protocol==='wss:'?'https:':'http:')+'//'+u.host;const localFixture=u.protocol==='ws:'&&origin===sandboxOrigin&&u.pathname.startsWith('/sandbox/');if(retrievalOnly||u.protocol!=='wss:'&&!localFixture||!allowed.has(origin)){blocked(ws.url(),retrievalOnly?'METHOD_BLOCKED':'ORIGIN_NOT_APPROVED','websocket');return ws.close();}if(localFixture)return relaySandboxSocket(ws,ctx);ws.connectToServer();}catch{return ws.close();}});
    ctx.on('page',p=>{syncNavigations();if(!pageState.has(p))pageState.set(p,{requestedUrl:/^https?:/.test(p.url())?p.url():connection.checkpoint??connection.url,status:0});pageIds.set(p,String(++serial));p.on('dialog',d=>d.dismiss().catch(()=>{}));p.on('download',d=>d.cancel().catch(()=>{}));});
    ctx.setDefaultTimeout(8000);ctx.setDefaultNavigationTimeout(25000);
    // Discard persistent startup pages while still offline: a restored document
    // must not flush queued background submissions when networking resumes.
    let page;
    if(profile){const initialPages=ctx.pages();page=await ctx.newPage();for(const initial of initialPages)await initial.close();}
    if(!isCurrent())throw Error('BROWSER_CLOSED');
    await ctx.setOffline(false);
    page??=await ctx.newPage();
    return {ctx,page,allowed,observedOrigins,credentials,diagnostics,pageIds,pageState,syncNavigations,desktop,connection,elements:new Map(),busy:false,openedAt:Date.now()};
    }catch(error){await ctx.close().catch(()=>{});throw error;}
  }
  const get=cid=>{const v=studios.get(cid);if(!v)throw new Error('BROWSER_CLOSED');return v;};
  async function closeCurrent(cid){const v=studios.get(cid);if(v){studios.delete(cid);await v.ctx.close();}}
  async function close(cid){openGenerations.set(cid,(openGenerations.get(cid)??0)+1);await closeCurrent(cid);}
  function isOpen(cid){const v=studios.get(cid);return !!v?.ctx.browser()?.isConnected()&&v.ctx.pages().some(p=>!p.isClosed());}
  async function open(cid,connection,{resume=false}={}){
    if(executing.has(cid))throw Error('BROWSER_BUSY');
    const current=studios.get(cid);if(resume&&isOpen(cid)){allowOrigins(cid,connection.origins);return current;}
    const generation=(openGenerations.get(cid)??0)+1,epoch=studioGeneration;openGenerations.set(cid,generation);
    const active=()=>!closed&&openGenerations.get(cid)===generation&&studioGeneration===epoch;
    await closeCurrent(cid);if(!active())throw Error('BROWSER_CLOSED');
    const restored=connection.access==='public'?connection:{...connection,...connection.studioState};let checkpoint=restored.url;try{const saved=validateWebsite(restored.checkpoint??restored.url,sandboxOrigin);if(restored.origins.includes(saved.origin))checkpoint=saved.href;}catch{/* Legacy error-page checkpoints recover at the original website. */}
    const v=await context({...restored,id:cid,checkpoint},false,false,active);if(!active()){await v.ctx.close();throw Error('BROWSER_CLOSED');}
    studios.set(cid,v);try{await v.page.goto(checkpoint,{waitUntil:'domcontentloaded'});}catch{if(!active())throw Error('BROWSER_CLOSED');v.pageState.get(v.page).error='NETWORK_FAILED';}if(!active())throw Error('BROWSER_CLOSED');return v;
  }
  async function openDesktop(cid){return exclusive(cid,async v=>{
    if(v.page.isClosed()){const remaining=v.ctx.pages().filter(p=>!p.isClosed());if(!remaining.length)throw new Error('BROWSER_CLOSED');v.page=remaining[remaining.length-1];}
    if(v.desktop){await v.page.bringToFront();return;}
    v.syncNavigations();const storageState=await v.ctx.storageState({indexedDB:true}),candidate=v.pageState.get(v.page)?.requestedUrl??v.connection.url,checkpoint=validateWebsite(candidate,sandboxOrigin).href;
    let next;try{if(closed||studios.get(cid)!==v)throw Error('BROWSER_CLOSED');await v.ctx.close();next=await context({...v.connection,origins:[...v.allowed],storageState,checkpoint},false,true);if(closed||studios.get(cid)!==v)throw Error('BROWSER_CLOSED');try{await next.page.goto(checkpoint,{waitUntil:'domcontentloaded'});}catch{next.pageState.get(next.page).error='NETWORK_FAILED';}if(closed||studios.get(cid)!==v)throw Error('BROWSER_CLOSED');syncPolicy(next,[...v.allowed]);await next.page.bringToFront();if(closed||studios.get(cid)!==v)throw Error('BROWSER_CLOSED');}
    catch(error){await next?.ctx.close().catch(()=>{});throw error;}
    studios.set(cid,next);await v.ctx.close().catch(()=>{});
  });}
  function address(page,v){try{const actual=new URL(page.url());if(['http:','https:'].includes(actual.protocol))return actual.origin+actual.pathname;const requested=new URL(v.pageState.get(page)?.requestedUrl??v.connection.url);return ['http:','https:'].includes(requested.protocol)?requested.origin+requested.pathname:'Blocked address';}catch{return 'New tab';}}
  async function exclusive(cid,fn){const v=get(cid);if(v.busy)throw new Error('BROWSER_BUSY');v.busy=true;try{await v.snapshotTask?.catch(()=>{});return await fn(v);}finally{v.busy=false;}}
  async function framePath(frame){const path=[];while(frame.parentFrame()){const element=await frame.frameElement();try{path.unshift(await element.evaluate(inspectDocument));}finally{await element.dispose();}frame=frame.parentFrame();if(path.length>6)throw new Error('FRAME_DEPTH_LIMIT');}return path;}
  function locator(page,item){let scope=page;for(const selector of item.frame_path??[])scope=scope.frameLocator(selector);return scope.locator(item.selector);}
  async function stepTarget(page,item,{missingAllowed=false,deadline=Date.now(),check=()=>{}}={}){
    let scope=page;for(const selector of item.frame_path??[])scope=scope.frameLocator(selector);
    const candidates=[...(item.locators??[]),...item.selector?[{kind:'css',value:item.selector}]:[]];
    const semantic=candidates.filter(candidate=>candidate.kind==='role'||candidate.kind==='label');
    const resolve=candidate=>candidate.kind==='testId'?scope.getByTestId(candidate.value):candidate.kind==='role'?scope.getByRole(candidate.role,{name:candidate.name,exact:true}):candidate.kind==='label'?scope.getByLabel(candidate.value,{exact:true}):scope.locator(candidate.value);
    do{
      check();
      for(const candidate of candidates){
        let target=resolve(candidate);
        const count=await target.count();if(count>1)throw Error('ELEMENT_AMBIGUOUS');
        if(count===1){
          // Stable IDs can be reused for a different action. A repaired CSS or
          // test-ID target must retain a recorded accessible role/name or label.
          if(semantic.length){
            let sameMeaning=false;
            for(const identity of semantic){const bound=target.and(resolve(identity));if(await bound.count()===1){target=bound;sameMeaning=true;break;}}
            if(!sameMeaning)throw Error('ELEMENT_CHANGED');
          }
          if(missingAllowed||await target.isVisible()&&await target.isEnabled())return target;
          // A stronger match that is still becoming actionable must not fall
          // through to another control while the page or frame hydrates.
          break;
        }
      }
      if(missingAllowed||Date.now()>=deadline)break;
      await new Promise(done=>setTimeout(done,Math.min(100,Math.max(1,deadline-Date.now()))));
    }
    while(Date.now()<=deadline);
    check();
    if(missingAllowed)return null;throw Error('ELEMENT_NOT_FOUND');
  }
  async function targetFrame(page,item){let scope=page.mainFrame();for(const selector of item.frame_path??[]){const handle=await scope.locator(selector).elementHandle();try{scope=await handle.contentFrame();if(!scope)throw new Error('FRAME_CHANGED');}finally{await handle.dispose();}}return scope;}
  async function guardedStep(page,target,step,check,action,beforeAction){
    const element=await target.elementHandle(),trigger=page.locator('body');let failure;
    if(!element)throw Error('ELEMENT_NOT_FOUND');
    // Hover and pointer-down handlers run inside a native click, after its last
    // actionability check. Stop later input events synchronously if the target
    // changes during that sequence. Field values are excluded because filling
    // them is the intended operation.
    const inputGuard=await element.evaluateHandle(node=>{
      const normalize=value=>(value??'').replace(/\s+/g,' ').trim();
      const fingerprint=()=>{
        const root=node.getRootNode(),labelled=(node.getAttribute('aria-labelledby')??'').split(/\s+/).filter(Boolean).map(id=>normalize((root.getElementById?.(id)??node.ownerDocument.getElementById(id))?.textContent));
        return JSON.stringify({attributes:['id','data-testid','role','aria-label','aria-labelledby','type','title','alt','name','href','formaction'].map(name=>node.getAttribute(name)),labels:[...node.labels??[]].map(label=>normalize(label.textContent)),labelled,text:node.isContentEditable||node.matches('input,textarea,select')?null:normalize(node.textContent)});
      };
      const initial=fingerprint(),events=['pointerdown','mousedown','pointerup','mouseup','click','beforeinput','input','change'];let changed=false;
      const guard=event=>{if(event.composedPath().includes(node)&&(!node.isConnected||fingerprint()!==initial)){changed=true;event.preventDefault();event.stopImmediatePropagation();}};
      for(const type of events)window.addEventListener(type,guard,true);
      return {changed:()=>changed,dispose:()=>{for(const type of events)window.removeEventListener(type,guard,true);}};
    });
    // Native actions retain an element while waiting for visibility, stability or
    // an overlay. Recheck its identity before every actionability retry; closing
    // this run's context prevents an obsolete handle from receiving input.
    await page.addLocatorHandler(trigger,async()=>{
      try{
        check();
        const current=await stepTarget(page,step,{missingAllowed:true,check});
        if(!current)throw Error('ELEMENT_NOT_FOUND');
        if(!await current.evaluate((node,original)=>node===original,element))throw Error('ELEMENT_CHANGED');
        await beforeAction?.();check();
      }catch(error){failure=error;await page.context().close().catch(()=>{});}
    },{noWaitAfter:true});
    const changed=async()=>{try{return await inputGuard.evaluate(guard=>guard.changed());}catch(error){
      // A completed native navigation disposes the previous document's guard.
      // URL policy and output verification still run against the new document.
      if(/Execution context was destroyed|Cannot find context with specified id/.test(error.message))return false;
      throw error;
    }};
    try{await action(element);if(failure)throw failure;if(await changed())throw Error('ELEMENT_CHANGED');}
    catch(error){if(failure)throw failure;if(await inputGuard.evaluate(guard=>guard.changed()).catch(()=>false))throw Error('ELEMENT_CHANGED');throw error;}
    finally{await page.removeLocatorHandler(trigger).catch(()=>{});await inputGuard.evaluate(guard=>guard.dispose()).catch(()=>{});await inputGuard.dispose().catch(()=>{});await element.dispose().catch(()=>{});}
  }
  async function snapshot(cid){
    const v=get(cid);if(v.busy){if(v.lastSnapshot)return v.lastSnapshot;throw new Error('BROWSER_BUSY');}if(v.snapshotTask)return v.snapshotTask;
    const task=capture(cid);v.snapshotTask=task;try{return await task;}finally{if(v.snapshotTask===task)v.snapshotTask=undefined;}
  }
  async function capture(cid){
    const v=get(cid);
    if(v.page.isClosed()){const remaining=v.ctx.pages();if(!remaining.length)throw new Error('BROWSER_CLOSED');v.page=remaining[remaining.length-1];}
    v.syncNavigations();const page=v.page;
    if(!v.lastSnapshot)await page.waitForFunction(()=>!!document.querySelector('input:not([type=hidden]),textarea,button,[role=button],[contenteditable=true],iframe')||(document.body?.innerText?.trim().length??0)>100,{},{timeout:5000}).catch(()=>{});
    const items=[];let main;
    const scanDeadline=Date.now()+5000;
    for(const frame of page.frames().slice(0,40)){if(Date.now()>=scanDeadline)break;try{await frame.waitForLoadState('domcontentloaded',{timeout:Math.max(1,Math.min(1000,scanDeadline-Date.now()))});let doc,path;for(let attempt=0;attempt<3;attempt++){try{doc=await frame.evaluate(inspectDocument,null);path=await framePath(frame);break;}catch(e){if(attempt===2)throw e;await new Promise(r=>setTimeout(r,50));}}if(frame===page.mainFrame())main=doc;for(const item of doc.elements)if(items.length<240&&!(item.kind==='output'&&(doc.credentials||doc.login&&v.connection.access!=='public'||doc.challenge||doc.denied||doc.networkError)))items.push({...item,frame_path:path});}catch{/* Detached frames are retried on the next live refresh. */}}
    const old=new Map([...v.elements].map(([key,value])=>[JSON.stringify([value.frame_path,value.selector,value.kind,value.read_attribute??'']),key])),next=new Map();
    const elements=items.map(item=>{const key=old.get(JSON.stringify([item.frame_path,item.selector,item.kind,item.read_attribute??'']))??id('el');next.set(key,item);const {selector,frame_path,...safe}=item;return {...safe,id:key,framed:frame_path.length>0};});v.elements=next;
    // Preserve the page's actual resource type when the proxy reports the same
    // destination as a generic connection (for example, a blocked login script).
    const proxyIssues=v.credentials.diagnostics(),pageBlocked=[...v.diagnostics.blocked.values()],pageKeys=new Set(pageBlocked.map(x=>x.origin+'|'+x.reason));
    const blocked=[...pageBlocked,...proxyIssues.filter(x=>x.reason!=='CONNECTION_FAILED'&&!pageKeys.has(x.origin+'|'+x.reason))].filter(x=>x.reason!=='ORIGIN_NOT_APPROVED'||!v.allowed.has(x.origin));
    const uniqueBlocked=[...new Map(blocked.map(x=>[x.origin+'|'+x.reason,{...x,advisory:x.origin.startsWith('https://')&&new URL(x.origin).hostname.endsWith('.challenges.cloudflare.com')}])).values()],status=v.pageState.get(page)?.status??0;
    const errorPage=!/^https?:/.test(page.url())||main?.networkError;
    const controlsPresent=elements.some(x=>x.kind!=='output'),navigationOrigin=new URL(v.pageState.get(page)?.requestedUrl??v.connection.url).origin;
    const blockingDependency=uniqueBlocked.some(x=>x.reason==='ORIGIN_NOT_APPROVED'&&!x.advisory&&(x.resource!=='connection'||v.observedOrigins.has(x.origin)||x.origin===navigationOrigin)&&(!controlsPresent||x.resource==='document'||x.resource==='connection'&&x.origin===navigationOrigin));
    const login=main?.credentials||main?.login&&v.connection.access!=='public';
    const state=main?.authRejected?'auth_rejected':main?.challenge?'challenge':blockingDependency?'blocked':errorPage?'network_error':main?.denied||status>=400?'denied':login?'sign_in':controlsPresent?'ready':elements.some(x=>x.kind==='output')?'read_only':Date.now()-v.openedAt<30000?'loading':'empty';
    if(['auth_rejected','challenge','network_error','denied','blocked','sign_in'].includes(state)){for(const [key,item]of v.elements)if(item.kind==='output')v.elements.delete(key);}
    const tabs=v.ctx.pages().map(p=>({id:v.pageIds.get(p),url:address(p,v),active:p===page}));
    const failed=[...new Map([...v.diagnostics.failed.values(),...proxyIssues.filter(x=>x.reason==='CONNECTION_FAILED').map(x=>({origin:x.origin,code:x.reason}))].map(x=>[x.origin+'|'+x.code,x])).values()];
    const result={url:address(page,v),title:await page.title(),image:(await page.screenshot({type:'jpeg',quality:70,timeout:5000})).toString('base64'),elements:elements.filter(x=>v.elements.has(x.id)),viewport:{width:1100,height:720},state,mode:v.desktop?'desktop':'preview',approved_origins:[...v.allowed],can_confirm:['ready','read_only'].includes(state)&&v.allowed.has(new URL(page.url()).origin),diagnostics:{blocked:uniqueBlocked,failed,http_status:status},tabs};v.lastSnapshot=result;return result;
  }
  function element(cid,eid,kind){const item=get(cid).elements.get(eid);if(!item||kind&&item.kind!==kind)throw new Error('ELEMENT_CHANGED');return item;}
  async function operate(cid,item,operation,value){return exclusive(cid,async v=>{const page=v.page,target=locator(page,item);if(await target.count()!==1||!await target.isVisible())throw new Error('ELEMENT_CHANGED');if(item.disabled||!await target.isEnabled())throw new Error('ACTION_UNAVAILABLE');if(operation==='fill')await target.fill(value);else if(operation==='select')await target.selectOption(value);else if(operation==='check'){if(!['true','false'].includes(value))throw new Error('INVALID_CHECK');await target.setChecked(value==='true');}else {const frame=await targetFrame(page,item),navigation=page.waitForEvent('framenavigated',{predicate:f=>f===frame,timeout:1500}).catch(()=>null);await target.click();if(await navigation)await frame.waitForLoadState('domcontentloaded',{timeout:5000}).catch(()=>{});}v.lastSnapshot=undefined;await page.waitForLoadState('domcontentloaded').catch(()=>{});});}
  async function interact(cid,action){return exclusive(cid,async v=>{const page=v.page;if(['reload','back','forward','retry','home'].includes(action.op)){v.diagnostics.blocked.clear();v.diagnostics.failed.clear();v.credentials.clearDiagnostics();v.openedAt=Date.now();const requested=action.op==='home'?v.connection.url:v.pageState.get(page)?.requestedUrl??v.connection.url;try{if(action.op==='retry'||action.op==='home'||action.op==='reload'&&!/^https?:/.test(page.url())){const u=validateWebsite(requested,sandboxOrigin);await page.goto(u.href,{waitUntil:'domcontentloaded'});}else await page[action.op==='reload'?'reload':action.op==='back'?'goBack':'goForward']({waitUntil:'domcontentloaded'});}catch{v.pageState.get(page).error='NETWORK_FAILED';}}
    else if(action.op==='scroll'){await page.mouse.move(action.x??550,action.y??360);await page.mouse.wheel(0,action.delta);}
    else if(action.op==='click')await page.mouse.click(action.x,action.y);
    else if(action.op==='press')await page.keyboard.press(action.key);
    else if(action.op==='type')await page.keyboard.insertText(action.value);
    else if(action.op==='tab'){const target=v.ctx.pages().find(p=>v.pageIds.get(p)===action.tab_id);if(!target)throw new Error('TAB_CLOSED');v.page=target;}
    v.lastSnapshot=undefined;
  });}
  function syncPolicy(v,origins){const next=new Set(origins);if(next.size===v.allowed.size&&[...next].every(origin=>v.allowed.has(origin)))return;v.allowed.clear();for(const origin of next)v.allowed.add(origin);v.credentials.setOrigins([...next]);v.lastSnapshot=undefined;}
  function allowOrigins(cid,origins){const v=studios.get(cid);if(v)syncPolicy(v,origins);}
  async function readObservation(page,item){
    if(usesStructuredExtraction(item)&&!item.selector?.startsWith(':hermo-')){
      const frame=await targetFrame(page,item),{frame_path,...mapping}=browserOutputMapping(item),value=await frame.evaluate(extractOutputDocument,{mapping});
      if(value?.hermo_error)throw Error(value.hermo_error);return {text:value.value,count:value.count,streaming:value.streaming,identity:value.identity};
    }
    const target=locator(page,item),count=await target.count();
    if(count!==1||!await target.isVisible())throw Error('ACTION_UNAVAILABLE');
    if(item.read_attribute){
      const frame=await targetFrame(page,item),value=await frame.evaluate(inspectDocument,{selector:item.selector,read_attribute:item.read_attribute,read_mode:item.read_mode});
      if(value?.hermo_error)throw Error(value.hermo_error);return value;
    }
    const text=(await target.innerText()).trim();if(text.length>4096)throw Error('ACTION_UNAVAILABLE');
    const streaming=await target.evaluate(el=>!!el.closest('[aria-busy="true"],[data-is-streaming="true"],[data-is-generating="true"]')||[...document.querySelectorAll('button,[role="button"]')].some(button=>{const box=button.getBoundingClientRect();return box.width>0&&box.height>0&&/^stop$|stop (generating|streaming|response|generation)/i.test(button.getAttribute('aria-label')??button.textContent??'');}));
    const identity=await target.evaluate(el=>{const key=Symbol.for('hermo.output.observations.v1'),registry=globalThis[key]??(globalThis[key]={nodes:new WeakMap(),next:0,document:crypto.randomUUID()});let id=registry.nodes.get(el);if(!id){id=++registry.next;registry.nodes.set(el,id);}return registry.document+':'+id;});
    return {text,count,streaming,identity};
  }
  async function read(cid,item){return (await readObservation(get(cid).page,item)).text;}
  async function probeTarget(cid,payload,frame_path=[],authority){return exclusive(cid,async v=>{
    let timer;const interrupted=new Promise((_,reject)=>{timer=setTimeout(()=>{void v.ctx.close().catch(()=>{});reject(Error('PROBE_UNAVAILABLE'));},8000);});
    const inspect=async()=>{
    const c=authority??v.connection,main=validateWebsite(v.page.url(),sandboxOrigin);
    if(!c.origins.includes(main.origin))throw Error('POLICY_BLOCKED');
    if(c.access==='public'){
      if(c.identity?.kind!=='public_origin'||main.origin!==c.identity.origin)throw Error('AUTH_REQUIRED');
    }else{
      if(!c.identity)throw Error('AUTH_REQUIRED');const marker=locator(v.page,c.identity);
      if(await marker.count()!==1||!await marker.isVisible()||await marker.evaluate(element=>element.matches('input,textarea,select,[contenteditable]')||!!element.querySelector('input,textarea,select,[contenteditable]'))||(await marker.innerText()).trim()!==c.identity.text)throw Error('AUTH_REQUIRED');
    }
    const frame=await targetFrame(v.page,{frame_path}),url=validateWebsite(frame.url(),sandboxOrigin);
    if(!c.origins.includes(url.origin))throw Error('POLICY_BLOCKED');
    // Keep observation/node identities out of the website's JavaScript world.
    // Select a nested frame only when its public name/URL is unambiguous; never
    // guess between same-name/same-URL frames or grant cross-origin access.
    if(v.probePage!==v.page){await v.probeSession?.detach().catch(()=>{});v.probeSession=await v.ctx.newCDPSession(v.page);v.probePage=v.page;if(!v.probeCleanup){v.probeCleanup=true;v.ctx.once('close',()=>{v.probeSession?.detach().catch(()=>{});});}}
    const session=v.probeSession,{frameTree}=await session.send('Page.getFrameTree');
    const frames=[];const collect=tree=>{frames.push(tree.frame);for(const child of tree.childFrames??[])collect(child);};collect(frameTree);
    const matches=frame===v.page.mainFrame()?[frameTree.frame]:frames.filter(value=>value.url===frame.url()&&(value.name??'')===frame.name());
    if(matches.length!==1)throw Error('UNSUPPORTED_FRAME');
    const {executionContextId}=await session.send('Page.createIsolatedWorld',{frameId:matches[0].id,worldName:'Hermo locator inspection',grantUniveralAccess:false});
    const evaluated=await session.send('Runtime.callFunctionOn',{functionDeclaration:locatorProbeDocument.toString(),executionContextId,arguments:[{value:{...payload,require_ready:true,origin:url.origin,path_prefix:url.origin===sandboxOrigin?'/sandbox/':'/',expires_at:Date.now()+8000}}],returnByValue:true});
    if(evaluated.exceptionDetails)throw Error('PROBE_UNAVAILABLE');const result=evaluated.result.value;
    if(result?.hermo_error)throw Error(result.hermo_error);return result;
    };
    try{return await Promise.race([inspect(),interrupted]);}finally{clearTimeout(timer);}
  });}
  async function save(cid){const {ctx,page,allowed,connection}=get(cid),u=validateWebsite(page.url(),sandboxOrigin);if(!allowed.has(u.origin))throw new Error('CONNECTION_NOT_READY');return {storageState:connection.access==='public'?{cookies:[],origins:[]}:await ctx.storageState({indexedDB:true}),checkpoint:u.href};}
  async function navigate(cid,url){return exclusive(cid,async v=>{const u=validateWebsite(url,sandboxOrigin);if(!v.allowed.has(u.origin))throw new Error('POLICY_BLOCKED');const response=await v.page.goto(u.href,{waitUntil:'domcontentloaded'});v.lastSnapshot=undefined;if(!response||response.status()>=400)throw new Error('PAGE_UNAVAILABLE');});}
  async function addTab(cid,url){return exclusive(cid,async v=>{const u=validateWebsite(url,sandboxOrigin);if(!v.allowed.has(u.origin))throw new Error('POLICY_BLOCKED');const page=await v.ctx.newPage();v.page=page;v.lastSnapshot=undefined;try{await page.goto(u.href,{waitUntil:'domcontentloaded'});}catch{const state=v.pageState.get(page);if(state)state.error='NETWORK_FAILED';}});}
  async function demoLogin(cid){await exclusive(cid,async({page})=>{if(!page.url().startsWith(sandboxOrigin+'/sandbox/'))throw new Error('NOT_SANDBOX');await page.getByLabel('Email',{exact:true}).fill('alex@northstar.example');await page.getByLabel('Password',{exact:true}).fill('demo-only-local');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(sandboxOrigin+'/sandbox/orders');});}
  async function executeUnlocked(connection,definition,input,onProgress=()=>{},signal,beforeStep){
    definition=compileApprovalPolicy(definition);
    if(!validateCompletionPolicy(definition))throw Error('INVALID_WORKFLOW_CONTRACT');
    const check=()=>{if(signal?.aborted)throw signal.reason??Error('WORKFLOW_CANCELLED');};check();
    const executionDeadline=Date.now()+(definition.timeout_ms?Math.min(300000,Math.max(15000,definition.timeout_ms))-1000:25000);
    const invocationApproval=requiresInvocationApproval(definition);
    if((invocationApproval||definition.steps.some(step=>step.enabled!==false&&step.approval_required===true))&&typeof beforeStep!=='function')throw Error('APPROVAL_REQUIRED');
    if(invocationApproval){
      let timer,abort;
      const interrupted=new Promise((_,reject)=>{
        abort=()=>reject(signal.reason??Error('WORKFLOW_CANCELLED'));
        signal?.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>reject(Error('TIMEOUT')),Math.max(1,executionDeadline-Date.now()));
        if(signal?.aborted)abort();
      });
      try{await Promise.race([Promise.resolve().then(()=>{check();return beforeStep(-1);}),interrupted]);}
      finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
      check();if(Date.now()>=executionDeadline)throw Error('TIMEOUT');
    }
    const opening=context(connection,definition.effect!=='recorded_browser_actions',connection.managed_profile?.visibility==='visible',()=>!closed&&!signal?.aborted);
    // A slow launch must not hold the run past cancellation. Late context
    // creation is disposed without navigation and can never resume this run.
    const ready=signal?new Promise((resolve,reject)=>{
      const cancel=()=>reject(signal.reason??Error('WORKFLOW_CANCELLED'));signal.addEventListener('abort',cancel,{once:true});
      opening.then(value=>{signal.removeEventListener('abort',cancel);if(signal.aborted){value.ctx.close().catch(()=>{});cancel();}else resolve(value);},error=>{signal.removeEventListener('abort',cancel);reject(error);});
      if(signal.aborted)cancel();
    }):opening;
    const {ctx,page}=await ready,aborted=()=>{ctx.close().catch(()=>{});},deadline=executionDeadline,baselines=new Map(),priorMediaURLs=new Set(),observations={};signal?.addEventListener('abort',aborted,{once:true});
    let requestSerial=0,actionBoundary=1;
    const requests=new WeakMap(),responses=[];
    page.on('request',request=>requests.set(request,++requestSerial));
    page.on('response',response=>{
      const sequence=requests.get(response.request());if(sequence===undefined)return;
      responses.push({sequence,url:response.url(),method:response.request().method(),status:response.status()});
      if(responses.length>256)responses.shift();
    });
    const generated=definition.action_type==='generate_media',hasMutation=definition.steps.some(step=>step.enabled!==false&&['fill','select','check','click'].includes(step.op)),hasMediaURL=definition.outputs.some(field=>['src','href','poster'].includes(field.read_attribute));
    const evidenceFields=completionEvidenceFields(definition),lastAction=definition.steps.findLastIndex(step=>step.enabled!==false&&['navigate','fill','select','check','click'].includes(step.op));
    const freshFields=new Set([...evidenceFields,...definition.outputs.filter(field=>definition.verifiers.some(rule=>rule.kind==='changed'&&rule.output===field.name)||generated&&(hasMediaURL?['src','href','poster'].includes(field.read_attribute):true)).map(field=>field.name)]);
    const captureEvidence=async()=>{for(const field of definition.outputs.filter(field=>evidenceFields.has(field.name))){try{baselines.set(field.name,await readObservation(page,field));}catch(error){if(error.message!=='ACTION_UNAVAILABLE')throw error;baselines.set(field.name,{count:0});}}};
    const captureBaselines=async()=>{
      if([...freshFields].every(name=>baselines.has(name)))return;
      for(const field of definition.outputs.filter(field=>freshFields.has(field.name)&&!baselines.has(field.name))){try{baselines.set(field.name,await readObservation(page,field));}catch(error){if(error.message!=='ACTION_UNAVAILABLE')throw error;baselines.set(field.name,{text:'',count:0});}}
      if(generated&&hasMediaURL){const frames=new Set();for(const output of definition.outputs.filter(field=>['src','href','poster'].includes(field.read_attribute))){const frame=await targetFrame(page,output);if(frames.has(frame))continue;frames.add(frame);const doc=await frame.evaluate(inspectDocument,null);for(const item of doc.elements.filter(item=>['src','href','poster'].includes(item.read_attribute))){try{const value=await readObservation(page,{...item,frame_path:output.frame_path});if(value.text)priorMediaURLs.add(value.text);}catch(error){if(error.message!=='ACTION_UNAVAILABLE')throw error;}}}}
    };
    try{check();const identity=async()=>{if(!connection.identity)throw new Error('AUTH_REQUIRED');if(connection.access==='public'){
        const u=validateWebsite(page.url(),sandboxOrigin),doc=await page.evaluate(inspectDocument,null);if(connection.identity.kind!=='public_origin'||u.origin!==connection.identity.origin||doc.challenge||doc.denied||doc.authRejected||doc.networkError||doc.credentials)throw new Error('VERIFICATION_FAILED');return;
      }const target=locator(page,connection.identity);try{await target.waitFor({state:'visible',timeout:5000});}catch{throw new Error('AUTH_REQUIRED');}if(await target.count()!==1||(await target.innerText()).trim()!==connection.identity.text)throw new Error('AUTH_REQUIRED');};
      const visit=async(url,timeout)=>{check();const u=validateWebsite(url,sandboxOrigin);if(!connection.origins.includes(u.origin))throw new Error('POLICY_BLOCKED');let response;try{response=await page.goto(u.href,{waitUntil:'domcontentloaded',timeout:Math.max(1,Math.min(timeout??25000,deadline-Date.now()))});}catch(error){check();if(error.name==='TimeoutError')throw Error('TIMEOUT');throw error;}if(!response||response.status()>=400)throw new Error('VERIFICATION_FAILED');};
      await visit(connection.checkpoint??connection.url);await identity();
      if(!hasMutation)await captureBaselines();
      for(let i=0;i<definition.steps.length;i++){if(signal?.aborted)throw signal.reason??new Error('WORKFLOW_CANCELLED');const step=definition.steps[i];onProgress(i,definition.steps.length);
        if(step.enabled===false){onProgress(i,definition.steps.length,{phase:'skipped'});continue;}
        if(step.approval_required===true){
          // Approval authorizes this stored step only. No element handle or
          // previously observed website state survives the owner's decision.
          let timer,abort;
          const interrupted=new Promise((_,reject)=>{
            abort=()=>reject(signal.reason??Error('WORKFLOW_CANCELLED'));
            signal?.addEventListener('abort',abort,{once:true});
            timer=setTimeout(()=>reject(Error('TIMEOUT')),Math.max(0,deadline-Date.now()));
            if(signal?.aborted)abort();
          });
          try{await Promise.race([Promise.resolve().then(()=>{check();return beforeStep(i);}),interrupted]);}
          finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
          check();if(Date.now()>=deadline)throw Error('TIMEOUT');
          const current=validateWebsite(page.url(),sandboxOrigin);
          if(!connection.origins.includes(current.origin))throw Error('POLICY_BLOCKED');
          await identity();check();if(Date.now()>=deadline)throw Error('TIMEOUT');
        }
        if(i===lastAction&&step.op==='navigate'&&evidenceFields.size){await captureBaselines();await captureEvidence();}
        if(step.op.startsWith('wait_')){
          const passed=await runWorkflowWait(step,{deadline,signal,check,observe:async()=>{
            check();
            const actual=validateWebsite(page.url(),sandboxOrigin);if(!connection.origins.includes(actual.origin))throw Error('POLICY_BLOCKED');
            if(step.op==='wait_url'){
              const current=validateWebsite(page.url(),sandboxOrigin),expected=validateWebsite(step.url,sandboxOrigin);
              if(!connection.origins.includes(current.origin))throw Error('POLICY_BLOCKED');
              return current.origin===expected.origin&&(step.match==='contains'?(current.pathname+current.search+current.hash).includes(expected.pathname+expected.search+expected.hash):current.href===expected.href);
            }else if(step.op==='wait_navigation'){
              if(step.url&&actual.href!==validateWebsite(step.url,sandboxOrigin).href)return false;
              const state=await page.evaluate(()=>document.readyState);return step.state==='domcontentloaded'?state!=='loading':state==='complete';
            }else if(step.op==='wait_response'){
              const expected=validateWebsite(step.url,sandboxOrigin);if(!connection.origins.includes(expected.origin))throw Error('POLICY_BLOCKED');
              return responses.some(value=>value.sequence>=actionBoundary&&value.url===expected.href&&value.method===(step.method??'GET')&&(step.status===undefined||value.status===step.status));
            }else if(step.op==='wait_output'){
              const field=definition.outputs.find(field=>field.name===step.output);if(!field)throw Error('INVALID_WORKFLOW_CONTRACT');
              let value;
              if(field.source==='url_parameter')value=pageParameter(page.url(),field.template,field.parameter);
              else{let observation;try{observation=await readObservation(page,field);}catch(error){if(error.message==='ACTION_UNAVAILABLE')return false;throw error;}if(!extractionReady(field,observation)||observation.streaming)return false;value=observation.text;}
              return outputWaitMatches(step,convertOutputs([field],{[field.name]:value})[field.name]);
            }else{
              const target=await stepTarget(page,step,{missingAllowed:true});
              if(step.op==='wait_element')return step.state==='hidden'?!target||!await target.isVisible():!!target&&await target.isVisible()&&(step.state!=='enabled'||await target.isEnabled());
              else if(step.op==='wait_text')return !!target&&await target.isVisible()&&(await target.innerText()).includes(step.text);
              else throw Error('UNSUPPORTED_STEP');
            }
          }});
          if(!passed){onProgress(i,definition.steps.length,{phase:'skipped',warning:'WAIT_TIMEOUT_CONTINUED'});continue;}
        }else if(step.op==='navigate'){const url=step.path_parameter?pageTemplate(step.template,step.path_parameter,input[step.path_parameter]).url:step.url;actionBoundary=requestSerial+1;onProgress(i,definition.steps.length,{phase:'issuing'});await visit(url,step.timeout_ms);if(step.path_parameter&&page.url()!==url)throw new Error('VERIFICATION_FAILED');if(hasMutation){for(const name of baselines.keys())if(!evidenceFields.has(name)||i!==lastAction)baselines.delete(name);priorMediaURLs.clear();}}else{
        const actionDeadline=Math.min(deadline,Date.now()+(step.timeout_ms??8000));
        await captureBaselines();
        const target=await stepTarget(page,step,{deadline:actionDeadline,check}),value=step.parameter?browserInputValue(definition.inputs[step.parameter],input[step.parameter],step.op,step.value_path??[]):step.value;
        if(!await target.isVisible()||!await target.isEnabled())throw new Error('ACTION_UNAVAILABLE');
        if(i===lastAction&&evidenceFields.size)await captureEvidence();
        const authorize=()=>{check();if(Date.now()>=actionDeadline)throw Error('TIMEOUT');const current=validateWebsite(page.url(),sandboxOrigin);if(!connection.origins.includes(current.origin))throw Error('POLICY_BLOCKED');actionBoundary=requestSerial+1;onProgress(i,definition.steps.length,{phase:'issuing'});};
        authorize();
        await guardedStep(page,target,step,authorize,async element=>{
          const options={timeout:Math.max(1,actionDeadline-Date.now())};
          try{
          if(step.op==='fill')await element.fill(value,options);
          else if(step.op==='select')await element.selectOption(value,options);
          else if(step.op==='check'){if(!['true','false'].includes(value))throw new Error('VERIFICATION_FAILED');await element.setChecked(value==='true',options);}
          else if(step.op==='click'){await element.click(options);await page.waitForLoadState('domcontentloaded',{timeout:Math.max(1,actionDeadline-Date.now())});}
          else throw new Error('UNSUPPORTED_STEP');
          }catch(error){check();if(error.name==='TimeoutError')throw Error('TIMEOUT');throw error;}
        },i===lastAction&&evidenceFields.size?captureEvidence:undefined);}onProgress(i,definition.steps.length,{phase:'completed'});}
      onProgress(definition.steps.length,definition.steps.length,{phase:'verifying'});
      await identity();const result={};const extractionOrder=[...definition.outputs.filter(field=>evidenceFields.has(field.name)),...definition.outputs.filter(field=>!evidenceFields.has(field.name))];for(const field of extractionOrder){
        if(field.source==='url_parameter'){result[field.name]=pageParameter(page.url(),field.template,field.parameter);continue;}
        const baseline=baselines.get(field.name)??{text:'',count:0},fieldDeadline=generated||freshFields.has(field.name)?deadline:Math.min(deadline,Date.now()+8000);let previous,stableSince=Date.now(),value,settled=false,fresh=false;
        while(Date.now()<fieldDeadline){
          check();
          try{value=await readObservation(page,field);}catch(error){if(error.message!=='ACTION_UNAVAILABLE')throw error;value=undefined;}
          const signature=observationSignature(value);if(signature!==previous){previous=signature;stableSince=Date.now();}
          fresh=(evidenceFields.has(field.name)?!!value&&JSON.stringify(value.text)!==JSON.stringify(baseline.text):observationChanged(value,baseline))&&!(generated&&['src','href','poster'].includes(field.read_attribute)&&priorMediaURLs.has(value.text));
          if(extractionReady(field,value)&&!value.streaming&&(!freshFields.has(field.name)||fresh)&&Date.now()-stableSince>=600){if(value.text!==undefined)result[field.name]=value.text;observations[field.name]={fresh:!!fresh,stable:true,...evidenceFields.has(field.name)?{signature}:{}};settled=true;break;}
          await new Promise(done=>setTimeout(done,150));
        }
        if(!settled)throw Object.assign(new Error('VERIFICATION_FAILED'),{verification:{output:field.name,reason:!extractionReady(field,value)?'missing_output':value.streaming?'still_streaming':freshFields.has(field.name)&&!fresh?'not_fresh':'not_settled'}});
      }
      for(const field of definition.outputs.filter(field=>evidenceFields.has(field.name))){const current=await readObservation(page,field);if(current.streaming||observationSignature(current)!==observations[field.name]?.signature)throw Object.assign(Error('VERIFICATION_FAILED'),{verification:{output:field.name,reason:'completion_unverified'}});}
      await identity();
      const verification=verifyResult(definition,result,input,connection.access==='public'?'public_source_origin':'account_identity',observations);if(generated){if(![...freshFields].some(name=>observations[name]?.fresh))throw Object.assign(Error('VERIFICATION_FAILED'),{verification:{output:definition.outputs[0]?.name,reason:'not_fresh'}});verification.checks.push('fresh_generated_outputs');}
      const converted=convertOutputs(definition.outputs,result);
      if(connection.access!=='public'){check();await onSession(connection,{storageState:await ctx.storageState({indexedDB:true})});check();}
      return {result:converted,verification};
    }catch(error){
      // Cancellation owns its cause even when it closes the browser context.
      check();
      const browser=ctx.browser?.();
      if(browser&&!browser.isConnected())throw Object.assign(Error('BROWSER_DISCONNECTED'),{phase:'managed_browser'});
      throw error;
    }finally{signal?.removeEventListener('abort',aborted);await ctx.close();}
  }
  async function execute(connection,...args){
    const studio=studios.get(connection.id);
    if(executing.has(connection.id)||studio?.busy||studio?.snapshotTask)throw Error('BROWSER_BUSY');
    executing.add(connection.id);try{await close(connection.id);return await executeUnlocked(connection,...args);}finally{executing.delete(connection.id);scheduleIdle();}
  }
  async function closeStudios(){studioGeneration++;for(const cid of [...studios.keys()])await close(cid);}
  return {open,openDesktop,close,isOpen,snapshot,element,operate,read,probeTarget,save,navigate,addTab,demoLogin,execute,interact,allowOrigins,closeStudios,forgetProfile:cid=>profileVault?.forget(cid),hasDiskProfile:cid=>profileVault?.has(cid)??false,isProfileBusy:cid=>executing.has(cid)||studios.get(cid)?.busy===true,async closeAll(){closed=true;clearTimeout(idleTimer);await Promise.allSettled([...starting.values(),...pendingContexts]);await Promise.allSettled([...contexts].map(ctx=>ctx.close()));await Promise.allSettled([...browsers.values()].map(browser=>browser.close()));browsers.clear();if(contexts.size)throw Object.assign(Error('MANAGED_PROFILE_BUSY'),{code:'MANAGED_PROFILE_BUSY'});profileLocks?.close();}};
}
