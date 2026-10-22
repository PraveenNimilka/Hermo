import test from 'node:test';
import assert from 'node:assert/strict';
import {repairChatDefinition} from '../server/repair-chat.mjs';

const draft=()=>({inputs:{prompt:{type:'string',example:'first'}},steps:[{op:'navigate',url:'https://chatgpt.com/'},{op:'fill',selector:'#old-editor',parameter:'prompt'},{op:'click',selector:'#obsolete-sidebar'},{op:'click',selector:'[aria-label="Send"]'},{op:'click',selector:'[aria-label="Copy"]'}],outputs:[{name:'prompt_echo',selector:'#old-user'},{name:'response',selector:'#old-assistant'}]});
const editor=[{kind:'input',type:'editor',selector:'[aria-label="Ask\\ ChatGPT"]'}];

test('repair preserves stable action identities and approval authority without moving removed gates',()=>{
  const value=draft();value.steps[1]={...value.steps[1],id:'step_original_fill',approval_required:true,risk:'high',label:'Recorded prompt',timeout_ms:2000};value.steps[3].id='step_original_send';
  value.approval_policy={mode:'selected_steps',steps:[2,4]};
  const fixed=repairChatDefinition(value,editor,{url:'https://chatgpt.com/'});
  assert.deepEqual(fixed.steps.map(step=>step.id),['step_original_fill','step_original_send']);assert.equal(fixed.steps[0].approval_required,true);assert.equal(fixed.steps[0].risk,'high');assert.equal(fixed.steps[0].timeout_ms,2000);
  assert.deepEqual(fixed.approval_policy,{mode:'selected_steps',steps:[1,2]});assert.deepEqual(value.approval_policy.steps,[2,4]);
  value.approval_policy={mode:'every_invocation'};assert.deepEqual(repairChatDefinition(value,editor,{url:'https://chatgpt.com/'}).approval_policy,value.approval_policy);
  value.approval_policy={mode:'selected_steps',steps:[1]};assert.throws(()=>repairChatDefinition(value,editor,{url:'https://chatgpt.com/'}),{message:'CHAT_REPAIR_NOT_READY'});
});
test('repair a positional ChatGPT draft on an empty new chat without a prior reply',()=>{
  const d=draft(),before=structuredClone(d),fixed=repairChatDefinition(d,editor,{url:'https://chatgpt.com/'});
  assert.deepEqual(d,before,'repair construction does not mutate the existing definition');
  assert.deepEqual(fixed.steps,[{op:'fill',selector:editor[0].selector,frame_path:[],parameter:'prompt'},d.steps[3]]);
  assert.equal(fixed.outputs.length,2);
  assert.deepEqual(fixed.outputs.map(x=>[x.name,x.selector,x.read_mode]),[['prompt_echo','[data-message-author-role="user"],[data-turn="user"]','last'],['response','[data-message-author-role="assistant"],[data-turn="assistant"]','last']]);
  assert.deepEqual(fixed.verifiers,[{output:'prompt_echo',input:'prompt'}]);
  assert.equal(fixed.inputs.prompt.normalization,'trim');
});

test('repair is repeatable without a navigation step and preserves the selected conversation',()=>{
 const fixed=repairChatDefinition(draft(),editor,{url:'https://chatgpt.com/c/existing'});
 assert.equal(fixed.steps.some(x=>x.op==='navigate'),false);
 assert.deepEqual(repairChatDefinition(fixed,editor,{url:'https://chatgpt.com/c/existing'}),fixed);
});
test('empty-page repair does not assume ChatGPT message markup for other origins',()=>{
  for(const url of ['https://example.com/','https://chatgpt.com.example.com/','http://chatgpt.com/'])assert.throws(()=>repairChatDefinition(draft(),editor,{url}),/CHAT_REPAIR_NOT_READY/);
});
test('repair requires one editor and the original semantic Send instead of guessing a button',()=>{
  assert.throws(()=>repairChatDefinition(draft(),[],{url:'https://chatgpt.com/'}));
  assert.throws(()=>repairChatDefinition(draft(),[...editor,...editor],{url:'https://chatgpt.com/'}));
  const d=draft();d.steps[3].selector='#button-at-position-42';assert.throws(()=>repairChatDefinition(d,editor,{url:'https://chatgpt.com/'}));
});
test('empty-page repair may retain a previously recorded supported message contract on other sites',()=>{
  const d=draft();d.steps[0].url='https://example.com/';d.outputs=[{name:'prompt_echo',selector:'[data-turn="user"]',read_mode:'last'},{name:'response',selector:'[data-turn="assistant"]',read_mode:'last'}];
  const fixed=repairChatDefinition(d,editor,{url:'https://example.com/'});
  assert.equal(fixed.outputs[1].selector,'[data-turn="assistant"]');
});
