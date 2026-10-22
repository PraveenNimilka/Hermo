import {z} from 'zod';
import {inputValueSchema,inputJsonSchema,boundedInputJson} from './input-contract.mjs';
export {canonicalInput,inputBindingField} from './input-contract.mjs';

const bounded=z.unknown().superRefine((value,context)=>{if(!boundedInputJson(value))context.addIssue({code:'custom',message:'INVALID_WORKFLOW_INPUT'});});
export const jsonInputSchema=bounded.pipe(z.record(z.string(),z.unknown())).meta({type:'object',additionalProperties:{}});

// Opt-in normalization happens before hashing, persistence and browser replay.
// Verification still compares the observed output to the exact submitted value.
export function workflowInputSchema(inputs){
  const schema=z.object(Object.fromEntries(Object.entries(inputs).map(([name,field])=>{
    const schema=inputValueSchema(field);
    // prefault runs defaults through the constraints and normalization too.
    return [name,Object.hasOwn(field,'default')&&field.default!==undefined?schema.prefault(field.default):field.required===false?schema.optional():schema];
  }))).strict();
  return bounded.pipe(schema).superRefine((value,context)=>{if(!boundedInputJson(value))context.addIssue({code:'custom',message:'INVALID_WORKFLOW_INPUT'});}).meta(inputJsonSchema(inputs));
}

export function chatPromptInputs(inputs){
  return {...inputs,prompt:{...inputs.prompt,normalization:'trim',...typeof inputs.prompt.example==='string'?{example:inputs.prompt.example.trim()}:{}}};
}
