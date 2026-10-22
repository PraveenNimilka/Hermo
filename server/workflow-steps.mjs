import {z} from 'zod';
import {createHash,randomUUID} from 'node:crypto';
import {validateWebsite} from './network.mjs';
import {pageTemplate} from './page-template.mjs';
import {PATH_INPUT_PATTERN} from './workflow-contract.mjs';
import {inputBindingField} from './input-contract.mjs';
import {stepRiskSchema} from './approval-policy.mjs';

const invalid=()=>{throw Error('INVALID_WORKFLOW_STEPS');};
const field=z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
const roles=new Set(['alert','alertdialog','application','article','banner','blockquote','button','caption','cell','checkbox','code','columnheader','combobox','complementary','contentinfo','definition','deletion','dialog','directory','document','emphasis','feed','figure','form','generic','grid','gridcell','group','heading','img','insertion','link','list','listbox','listitem','log','main','marquee','math','menu','menubar','menuitem','menuitemcheckbox','menuitemradio','meter','navigation','none','note','option','paragraph','presentation','progressbar','radio','radiogroup','region','row','rowgroup','rowheader','scrollbar','search','searchbox','separator','slider','spinbutton','status','strong','subscript','superscript','switch','tab','table','tablist','tabpanel','term','textbox','time','timer','toolbar','tooltip','tree','treegrid','treeitem']);

// Both browser adapters consume DOM CSS selectors. Playwright-specific selector
// engines or executable strings must never travel through this shared format.
const css=z.string().trim().min(1).max(3000).refine(value=>!/[\u0000-\u001f\u007f]/.test(value)&&!/(?:>>|javascript\s*:|(?:^|\s)(?:xpath|text|id|data-testid|internal:[\w-]+)\s*=|:(?:has-text|text|text-is|text-matches|nth-match)\s*\(|=>|\b(?:eval|Function)\s*\()/i.test(value));
const shortText=z.string().trim().min(1).max(300).refine(value=>!/[\u0000-\u001f\u007f]/.test(value));
export const workflowLocatorSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('testId'),value:shortText}).strict(),
  z.object({kind:z.literal('role'),role:z.string().refine(value=>roles.has(value)),name:shortText}).strict(),
  z.object({kind:z.literal('label'),value:shortText}).strict(),
  z.object({kind:z.literal('css'),value:css}).strict()
]);
const common={id:z.string().regex(/^step_[A-Za-z0-9_-]{8,80}$/).optional(),enabled:z.boolean().optional(),approval_required:z.boolean().optional(),risk:stepRiskSchema.optional(),label:z.string().trim().min(1).max(160).optional(),timeout_ms:z.number().int().min(100).max(30000).optional(),error_policy:z.enum(['stop','continue']).optional()};
const target={selector:css.optional(),locators:z.array(workflowLocatorSchema).min(1).max(6).optional(),frame_path:z.array(css).max(8).optional()};
const value={parameter:field.optional(),value_path:z.array(z.union([field,z.number().int().min(0).max(99)])).max(4).optional(),value:z.string().max(4096).optional()};
const stepSchema=z.discriminatedUnion('op',[
  z.object({op:z.literal('navigate'),...common,url:z.string().min(1).max(2048).optional(),template:z.string().min(1).max(2048).optional(),path_parameter:field.optional()}).strict(),
  z.object({op:z.literal('click'),...common,...target}).strict(),
  ...['fill','select','check'].map(op=>z.object({op:z.literal(op),...common,...target,...value}).strict()),
  z.object({op:z.literal('wait_element'),...common,...target,state:z.enum(['visible','hidden','enabled'])}).strict(),
  z.object({op:z.literal('wait_url'),...common,url:z.string().min(1).max(2048),match:z.enum(['exact','contains']).default('exact')}).strict(),
  z.object({op:z.literal('wait_text'),...common,...target,text:z.string().min(1).max(2000).refine(value=>value.trim().length>0&&!/[\u0000\u007f]/.test(value))}).strict(),
  z.object({op:z.literal('wait_delay'),...common,duration_ms:z.number().int().min(100).max(10000)}).strict(),
  z.object({op:z.literal('wait_navigation'),...common,url:z.string().min(1).max(2048).optional(),state:z.enum(['domcontentloaded','load']).default('load')}).strict(),
  z.object({op:z.literal('wait_output'),...common,output:field,predicate:z.enum(['nonempty','equals']),value:z.union([z.null(),z.string().max(4096),z.number().finite(),z.boolean()]).optional()}).strict(),
  z.object({op:z.literal('wait_response'),...common,url:z.string().min(1).max(2048),method:z.enum(['GET','HEAD']).default('GET'),status:z.number().int().min(100).max(599).optional()}).strict()
]);
const locatorPriority={testId:0,role:1,label:2,css:3};

