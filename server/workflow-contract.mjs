import {z} from 'zod';
import {validateOutputMappings} from './output-mappings.mjs';
export {outputMappingSchema,validateOutputMappings} from './output-mappings.mjs';

export const PATH_INPUT_PATTERN='^[A-Za-z0-9_-]{1,120}$';
const pathInputPattern=/^[A-Za-z0-9_-]{1,120}$/;
const fieldName=z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
const scalar=z.union([z.string(),z.number().finite(),z.boolean()]);
const owns=(value,key)=>Object.hasOwn(value,key)&&value[key]!==undefined;
const hasDefault=field=>owns(field,'default');
const invalidContract=()=>{throw Error('INVALID_WORKFLOW_CONTRACT');};
const maxInputLength=field=>Math.min(field.maxLength??4096,field.pattern?120:4096);

function inputScalarJson(field){
  const type=field.type??'string',schema={type};
  if(type==='string'){
    schema.minLength=field.minLength??1;
    schema.maxLength=maxInputLength(field);
    if(field.pattern)schema.pattern=PATH_INPUT_PATTERN;
    if(field.enum)schema.enum=[...field.enum];
    if(field.normalization==='trim'){schema.description='Leading and trailing whitespace is trimmed before validation.';schema['x-hermo-normalization']='trim';}
  }else if(type==='number'){
    if(field.minimum!==undefined)schema.minimum=field.minimum;
    if(field.maximum!==undefined)schema.maximum=field.maximum;
  }
  return schema;
}

// The same scalar rules apply before persistence, browser replay, and API calls.
// Historical patterns were interpreted as this fixed safe path pattern; keep that
// runtime behavior while rejecting new author configuration with other patterns.
export function inputValueSchema(field){
  const type=field.type??'string';
  if(type==='number'){
    let schema=z.number().finite();
    if(field.minimum!==undefined)schema=schema.min(field.minimum);
    if(field.maximum!==undefined)schema=schema.max(field.maximum);
    return schema.meta(inputScalarJson(field));
  }
  if(type==='boolean')return z.boolean().meta(inputScalarJson(field));
  if(type!=='string')return invalidContract();
  let schema=z.string();
  if(field.normalization==='trim')schema=schema.transform(value=>value.trim()).pipe(z.string());
  // These checks run on normalized text. Metadata keeps the same contract visible
  // through Zod's input JSON Schema conversion used by MCP, including enums.
  return schema.refine(value=>value.length<=maxInputLength(field),'INPUT_TOO_LONG')
    .refine(value=>value.length>=(field.minLength??1),'INPUT_TOO_SHORT')
    .refine(value=>!field.pattern||pathInputPattern.test(value),'INVALID_PATH_INPUT')
    .refine(value=>!field.enum||field.enum.includes(value),'INPUT_NOT_IN_ENUM').meta(inputScalarJson(field));
}

export const inputFieldSchema=z.object({
  type:z.enum(['string','number','boolean']).default('string'),
  required:z.boolean().default(true),
  default:scalar.optional(),
  example:scalar.optional(),
  normalization:z.literal('trim').optional(),
  pattern:z.literal(PATH_INPUT_PATTERN).optional(),
  minLength:z.number().int().min(1).max(4096).optional(),
  maxLength:z.number().int().min(1).max(4096).optional(),
  enum:z.array(z.string().max(4096)).min(1).max(50).optional(),
  minimum:z.number().finite().optional(),
  maximum:z.number().finite().optional()
}).strict().superRefine((field,context)=>{
  const issue=key=>context.addIssue({code:'custom',path:[key],message:'INVALID_WORKFLOW_CONTRACT'});
  if(field.type!=='string')for(const key of ['normalization','pattern','minLength','maxLength','enum'])if(owns(field,key))issue(key);
  if(field.type!=='number')for(const key of ['minimum','maximum'])if(owns(field,key))issue(key);
  if((field.minLength??1)>maxInputLength(field))issue('minLength');
  if(field.minimum!==undefined&&field.maximum!==undefined&&field.minimum>field.maximum)issue('minimum');
  const enumValues=field.enum?.map(value=>field.normalization==='trim'?value.trim():value);
  const present=inputValueSchema({...field,...enumValues?{enum:enumValues}:{}});
  if(field.enum){
    if(new Set(enumValues).size!==enumValues.length||enumValues.some(value=>!present.safeParse(value).success))issue('enum');
  }
  for(const key of ['default','example'])if(owns(field,key)&&!present.safeParse(field[key]).success)issue(key);
}).transform(field=>{
  const normalized={...field};
  if(field.type==='string'&&field.normalization==='trim'){
    if(field.enum)normalized.enum=field.enum.map(value=>value.trim());
    for(const key of ['default','example'])if(owns(field,key))normalized[key]=field[key].trim();
  }
  return normalized;
});

export const outputFieldSchema=z.object({
  name:fieldName,
  type:z.enum(['string','number','boolean','url']).default('string'),
  required:z.literal(true).default(true)
}).strict();

