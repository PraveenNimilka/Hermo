import {hash} from './store.mjs';
import {inputJsonSchema,outputJsonSchema} from './workflow-contract.mjs';
import {workflowEffect} from './execution-capabilities.mjs';
import {compileApprovalPolicy} from './approval-policy.mjs';

// Review metadata contains paths and fixed reason codes only. Values, browser
// selectors, destinations, fixed form data and session material stay private.
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const equal=(a,b)=>canonical(a)===canonical(b);
const owns=(value,key)=>Object.hasOwn(value??{},key);
const segment=value=>typeof value==='number'?value:/^[a-z][a-z0-9_]{0,79}$/i.test(value)?value:'[field]';
const safePath=path=>path.map(segment);
const ordered=items=>items.sort((a,b)=>canonical(a).localeCompare(canonical(b),'en'));
const types=schema=>{
  if(schema?.anyOf?.length===2&&schema.anyOf.some(branch=>branch?.type==='null')){
    const base=schema.anyOf.find(branch=>branch?.type!=='null');
    return {schema:base,values:[...(Array.isArray(base?.type)?base.type:[base?.type]),'null']};
  }
  return {schema,values:Array.isArray(schema?.type)?schema.type:[schema?.type]};
};
const typeSubset=(subset,superset)=>subset.every(value=>superset.includes(value)||value==='integer'&&superset.includes('number'));
const informational=new Set(['title','description','examples','$comment','default','x-hermo-normalization']);
const handled=new Set(['type','anyOf','properties','required','additionalProperties','items','enum','minimum','maximum','exclusiveMinimum','exclusiveMaximum','minLength','maxLength','minItems','maxItems','uniqueItems','pattern','format','allOf']);

/** Compare caller acceptance (input) or returned-value guarantees (output).
 * Unknown changed schema constraints are conservatively breaking. The caller
 * must supply validated schemas; this is a compatibility review, not validation.
 */