// A legacy editor view can expose identities without rewriting its stored hash
// or an immutable publication. IDs become part of the draft only when saved.
export function projectStepIds(steps,{workflowId,version}){
  if(typeof workflowId!=='string'||!workflowId||typeof version!=='string'||!version)return invalid();
  return structuredClone(steps).map((step,index)=>step.id!==undefined?step:{...step,id:'step_'+createHash('sha256').update(JSON.stringify([workflowId,version,index])).digest('hex')});
}

// Missing identities represent newly authored steps. Never replace a supplied
// invalid or duplicated ID: validation must reject it rather than mask an error.
export function assignStepIds(steps){
  const copied=structuredClone(steps),used=new Set(copied.filter(step=>step?.id!==undefined).map(step=>step.id));
  return copied.map(step=>{
    if(step?.id!==undefined)return step;
    let id;do{id='step_'+randomUUID();}while(used.has(id));used.add(id);
    return {...step,id};
  });
}

export function validateWorkflowSteps(steps,{inputs={},outputs,origins=[],sandboxOrigin}={}){
  try{
    const parsed=z.array(stepSchema).max(32).parse(steps);
    const identities=parsed.filter(step=>step.id!==undefined).map(step=>step.id);
    if(new Set(identities).size!==identities.length)return invalid();
    if(!inputs||typeof inputs!=='object'||Array.isArray(inputs)||!Array.isArray(origins)||outputs!==undefined&&!Array.isArray(outputs))return invalid();
    const allowed=new Set(origins);
    const website=value=>{
      const url=validateWebsite(value,sandboxOrigin);
      if(!allowed.has(url.origin))return invalid();
      return url.href;
    };
    return parsed.map(step=>{
      if(step.approval_required===true&&step.op.startsWith('wait_'))return invalid();
      if(step.error_policy==='continue'&&!step.op.startsWith('wait_'))return invalid();
      if(step.op==='navigate'){
        if(step.path_parameter){
          const input=Object.hasOwn(inputs,step.path_parameter)?inputs[step.path_parameter]:undefined;
          if(!input||input.nullable||(input.type??'string')!=='string'||input.required===false||input.pattern!==PATH_INPUT_PATTERN||!step.template)return invalid();
          const sample=pageTemplate(step.template,step.path_parameter,'hermo-validation');website(sample.url);
          if(step.url)step.url=website(step.url);
        }else{
          if(step.template!==undefined||!step.url)return invalid();
          step.url=website(step.url);
        }
      }else if(['wait_url','wait_response','wait_navigation'].includes(step.op)){
        // A contains match still carries a complete approved URL. Adapters must
        // compare origin independently before checking its path/query portion.
        if(step.url!==undefined)step.url=website(step.url);
      }else if(step.op==='wait_delay'){
        // Delay is bounded independently of the total and per-step deadlines.
      }else if(step.op==='wait_output'){
        if(step.predicate==='equals'?!Object.hasOwn(step,'value'):Object.hasOwn(step,'value'))return invalid();
        if(outputs!==undefined&&!outputs.some(output=>output?.name===step.output))return invalid();
      }else{
        if(!step.selector&&!step.locators?.length)return invalid();
        if(step.locators){
          const signatures=new Set();
          for(const locator of step.locators){const signature=JSON.stringify(locator);if(signatures.has(signature))return invalid();signatures.add(signature);}
          step.locators.sort((a,b)=>locatorPriority[a.kind]-locatorPriority[b.kind]);
        }
        if(['fill','select','check'].includes(step.op)){
          const hasParameter=step.parameter!==undefined,hasValue=step.value!==undefined;
          if(hasParameter===hasValue)return invalid();
          if(hasParameter){
            const parameter=Object.hasOwn(inputs,step.parameter)?inputs[step.parameter]:undefined;
            if(!parameter)return invalid();
            const input=inputBindingField(parameter,step.value_path??[]);
            if(['select','check'].includes(step.op)&&input.required===false&&!Object.hasOwn(input,'default'))return invalid();
            if(step.op==='check'&&!['string','boolean'].includes(input.type??'string'))return invalid();
          }else if(step.value_path!==undefined||step.op==='check'&&!['true','false'].includes(step.value))return invalid();
        }
      }
      return step;
    });
  }catch{return invalid();}
}
