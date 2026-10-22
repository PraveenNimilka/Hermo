import {z} from 'zod';
import {id,hash} from './store.mjs';
import {validateWorkflowSteps,assignStepIds} from './workflow-steps.mjs';
import {validateWorkflowContract} from './workflow-contract.mjs';
import {workflowExecutionCompatibility,workflowEffect} from './execution-capabilities.mjs';
import {resolveApprovalPolicy} from './approval-policy.mjs';

// Portable templates contain structure, never a captured website or account.
// Strings are closed enums or neutral slot names; every target is configured
// afresh by the owner. Imports cannot open a browser, run, test, or publish.
const inputName=z.string().regex(/^input_[1-9][0-9]?$/),outputName=z.string().regex(/^output_[1-9][0-9]?$/);
const targetSlot=z.string().regex(/^target_[1-9][0-9]{0,2}$/),urlSlot=z.string().regex(/^url_[1-9][0-9]?$/),valueSlot=z.string().regex(/^value_[1-9][0-9]?$/);
const shape=z.lazy(()=>z.object({type:z.enum(['string','number','integer','boolean','url','null','array','object']),required:z.boolean().default(true),nullable:z.boolean().optional(),target:targetSlot.optional(),attribute:z.enum(['src','href','alt','download','poster']).optional(),fields:z.array(shape).min(1).max(16).optional(),items:shape.optional(),max_items:z.number().int().min(1).max(100).optional()}).strict());
const inputShape=z.object({type:z.enum(['string','number','boolean']),required:z.boolean().default(true)}).strict();
const common={enabled:z.boolean().optional(),timeout_ms:z.number().int().min(100).max(30000).optional(),approval_required:z.boolean().optional()};
const target={target:targetSlot};
const step=z.discriminatedUnion('op',[
  z.object({op:z.literal('navigate'),...common,url:urlSlot}).strict(),
  z.object({op:z.literal('click'),...common,...target}).strict(),
  ...['fill','select','check'].map(op=>z.object({op:z.literal(op),...common,...target,input:inputName.optional(),value:valueSlot.optional()}).strict()),
  z.object({op:z.literal('wait_element'),...common,...target,state:z.enum(['visible','hidden','enabled'])}).strict(),
  z.object({op:z.literal('wait_text'),...common,...target,text:valueSlot}).strict(),
  z.object({op:z.literal('wait_url'),...common,url:urlSlot,match:z.enum(['exact','contains'])}).strict(),
  z.object({op:z.literal('wait_delay'),...common,duration_ms:z.number().int().min(100).max(10000)}).strict(),
  z.object({op:z.literal('wait_navigation'),...common,url:urlSlot.optional(),state:z.enum(['domcontentloaded','load'])}).strict(),
  z.object({op:z.literal('wait_response'),...common,url:urlSlot,method:z.enum(['GET','HEAD']),status:z.number().int().min(100).max(599).optional()}).strict(),
  z.object({op:z.literal('wait_output'),...common,output:outputName,predicate:z.literal('nonempty')}).strict()
]);
const rule=z.discriminatedUnion('kind',[
  ...['nonempty','changed','url','number','unique'].map(kind=>z.object({kind:z.literal(kind),output:outputName}).strict()),
  z.object({kind:z.literal('equals_input'),output:outputName,input:inputName}).strict()
]);
const schema=z.object({format:z.literal('hermo.template.v1'),structure:z.object({inputs:z.array(inputShape).max(16),outputs:z.array(shape).min(1).max(8),steps:z.array(step).max(32),verifiers:z.array(rule).max(24),approval:z.enum(['none','every_invocation']).default('none'),execution:z.enum(['either','managed_local']).default('either'),timeout_seconds:z.number().int().min(15).max(300).default(45)}).strict()}).strict();
const invalid=()=>{throw Error('INVALID_TEMPLATE');};
export function validateWorkflowTemplate(value){
  try{
    if(JSON.stringify(value).length>65536)invalid();
    const parsed=schema.parse(value),s=parsed.structure;let nodes=0;
    const inspect=(node,depth=0)=>{
      if(depth>4||++nodes>64)invalid();
      if(node.type==='object'){if(!node.fields||node.items||node.attribute||node.max_items!==undefined)invalid();node.fields.forEach(child=>inspect(child,depth+1));}
      else if(node.type==='array'){if(!node.target||!node.items||node.fields||node.attribute)invalid();inspect(node.items,depth+1);}
      else if(node.fields||node.items||node.max_items!==undefined)invalid();
      if(node.attribute&&!['string','url'].includes(node.type))invalid();
    };s.outputs.forEach(node=>inspect(node));
    for(const item of s.steps){
      if(['fill','select','check'].includes(item.op)&&Boolean(item.input)===Boolean(item.value))invalid();
      if(item.input&&Number(item.input.slice(6))>s.inputs.length)invalid();
      if(item.output&&Number(item.output.slice(7))>s.outputs.length)invalid();
      if(item.op.startsWith('wait_')&&item.approval_required)invalid();
    }
    for(const item of s.verifiers){if(Number(item.output.slice(7))>s.outputs.length||item.input&&Number(item.input.slice(6))>s.inputs.length)invalid();}
    return parsed;
  }catch{return invalid();}
}
export function templateSlots(template){
  const {structure:s}=validateWorkflowTemplate(template),targets=new Set(),urls=new Set(),values=new Set();
  const node=value=>{if(value.target)targets.add(value.target);value.fields?.forEach(node);if(value.items)node(value.items);};s.outputs.forEach(node);
  for(const value of s.steps){if(value.target)targets.add(value.target);if(value.url)urls.add(value.url);if(value.value)values.add(value.value);if(value.text)values.add(value.text);}
  return {targets:[...targets],urls:[...urls],values:[...values]};
}
const envelope=structure=>validateWorkflowTemplate({format:'hermo.template.v1',structure:{inputs:[],steps:[],outputs:[{type:'string',target:'target_1'}],verifiers:[{kind:'nonempty',output:'output_1'}],...structure}});
const rows={type:'array',target:'target_1',max_items:50,items:{type:'object',fields:[{type:'string',target:'target_2'},{type:'string',target:'target_3'}]}};
export const workflowTemplateCatalog=[
  {id:'search-extract',name:'Search and extract',description:'Fill a search field, submit once, then verify a changed result.',template:envelope({inputs:[{type:'string'}],steps:[{op:'fill',target:'target_1',input:'input_1'},{op:'click',target:'target_2'}],outputs:[{type:'string',target:'target_3'}],verifiers:[{kind:'changed',output:'output_1'}]})},
  {id:'table-json',name:'Table to JSON',description:'Extract up to 50 rows with two explicitly selected fields.',template:envelope({outputs:[rows]})},
  {id:'detail-page',name:'Detail page',description:'Visit one approved page and extract a selected result.',template:envelope({steps:[{op:'navigate',url:'url_1'}]})},
  {id:'finite-pagination',name:'Finite pagination',description:'Click Load more twice and extract up to 100 accumulated rows. Use only on a page that retains earlier rows; replacing pages returns only the final page.',template:envelope({steps:[{op:'click',target:'target_1'},{op:'click',target:'target_1'}],outputs:[{type:'array',target:'target_2',max_items:100,items:{type:'string'}}],verifiers:[{kind:'nonempty',output:'output_1'},{kind:'changed',output:'output_1'}]})},
  {id:'approved-form',name:'Form with approval',description:'Fill one input and require the owner to approve submission.',template:envelope({inputs:[{type:'string'}],steps:[{op:'fill',target:'target_1',input:'input_1'},{op:'click',target:'target_2',approval_required:true}],outputs:[{type:'string',target:'target_3'}],verifiers:[{kind:'changed',output:'output_1'}]})},
  {id:'status-lookup',name:'Status lookup',description:'Submit a reference and match its echoed value to the input.',template:envelope({inputs:[{type:'string'}],steps:[{op:'fill',target:'target_1',input:'input_1'},{op:'click',target:'target_2'}],outputs:[{type:'string',target:'target_3'},{type:'string',target:'target_4'}],verifiers:[{kind:'equals_input',output:'output_1',input:'input_1'},{kind:'changed',output:'output_2'}]})},
  {id:'dashboard-extract',name:'Dashboard extraction',description:'Read three selected dashboard values without submitting a form.',template:envelope({outputs:[{type:'string',target:'target_1'},{type:'number',target:'target_2'},{type:'string',target:'target_3'}],verifiers:[{kind:'nonempty',output:'output_1'},{kind:'number',output:'output_2'},{kind:'nonempty',output:'output_3'}]})},
  {id:'authenticated-managed',name:'Authenticated managed browser',description:'Use an existing confirmed managed session, wait for a selected result, then extract it. Sign in separately.',template:envelope({execution:'managed_local',steps:[{op:'wait_element',target:'target_1',state:'visible'}],approval:'every_invocation'})}
];