export function validateWorkflowContract(definition){
  try{
    if(!definition||typeof definition!=='object'||Array.isArray(definition))return invalidContract();
    const inputs=z.record(fieldName,inputFieldSchema).parse(definition.inputs??{});
    const outputs=validateOutputMappings(definition.outputs,{requireSelectors:false}),names=new Set(outputs.map(field=>field.name));
    for(const step of definition.steps??[]){
      if(step.parameter){
        const field=Object.hasOwn(inputs,step.parameter)?inputs[step.parameter]:undefined;
        if(!field)return invalidContract();
        if(['select','check'].includes(step.op)&&field.required===false&&!hasDefault(field))return invalidContract();
        if(step.op==='check'){
          if(!['boolean','string'].includes(field.type))return invalidContract();
          if(field.type==='string'&&(field.enum?.some(value=>!['true','false'].includes(value))||['default','example'].some(key=>owns(field,key)&&!['true','false'].includes(field[key]))))return invalidContract();
        }
      }
      if(step.path_parameter){
        const field=Object.hasOwn(inputs,step.path_parameter)?inputs[step.path_parameter]:undefined;
        if(!field||field.type!=='string'||field.required!==true||field.pattern!==PATH_INPUT_PATTERN)return invalidContract();
      }
    }
    for(const rule of definition.verifiers??[]){
      if(!names.has(rule.output))return invalidContract();
      if(['object','array'].includes(outputs.find(field=>field.name===rule.output)?.type)&&!['changed','nonempty'].includes(rule.kind))return invalidContract();
      if((rule.kind??'equals_input')==='equals_input'){
        const field=Object.hasOwn(inputs,rule.input)?inputs[rule.input]:undefined;
        if(!field||field.required===false&&!hasDefault(field))return invalidContract();
      }
    }
    return {...definition,inputs,outputs};
  }catch{return invalidContract();}
}

export function inputJsonSchema(inputs){
  const properties={},required=[];
  for(const [name,field]of Object.entries(inputs)){
    const schema=inputScalarJson(field);
    if(hasDefault(field))schema.default=field.default;
    if(owns(field,'example'))schema.examples=[field.example];
    properties[name]=schema;
    if(field.required!==false&&!hasDefault(field))required.push(name);
  }
  return {type:'object',properties,required,additionalProperties:false};
}

function outputNodeJson(field){
  let schema;
  if(field.type==='object')schema=outputJsonSchema(field.fields);
  else if(field.type==='array')schema={type:'array',items:outputNodeJson(field.items),minItems:field.minItems??1,maxItems:field.maxItems??100};
  else schema=field.type==='url'?{type:'string',format:'uri',pattern:'^[Hh][Tt][Tt][Pp][Ss]?://',description:'Absolute HTTP or HTTPS URL without credentials.'}:field.type==='number'||field.type==='boolean'?{type:field.type}:{type:'string',minLength:1};
  if(field.media_type)schema={...schema,format:'uri',pattern:'^[Hh][Tt][Tt][Pp][Ss]?://',description:'Verified HTTP(S) asset URL. Availability and anonymous embedding are controlled by the website.','x-hermo-media-type':field.media_type};
  return field.nullable?{anyOf:[schema,{type:'null'}]}:schema;
}
export function outputJsonSchema(outputs){
  return {type:'object',properties:Object.fromEntries(outputs.map(field=>[field.name,outputNodeJson(field)])),required:outputs.filter(field=>field.required!==false).map(field=>field.name),additionalProperties:false};
}

const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export function convertOutputs(outputs,rawResult){
  const result={};let nodes=0,characters=0;
  const reject=(output,reason)=>{throw Object.assign(Error('VERIFICATION_FAILED'),{verification:{output,reason}});};
  const convert=(field,raw,root,depth=0)=>{
    if(depth>4||++nodes>2000)reject(root,'output_limit');
    if(raw===undefined||raw===null||typeof raw==='string'&&!raw.trim()){
      if(raw===undefined&&field.required===false)return undefined;
      if(field.nullable)return null;
      if(field.required===false&&raw!==null)return undefined;
      reject(root,'missing_output');
    }
    if(field.type==='object'){
      if(typeof raw!=='object'||Array.isArray(raw)||Object.getPrototypeOf(raw)!==Object.prototype&&Object.getPrototypeOf(raw)!==null)reject(root,'invalid_structure');
      const value={};for(const child of field.fields){const converted=convert(child,Object.hasOwn(raw,child.name)?raw[child.name]:undefined,root,depth+1);if(converted!==undefined)value[child.name]=converted;}return value;
    }
    if(field.type==='array'){
      if(!Array.isArray(raw))reject(root,'invalid_structure');
      if(raw.length<(field.minItems??1)||raw.length>(field.maxItems??100))reject(root,'collection_limit');
      return raw.map(item=>{const converted=convert({...field.items,required:true},item,root,depth+1);if(converted===undefined)reject(root,'missing_output');return converted;});
    }
    if(typeof raw!=='string')reject(root,'missing_output');
    characters+=raw.length;if(raw.length>4096||characters>131072)reject(root,'output_limit');
    const value=raw.trim();
    if(field.type==='number'){
      if(!decimal.test(value)||!Number.isFinite(Number(value)))reject(root,'invalid_number');return Number(value);
    }
    if(field.type==='boolean'){
      if(!['true','false'].includes(value))reject(root,'invalid_boolean');return value==='true';
    }
    if(field.type==='url'||field.media_type){
      let url;try{url=new URL(value);}catch{reject(root,'invalid_url');}
      if(!/^https?:\/\//i.test(value)||/[\u0000-\u0020\u007f]/.test(value)||!['http:','https:'].includes(url.protocol)||url.username||url.password)reject(root,'invalid_url');return value;
    }
    if(field.type===undefined||field.type==='string')return raw;
    return invalidContract();
  };
  for(const field of outputs){const value=convert(field,rawResult?.[field.name],field.name);if(value!==undefined)result[field.name]=value;}
  return result;
}

export function browserInputValue(field,value,operation){
  if(value===undefined&&hasDefault(field))value=field.default;
  if(value===undefined&&field.required===false&&operation==='fill')return '';
  if(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw Error('INVALID_WORKFLOW_INPUT');
  return String(value);
}