export function compareJsonSchemas(before,after,{direction='input',path=[]}={}){
  if(!['input','output'].includes(direction)||!before||!after||typeof before!=='object'||typeof after!=='object')throw Error('INVALID_CHANGE_REVIEW');
  const changes=[];
  const add=(path,reason,breaking)=>changes.push({path:safePath(path),reason,breaking});
  const visit=(old,next,path,depth=0)=>{
    if(equal(old,next))return;
    if(depth>12){add(path,'schema_change_unclassified',true);return;}
    if(!old||!next||typeof old!=='object'||typeof next!=='object'||Array.isArray(old)||Array.isArray(next)){add(path,'schema_change_unclassified',true);return;}
    const a=types(old),b=types(next),narrowed=!typeSubset(a.values,b.values),widened=!typeSubset(b.values,a.values);
    if(narrowed||widened)add(path,'type_changed',direction==='input'?narrowed:widened);
    const left=a.schema??{},right=b.schema??{};
    if(a.values.includes('object')&&b.values.includes('object')){
      const oldFields=left.properties??{},nextFields=right.properties??{},oldRequired=new Set(left.required??[]),nextRequired=new Set(right.required??[]);
      for(const name of [...new Set([...Object.keys(oldFields),...Object.keys(nextFields)])].sort()){
        const fieldPath=[...path,name];
        if(!owns(oldFields,name)){add(fieldPath,'field_added',direction==='input'&&nextRequired.has(name));continue;}
        if(!owns(nextFields,name)){add(fieldPath,'field_removed',direction==='output'||left.additionalProperties===false||right.additionalProperties===false);continue;}
        if(oldRequired.has(name)!==nextRequired.has(name))add(fieldPath,nextRequired.has(name)?'field_required':'field_optional',direction==='input'?nextRequired.has(name):!nextRequired.has(name));
        visit(oldFields[name],nextFields[name],fieldPath,depth+1);
      }
      if(!equal(left.additionalProperties,right.additionalProperties)){
        const closedBefore=left.additionalProperties===false,closedAfter=right.additionalProperties===false;
        add(path,'additional_properties_changed',direction==='input'?closedAfter||!closedBefore&&!closedAfter:closedBefore||!closedBefore&&!closedAfter);
      }
    }
    if(a.values.includes('array')&&b.values.includes('array'))visit(left.items,right.items,[...path,'items'],depth+1);
    if(!equal(left.enum,right.enum)){
      const subset=(one,two)=>!two||!!one&&one.every(value=>two.some(item=>equal(item,value)));
      add(path,'enum_changed',direction==='input'?!subset(left.enum,right.enum):!subset(right.enum,left.enum));
    }
    for(const [key,lower]of [['minimum',true],['maximum',false],['exclusiveMinimum',true],['exclusiveMaximum',false],['minLength',true],['maxLength',false],['minItems',true],['maxItems',false]]){
      if(equal(left[key],right[key]))continue;
      const fallback=lower?-Infinity:Infinity,oldValue=left[key]??fallback,nextValue=right[key]??fallback;
      const narrower=lower?nextValue>oldValue:nextValue<oldValue;
      add(path,key+'_changed',direction==='input'?narrower:!narrower);
    }
    if(!!left.uniqueItems!==!!right.uniqueItems)add(path,'unique_items_changed',direction==='input'?!!right.uniqueItems:!!left.uniqueItems);
    for(const key of ['pattern','format','allOf'])if(!equal(left[key],right[key])){
      // Arbitrary regular expression or format containment is not decidable by
      // string comparison. Adding/removing a predicate has a known direction;
      // replacing one requires an explicit compatibility review.
      const breaking=owns(left,key)&&owns(right,key)||(direction==='input'?owns(right,key):owns(left,key));
      add(path,key+'_changed',breaking);
    }
    for(const key of [...new Set([...Object.keys(left),...Object.keys(right)])].sort())if(!handled.has(key)&&!informational.has(key)&&!equal(left[key],right[key]))add(path,'schema_change_unclassified',true);
    // Optionality with defaults affects request omission. The generated required
    // list accounts for it; normalization affects accepted values independently.
    if(!equal(left['x-hermo-normalization'],right['x-hermo-normalization']))add(path,'normalization_changed',true);
    if((old.anyOf||next.anyOf)&&!(old.anyOf?.length===2&&old.anyOf.some(branch=>branch?.type==='null')||!old.anyOf)&&!equal(old.anyOf,next.anyOf))add(path,'schema_change_unclassified',true);
    if(next.anyOf&&!b.values.includes('null')&&!equal(old.anyOf,next.anyOf))add(path,'schema_change_unclassified',true);
  };
  visit(before,after,path);
  return ordered(changes);
}

