import test from 'node:test';
import assert from 'node:assert/strict';
import {executeBrowserCommand} from '../companion/browser/commands.mjs';
import {previewDocument} from '../companion/browser/preview-interaction.mjs';

function fixture(){
  const state={url:'https://example.test/task',inspections:0,registrations:[],captures:0,unsafe:false,active:2};
  const inspect=function inspect(){};
  const chrome={tabs:{get:async()=>({id:1,windowId:5,url:state.url,title:'Website'}),query:async()=>[{id:state.active}],captureVisibleTab:async()=>{state.captures++;return 'data:image/jpeg;base64,YWJj';}},scripting:{executeScript:async({func,args,target,world})=>{
    assert.deepEqual(target,{tabId:1});assert.equal(world,'ISOLATED');
    if(func===previewDocument){assert.equal(args[0].op,'register');state.registrations.push(args[0]);return [{result:'fixture-preview-frame'}];}
    assert.equal(func,inspect,'unexpected script must not masquerade as a page inspection');state.inspections++;
    return [{result:{elements:[{kind:'output',read_mode:'last',semantic_role:'assistant'}],login:false,credentials:state.unsafe,challenge:false,authRejected:false,denied:false,networkError:false}}];
  }}};
  const frame=()=>({state:'live',image:'YWJj',captured_at:Date.now(),width:1200,height:800});
  return {state,frame,run:options=>executeBrowserCommand({chrome,tabId:1,origin:'https://example.test',command:{op:'snapshot',visual:true},inspect,...options})};
}
test('live frames are delivered for only the authorized background tab',async()=>{
  const {run,frame,state}=fixture(),value=await run({getVisualFrame:async()=>frame()});
  assert.equal(value.image,'YWJj');assert.equal(value.preview.state,'live');assert.equal(value.preview.width,1200);assert.equal(state.inspections,2);assert.equal(state.captures,0);
  assert.equal(value.preview.interaction_id,'fixture-preview-frame');assert.equal(state.registrations.length,1);
  const registration=state.registrations[0];assert.equal(registration.origin,'https://example.test');assert.equal(registration.path_prefix,'/');assert.equal(registration.captured_at,value.preview.captured_at);assert.equal(registration.width,1200);assert.equal(registration.height,800);assert.deepEqual(registration.elements,value.doc.elements);
});
test('visual access disabled never captures another active tab',async()=>{
  for(const active of [1,2]){
    const {run,state}=fixture();state.active=active;const value=await run({getVisualFrame:async()=>({state:'disabled'})});
    assert.equal(value.image,'');assert.equal(value.preview.state,'disabled');assert.equal(state.captures,0,'neither the paired nor another active tab is captured without preview consent');
    assert.equal(state.registrations.length,0,'disabled visual access cannot register an interactive frame');
  }
});
test('sign-in and verification pages cannot leak visual frames',async()=>{
  const {run,state,frame}=fixture();state.unsafe=true;let sampled=false;
  const value=await run({getVisualFrame:async()=>{sampled=true;return frame();}});assert.equal(value.image,'');assert.equal(value.preview.state,'blocked');assert.equal(sampled,false);
  assert.equal(state.registrations.length,0,'unsafe pages cannot register interactive preview targets');
});
test('navigation or newly displayed credentials discard an in-flight visual frame',async()=>{
  for(const change of ['navigation','credentials']){
    const {run,state,frame}=fixture(),value=await run({getVisualFrame:async()=>{if(change==='navigation')state.url='https://example.test/other';else state.unsafe=true;return frame();}});
    assert.equal(value.image,'');assert.ok(['blocked','unavailable'].includes(value.preview.state));assert.equal(state.captures,0);
  }
});
test('stale, oversized, malformed and unbounded frames are not presented as live',async()=>{
  for(const patch of [{captured_at:Date.now()-10000},{image:'a'.repeat(600001)},{image:'<svg>'},{width:99999},{captured_at:Date.now()+100000}]){
    const {run,frame}=fixture(),value=await run({getVisualFrame:async()=>({...frame(),...patch})});assert.equal(value.image,'');assert.equal(value.preview.state,'unavailable');
  }
});
test('ending command authority or leaving the origin discards visual frames',async()=>{
  const {run,frame}=fixture(),controller=new AbortController();
  await assert.rejects(run({signal:controller.signal,getVisualFrame:async()=>{controller.abort();return frame();}}),{message:'COMMAND_CANCELLED'});
  const other=fixture();await assert.rejects(other.run({getVisualFrame:async()=>{other.state.url='https://other.test/';return other.frame();}}),{message:'ORIGIN_CHANGED'});
});
