import {useId,useState} from 'react';
import type {CapturedOutput} from './ActionTypes';

export type Scalar=string|number|boolean;
export type JsonValue=Scalar|null|JsonValue[]|{[name:string]:JsonValue};
export type InputDefinition={type:'string'|'number'|'integer'|'boolean'|'object'|'array'|'null';example?:JsonValue;required?:boolean;default?:JsonValue;nullable?:boolean;coercion?:'strict'|'number'|'boolean';properties?:Record<string,InputDefinition>;items?:InputDefinition;minItems?:number;maxItems?:number;uniqueItems?:boolean;enum?:string[];minimum?:number;maximum?:number;minLength?:number;maxLength?:number;pattern?:string;normalization?:'trim'};
export type ContractWorkflow={version:string;inputs:Record<string,InputDefinition>;outputs:CapturedOutput[];steps:{op:string;parameter?:string;path_parameter?:string}[]};
export type ContractUpdate={expected_version:string;inputs:Record<string,Omit<InputDefinition,'example'>>;outputs:{name:string;type:'string'|'number'|'boolean'|'url'}[]};
export type InputDraft=Record<string,string>;
const owns=(value:object,key:string)=>Object.prototype.hasOwnProperty.call(value,key);
const advancedOutput=(field:CapturedOutput)=>!['string','number','boolean','url'].includes(field.type??'string')||field.required===false||field.nullable===true||!!field.media_type||['enum','minimum','maximum','minLength','maxLength','pattern','format','uniqueItems'].some(key=>owns(field,key));

