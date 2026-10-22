// Acceptance-only Chrome harness. CDP opens the production companion popup;
// all workflow operations still travel through its normal authorized transport.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const sleep=ms=>new Promise(done=>setTimeout(done,ms));
export async function createCompanionSession({origin,owner,connection,url,browserPath=process.env.HERMO_BROWSER_PATH??process.env.HERMO_CHROME_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe'}){
  const context=await chromium.launchPersistentContext('',{headless:true,chromiumSandbox:true,viewport:{width:1280,height:900},executablePath:browserPath,args:['--enable-unsafe-extension-debugging'],ignoreDefaultArgs:['--disable-extensions']});
  try{
    const cdp=await context.browser().newBrowserCDPSession(),{id:extensionId}=await cdp.send('Extensions.loadUnpacked',{path:resolve('companion/browser')});
    const evaluate=async(targetId,expression)=>{
      const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:false});
      try{return await new Promise((done,reject)=>{
        const listener=event=>{if(event.sessionId!==sessionId)return;const message=JSON.parse(event.message);if(message.id!==79)return;clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',listener);if(message.error||message.result?.exceptionDetails)reject(Error('Companion popup evaluation failed'));else done(message.result.result.value);};
        const timer=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',listener);reject(Error('Companion popup evaluation timed out'));},15000);
        cdp.on('Target.receivedMessageFromTarget',listener);
        cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:79,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true,userGesture:true}})}).catch(reject);
      });}finally{await cdp.send('Target.detachFromTarget',{sessionId}).catch(()=>{});}
    };
    const site=await context.newPage();await site.goto(url);
    await site.bringToFront();const grant=await owner(`/studio/connections/${connection.id}/browser-link`,{authorized:true});
    const tab=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos.find(item=>item.url===site.url());assert.ok(tab,'Selected Chrome website tab exists');
    await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:tab.targetId});
    let popup;
    for(let attempt=0;attempt<100;attempt++){
      popup=(await cdp.send('Target.getTargets')).targetInfos.find(item=>item.url.endsWith('/popup.html'));
      if(popup&&await evaluate(popup.targetId,"document.documentElement?.dataset.hermoReady==='true'").catch(()=>false))break;
      await sleep(100);
    }
    assert.ok(popup,'Production companion popup opened');
    await evaluate(popup.targetId,`document.querySelector('#workspace').value=${JSON.stringify(origin)};document.querySelector('#code').value=${JSON.stringify(grant.code)};document.querySelector('#authorize').checked=true;document.querySelector('#pair').requestSubmit();true`);
    let linked=false;
    for(let attempt=0;attempt<100;attempt++){linked=(await owner(`/studio/connections/${connection.id}/browser-link`)).linked;if(linked)break;await sleep(100);}
    assert.equal(linked,true,'Production companion paired with the selected Chrome tab');
    await cdp.send('Target.closeTarget',{targetId:popup.targetId}).catch(error=>{if(!error.message.includes('No target with given id'))throw error;});
    await site.locator('#hermo-connection-panel').waitFor();
    return {context,site,browserVersion:context.browser().version(),close:()=>context.close()};
  }catch(error){await context.close();throw error;}
}