export function exportWorkflowTemplate(definition){
  const inputs=Object.keys(definition.inputs??{}),outputs=definition.outputs??[],inputMap=new Map(inputs.map((name,i)=>[name,`input_${i+1}`])),outputMap=new Map(outputs.map((field,i)=>[field.name,`output_${i+1}`]));let target=0,url=0,value=0;
  const nextTarget=()=>`target_${++target}`,nextURL=()=>`url_${++url}`,nextValue=()=>`value_${++value}`;
  const mapping=(node,item=false)=>{
    if(node.source||node.frame_path?.length)invalid();
    const result={type:node.type??'string',required:node.required!==false,...node.nullable?{nullable:true}:{}};
    if(node.selector||!item&&!['object'].includes(result.type))result.target=nextTarget();
    if(node.read_attribute)result.attribute=node.read_attribute;
    if(result.type==='object')result.fields=node.fields.map(child=>mapping(child));
    if(result.type==='array'){result.max_items=node.maxItems??100;result.items=mapping(node.items,true);}
    return result;
  };
  const policy=resolveApprovalPolicy(definition),required=new Set(policy.required_steps);
  // A wait gate can occur after earlier website actions. Moving that decision
  // to invocation would change the approved execution order, so refuse an
  // export that this portable format cannot represent without loss.
  if(policy.classifications.some(item=>item.approval_required&&item.operation.startsWith('wait_')))invalid();
  const steps=definition.steps.map((item,i)=>{
    if(item.frame_path?.length||item.path_parameter||item.value_path?.length||item.op==='wait_output'&&item.predicate!=='nonempty')invalid();
    const result={op:item.op,...item.enabled===false?{enabled:false}:{},...item.timeout_ms?{timeout_ms:item.timeout_ms}:{},...required.has(i+1)&&!item.op.startsWith('wait_')?{approval_required:true}:{}};
    if(item.selector||item.locators?.length)result.target=nextTarget();
    if(item.url)result.url=nextURL();
    if(item.parameter)result.input=inputMap.get(item.parameter);
    if(item.value!==undefined)result.value=nextValue();
    if(item.text!==undefined)result.text=nextValue();
    for(const key of ['state','match','duration_ms','method','status','predicate'])if(item[key]!==undefined)result[key]=item[key];
    if(item.output)result.output=outputMap.get(item.output);
    return result;
  });
  const invocation=policy.invocation_gate;
  const verifiers=definition.verifiers.map(rule=>{
    const kind=rule.kind??'equals_input';if(!['nonempty','changed','url','number','unique','equals_input'].includes(kind)||rule.path?.length)invalid();
    return {kind,output:outputMap.get(rule.output),...rule.input?{input:inputMap.get(rule.input)}:{}};
  });
  return validateWorkflowTemplate({format:'hermo.template.v1',structure:{inputs:inputs.map(name=>({type:definition.inputs[name].type??'string',required:definition.inputs[name].required!==false})),outputs:outputs.map(node=>mapping(node)),steps,verifiers,approval:invocation?'every_invocation':'none',execution:'either',timeout_seconds:Math.max(15,Math.min(300,Math.ceil((definition.timeout_ms??45000)/1000)))}});
}