const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export const jsonInput=(definition:InputDefinition)=>['object','array','null'].includes(definition.type)||definition.nullable===true;
const encodeInput=(definition:InputDefinition,value:JsonValue)=>jsonInput(definition)?JSON.stringify(value,null,2):String(value);
const advancedInput=(definition:InputDefinition)=>jsonInput(definition)||definition.type==='integer'||definition.coercion!==undefined;
const forbiddenInputKeys=new Set(['__proto__','constructor','prototype']);
export function initialInputValues(inputs:ContractWorkflow['inputs']):InputDraft{return Object.fromEntries(Object.entries(inputs).map(([name,definition])=>{const value=owns(definition,'default')?definition.default!:owns(definition,'example')?definition.example!:jsonInput(definition)?exampleValue(definition):'';return [name,definition.normalization==='trim'&&typeof value==='string'?value.trim():encodeInput(definition,value)];}));}
function inputValue(definition:InputDefinition,raw:unknown,depth=0):JsonValue{
  const fail=(message:string):never=>{throw Error(message);};
  if(depth>4)return fail('Keep JSON input nesting within four levels.');
  if(raw===null)return definition.nullable||definition.type==='null'?null:fail('Null is not permitted for this field.');
  const type=definition.type??'string';
  if(type==='object'){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail('Enter a JSON object.');
    const value=raw as Record<string,unknown>,properties=definition.properties??{};
    if(Object.keys(value).some(key=>forbiddenInputKeys.has(key)||!owns(properties,key)))return fail('JSON contains an undeclared or unsafe field.');
    const result:Record<string,JsonValue>={};
    for(const[name,field]of Object.entries(properties)){
      if(!owns(value,name)){if(owns(field,'default'))result[name]=inputValue(field,field.default,depth+1);else if(field.required!==false)return fail(`Missing required JSON field: ${name}.`);}
      else result[name]=inputValue(field,value[name],depth+1);
    }
    return result;
  }
  if(type==='array'){
    if(!Array.isArray(raw)||!definition.items)return fail('Enter a JSON array with declared items.');
    if(raw.length<(definition.minItems??0)||raw.length>(definition.maxItems??100))return fail(`Use between ${definition.minItems??0} and ${definition.maxItems??100} array items.`);
    const result=raw.map(value=>inputValue(definition.items!,value,depth+1));
    const stable=(value:JsonValue):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
    if(definition.uniqueItems&&new Set(result.map(value=>JSON.stringify(stable(value)))).size!==result.length)return fail('Array items must be unique.');
    return result;
  }
  if(type==='number'||type==='integer'){
    let value=raw;if(definition.coercion==='number'&&typeof value==='string'&&decimal.test(value.trim()))value=Number(value);
    if(typeof value!=='number'||!Number.isFinite(value))return fail('Enter a finite decimal number.');
    if(type==='integer'&&!Number.isSafeInteger(value))return fail('Enter a safe whole number.');
    if(definition.minimum!==undefined&&value<definition.minimum)return fail(`Enter ${definition.minimum} or greater.`);
    if(definition.maximum!==undefined&&value>definition.maximum)return fail(`Enter ${definition.maximum} or less.`);return value;
  }
  if(type==='boolean'){
    if(definition.coercion==='boolean'&&(raw==='true'||raw==='false'))return raw==='true';
    return typeof raw==='boolean'?raw:fail('Choose true or false.');
  }
  if(type==='null')return fail('Enter the JSON value null.');
  if(typeof raw!=='string')return fail('Enter text for this field.');
  const value=definition.normalization==='trim'?raw.trim():raw;
  if(value.length<(definition.minLength??1))return fail(`Enter at least ${definition.minLength??1} character${(definition.minLength??1)===1?'':'s'}.`);
  if(value.length>(definition.maxLength??(definition.pattern?120:4096)))return fail(`Enter at most ${definition.maxLength??(definition.pattern?120:4096)} characters.`);
  if(definition.enum&&!definition.enum.includes(value))return fail('Choose one of the allowed values.');
  if(definition.pattern&&!new RegExp('^(?:'+definition.pattern+')$').test(value))return fail('Use the permitted characters for this page parameter.');return value;
}
export function typedInput(inputs:ContractWorkflow['inputs'],values:InputDraft,omitted:Record<string,boolean>={}){
  const result:Record<string,JsonValue>={},errors:Record<string,string>={};
  for(const[name,definition]of Object.entries(inputs)){
    if(omitted[name]&&(definition.required===false||owns(definition,'default')))continue;
    const text=values[name]??'';
    try{
      if(text.length>24576)throw Error('Keep this input within 24 KB.');
      let raw:unknown=text;
      if(jsonInput(definition)){try{raw=JSON.parse(text);}catch{throw Error('Enter valid JSON for this field.');}}
      else if(['number','integer'].includes(definition.type)){if(!decimal.test(text.trim()))throw Error('Enter a finite decimal number.');raw=Number(text);}
      else if(definition.type==='boolean'){if(text!=='true'&&text!=='false')throw Error('Choose true or false.');raw=text==='true';}
      result[name]=inputValue(definition,raw);
    }catch(cause){errors[name]=cause instanceof Error?cause.message:'Check this input.';}
  }
  if(JSON.stringify(result).length>24576)errors[Object.keys(inputs)[0]??'input']='Keep the request within 24 KB.';
  return {input:result,errors};
}
function exampleValue(definition:InputDefinition,depth=0):JsonValue{
  if(depth>4)return null;
  if(owns(definition,'default'))return definition.default!;
  if(owns(definition,'example'))return definition.example!;
  if(definition.type==='null')return null;
  if(definition.type==='object')return Object.fromEntries(Object.entries(definition.properties??{}).filter(([,field])=>field.required!==false||owns(field,'default')).map(([name,field])=>[name,exampleValue(field,depth+1)]));
  if(definition.type==='array')return Array.from({length:definition.minItems??0},()=>exampleValue(definition.items!,depth+1));
  if(definition.type==='boolean')return false;
  if(definition.type==='number'||definition.type==='integer')return Math.min(definition.maximum??Infinity,Math.max(definition.minimum??-Infinity,0));
  return definition.enum?.[0]??'example'.padEnd(definition.minLength??1,'x').slice(0,definition.maxLength??4096);
}
export function exampleInput(inputs:ContractWorkflow['inputs']):Record<string,JsonValue>{const result:Record<string,JsonValue>={};for(const[name,definition]of Object.entries(inputs)){if(definition.required===false&&!owns(definition,'default'))continue;const candidates=[...(owns(definition,'default')?[definition.default!]:[]),...(definition.example!==undefined?[definition.example]:[]),...(definition.enum??[]),exampleValue(definition)];for(const candidate of candidates){const parsed=typedInput({[name]:definition},{[name]:encodeInput(definition,candidate)});if(!parsed.errors[name]){result[name]=parsed.input[name];break;}}}return result;}

