import {z} from 'zod';
import {validateOutputMappings} from './output-mappings.mjs';
import {scalarConstraintIssue,outputValueKey,outputConstraintKeys} from './output-constraints.mjs';
import {validateVerifierReferences,validateCompletionPolicy} from './verification-rules.mjs';
import {resolveApprovalPolicy} from './approval-policy.mjs';
import {PATH_INPUT_PATTERN,inputFieldSchema,inputBindingField,inputBindingValue} from './input-contract.mjs';
export {PATH_INPUT_PATTERN,inputFieldSchema,inputValueSchema,inputJsonSchema,inputBindingField} from './input-contract.mjs';
export {outputMappingSchema,validateOutputMappings,browserOutputMapping} from './output-mappings.mjs';

const fieldName=z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
const owns=(value,key)=>Object.hasOwn(value,key)&&value[key]!==undefined;
const hasDefault=field=>owns(field,'default');
const invalidContract=()=>{throw Error('INVALID_WORKFLOW_CONTRACT');};

export const outputFieldSchema=z.object({
  name:fieldName,
  type:z.enum(['string','number','boolean','url']).default('string'),
  required:z.literal(true).default(true)
}).strict();

export function validateWorkflowContract(definition){
  try{
    if(!definition||typeof definition!=='object'||Array.isArray(definition))return invalidContract();
    resolveApprovalPolicy(definition);
    const inputs=z.record(fieldName.refine(name=>!['constructor','prototype','__proto__'].includes(name)),inputFieldSchema).parse(definition.inputs??{});
    const outputs=validateOutputMappings(definition.outputs,{requireSelectors:false});
    for(const step of definition.steps??[]){
      if(step.op==='wait_output'&&!outputs.some(field=>field.name===step.output))return invalidContract();
      if(step.parameter){
        const parameter=Object.hasOwn(inputs,step.parameter)?inputs[step.parameter]:undefined;
        if(!parameter)return invalidContract();
        const field=inputBindingField(parameter,step.value_path??[]);
        if(['select','check'].includes(step.op)&&field.required===false&&!hasDefault(field))return invalidContract();
        if(step.op==='check'){
          if(!['boolean','string'].includes(field.type))return invalidContract();
          if(field.type==='string'&&(field.enum?.some(value=>!['true','false'].includes(value))||['default','example'].some(key=>owns(field,key)&&!['true','false'].includes(field[key]))))return invalidContract();
        }
      }
      if(step.value_path!==undefined&&!step.parameter)return invalidContract();
      if(step.path_parameter){
        const field=Object.hasOwn(inputs,step.path_parameter)?inputs[step.path_parameter]:undefined;
        if(!field||field.type!=='string'||field.nullable||field.required!==true||field.pattern!==PATH_INPUT_PATTERN)return invalidContract();
      }
    }
    if(!validateVerifierReferences(definition.verifiers??[],outputs,inputs)||!validateCompletionPolicy({...definition,inputs,outputs}))return invalidContract();
    return {...definition,inputs,outputs};
  }catch{return invalidContract();}
}

function outputNodeJson(field){
  let schema;
  if(field.type==='object')schema=outputJsonSchema(field.fields);
  else if(field.type==='array')schema={type:'array',items:outputNodeJson(field.items),minItems:field.minItems??1,maxItems:field.maxItems??100};
  else schema=field.type==='url'?{type:'string',format:'uri',pattern:'^[Hh][Tt][Tt][Pp][Ss]?://',description:'Absolute HTTP or HTTPS URL without credentials.'}:['number','integer','boolean','null'].includes(field.type)?{type:field.type}:{type:'string',minLength:1};
  if(field.type==='integer'){schema.minimum=Number.MIN_SAFE_INTEGER;schema.maximum=Number.MAX_SAFE_INTEGER;}
  if(field.media_type)schema={...schema,format:'uri',pattern:'^[Hh][Tt][Tt][Pp][Ss]?://',description:'Verified HTTP(S) asset URL. Availability and anonymous embedding are controlled by the website.','x-hermo-media-type':field.media_type};
  for(const key of outputConstraintKeys)if(owns(field,key))schema[key]=field[key];
  if(field.type==='integer'){schema.minimum=Math.max(schema.minimum,Number.MIN_SAFE_INTEGER);schema.maximum=Math.min(schema.maximum,Number.MAX_SAFE_INTEGER);}
  if(field.pattern&&(field.type==='url'||field.media_type))schema.allOf=[{pattern:'^[Hh][Tt][Tt][Pp][Ss]?://'}];
  if(field.coercion!==undefined)schema['x-hermo-coercion']=field.coercion;
  return field.nullable?{anyOf:[schema,{type:'null'}]}:schema;
}
export function outputJsonSchema(outputs){
  return {type:'object',properties:Object.fromEntries(outputs.map(field=>[field.name,outputNodeJson(field)])),required:outputs.filter(field=>field.required!==false).map(field=>field.name),additionalProperties:false};
}