const mode=connection=>connection.browser_mode==='connected'?'connected_chrome':'managed_local';
const values=value=>[...new Set(value)].sort();
function permissionChanges(before,after,beforeConnection,afterConnection){
  const changes=[],add=(path,reason,direction,count)=>changes.push({path:safePath(path),reason,direction,...count?{count}:{}});
  const sets=(old,next,path,reason)=>{
    const a=new Set(old),b=new Set(next),added=[...b].filter(value=>!a.has(value)).length,removed=[...a].filter(value=>!b.has(value)).length;
    if(added)add(path,reason+'_added','expanded',added);
    if(removed)add(path,reason+'_removed','reduced',removed);
  };
  sets(beforeConnection.origins??[],afterConnection.origins??[],['permissions','origins'],'origin');
  const active=definition=>(definition.steps??[]).filter(step=>step.enabled!==false);
  sets(values(active(before).map(step=>step.op)),values(active(after).map(step=>step.op)),['permissions','actions'],'action');
  sets(before.required_capabilities??[],after.required_capabilities??[],['permissions','capabilities'],'capability');
  if(!equal(before.execution,after.execution))add(['permissions','execution'],'execution_policy_changed','changed');
  if(mode(beforeConnection)!==mode(afterConnection))add(['permissions','browser'],'execution_mode_changed','changed');
  for(const key of ['id','access','browser_workspace_id','browser_profile_id','session_generation','identity','url','checkpoint'])if(!equal(beforeConnection[key],afterConnection[key]))add(['permissions','browser'],key==='access'?'session_requirement_changed':key==='url'||key==='checkpoint'?'entry_page_changed':'browser_binding_changed','changed');
  const oldEffect=workflowEffect(before,mode(beforeConnection)),nextEffect=workflowEffect(after,mode(afterConnection));
  if(oldEffect!==nextEffect)add(['permissions','effect'],'workflow_effect_changed',nextEffect==='recorded_browser_actions'?'expanded':'reduced');
  const oldSteps=active(before),nextSteps=active(after);
  for(const [index,step]of oldSteps.entries()){
    if(step.approval_required!==true)continue;
    // Stable step IDs win. Legacy steps are paired by their stored position;
    // reordered/changed targets are conservatively reviewed rather than guessed.
    const replacement=step.id?nextSteps.find(value=>value.id===step.id):nextSteps[index];
    if(!replacement)add(['permissions','approvals',index],'protected_action_removed','reduced');
    else if(replacement.approval_required!==true)add(['permissions','approvals',index],'approval_removed','expanded');
    else if(!equal({...step,approval_required:undefined},{...replacement,approval_required:undefined}))add(['permissions','approvals',index],'protected_action_changed','changed');
  }
  for(const [index,step]of nextSteps.entries()){
    const previous=step.id?oldSteps.find(value=>value.id===step.id):oldSteps[index];
    if(step.approval_required===true&&previous?.approval_required!==true)add(['permissions','approvals',index],'approval_added','reduced');
  }
  if(!equal(before.approval_policy,after.approval_policy))add(['permissions','approvals'],'approval_policy_changed','changed');
  const exposure=(old,next,path)=>{
    const a=new Map(old.map(field=>[field.name,field])),b=new Map(next.map(field=>[field.name,field]));
    for(const [name,field]of b){
      const previous=a.get(name),nextPath=[...path,name];
      if(!previous){add(nextPath,'returned_field_added','expanded');continue;}
      if(!equal(Object.fromEntries(['selector','locators','frame_path','read_attribute','read_mode','source','template','parameter','maxItems'].map(key=>[key,previous[key]])),Object.fromEntries(['selector','locators','frame_path','read_attribute','read_mode','source','template','parameter','maxItems'].map(key=>[key,field[key]]))))add(nextPath,'extraction_scope_changed','changed');
      if(previous.type!==field.type)add(nextPath,'returned_shape_changed','changed');
      if(field.fields||previous.fields)exposure(previous.fields??[],field.fields??[],nextPath);
      if(field.items||previous.items)exposure(previous.items?[{...previous.items,name:'items'}]:[],field.items?[{...field.items,name:'items'}]:[],nextPath);
    }
    for(const name of a.keys())if(!b.has(name))add([...path,name],'returned_field_removed','reduced');
  };
  exposure(before.outputs??[],after.outputs??[],['permissions','outputs']);
  // A reused operation can acquire a different target or fixed payload without
  // adding a capability. Still require renewed permission review for that change.
  if(!equal(oldSteps,nextSteps))add(['permissions','steps'],'action_configuration_changed','changed');
  return ordered(changes);
}

/** Pure comparison of validated draft/revision definitions and frozen configs.
 * Fingerprint binds the exact supplied pair (including policy fields omitted
 * from the public summary). Never persist or expose these inputs as diagnostics.
 */
export function compareWorkflowChanges({before,after,beforeConnection,afterConnection}){
  if(!before||!after||!beforeConnection||!afterConnection)throw Error('INVALID_CHANGE_REVIEW');
  const inputChanges=compareJsonSchemas(inputJsonSchema(before.inputs??{}),inputJsonSchema(after.inputs??{}),{direction:'input',path:['inputs']});
  const outputChanges=compareJsonSchemas(outputJsonSchema(before.outputs??[]),outputJsonSchema(after.outputs??[]),{direction:'output',path:['outputs']});
  const permissions=permissionChanges(compileApprovalPolicy(before),compileApprovalPolicy(after),beforeConnection,afterConnection);
  return {fingerprint:hash(canonical({before,after,beforeConnection,afterConnection})),breaking:inputChanges.some(change=>change.breaking)||outputChanges.some(change=>change.breaking),input_changes:inputChanges,output_changes:outputChanges,permission_changes:permissions,permission_review_required:permissions.length>0,permissions_expanded:permissions.some(change=>change.direction==='expanded')};
}
