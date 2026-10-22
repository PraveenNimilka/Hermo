import {z} from 'zod';

export const PATH_INPUT_PATTERN='^[A-Za-z0-9_-]{1,120}$';
const pathPattern=/^[A-Za-z0-9_-]{1,120}$/;
const fieldPattern=/^[a-z][a-z0-9_]{1,39}$/;
const forbidden=new Set(['__proto__','prototype','constructor']);
const own=(value,key)=>Object.hasOwn(value,key)&&value[key]!==undefined;
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const invalid=()=>{throw Error('INVALID_WORKFLOW_CONTRACT');};
const maxLength=field=>Math.min(field.maxLength??4096,field.pattern?120:4096);
const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const safeName=value=>fieldPattern.test(value)&&!forbidden.has(value);

// Run this before recursive schemas, including direct in-process callers. HTTP
// also has a body limit; MCP and default values need the same bounded JSON rules.
export function boundedInputJson(value){
  let nodes=0,characters=0;const seen=new Set();
  const visit=(item,depth)=>{
    if(depth>5||++nodes>2000)return false;
    if(item===null||typeof item==='boolean')return true;
    if(typeof item==='number')return Number.isFinite(item);
    if(typeof item==='string'){characters+=item.length;return item.length<=4096&&characters<=24576;}
    if(typeof item!=='object'||seen.has(item))return false;
    seen.add(item);
    if(Object.getOwnPropertySymbols(item).length||Object.getOwnPropertyNames(item).some(key=>key!=='length'&&Object.getOwnPropertyDescriptor(item,key)?.enumerable!==true))return false;
    if(Array.isArray(item)){
      if(item.length>100||Object.keys(item).length!==item.length)return false;
      for(let index=0;index<item.length;index++){const descriptor=Object.getOwnPropertyDescriptor(item,index);if(!descriptor||!Object.hasOwn(descriptor,'value')||!visit(descriptor.value,depth+1))return false;}
    }else{
      if(!plain(item)||Object.keys(item).length>100)return false;
      for(const key of Object.keys(item)){
        const descriptor=Object.getOwnPropertyDescriptor(item,key);
        if(forbidden.has(key)||!descriptor||!Object.hasOwn(descriptor,'value')||!visit(descriptor.value,depth+1))return false;
      }
    }
    seen.delete(item);return true;
  };
  return visit(value,0)&&Buffer.byteLength(JSON.stringify(value),'utf8')<=24576;
}

const rawField=z.object({
  type:z.enum(['string','number','integer','boolean','object','array','null']).default('string'),required:z.boolean().default(true),nullable:z.boolean().optional(),
  default:z.unknown().optional(),example:z.unknown().optional(),normalization:z.literal('trim').optional(),coercion:z.enum(['strict','number','boolean']).optional(),
  pattern:z.literal(PATH_INPUT_PATTERN).optional(),minLength:z.number().int().min(1).max(4096).optional(),maxLength:z.number().int().min(1).max(4096).optional(),
  enum:z.array(z.string().max(4096)).min(1).max(50).optional(),minimum:z.number().finite().optional(),maximum:z.number().finite().optional(),
  properties:z.record(z.string(),z.unknown()).optional(),items:z.unknown().optional(),minItems:z.number().int().min(0).max(100).optional(),maxItems:z.number().int().min(0).max(100).optional(),uniqueItems:z.boolean().optional()
}).strict();

