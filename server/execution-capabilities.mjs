import {createHash} from 'node:crypto';
import {z} from 'zod';
import {validateWebsite} from './network.mjs';
import {validateOutputMappings} from './output-mappings.mjs';
import {pageTemplate} from './page-template.mjs';

export const EXECUTION_MODES=Object.freeze(['connected_chrome','managed_local']);
const operations=Object.freeze(['navigate','click','fill','select','check','wait_element','wait_url','wait_text']);
const configSchema=z.object({
  version:z.literal(1),
  mode:z.enum(EXECUTION_MODES),
  connection_id:z.string().min(1).max(100),
  allowed_origins:z.array(z.string()).min(1).max(32),
  allowed_actions:z.array(z.enum(operations)).max(operations.length),
  network_policy:z.enum(['selected_tab','retrieval']),
  session_binding:z.object({kind:z.enum(['selected_tab','anonymous','dedicated_connection']),connection_id:z.string().min(1).max(100)}).strict()
}).strict();

const problem=(code,path,message)=>({code,path,message});
const invalid=()=>{throw Error('INVALID_EXECUTION_CONFIG');};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const modeFor=connection=>connection.browser_mode==='connected'?'connected_chrome':connection.browser_mode===undefined||connection.browser_mode==='isolated'?'managed_local':undefined;

export function executionCapabilities(mode){
  if(!EXECUTION_MODES.includes(mode))return invalid();
  return {
    mode,operations:[...operations],input_types:['string','number','boolean'],output_types:['string','number','boolean','url','object','array'],
    frames:mode==='managed_local',network_policy:mode==='managed_local'?'retrieval':'selected_tab',
    persistent_profile_directory:false,session_import:false,explicit_wait_steps:true,collections:true,
    requires_available_tab:mode==='connected_chrome',requires_dashboard:false
  };
}

function originsFor(connection,sandboxOrigin){
  if(!Array.isArray(connection.origins)||connection.origins.length<1||connection.origins.length>32)return invalid();
  const values=connection.origins.map(value=>{
    const url=new URL(value);
    // Configuration stores exact origins, never URL prefixes or wildcards.
    if(value!==url.origin||url.username||url.password)return invalid();
    validateWebsite(url.origin===sandboxOrigin?url.origin+'/sandbox/':url.origin,sandboxOrigin);
    return url.origin;
  });
  const entry=validateWebsite(connection.url,sandboxOrigin);
  if(!values.includes(entry.origin)||entry.origin!==sandboxOrigin&&values.includes(sandboxOrigin))return invalid();
  return [...new Set(values)].sort();
}

/** Derive authority from an existing connection. This never transfers a session. */
export function normalizeExecutionConfig(connection,{sandboxOrigin,mode}={}){
  try{
    const actualMode=modeFor(connection);
    if(!actualMode)return invalid();
    if(mode!==undefined&&mode!==actualMode)throw Error('EXECUTION_MODE_MISMATCH');
    if(actualMode==='managed_local'&&connection.browser_profile_id)throw Error('SHARED_SESSION_NOT_SUPPORTED');
    const value={version:1,mode:actualMode,connection_id:connection.id,allowed_origins:originsFor(connection,sandboxOrigin),allowed_actions:[...operations],
      network_policy:actualMode==='managed_local'?'retrieval':'selected_tab',
      session_binding:{kind:actualMode==='connected_chrome'?'selected_tab':connection.access==='public'?'anonymous':'dedicated_connection',connection_id:connection.id}};
    return configSchema.parse(value);
  }catch(error){if(['EXECUTION_MODE_MISMATCH','SHARED_SESSION_NOT_SUPPORTED'].includes(error.message))throw error;return invalid();}
}

