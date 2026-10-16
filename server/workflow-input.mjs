import {z} from 'zod';
import {inputValueSchema} from './workflow-contract.mjs';

// Opt-in normalization happens before hashing, persistence and browser replay.
// Verification still compares the observed output to the exact submitted value.
export function workflowInputSchema(inputs){
  return z.object(Object.fromEntries(Object.entries(inputs).map(([name,field])=>{
    const schema=inputValueSchema(field);
    // prefault runs defaults through the constraints and normalization too.
    return [name,Object.hasOwn(field,'default')&&field.default!==undefined?schema.prefault(field.default):field.required===false?schema.optional():schema];
  }))).strict();
}

export function chatPromptInputs(inputs){
  return {...inputs,prompt:{...inputs.prompt,normalization:'trim',...typeof inputs.prompt.example==='string'?{example:inputs.prompt.example.trim()}:{}}};
}
