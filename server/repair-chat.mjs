import {recordedChatOutputs} from './recorded-chat.mjs';
import {chatPromptInputs} from './workflow-input.mjs';

export function repairChatDefinition(definition,elements,{url}={}){
  const one=items=>{if(items.length!==1)throw Error('CHAT_REPAIR_NOT_READY');return items[0];};
  if(Object.keys(definition.inputs).join(',')!=='prompt'||!definition.outputs.some(x=>x.name==='response')||!definition.outputs.some(x=>x.name==='prompt_echo'))throw Error('CHAT_REPAIR_NOT_READY');
  const navigation=definition.steps.find(x=>x.op==='navigate'&&!x.path_parameter),editor=one(elements.filter(x=>x.kind==='input'&&x.type==='editor'));
  // Retain only a recorded Send with an explicit semantic selector. Never guess a button by position.
  const send=one(definition.steps.filter(x=>x.op==='click'&&/^\[(aria-label|data-testid)="(Send|Send\\ message|Send message|send-button)"\]$/.test(x.selector)));
  const sendIndex=definition.steps.indexOf(send),fill=definition.steps.slice(0,sendIndex).findLast(step=>step.op==='fill'&&step.parameter==='prompt');
  const retained=Object.fromEntries(['id','enabled','approval_required','risk','label','timeout_ms'].filter(key=>fill?.[key]!==undefined).map(key=>[key,fill[key]]));
  let approvalPolicy=definition.approval_policy;
  if(approvalPolicy?.mode==='selected_steps'){
    const fillIndex=definition.steps.indexOf(fill);
    // Removing an explicitly protected action needs a deliberate policy edit,
    // not an inferred transfer of its approval to a different action.
    if(approvalPolicy.steps.some(number=>number!==fillIndex+1&&number!==sendIndex+1))throw Error('CHAT_REPAIR_NOT_READY');
    approvalPolicy={...approvalPolicy,steps:approvalPolicy.steps.map(number=>number===fillIndex+1?1:2).sort((a,b)=>a-b)};
  }
  let chatgpt=false;try{chatgpt=new URL(url).origin==='https://chatgpt.com'&&(!navigation||new URL(navigation.url).origin==='https://chatgpt.com');}catch{}
  const observed=chatgpt?recordedChatOutputs(definition):undefined;
  // Repair is not verification. An empty chat may use the supported message
  // contract; execution must still observe fresh, nonempty, completed outputs.
  const message=(role,name,label)=>{
    const detected=elements.filter(x=>x.kind==='output'&&x.read_mode==='last'&&x.label===label);
    if(detected.length)return one(detected);
    const queries=['[data-message-author-role="'+role+'"]','[data-turn="'+role+'"]'];
    const prior=definition.outputs.filter(x=>x.name===name&&x.read_mode==='last'&&!x.frame_path?.length&&[...queries,queries.join(','),':hermo-latest-'+role].includes(x.selector));
    if(prior.length===1)return prior[0];
    if(chatgpt)return {selector:queries.join(','),frame_path:[],read_mode:'last'};
    throw Error('CHAT_REPAIR_NOT_READY');
  };
  const submitted=observed?.outputs[0]??message('user','prompt_echo','Latest submitted message'),response=observed?.outputs[1]??message('assistant','response','Latest assistant response');
  // The connection already binds the selected tab and origin. Reopening its
  // checkpoint on every send resets chat history; continue in that tab.
  return {effect:'recorded_browser_actions',inputs:chatgpt?chatPromptInputs(definition.inputs):{prompt:definition.inputs.prompt},steps:[{...retained,op:'fill',selector:editor.selector,frame_path:editor.frame_path??[],parameter:'prompt'},send],outputs:[{name:'prompt_echo',selector:submitted.selector,frame_path:submitted.frame_path??[],read_mode:'last'},{name:'response',selector:response.selector,frame_path:response.frame_path??[],read_mode:'last'}],...approvalPolicy?{approval_policy:structuredClone(approvalPolicy)}:{},...observed?{chat_recording:observed.recorded}:{},verifiers:[{output:'prompt_echo',input:'prompt'}]};
}