function boundConfig(connection,config,options){
  const parsed=configSchema.parse(config),authority=normalizeExecutionConfig(connection,options);
  if(parsed.mode!==authority.mode||parsed.connection_id!==authority.connection_id||parsed.network_policy!==authority.network_policy||
    digest(parsed.session_binding)!==digest(authority.session_binding)||new Set(parsed.allowed_origins).size!==parsed.allowed_origins.length||
    new Set(parsed.allowed_actions).size!==parsed.allowed_actions.length||parsed.allowed_origins.some(origin=>!authority.allowed_origins.includes(origin))||
    !parsed.allowed_origins.includes(new URL(connection.url).origin))return invalid();
  return {...parsed,allowed_origins:[...parsed.allowed_origins].sort(),allowed_actions:[...parsed.allowed_actions].sort()};
}
export function validateExecutionConfig(connection,config,options={}){
  try{return boundConfig(connection,config,options);}catch(error){if(error.message==='SHARED_SESSION_NOT_SUPPORTED')throw error;return invalid();}
}

/** Capability compatibility is not test evidence or proof that a website permits automation. */
export function workflowExecutionCompatibility(connection,definition,config,options={}){
  const errors=[],warnings=[];let bound;
  try{bound=validateExecutionConfig(connection,config??normalizeExecutionConfig(connection,options),options);}catch(error){
    return {compatible:false,execution_mode:config?.mode??modeFor(connection)??null,requires_test:true,errors:[problem(error.message==='SHARED_SESSION_NOT_SUPPORTED'?error.message:'INVALID_EXECUTION_CONFIG','execution','Use an authorized connection and its exact execution scope.')],warnings};
  }
  const managed=bound.mode==='managed_local';
  if(!definition||!Array.isArray(definition.steps)||!Array.isArray(definition.outputs)||!definition.outputs.length)errors.push(problem('INVALID_WORKFLOW','workflow','A workflow requires steps and output mappings.'));
  const capabilities=new Set(['input.scalar','output.scalar','output.object','output.array','extract.text','extract.attribute','url.path_parameter',...bound.allowed_actions.map(op=>'step.'+op),...managed?['frames']:[]]);
  if(definition?.required_capabilities!==undefined){
    if(!Array.isArray(definition.required_capabilities)||definition.required_capabilities.some(value=>typeof value!=='string'))errors.push(problem('INVALID_CAPABILITIES','workflow.required_capabilities','Required capabilities must be named explicitly.'));
    else for(const capability of [...new Set(definition.required_capabilities)].sort())if(!capabilities.has(capability))errors.push(problem('CAPABILITY_NOT_SUPPORTED','workflow.required_capabilities','This execution adapter does not support a required capability: '+capability.slice(0,80)));
  }
  const navigation=(value,path)=>{
    try{
      const url=validateWebsite(value,options.sandboxOrigin);
      if(!bound.allowed_origins.includes(url.origin))throw Error();
      // The companion supports only its selected origin, including approved login origins.
      if(!managed&&url.origin!==new URL(connection.url).origin)throw Error();
    }catch{errors.push(problem('NAVIGATION_NOT_ALLOWED',path,'Navigation must remain within this execution mode’s authorized origins and paths.'));}
  };
  if(connection.checkpoint)navigation(connection.checkpoint,'connection.checkpoint');
  for(const [index,step]of (Array.isArray(definition?.steps)?definition.steps:[]).entries()){
    const path=`steps.${index}`;
    if(step?.enabled===false)continue;
    if(!step||!bound.allowed_actions.includes(step.op)){errors.push(problem('UNSUPPORTED_STEP',path,'This execution adapter does not support the configured step.'));continue;}
    if(step.frame_path!==undefined&&(!Array.isArray(step.frame_path)||step.frame_path.some(value=>typeof value!=='string'||!value)||step.frame_path.length>6))errors.push(problem('INVALID_LOCATOR',path+'.frame_path','Frame paths must contain at most six recorded selectors.'));
    else if(!managed&&step.frame_path?.length)errors.push(problem('UNSUPPORTED_FRAME',path+'.frame_path','Connected Chrome supports top-level recorded elements only.'));
    if(step.op==='navigate'||step.op==='wait_url'){
      let url=step.url;
      if(step.path_parameter)try{url=pageTemplate(step.template,step.path_parameter,'hermo-check').url;}catch{errors.push(problem('INVALID_PAGE_TEMPLATE',path+'.template','Use a supported complete path-segment parameter.'));continue;}
      navigation(url,path+'.url');
    }else if((typeof step.selector!=='string'||!step.selector.trim())&&!step.locators?.length)errors.push(problem('INVALID_LOCATOR',path+'.selector','An element locator is required.'));
  }
  const inspectOutput=(field,path,depth=0)=>{
    if(depth>4)return;
    if(managed&&(field.read_mode!==undefined||typeof field.selector==='string'&&field.selector.startsWith(':hermo-')))errors.push(problem('UNSUPPORTED_OUTPUT',path,'Managed extraction requires a literal CSS target; companion semantic message reads cannot be transferred.'));
    if(field.source==='url_parameter'){
      try{navigation(pageTemplate(field.template,field.parameter,'hermo-check').url,path+'.template');}catch{errors.push(problem('INVALID_PAGE_TEMPLATE',path+'.template','Use a supported complete path-segment parameter.'));}
    }
    if(field.frame_path!==undefined&&(!Array.isArray(field.frame_path)||field.frame_path.some(value=>typeof value!=='string'||!value)||field.frame_path.length>6))errors.push(problem('INVALID_LOCATOR',path+'.frame_path','Frame paths must contain at most six recorded selectors.'));
    else if(!managed&&field.frame_path?.length)errors.push(problem('UNSUPPORTED_FRAME',path+'.frame_path','Connected Chrome supports top-level extraction only.'));
    for(const [index,child]of (field.fields??[]).entries())inspectOutput(child,path+'.fields.'+index,depth+1);
    if(field.items)inspectOutput(field.items,path+'.items',depth+1);
  };
  for(const [index,field]of (Array.isArray(definition?.outputs)?definition.outputs:[]).entries()){
    const path=`outputs.${index}`;
    try{validateOutputMappings([field]);inspectOutput(field,path);}catch{errors.push(problem('UNSUPPORTED_OUTPUT',path,'Use bounded scalar, object or repeating-list extraction mappings with supported CSS targets.'));}
  }
  if(managed){
    if(['generate_media','submit_form'].includes(definition?.action_type)||definition?.effect==='recorded_browser_actions'||definition?.execution?.network_policy==='authorized_actions')errors.push(problem('MANAGED_ACTIONS_NOT_SUPPORTED','workflow.effect','The current managed adapter permits GET/HEAD retrieval only; action workflows require Connected Chrome.'));
    if(connection.access!=='public'&&!connection.storageState)warnings.push(problem('AUTHENTICATION_SETUP_REQUIRED','connection','Sign in explicitly in this dedicated connection and run a real managed test. Stored state alone does not prove authentication.'));
    if(Array.isArray(definition?.steps)&&definition.steps.some(step=>step?.op!=='navigate'))warnings.push(problem('RETRIEVAL_NETWORK_ONLY','workflow.steps','DOM controls can be replayed, but non-GET/HEAD traffic and WebSockets are blocked. A GET request can still have a website side effect.'));
    warnings.push(problem('MANAGED_TEST_REQUIRED','execution','Only a real test in this dedicated managed connection can establish publication evidence.'));
  }
  return {compatible:errors.length===0,execution_mode:bound.mode,requires_test:true,errors,warnings};
}

export function executionConfigHash(config){
  const value=configSchema.parse(config);
  return digest({...value,allowed_origins:[...value.allowed_origins].sort(),allowed_actions:[...value.allowed_actions].sort()});
}

/** Bind verification to both content and mode; never reuse a connected-tab test for managed execution. */
export function executionTestBinding(definition,config){return {definition_hash:digest(definition),execution_config_hash:executionConfigHash(config)};}
export function isExecutionTestEvidenceValid(evidence,definition,config){
  if(evidence?.status!=='succeeded')return false;
  const binding=executionTestBinding(definition,config);
  return evidence.definition_hash===binding.definition_hash&&evidence.execution_config_hash===binding.execution_config_hash;
}