export function configureWorkflowTemplate(template,configuration,connection,origin){
  const {structure:s}=validateWorkflowTemplate(template),slots=templateSlots(template);
  const config=z.object({targets:z.record(targetSlot,z.string().min(1).max(3000)),urls:z.record(urlSlot,z.string().min(1).max(2048)),values:z.record(valueSlot,z.string().max(4096))}).strict().parse(configuration);
  for(const key of ['targets','urls','values'])if(JSON.stringify(Object.keys(config[key]).sort())!==JSON.stringify(slots[key].sort()))invalid();
  if(s.execution==='managed_local'&&connection.browser_mode==='connected')throw Error('EXECUTION_INCOMPATIBLE');
  const inputs=Object.fromEntries(s.inputs.map((field,i)=>[`input_${i+1}`,field]));
  const mapping=(node,index,root=true)=>({...(root?{name:`output_${index+1}`}:{name:`field_${index+1}`}),type:node.type,required:node.required,...node.nullable?{nullable:true}:{},...node.target?{selector:config.targets[node.target]}:{},...node.attribute?{read_attribute:node.attribute}:{},...node.fields?{fields:node.fields.map((child,i)=>mapping(child,i,false))}:{},...node.items?{items:((({name,...rest})=>rest)(mapping(node.items,0,false))),maxItems:node.max_items??100}:{}});
  const outputs=s.outputs.map((node,i)=>mapping(node,i));
  const steps=assignStepIds(s.steps.map(item=>{const {target,url,input,value,text,...rest}=item;return {...rest,...target?{selector:config.targets[target]}:{},...url?{url:config.urls[url]}:{},...input?{parameter:input}:{},...value?{value:config.values[value]}:{},...text?{text:config.values[text]}:{}};}));
  const definition=validateWorkflowContract({contract_version:'2',action_type:'custom',effect:'retrieval',approval_policy:{mode:s.approval},inputs,outputs,steps:validateWorkflowSteps(steps,{inputs,outputs,origins:connection.origins,sandboxOrigin:origin}),verifiers:s.verifiers,timeout_ms:s.timeout_seconds*1000});
  definition.effect=workflowEffect(definition,connection.browser_mode);
  const compatible=workflowExecutionCompatibility(connection,definition,undefined,{sandboxOrigin:origin});if(!compatible.compatible)throw Error('EXECUTION_INCOMPATIBLE');
  definition.version=hash(JSON.stringify(definition));return definition;
}

