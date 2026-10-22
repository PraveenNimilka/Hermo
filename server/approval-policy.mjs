import {z} from 'zod';

const operations=['navigate','click','fill','select','check','wait_element','wait_url','wait_text','wait_delay','wait_navigation','wait_output','wait_response'];
export const stepRiskSchema=z.enum(['unspecified','low','medium','high','critical']);
const unique=values=>new Set(values).size===values.length;
const operationList=z.array(z.enum(operations)).min(1).max(operations.length).refine(unique);
const riskList=z.array(stepRiskSchema).min(1).max(5).refine(unique);
const ruleSchema=z.object({operations:operationList.optional(),risks:riskList.optional()}).strict()
  .refine(rule=>rule.operations!==undefined||rule.risks!==undefined);

// Rules only inspect explicitly configured metadata. Page text, input values,
// credentials and element names never participate in risk classification.
export const approvalPolicySchema=z.discriminatedUnion('mode',[
  z.object({mode:z.literal('none')}).strict(),
  z.object({mode:z.literal('selected_steps'),steps:z.array(z.number().int().min(1).max(32)).min(1).max(32).refine(unique)}).strict(),
  z.object({mode:z.literal('every_invocation')}).strict(),
  z.object({mode:z.literal('risk_rules'),rules:z.array(ruleSchema).min(1).max(16)}).strict()
]);
const stepMetadata=z.object({op:z.enum(operations),enabled:z.boolean().optional(),approval_required:z.boolean().optional(),risk:stepRiskSchema.optional()});
const invalid=()=>{throw Error('INVALID_APPROVAL_POLICY');};

/** Step numbers are one-based and refer to the immutable definition's order. */
export function resolveApprovalPolicy(definition){
  if(!definition||typeof definition!=='object'||Array.isArray(definition)||!Array.isArray(definition.steps)||definition.steps.length>32)return invalid();
  const policyResult=approvalPolicySchema.safeParse(definition.approval_policy===undefined?{mode:'none'}:definition.approval_policy);
  if(!policyResult.success)return invalid();
  const policy=policyResult.data,steps=[];
  for(const step of definition.steps){const result=stepMetadata.safeParse(step);if(!result.success)return invalid();steps.push(result.data);}
  if(policy.mode==='selected_steps'&&policy.steps.some(number=>number>steps.length))return invalid();
  const first=steps.findIndex(step=>step.enabled!==false);
  // Output-only workflows still need an owner decision before browser access.
  // This is an invocation scope, never a fabricated browser step.
  const invocation_gate=policy.mode==='every_invocation'&&first===-1;
  const classifications=steps.map((step,index)=>{
    const risk=step.risk??'unspecified',enabled=step.enabled!==false;
    const matched=policy.mode==='selected_steps'?policy.steps.includes(index+1):
      policy.mode==='every_invocation'?index===first:
      policy.mode==='risk_rules'?policy.rules.some(rule=>(!rule.operations||rule.operations.includes(step.op))&&(!rule.risks||rule.risks.includes(risk))):false;
    const explicit=step.approval_required===true;
    return {step:index+1,operation:step.op,risk,enabled,approval_required:enabled&&(explicit||matched),
      reason:!enabled?'disabled':explicit?'explicit_step':matched?policy.mode:'not_required'};
  });
  return {policy,classifications,required_steps:classifications.filter(step=>step.approval_required).map(step=>step.step),invocation_gate};
}

export function effectiveApprovalSteps(definition){return resolveApprovalPolicy(definition).required_steps;}
export function requiresInvocationApproval(definition){return resolveApprovalPolicy(definition).invocation_gate;}

/** Compile a private execution copy; never rewrite the authoring snapshot/hash. */
export function compileApprovalPolicy(definition){
  const required=new Set(effectiveApprovalSteps(definition));
  let copy;try{copy=structuredClone(definition);}catch{return invalid();}
  copy.steps=copy.steps.map((step,index)=>({...step,approval_required:required.has(index+1)}));
  return copy;
}