export function inputDefinitionFromSchema(raw:unknown,required=true,depth=0):InputDefinition{
  if(depth>4||!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('The published input schema is unsupported.');
  const outer=raw as Record<string,any>;let schema=outer,nullable=false;
  if(Array.isArray(schema.anyOf)){
    nullable=schema.anyOf.some((branch:any)=>branch?.type==='null');
    const branches=schema.anyOf.filter((branch:any)=>branch?.type!=='null');
    if(branches.length===1)schema=branches[0];
    else if(schema['x-hermo-value-type'])schema=branches.find((branch:any)=>branch?.type===schema['x-hermo-value-type']);
    else throw Error('The published input schema uses an unsupported union.');
    if(Array.isArray(schema?.anyOf)&&schema['x-hermo-value-type'])schema=schema.anyOf.find((branch:any)=>branch?.type===schema['x-hermo-value-type']);
  }
  const type=schema?.type;
  if(!['string','number','integer','boolean','object','array','null'].includes(type))throw Error('The published input type is unsupported.');
  const definition:InputDefinition={type,required,...nullable?{nullable:true}:{}};
  for(const key of ['minLength','maxLength','pattern','enum','minimum','maximum','minItems','maxItems','uniqueItems'] as const)if(schema[key]!==undefined)(definition as any)[key]=schema[key];
  for(const key of ['default','examples'])if(outer[key]!==undefined||schema[key]!==undefined){const value=owns(outer,key)?outer[key]:schema[key];if(key==='examples'){if(Array.isArray(value)&&value.length)definition.example=value[0];}else definition.default=value;}
  const coercion=outer['x-hermo-coercion']??(outer.anyOf?.find((branch:any)=>branch?.['x-hermo-coercion']))?.['x-hermo-coercion']??schema['x-hermo-coercion'];
  if(['strict','number','boolean'].includes(coercion))definition.coercion=coercion;
  if(schema['x-hermo-normalization']==='trim'||outer['x-hermo-normalization']==='trim')definition.normalization='trim';
  if(type==='object'){
    if(schema.additionalProperties!==false)throw Error('The published input object must reject undeclared fields.');
    definition.properties=Object.fromEntries(Object.entries(schema.properties??{}).map(([name,field])=>[name,inputDefinitionFromSchema(field,schema.required?.includes(name)===true,depth+1)]));
  }
  if(type==='array')definition.items=inputDefinitionFromSchema(schema.items,true,depth+1);
  return definition;
}
export function inputDescription(definition:InputDefinition){return [definition.type,definition.required===false||owns(definition,'default')?'optional':'required',owns(definition,'default')?`default: ${JSON.stringify(definition.default)}`:undefined,definition.enum?.length?`one of ${definition.enum.map(value=>JSON.stringify(value)).join(', ')}`:undefined,definition.minimum!==undefined?`minimum ${definition.minimum}`:undefined,definition.maximum!==undefined?`maximum ${definition.maximum}`:undefined,definition.minLength!==undefined?`minimum ${definition.minLength} characters`:undefined,definition.maxLength!==undefined?`maximum ${definition.maxLength} characters`:undefined].filter(Boolean).join(' · ');}

export function TypedInputFields({inputs,values,onChange,omitted,onOmit,errors={},disabled=false}:{inputs:ContractWorkflow['inputs'];values:InputDraft;onChange:(name:string,value:string)=>void;omitted:Record<string,boolean>;onOmit:(name:string,value:boolean)=>void;errors?:Record<string,string>;disabled?:boolean}){const prefix=useId();return <>{Object.entries(inputs).map(([name,definition],index)=>{const id=`${prefix}-${index}`,hint=id+'-hint',error=id+'-error',skip=!!omitted[name],required=definition.required!==false&&!owns(definition,'default');const common={id,'aria-label':name,'aria-describedby':hint+(errors[name]?' '+error:''),'aria-invalid':errors[name]?true:undefined,disabled:disabled||skip,required:required&&!skip,value:values[name]??'',onChange:(event:{target:{value:string}})=>onChange(name,event.target.value)};return <div className="typed-input" key={name}><label className="field" htmlFor={id}><span>{name}{!required&&<span className="field-optional">Optional</span>}</span>{jsonInput(definition)?<textarea {...common} rows={6} maxLength={24576} spellCheck={false}/>:definition.type==='boolean'?<select {...common}><option value="">Choose a value</option><option value="true">true</option><option value="false">false</option></select>:['number','integer'].includes(definition.type)?<input {...common} type="number" step={definition.type==='integer'?'1':'any'} min={definition.minimum} max={definition.maximum}/>:definition.enum?<select {...common}><option value="">Choose a value</option>{definition.enum.map(value=><option key={value} value={value}>{value}</option>)}</select>:definition.pattern?<input {...common} minLength={definition.minLength??1} maxLength={definition.maxLength??120} pattern={definition.pattern}/>:<textarea {...common} minLength={definition.minLength??1} maxLength={definition.maxLength??4096} rows={3}/>}<small id={hint}>{jsonInput(definition)?'Enter JSON matching the declared structure. Null is distinct from an omitted field. ':''}{owns(definition,'default')?`When omitted, Hermo uses ${JSON.stringify(definition.default)}.`:!required?jsonInput(definition)?'Optional. Omitted fields are excluded from the request.':'When omitted, a recorded text field is cleared before the next step.':''}{definition.normalization==='trim'?' Outer whitespace is removed before sending. Line breaks inside your prompt are preserved.':''}</small>{errors[name]&&<small id={error} className="field-error" role="alert">{errors[name]}</small>}</label>{!required&&<label className="checkbox-row input-omission"><input type="checkbox" disabled={disabled} checked={skip} onChange={event=>onOmit(name,event.target.checked)}/><span>Omit {name}{owns(definition,'default')?' and use its default':''}</span></label>}</div>;})}</>;}

type InputEditor={type:InputDefinition['type'];required:boolean;hasDefault:boolean;defaultValue:string;enumValues:string;minimum:string;maximum:string;trim:boolean};
const editorInput=(definition:InputDefinition):InputEditor=>({type:definition.type??'string',required:definition.required!==false,hasDefault:owns(definition,'default'),defaultValue:owns(definition,'default')?String(definition.default):'',enumValues:definition.enum?.join('\n')??'',minimum:definition.minimum===undefined?'':String(definition.minimum),maximum:definition.maximum===undefined?'':String(definition.maximum),trim:definition.normalization==='trim'});
export function WorkflowContractEditor({workflow,disabled,onSave,onBusyChange}:{workflow:ContractWorkflow;disabled:boolean;onSave:(update:ContractUpdate)=>Promise<void>;onBusyChange?:(busy:boolean)=>void}){const[inputs,setInputs]=useState<Record<string,InputEditor>>(()=>Object.fromEntries(Object.entries(workflow.inputs).map(([name,definition])=>[name,editorInput(definition)]))),[outputs,setOutputs]=useState<Record<string,ContractUpdate['outputs'][number]['type']>>(()=>Object.fromEntries(workflow.outputs.map(output=>[output.name,(['string','number','boolean','url'].includes(output.type??'string')?output.type:'string') as ContractUpdate['outputs'][number]['type']]))),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');const prefix=useId();const update=(name:string,patch:Partial<InputEditor>)=>{setInputs(current=>({...current,[name]:{...current[name],...patch}}));setSaved('');};
async function save(){setError('');setSaved('');const definitions:ContractUpdate['inputs']={};try{for(const[name,editor]of Object.entries(inputs)){const original=workflow.inputs[name],definition:Omit<InputDefinition,'example'>={type:editor.type,required:editor.required};if(original.pattern){definition.pattern=original.pattern;if(editor.type!=='string'||!editor.required)throw new Error(`${name}: page parameters must remain required text.`);}if(editor.type==='string'){if(original.minLength!==undefined)definition.minLength=original.minLength;if(original.maxLength!==undefined)definition.maxLength=original.maxLength;if(editor.trim)definition.normalization='trim';if(editor.enumValues.trim()){definition.enum=editor.enumValues.split('\n').map(value=>editor.trim?value.trim():value).filter(value=>value.length>0);if(new Set(definition.enum).size!==definition.enum.length)throw new Error(`${name}: allowed values must be unique.`);}}if(editor.type==='number'){for(const key of ['minimum','maximum'] as const){if(editor[key].trim()){const number=Number(editor[key]);if(!Number.isFinite(number))throw new Error(`${name}: ${key} must be a finite number.`);definition[key]=number;}}if(definition.minimum!==undefined&&definition.maximum!==undefined&&definition.minimum>definition.maximum)throw new Error(`${name}: minimum cannot exceed maximum.`);}if(editor.hasDefault){const converted=typedInput({[name]:{...definition,example:''}}, {[name]:editor.defaultValue});if(converted.errors[name])throw new Error(`${name} default: ${converted.errors[name]}`);definition.default=converted.input[name];}if(!editor.required&&workflow.steps.some(step=>step.parameter===name&&['select','check'].includes(step.op))&&!editor.hasDefault)throw new Error(`${name}: optional select or checkbox inputs need a default to avoid reusing browser state.`);definitions[name]=definition;}setBusy(true);onBusyChange?.(true);await onSave({expected_version:workflow.version,inputs:definitions,outputs:workflow.outputs.map(output=>({name:output.name,type:outputs[output.name]}))});setSaved('Contract saved. Run verification again before publishing.');}catch(cause){setError(cause instanceof Error?cause.message:'The contract could not be saved.');}finally{setBusy(false);onBusyChange?.(false);}}
if(Object.values(workflow.inputs).some(advancedInput))return <details className="advanced workflow-contract-editor"><summary>Edit input and output types</summary><p>This contract contains nested, nullable, integer, or explicitly coerced inputs. Edit its full definitions in <strong>Edit workflow steps and extraction</strong> to preserve their structure and validation.</p></details>;
return <details className="advanced workflow-contract-editor"><summary>Edit input and output types</summary><p>Set the API contract for this draft. Names and recorded targets stay the same. Saving clears its previous verification. Configured defaults are contract data included in workflow exports and API documentation; do not store secrets here.</p><div className="contract-editor-fields">{Object.entries(inputs).map(([name,editor],index)=>{const path=!!workflow.inputs[name].pattern,uses=workflow.steps.flatMap((step,index)=>(step.parameter===name||step.path_parameter===name)?[`${index+1} (${step.op})`]:[]),fieldPrefix=`${prefix}-${index}`;return <fieldset className="contract-editor-field" key={name} disabled={disabled||busy}><legend>Input: <code>{name}</code></legend><p className="contract-use">{uses.length?`Used in step${uses.length===1?'':'s'} ${uses.join(', ')}.`:'Used by recorded page parameters or output verification.'}{path?' This page parameter must remain required text.':''}</p><div className="contract-editor-grid"><label className="field"><span>Type for {name}</span><select aria-label={`Type for ${name}`} value={editor.type} disabled={path} onChange={event=>update(name,{type:event.target.value as InputEditor['type']})}><option value="string">Text</option><option value="number">Number</option><option value="boolean">Boolean</option></select></label><label className="checkbox-row"><input type="checkbox" checked={editor.required} disabled={path} onChange={event=>update(name,{required:event.target.checked})}/><span>Require {name}</span></label></div>{editor.type==='string'&&<><label className="checkbox-row"><input type="checkbox" checked={editor.trim} onChange={event=>update(name,{trim:event.target.checked})}/><span>Trim outer whitespace from {name}</span></label><label className="field"><span>Allowed values for {name}</span><textarea aria-label={`Allowed values for ${name}`} value={editor.enumValues} rows={2} onChange={event=>update(name,{enumValues:event.target.value})} aria-describedby={fieldPrefix+'-enum-hint'}/><small id={fieldPrefix+'-enum-hint'}>Optional. Enter one text value per line.</small></label></>}{editor.type==='number'&&<div className="contract-editor-grid"><label className="field"><span>Minimum for {name}</span><input aria-label={`Minimum for ${name}`} type="number" step="any" value={editor.minimum} onChange={event=>update(name,{minimum:event.target.value})}/></label><label className="field"><span>Maximum for {name}</span><input aria-label={`Maximum for ${name}`} type="number" step="any" value={editor.maximum} onChange={event=>update(name,{maximum:event.target.value})}/></label></div>}<label className="checkbox-row"><input type="checkbox" checked={editor.hasDefault} onChange={event=>update(name,{hasDefault:event.target.checked})}/><span>Use a default for {name}</span></label>{editor.hasDefault&&<label className="field"><span>Default for {name}</span>{editor.type==='boolean'?<select aria-label={`Default for ${name}`} value={editor.defaultValue} onChange={event=>update(name,{defaultValue:event.target.value})}><option value="">Choose a value</option><option value="true">true</option><option value="false">false</option></select>:<input aria-label={`Default for ${name}`} type={editor.type==='number'?'number':'text'} step={editor.type==='number'?'any':undefined} value={editor.defaultValue} onChange={event=>update(name,{defaultValue:event.target.value})}/>}</label>}</fieldset>;})}{workflow.outputs.map(output=><fieldset className="contract-editor-field" disabled={disabled||busy} key={output.name}><legend>Output: <code>{output.name}</code></legend>{advancedOutput(output)?<><p><strong>{output.type??'string'}</strong>{output.required===false?' · optional':' · required'}{output.nullable?' · nullable':''}</p><p>Edit this output in <strong>the full workflow editor</strong> to preserve its structure, media settings, and validation constraints.</p></>:<><label className="field"><span>Type for output {output.name}</span><select aria-label={`Type for output ${output.name}`} value={outputs[output.name]} onChange={event=>{setOutputs(current=>({...current,[output.name]:event.target.value as typeof current[string]}));setSaved('');}}><option value="string">Text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="url">URL</option></select></label><p>Required. Missing or invalid values fail verification.</p></>}</fieldset>)}</div>{error&&<p className="contract-message field-error" role="alert">{error}</p>}{saved&&<p className="contract-message" role="status">{saved}</p>}<button type="button" className="button secondary" disabled={disabled||busy} aria-busy={busy} onClick={save}>{busy?'Saving contract…':'Save contract'}</button></details>;}