function normalizedField(raw,depth=0,state={nodes:0}){
  if(depth>4||++state.nodes>200||!plain(raw))return invalid();
  for(const key of Object.keys(raw))if(!Object.hasOwn(Object.getOwnPropertyDescriptor(raw,key),'value'))return invalid();
  const field=rawField.parse(raw),type=field.type;
  const permitted={string:['normalization','pattern','minLength','maxLength','enum'],number:['minimum','maximum'],integer:['minimum','maximum'],boolean:[],object:['properties'],array:['items','minItems','maxItems','uniqueItems'],null:[]};
  for(const key of ['normalization','pattern','minLength','maxLength','enum','minimum','maximum','properties','items','minItems','maxItems','uniqueItems'])if(own(field,key)&&!permitted[type].includes(key))return invalid();
  if(field.coercion==='number'&&!['number','integer'].includes(type)||field.coercion==='boolean'&&type!=='boolean')return invalid();
  if(type==='object'){
    if(!plain(field.properties)||Object.keys(field.properties).length>16)return invalid();
    field.properties=Object.fromEntries(Object.entries(field.properties).map(([name,child])=>{if(!safeName(name))return invalid();return [name,normalizedField(child,depth+1,state)];}));
  }
  if(type==='array'){
    if(!own(field,'items')||(field.minItems??0)>(field.maxItems??100))return invalid();
    field.items=normalizedField(field.items,depth+1,state);
  }
  if(type==='string'){
    if((field.minLength??1)>maxLength(field))return invalid();
    if(field.enum&&field.normalization==='trim')field.enum=field.enum.map(value=>value.trim());
    if(field.enum&&new Set(field.enum).size!==field.enum.length)return invalid();
  }
  if(field.minimum!==undefined&&field.maximum!==undefined&&field.minimum>field.maximum)return invalid();
  if(type==='integer'&&[field.minimum,field.maximum].some(value=>value!==undefined&&!Number.isSafeInteger(value)))return invalid();
  const present=inputValueSchema(field);
  if(field.enum?.some(value=>!present.safeParse(value).success))return invalid();
  for(const key of ['default','example'])if(own(field,key)){
    if(!boundedInputJson(field[key]))return invalid();
    const parsed=present.safeParse(field[key]);if(!parsed.success||!boundedInputJson(parsed.data))return invalid();field[key]=parsed.data;
  }
  return field;
}

export const inputFieldSchema=z.unknown().transform((value,context)=>{
  try{return normalizedField(value);}catch{context.addIssue({code:'custom',message:'INVALID_WORKFLOW_CONTRACT'});return z.NEVER;}
});

function nodeJson(field){
  const type=field.type??'string';let schema={type};
  if(type==='object')schema=inputJsonSchema(field.properties??{});
  else if(type==='array')schema={type,items:nodeJson(field.items),minItems:field.minItems??0,maxItems:field.maxItems??100,...field.uniqueItems?{uniqueItems:true}:{}};
  else if(type==='string'){
    schema.minLength=field.minLength??1;schema.maxLength=maxLength(field);
    if(field.pattern)schema.pattern=PATH_INPUT_PATTERN;
    if(field.enum)schema.enum=[...field.enum];
    if(field.normalization==='trim'){schema.description='Leading and trailing whitespace is trimmed before validation.';schema['x-hermo-normalization']='trim';}
  }else if(type==='number'||type==='integer'){
    if(type==='integer'){schema.minimum=Number.MIN_SAFE_INTEGER;schema.maximum=Number.MAX_SAFE_INTEGER;}
    if(field.minimum!==undefined)schema.minimum=field.minimum;
    if(field.maximum!==undefined)schema.maximum=field.maximum;
  }
  if(field.coercion==='number'||field.coercion==='boolean')schema={anyOf:[schema,field.coercion==='number'?{type:'string',pattern:'^\\s*[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?\\s*$'}:{type:'string',enum:['true','false']}],'x-hermo-coercion':field.coercion,'x-hermo-value-type':type};
  else if(field.coercion==='strict')schema['x-hermo-coercion']='strict';
  if(field.nullable&&type!=='null')schema={anyOf:[schema,{type:'null'}],'x-hermo-value-type':type};
  return schema;
}