export function installWorkflowTemplates(app,{store,workflow,connection,projects,safeWorkflow,fail,rate,origin}){
  const {db,seal,audit}=store;
  const parse=(schema,value)=>{const parsed=schema.safeParse(value);if(!parsed.success)fail('INVALID_TEMPLATE','Check the template format and configuration.');return parsed.data;};
  const validate=value=>{try{return validateWorkflowTemplate(value);}catch{fail('INVALID_TEMPLATE','Only supported, neutral structural templates can be imported. Captured targets, URLs, values and unknown fields are rejected.');}};
  app.get('/studio/templates',async()=>({templates:workflowTemplateCatalog}));
  app.post('/studio/templates/import',async req=>{const body=parse(z.object({template:z.unknown()}).strict(),req.body),template=validate(body.template);return {template,slots:templateSlots(template)};});
  app.get('/studio/workflows/:wid/template',async req=>{try{const template=exportWorkflowTemplate(workflow(req.params.wid).definition);return {template,slots:templateSlots(template),notice:'Structural blueprint only. Configure every website target and URL, then test and review permissions before publishing.'};}catch(error){if(error.publicCode)throw error;fail('TEMPLATE_EXPORT_UNSUPPORTED','This workflow uses a binding or verification rule that cannot be exported safely as a neutral template. No partial template was produced.',409);}});
  app.post('/studio/templates/instantiate',async req=>{
    rate?.('template-create',20);
    const body=parse(z.object({template:z.unknown(),connection_id:z.string().min(1).max(100),name:z.string().trim().min(1).max(100),slug:z.string().regex(/^[a-z][a-z0-9.-]{2,79}$/),authorized:z.literal(true),configuration:z.unknown()}).strict(),req.body);
    const template=validate(body.template),c=connection(body.connection_id);
    if(c.status!=='connected'||!c.identity)fail('CONNECTION_REQUIRED','Choose an existing authorized, confirmed connection.',409);
    if(projects?.assertAssignable)projects.assertAssignable(projects.projectId(c.id));
    let definition;try{definition=configureWorkflowTemplate(template,body.configuration,c,origin);}catch(error){fail(error.message==='EXECUTION_INCOMPATIBLE'?'EXECUTION_INCOMPATIBLE':'INVALID_TEMPLATE_CONFIGURATION','Check every configured CSS target, approved full URL, value, and browser capability.');}
    if(db.prepare('SELECT 1 FROM workflows WHERE slug=?').get(body.slug))fail('SLUG_TAKEN','Choose another action slug.',409);
    const wid=id('wf');db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?)').run(wid,c.id,body.name,body.slug,'draft',definition.version,seal(definition),null,new Date().toISOString());audit('action.template_drafted',wid);
    return {workflow:safeWorkflow(db.prepare('SELECT * FROM workflows WHERE id=?').get(wid)),requires_test:true};
  });
}
