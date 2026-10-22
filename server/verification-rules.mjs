import {z} from 'zod';

const field=z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),token=z.union([field,z.number().int().min(0).max(99)]);
const path=z.array(token).max(4),scalar=z.union([z.string().max(4096),z.number().finite(),z.boolean()]);
const operator=z.enum(['eq','ne','lt','lte','gt','gte']);
export const verifierSchema=z.union([
  z.object({output:field,input:field}).strict(),
  z.object({kind:z.literal('equals_input'),output:field,input:field}).strict(),
  ...['nonempty','url','changed'].map(kind=>z.object({kind:z.literal(kind),output:field}).strict()),
  z.object({kind:z.literal('number'),output:field,unit:z.string().trim().min(1).max(30).optional()}).strict(),
  z.object({kind:z.literal('contains'),output:field,value:z.string().trim().min(1).max(300)}).strict(),
  z.object({kind:z.literal('unique'),output:field,path:path.optional()}).strict(),
  z.object({kind:z.literal('rows'),output:field,path,operator:z.enum(['eq','ne','lt','lte','gt','gte','contains']),value:scalar,quantifier:z.enum(['all','some','exactly_one'])}).strict(),
  z.object({kind:z.literal('compare'),output:field,path:path.optional(),operator,other_output:field,other_path:path.optional()}).strict(),
  z.object({kind:z.literal('completion'),output:field,evidence:field}).strict()
]);

export function mappingAt(mapping,path=[]){
  for(const part of path){
    if(typeof part==='number')mapping=mapping?.type==='array'?mapping.items:undefined;
    else mapping=mapping?.type==='object'?mapping.fields?.find(child=>child.name===part):undefined;
  }
  return mapping;
}
const scalarType=mapping=>mapping?.type==='integer'?'number':mapping?.type==='url'?'string':mapping?.type??(mapping?'string':undefined);
const isScalar=mapping=>['string','number','boolean'].includes(scalarType(mapping));
const comparable=(mapping,op)=>isScalar(mapping)&&(!['lt','lte','gt','gte'].includes(op)||scalarType(mapping)==='number');
export function validateVerifierReferences(rules,outputs,inputs){
  return Array.isArray(rules)&&rules.every(candidate=>{
    const parsed=verifierSchema.safeParse(candidate);if(!parsed.success)return false;
    const rule=parsed.data,mapping=outputs.find(output=>output.name===rule.output),kind=rule.kind??'equals_input';
    if(!mapping)return false;
    if(kind==='unique')return mapping.type==='array'&&(!rule.path?.length||isScalar(mappingAt(mapping.items,rule.path)));
    if(kind==='rows'){
      const leaf=mappingAt(mapping.items,rule.path);
      return mapping.type==='array'&&comparable(leaf,rule.operator)&&typeof rule.value===scalarType(leaf)&&(rule.operator!=='contains'||scalarType(leaf)==='string');
    }
    if(kind==='compare'){
      const leaf=mappingAt(mapping,rule.path),other=mappingAt(outputs.find(output=>output.name===rule.other_output),rule.other_path);
      return comparable(leaf,rule.operator)&&comparable(other,rule.operator)&&scalarType(leaf)===scalarType(other);
    }
    if(kind==='completion'){
      const evidence=outputs.find(output=>output.name===rule.evidence);
      return rule.output!==rule.evidence&&evidence?.required!==false&&!evidence?.nullable&&!evidence?.source&&!evidence?.read_mode&&!evidence?.read_attribute&&!evidence?.media_type&&!evidence?.frame_path?.length&&!!evidence?.selector&&['string','number'].includes(scalarType(evidence));
    }
    if(!isScalar(mapping)&&!['nonempty','changed'].includes(kind))return false;
    if(kind==='equals_input')return Object.hasOwn(inputs,rule.input)&&['string','number','integer','boolean'].includes(inputs[rule.input].type??'string')&&!inputs[rule.input].nullable&&(inputs[rule.input].required!==false||Object.hasOwn(inputs[rule.input],'default')&&inputs[rule.input].default!==undefined);
    return true;
  });
}

export function validateCompletionPolicy(definition){
  const rules=definition.verifiers??[],completion=rules.filter(rule=>rule.kind==='completion');
  if(!completion.length)return true;
  // A marker is explicitly selected by the author; it cannot prove completion
  // merely by existing, nor can another marker recursively vouch for it.
  const evidence=new Set(completion.map(rule=>rule.evidence));
  return definition.action_type!=='generate_media'&&definition.steps?.some(step=>step.enabled!==false&&['navigate','fill','select','check','click'].includes(step.op))&&completion.every(rule=>!evidence.has(rule.output));
}
export const completionEvidenceFields=definition=>new Set((definition.verifiers??[]).filter(rule=>rule.kind==='completion').map(rule=>rule.evidence));
export const completionResultFields=definition=>new Set((definition.verifiers??[]).filter(rule=>rule.kind==='completion').map(rule=>rule.output));
export function verificationRuleSummaries(rules=[]){
  return rules.map(rule=>Object.fromEntries(Object.entries({...rule,kind:rule.kind??'equals_input'}).filter(([key])=>['kind','output','input','path','other_output','other_path','operator','quantifier','evidence'].includes(key))));
}
export function valueAt(value,path=[]){for(const part of path){if(value===null||typeof value!=='object'||!Object.hasOwn(value,part))return undefined;value=value[part];}return value;}
export const canonicalValue=value=>JSON.stringify(canonical(value));
function canonical(value){return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;}
export function compareValues(left,right,operator){
  if(left===undefined||left===null||right===undefined||right===null||typeof left!==typeof right)return false;
  if(operator==='eq')return left===right;if(operator==='ne')return left!==right;
  if(operator==='contains')return typeof left==='string'&&left.includes(right);
  if(typeof left!=='number'||!Number.isFinite(left)||!Number.isFinite(right))return false;
  return {lt:left<right,lte:left<=right,gt:left>right,gte:left>=right}[operator]===true;
}