const optional=(field,schema)=>own(field,'default')?schema.prefault(field.default):field.required===false?schema.optional():schema;
export function inputValueSchema(field,depth=0){
  if(depth>4)return invalid();
  const type=field.type??'string';let schema;
  if(type==='object'){
    if(!plain(field.properties))return invalid();
    schema=z.object(Object.fromEntries(Object.entries(field.properties).map(([name,child])=>[name,optional(child,inputValueSchema(child,depth+1))]))).strict();
  }else if(type==='array'){
    if(!field.items)return invalid();
    schema=z.array(inputValueSchema(field.items,depth+1)).min(field.minItems??0).max(field.maxItems??100);
    if(field.uniqueItems)schema=schema.refine(value=>new Set(value.map(item=>JSON.stringify(canonicalInput(item)))).size===value.length,'INPUT_DUPLICATE_ITEMS');
  }else if(type==='number'||type==='integer'){
    schema=z.number().finite();if(type==='integer')schema=schema.int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
    if(field.minimum!==undefined)schema=schema.min(field.minimum);if(field.maximum!==undefined)schema=schema.max(field.maximum);
    if(field.coercion==='number')schema=z.union([z.number(),z.string().max(4096).refine(value=>decimal.test(value.trim()),'INVALID_NUMBER').transform(Number)]).pipe(schema);
  }else if(type==='boolean'){
    schema=z.boolean();if(field.coercion==='boolean')schema=z.union([z.boolean(),z.enum(['true','false']).transform(value=>value==='true')]);
  }else if(type==='null')schema=z.null();
  else if(type==='string'){
    schema=z.string();if(field.normalization==='trim')schema=schema.transform(value=>value.trim()).pipe(z.string());
    schema=schema.refine(value=>value.length<=maxLength(field),'INPUT_TOO_LONG').refine(value=>value.length>=(field.minLength??1),'INPUT_TOO_SHORT')
      .refine(value=>!field.pattern||pathPattern.test(value),'INVALID_PATH_INPUT').refine(value=>!field.enum||field.enum.includes(value),'INPUT_NOT_IN_ENUM');
  }else return invalid();
  if(field.nullable&&type!=='null')schema=schema.nullable();
  return schema.meta(nodeJson(field));
}

export function inputJsonSchema(inputs){
  const properties={},required=[];
  for(const[name,field]of Object.entries(inputs)){
    const schema=nodeJson(field);if(own(field,'default'))schema.default=field.default;if(own(field,'example'))schema.examples=[field.example];
    properties[name]=schema;if(field.required!==false&&!own(field,'default'))required.push(name);
  }
  return {type:'object',properties,required,additionalProperties:false};
}

// Object order has no meaning in JSON. Arrays retain their order. For a legacy
// scalar request this leaves the existing top-level digest bytes unchanged.
export function canonicalInput(value){
  if(Array.isArray(value))return value.map(canonicalInput);
  return plain(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalInput(value[key])])):value;
}

export function inputBindingField(field,valuePath=[]){
  const reject=()=>{throw Error('INVALID_WORKFLOW_INPUT');};
  if(!Array.isArray(valuePath)||valuePath.length>4||valuePath.some(part=>typeof part==='string'?!safeName(part):!Number.isInteger(part)||part<0||part>99))return reject();
  let current=field;
  for(const part of valuePath){
    if(!current||current.nullable||current.required===false&&!own(current,'default'))return reject();
    if(typeof part==='string'&&current.type==='object'&&Object.hasOwn(current.properties??{},part))current=current.properties[part];
    else if(typeof part==='number'&&current.type==='array'&&part<(current.minItems??0))current=current.items;
    else return reject();
  }
  if(!current||current.nullable||!['string','number','integer','boolean'].includes(current.type??'string')||valuePath.length&&current.required===false&&!own(current,'default'))return reject();
  return current;
}

export function inputBindingValue(field,value,operation,valuePath=[]){
  inputBindingField(field,valuePath);
  if(value===undefined&&own(field,'default'))value=field.default;
  if(valuePath.length){
    const parsed=inputValueSchema(field).safeParse(value);if(!parsed.success)throw Error('INVALID_WORKFLOW_INPUT');value=parsed.data;
    for(const part of valuePath){if(value===null||typeof value!=='object'||!Object.hasOwn(value,part))throw Error('INVALID_WORKFLOW_INPUT');value=value[part];}
  }
  if(value===undefined&&field.required===false&&operation==='fill'&&!valuePath.length)return '';
  if(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw Error('INVALID_WORKFLOW_INPUT');
  return String(value);
}
