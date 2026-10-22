import {z} from 'zod';

export const outputConstraintKeys=Object.freeze(['enum','minimum','maximum','minLength','maxLength','format','pattern','uniqueItems']);
const formats={date:z.iso.date(),'date-time':z.iso.datetime({offset:true,precision:undefined})};
const owns=(value,key)=>Object.hasOwn(value,key)&&value[key]!==undefined;
const numeric=type=>type==='number'||type==='integer';
const text=type=>type==='string'||type==='url';

// Deliberately smaller than JavaScript regex: anchored literals, character
// classes and predefined classes, optionally repeated an exact number of times.
// No groups, alternatives, variable repeats, lookaround or backreferences.
export function safeOutputPattern(pattern){
  if(typeof pattern!=='string'||pattern.length<3||pattern.length>300||pattern[0]!=='^'||pattern.at(-1)!=='$'||/[^\x20-\x7e]/.test(pattern))return false;
  let index=1,size=0;
  const end=pattern.length-1;
  while(index<end){
    const token=pattern[index++];
    if(token==='\\'){
      if(index>=end||!/[dDwWsS\\.^$|?*+()\[\]{}\-/]/.test(pattern[index++]))return false;
    }else if(token==='['){
      const start=index;let closed=false;
      if(pattern[index]==='^')index++;
      while(index<end){
        const character=pattern[index++];
        if(character==='\\'){if(index>=end||!/[dDwWsS\\\]\[\-^]/.test(pattern[index++]))return false;}
        else if(character===']'){closed=true;break;}
        else if(character==='[')return false;
      }
      if(!closed||index-start<=1||pattern.slice(start,index-1)==='^')return false;
    }else if(/[.^$|?*+()\]{}]/.test(token))return false;
    let repeat=1;
    if(pattern[index]==='{'){
      const match=/^\{([1-9]\d{0,3})\}/.exec(pattern.slice(index));
      if(!match)return false;repeat=Number(match[1]);index+=match[0].length;
    }
    if((size+=repeat)>4096)return false;
  }
  try{new RegExp(pattern,'u');return size>0;}catch{return false;}
}

export function scalarConstraintIssue(field,value){
  const issue=(reason,keyword)=>({reason,keyword});
  if(field.type==='integer'&&!Number.isSafeInteger(value))return issue('invalid_integer','type');
  if(numeric(field.type)){
    if(field.minimum!==undefined&&value<field.minimum)return issue('below_minimum','minimum');
    if(field.maximum!==undefined&&value>field.maximum)return issue('above_maximum','maximum');
  }
  if(text(field.type??'string')){
    const length=[...value].length;
    if(field.minLength!==undefined&&length<field.minLength)return issue('string_too_short','minLength');
    if(field.maxLength!==undefined&&length>field.maxLength)return issue('string_too_long','maxLength');
    if(field.format){
      const valid=field.format==='time'?/^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&formats['date-time'].safeParse('2000-01-01T'+value).success:formats[field.format]?.safeParse(value).success;
      if(!valid)return issue('invalid_format','format');
    }
    if(field.pattern&&(!safeOutputPattern(field.pattern)||new RegExp(field.pattern,'u').exec(value)?.[0]!==value))return issue('pattern_mismatch','pattern');
  }
  if(field.enum&&!field.enum.some(candidate=>candidate===value))return issue('enum_mismatch','enum');
}

export function validateOutputConstraintDefinition(field){
  const type=field.type??'string';
  if(!numeric(type)&&['minimum','maximum'].some(key=>owns(field,key)))return false;
  if(!text(type)&&['minLength','maxLength','format','pattern'].some(key=>owns(field,key)))return false;
  if(type!=='array'&&owns(field,'uniqueItems'))return false;
  if(['object','array'].includes(type)&&owns(field,'enum'))return false;
  if(field.minimum!==undefined&&field.maximum!==undefined&&field.minimum>field.maximum)return false;
  if(type==='integer'&&(field.minimum!==undefined&&Math.ceil(field.minimum)>Number.MAX_SAFE_INTEGER||field.maximum!==undefined&&Math.floor(field.maximum)<Number.MIN_SAFE_INTEGER))return false;
  if((field.minLength??1)>(field.maxLength??4096))return false;
  if(field.pattern&&!safeOutputPattern(field.pattern))return false;
  if(field.format&&(type!=='string'||field.media_type))return false;
  if(field.enum){
    const values=new Set();
    for(const value of field.enum){
      if(values.has(value)||numeric(type)&&(typeof value!=='number'||!Number.isFinite(value))||type==='boolean'&&typeof value!=='boolean'||type==='null'&&value!==null||text(type)&&typeof value!=='string')return false;
      if(scalarConstraintIssue({...field,enum:undefined},value))return false;
      if(typeof value==='string'&&!value.trim())return false;
      if(type==='url'||field.media_type){try{const url=new URL(value);if(!/^https?:\/\//i.test(value)||/[\u0000-\u0020\u007f]/.test(value)||url.username||url.password)return false;}catch{return false;}}
      values.add(value);
    }
  }
  return true;
}

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const outputValueKey=value=>JSON.stringify(canonical(value));