const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function processOutputs(outputs,rawResult,{converted=false}={}){
  const result={};let nodes=0,characters=0;
  // Preserve historical root-scalar errors; new and nested constraints carry an
  // exact path and a bounded JSON Schema keyword, never the observed value.
  const reject=(path,reason,keyword,detail=false)=>{throw Object.assign(Error('VERIFICATION_FAILED'),{verification:{output:path[0],reason,...converted||path.length>1||detail?{path,keyword}:{}}});};
  const applyConstraints=(field,value,path)=>{const issue=scalarConstraintIssue(field,value);if(issue)reject(path,issue.reason,issue.keyword,true);return value;};
  const convert=(field,raw,path,depth=0)=>{
    if(depth>4||++nodes>2000)reject(path,'output_limit','type');
    if(field.type==='null'){
      if(raw===undefined){if(field.required===false)return undefined;reject(path,'missing_output','required');}
      if(typeof raw==='string'){characters+=raw.length;if(raw.length>4096||characters>131072)reject(path,'output_limit','maxLength');}
      if(raw===null||!converted&&field.coercion!=='strict'&&typeof raw==='string'&&raw.trim()==='null')return applyConstraints(field,null,path);
      reject(path,'invalid_null','type',true);
    }
    if(raw===undefined||raw===null||typeof raw==='string'&&!raw.trim()){
      if(raw===undefined&&field.required===false)return undefined;
      if(converted){if(raw===null&&field.nullable)return null;reject(path,'missing_output','required');}
      if(field.nullable)return null;
      if(field.required===false&&raw!==null)return undefined;
      reject(path,'missing_output','required');
    }
    if(field.type==='object'){
      if(typeof raw!=='object'||Array.isArray(raw)||Object.getPrototypeOf(raw)!==Object.prototype&&Object.getPrototypeOf(raw)!==null)reject(path,'invalid_structure','type');
      if(converted&&Object.keys(raw).some(key=>!field.fields.some(child=>child.name===key)))reject(path,'invalid_structure','additionalProperties');
      const value={};for(const child of field.fields){const childPath=[...path,child.name];if(converted&&Object.hasOwn(raw,child.name)&&raw[child.name]===undefined)reject(childPath,'invalid_structure','type');const item=convert(child,Object.hasOwn(raw,child.name)?raw[child.name]:undefined,childPath,depth+1);if(item!==undefined)value[child.name]=item;}return value;
    }
    if(field.type==='array'){
      if(!Array.isArray(raw))reject(path,'invalid_structure','type');
      if(raw.length<(field.minItems??1)||raw.length>(field.maxItems??100))reject(path,'collection_limit',raw.length<(field.minItems??1)?'minItems':'maxItems');
      const values=Array.from(raw,(item,index)=>convert({...field.items,required:true},item,[...path,index],depth+1));
      if(field.uniqueItems){const seen=new Set();for(const [index,value]of values.entries()){const key=outputValueKey(value);if(seen.has(key))reject([...path,index],'duplicate_items','uniqueItems',true);seen.add(key);}}
      return values;
    }
    if(converted||field.coercion==='strict'){
      if(['number','integer'].includes(field.type)){
        if(typeof raw!=='number'||!Number.isFinite(raw))reject(path,'invalid_number','type',field.coercion==='strict');return applyConstraints(field,raw,path);
      }
      if(field.type==='boolean'){if(typeof raw!=='boolean')reject(path,'invalid_boolean','type',field.coercion==='strict');return applyConstraints(field,raw,path);}
    }
    if(typeof raw!=='string')reject(path,converted?'invalid_structure':'missing_output','type');
    characters+=raw.length;if(raw.length>4096||characters>131072)reject(path,'output_limit','maxLength');
    const value=raw.trim();
    if(['number','integer'].includes(field.type)){
      if(!decimal.test(value)||!Number.isFinite(Number(value)))reject(path,'invalid_number','type');return applyConstraints(field,Number(value),path);
    }
    if(field.type==='boolean'){
      if(!['true','false'].includes(value))reject(path,'invalid_boolean','type');return applyConstraints(field,value==='true',path);
    }
    if(field.type==='url'||field.media_type){
      let url;try{url=new URL(value);}catch{reject(path,'invalid_url','format');}
      if(!/^https?:\/\//i.test(value)||/[\u0000-\u0020\u007f]/.test(value)||!['http:','https:'].includes(url.protocol)||url.username||url.password||(converted||field.coercion==='strict')&&raw!==value)reject(path,'invalid_url','format');return applyConstraints(field,value,path);
    }
    if(field.type===undefined||field.type==='string')return applyConstraints(field,raw,path);
    return invalidContract();
  };
  if(converted&&(!rawResult||typeof rawResult!=='object'||Array.isArray(rawResult)||Object.getPrototypeOf(rawResult)!==Object.prototype&&Object.getPrototypeOf(rawResult)!==null))reject([outputs[0]?.name],'invalid_structure','type');
  if(converted&&Object.keys(rawResult).some(key=>!outputs.some(field=>field.name===key)))reject([outputs[0]?.name],'invalid_structure','additionalProperties');
  for(const field of outputs){if(converted&&Object.hasOwn(rawResult,field.name)&&rawResult[field.name]===undefined)reject([field.name],'invalid_structure','type');const value=convert(field,rawResult&&Object.hasOwn(rawResult,field.name)?rawResult[field.name]:undefined,[field.name]);if(value!==undefined)result[field.name]=value;}
  return result;
}
export const convertOutputs=(outputs,rawResult)=>processOutputs(outputs,rawResult);
export const validateConvertedOutputs=(outputs,result)=>{processOutputs(outputs,result,{converted:true});return result;};

export const browserInputValue=inputBindingValue;
