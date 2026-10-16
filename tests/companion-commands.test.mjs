import test from 'node:test';
import assert from 'node:assert/strict';
import {executeBrowserCommand} from '../companion/browser/commands.mjs';

function fixture(){
  const state={ready:false,mutations:0,checks:0};
  const doc={login:false,credentials:false,challenge:false,authRejected:false,denied:false,networkError:false,elements:[]};
  const chrome={tabs:{get:async()=>({url:'https://example.test/task',status:'complete'})},scripting:{executeScript:async({func,args})=>{
    if(func.name==='operateDocument'){
      if(args[0].op==='ready'){state.checks++;return [{result:state.ready?true:{hermo_error:'ACTION_UNAVAILABLE'}}];}
      state.mutations++;return [{result:true}];
    }
    return [{result:doc}];
  }}};
  return {state,run:options=>executeBrowserCommand({chrome,tabId:1,origin:'https://example.test',command:{op:'operate',kind:'click',selector:'#submit'},inspect:function inspect(){},...options})};
}

test('Stop during control readiness prevents the later website click',async()=>{
  const {state,run}=fixture(),controller=new AbortController();
  const result=run({signal:controller.signal,deadline:Date.now()+5000});
  await new Promise(resolve=>setTimeout(resolve,30));assert.ok(state.checks>0);
  controller.abort();state.ready=true;
  await assert.rejects(result,{message:'COMMAND_CANCELLED'});
  await new Promise(resolve=>setTimeout(resolve,180));assert.equal(state.mutations,0);
});

test('expired command authority cannot operate a control that becomes ready later',async()=>{
  const {state,run}=fixture();
  const result=run({deadline:Date.now()+50});
  await new Promise(resolve=>setTimeout(resolve,80));state.ready=true;
  await assert.rejects(result,{message:'TIMEOUT'});assert.equal(state.mutations,0);
});

test('runtime reauthorization happens after readiness and before browser mutation',async()=>{
  const {state,run}=fixture();state.ready=true;let checks=0;
  await assert.rejects(run({beforeMutation:async()=>{checks++;throw Error('BROWSER_COMMAND_EXPIRED');}}),{message:'BROWSER_COMMAND_EXPIRED'});
  assert.equal(checks,1);assert.equal(state.mutations,0);
});

test('Stop while runtime reauthorization is pending prevents browser mutation',async()=>{
  const {state,run}=fixture();state.ready=true;const controller=new AbortController();let authorize;
  const authorization=new Promise(resolve=>{authorize=resolve;});
  const result=run({signal:controller.signal,beforeMutation:()=>authorization});
  await new Promise(resolve=>setTimeout(resolve,10));controller.abort();authorize();
  await assert.rejects(result,{message:'COMMAND_CANCELLED'});assert.equal(state.mutations,0);
});
