import {z} from 'zod';
import {validateOutputConstraintDefinition} from './output-constraints.mjs';

const field=z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
const css=z.string().trim().min(1).max(3000).refine(value=>!/[\u0000-\u001f\u007f]/.test(value)&&!/(?:>>|javascript\s*:|(?:^|\s)(?:xpath|text|internal:[\w-]+)\s*=|:(?:has-text|text|text-is|text-matches|nth-match)\s*\(|=>|\b(?:eval|Function)\s*\()/i.test(value));
const selector=z.union([css,z.string().regex(/^:hermo-(?:latest|heading)-(?:user|assistant)$/)]);
const attributes=z.enum(['src','href','alt','download','poster']);
const mediaType=z.enum(['image','video','audio','file']);
const nodeFields=()=>({type:z.enum(['string','number','integer','boolean','url','null','object','array']).default('string'),coercion:z.enum(['legacy','strict']).optional(),media_type:mediaType.optional(),required:z.boolean().default(true),nullable:z.boolean().optional(),selector:selector.optional(),frame_path:z.array(css).max(8).optional(),read_mode:z.literal('last').optional(),read_attribute:attributes.optional(),source:z.literal('url_parameter').optional(),template:z.string().max(2048).optional(),parameter:field.optional(),fields:z.array(namedNode).min(1).max(16).optional(),items:itemNode.optional(),maxItems:z.number().int().min(1).max(100).optional(),minItems:z.number().int().min(0).max(100).optional(),uniqueItems:z.boolean().optional(),enum:z.array(z.union([z.string().max(4096),z.number().finite(),z.boolean(),z.null()])).min(1).max(50).optional(),minimum:z.number().finite().optional(),maximum:z.number().finite().optional(),minLength:z.number().int().min(1).max(4096).optional(),maxLength:z.number().int().min(1).max(4096).optional(),format:z.enum(['date','date-time','time']).optional(),pattern:z.string().min(3).max(300).optional()});
const checkNode=(node,ctx)=>{
  const issue=path=>ctx.addIssue({code:'custom',path:[path],message:'INVALID_OUTPUT_MAPPING'});
  if(!validateOutputConstraintDefinition(node))issue('constraints');
  if(['object','array'].includes(node.type)&&node.coercion!==undefined)issue('coercion');
  if(node.type==='null'&&(node.source||node.media_type||node.read_attribute||node.nullable!==undefined))issue('type');
  if(node.media_type&&(!['string','url'].includes(node.type)||node.source))issue('media_type');
  if(node.type==='object'){
    if(!node.fields)issue('fields');
    for(const key of ['items','maxItems','minItems','read_mode','read_attribute','source','template','parameter'])if(node[key]!==undefined)issue(key);
  }else if(node.type==='array'){
    if(!node.selector||!node.items)issue('items');
    for(const key of ['fields','read_mode','read_attribute','source','template','parameter'])if(node[key]!==undefined)issue(key);
    if((node.minItems??1)>(node.maxItems??100))issue('minItems');
  }else{
    for(const key of ['fields','items','maxItems','minItems'])if(node[key]!==undefined)issue(key);
    if(node.source){if(node.selector||!node.template||!node.parameter)issue('source');}
    else if(node.template!==undefined||node.parameter!==undefined)issue('source');
  }
};
const namedNode=z.lazy(()=>z.object({name:field,...nodeFields()}).strict().superRefine(checkNode));
const itemNode=z.lazy(()=>z.object(nodeFields()).strict().superRefine(checkNode));
function inspectTree(node,{strict=true,depth=0,item=false,state={count:0}}={}){
  if(depth>4||++state.count>64||depth>0&&node.frame_path?.length||depth>0&&node.source)throw Error('INVALID_OUTPUT_MAPPINGS');
  if(node.type==='object'){
    const names=new Set();for(const child of node.fields){if(names.has(child.name))throw Error('INVALID_OUTPUT_MAPPINGS');names.add(child.name);inspectTree(child,{strict,depth:depth+1,state});}
  }else if(node.type==='array')inspectTree(node.items,{strict,depth:depth+1,item:true,state});
  else if(!item&&!node.selector&&!node.source&&(strict||node.required===false||node.nullable))throw Error('INVALID_OUTPUT_MAPPINGS');
}
export const outputMappingSchema=namedNode.superRefine((node,ctx)=>{try{inspectTree(node);}catch{ctx.addIssue({code:'custom',message:'INVALID_OUTPUT_MAPPINGS'});}});
export function validateOutputMappings(outputs,{requireSelectors=true}={}){
  try{
    const parsed=z.array(namedNode).min(1).max(8).parse(outputs),names=new Set(),state={count:0};
    for(const node of parsed){if(names.has(node.name))throw Error('INVALID_OUTPUT_MAPPINGS');names.add(node.name);inspectTree(node,{strict:requireSelectors,state});}
    return parsed;
  }catch{throw Error('INVALID_OUTPUT_MAPPINGS');}
}
export const usesStructuredExtraction=field=>field.type==='object'||field.type==='array'||field.type==='null'||field.required===false||field.nullable===true;
// A caption or filename alone cannot establish a newly generated media result.
// Keep those useful metadata outputs, but require an actual asset address too.
const hasMediaAddress=(field,selected=false)=>!!field&&typeof field==='object'&&(!!((field.selector||selected)&&['src','href','poster'].includes(field.read_attribute))||(Array.isArray(field.fields)?field.fields:[]).some(child=>hasMediaAddress(child,selected||!!field.selector))||!!field.items&&hasMediaAddress(field.items,selected||!!field.selector));
export const mediaOutputError=definition=>definition?.action_type==='generate_media'&&!(Array.isArray(definition.outputs)?definition.outputs:[]).some(field=>hasMediaAddress(field))
  ?'Choose an image, video, audio or download URL output for media generation. Descriptions and filenames can be additional outputs; renaming them does not capture the media address.'
  :undefined;
// Integer is a server constraint, so existing companions can read its raw text.
export function browserOutputMapping(field){return {...field,...field.type==='integer'?{type:'number'}:{},...field.fields?{fields:field.fields.map(browserOutputMapping)}:{},...field.items?{items:browserOutputMapping(field.items)}:{}};}

export {extractOutputDocument} from '../companion/browser/output-extraction.mjs';
export const observationSignature=value=>value?value.count+'|'+JSON.stringify(value.text)+'|'+(value.identity??''):undefined;
export const observationChanged=(value,baseline)=>!!value&&(value.count>baseline.count||JSON.stringify(value.text)!==JSON.stringify(baseline.text)||value.identity!==undefined&&baseline.identity!==undefined&&value.identity!==baseline.identity);
export const extractionReady=(field,value)=>!!value&&(value.text!==undefined&&(typeof value.text!=='string'||!!value.text.trim())||field.required===false||field.nullable===true);
