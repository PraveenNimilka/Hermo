// Retain the operator's observed message structure instead of replacing it
// with attributes that the recorded page may never have exposed.
export function recordedChatOutputs(definition){
  if(definition.outputs.some(field=>field.frame_path?.length))return;
  const recorded=definition.chat_recording??Object.fromEntries(definition.outputs.map(field=>[field.name,field.selector]));
  const split=value=>typeof value==='string'?value.split(' > '):[];
  const user=split(recorded.prompt_echo),reply=split(recorded.response);
  if(user[0]!=='[aria-label="Conversation"]'||reply[0]!==user[0]||user.length>120||reply.length>120)return;
  const part=/^(div|span|p|pre|section|article):nth-of-type\([1-9]\d?\)$/;
  if(!user.slice(1).every(x=>part.test(x))||!reply.slice(1).every(x=>part.test(x)))return;
  let shared=1;while(shared<Math.min(user.length,reply.length)&&user[shared]===reply[shared])shared++;
  // Two independently recorded, ordered message branches under one turn.
  // Arbitrary page text, toolbar controls and unrelated selectors are rejected.
  if(shared<2||user[shared]!=='div:nth-of-type(1)'||reply[shared]!=='div:nth-of-type(2)'||reply.at(-1)!=='p:nth-of-type(1)')return;
  const prefix=user.slice(0,shared).map((value,index)=>index&&value.endsWith(':nth-of-type(1)')?value.replace(':nth-of-type(1)',':nth-of-type(n)'):value);
  // Some renderers append a group per exchange; others append user/reply
  // siblings in one list. Both retain the observed odd/even message branches.
  const selector=path=>[...prefix,path[shared].replace(':nth-of-type(1)',':nth-of-type(2n+1)').replace(':nth-of-type(2)',':nth-of-type(2n)'),...path.slice(shared+1)].join(' > ');
  // The paragraph's container owns the whole rich reply, including subsequent
  // paragraphs/code. Reading the recorded p:first would truncate the result.
  return {recorded:{prompt_echo:recorded.prompt_echo,response:recorded.response},outputs:[
    {name:'prompt_echo',selector:selector(user),frame_path:[],read_mode:'last'},
    {name:'response',selector:selector(reply.slice(0,-1)),frame_path:[],read_mode:'last'}
  ]};
}
