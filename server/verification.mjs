import {z} from 'zod';
import {convertOutputs} from './workflow-contract.mjs';
const field=z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
export const verifierSchema=z.union([
  z.object({output:field,input:field}).strict(),
  z.object({kind:z.literal('equals_input'),output:field,input:field}).strict(),
  z.object({kind:z.literal('nonempty'),output:field}).strict(),
  z.object({kind:z.literal('url'),output:field}).strict(),
  z.object({kind:z.literal('changed'),output:field}).strict(),
  z.object({kind:z.literal('number'),output:field,unit:z.string().trim().min(1).max(30).optional()}).strict(),
  z.object({kind:z.literal('contains'),output:field,value:z.string().trim().min(1).max(300)}).strict()
]);
export function validateVerifiers(rules,outputs,inputs){
  return rules.every(rule=>outputs.some(o=>o.name===rule.output&&(!['object','array'].includes(o.type)||['nonempty','changed'].includes(rule.kind)))&&(!rule.input||Object.hasOwn(inputs,rule.input)&&(inputs[rule.input].required!==false||Object.hasOwn(inputs[rule.input],'default')&&inputs[rule.input].default!==undefined)));
}
export function verifyResult(definition,result,input,sourceCheck,observations={}){
  const checks=[sourceCheck,'nonempty_outputs'];
  const reject=(output,reason)=>{throw Object.assign(Error('VERIFICATION_FAILED'),{verification:{output,reason}});};
  const converted=convertOutputs(definition.outputs,result);
  const nonempty=value=>value!==null&&value!==undefined&&(typeof value==='string'?!!value.trim():Array.isArray(value)?value.length>0:typeof value==='object'?Object.keys(value).length>0:true);
  for(const rule of definition.verifiers){
    const value=result[rule.output],kind=rule.kind??'equals_input',mapping=definition.outputs.find(output=>output.name===rule.output);
    if(['object','array'].includes(mapping?.type)&&!['changed','nonempty'].includes(kind))reject(rule.output,'invalid_structure');
    if(kind==='equals_input'){
      if(input[rule.input]===undefined||value!==String(input[rule.input]))throw Object.assign(Error('VERIFICATION_FAILED'),{verification:{output:rule.output,input:rule.input,reason:'input_mismatch'}});
      checks.push(rule.output+'_matches_'+rule.input);
    }else if(kind==='url'){
      let url;try{url=new URL(value);}catch{reject(rule.output,'invalid_url');}
      if(!['https:','http:'].includes(url.protocol)||url.username||url.password)reject(rule.output,'invalid_url');
      checks.push(rule.output+'_url');
    }else if(kind==='changed'){
      if(observations[rule.output]?.fresh!==true)reject(rule.output,'not_fresh');
      checks.push(rule.output+'_changed');
    }else if(kind==='number'){
      if(typeof value!=='string')reject(rule.output,'invalid_number');
      const match=/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*(°\s*[CF]|%|[A-Za-z/]+)?$/.exec(value.trim());
      if(!match)reject(rule.output,'invalid_number');
      if(rule.unit&&(match[1]??'').replace(/\s/g,'')!==rule.unit.replace(/\s/g,''))reject(rule.output,'unit_mismatch');
      checks.push(rule.output+'_number');
    }else if(kind==='contains'){
      if(typeof value!=='string'||!value.includes(rule.value))reject(rule.output,'context_mismatch');checks.push(rule.output+'_context');
    }else{if(!nonempty(converted[rule.output]))reject(rule.output,'missing_output');checks.push(rule.output+'_nonempty');}
  }
  if(definition.outputs.some(output=>Object.hasOwn(output,'type')))checks.push('output_schema');
  return {verified_at:new Date().toISOString(),observed_at:new Date().toISOString(),verifier_version:definition.version,checks};
}
