export type StepRisk='unspecified'|'low'|'medium'|'high'|'critical';
export type RiskRule={operations?:string[];risks?:StepRisk[]};
export type WorkflowApprovalPolicy={mode:'none'}|{mode:'selected_steps';steps:number[]}|{mode:'every_invocation'}|{mode:'risk_rules';rules:RiskRule[]};
export type ApprovalStep={id?:string;op:string;label?:string;enabled?:boolean;approval_required?:boolean;risk?:StepRisk};
export const riskOptions:StepRisk[]=['unspecified','low','medium','high','critical'];
const operations=[['navigate','Navigate'],['click','Click'],['fill','Fill input'],['select','Select option'],['check','Set checkbox'],['wait_element','Wait for element'],['wait_url','Wait for URL'],['wait_text','Wait for text'],['wait_delay','Bounded delay'],['wait_navigation','Wait for navigation'],['wait_output','Wait for output'],['wait_response','Wait for network response']];
const label=(step:ApprovalStep)=>step.label??operations.find(([op])=>step.op===op)?.[1]??step.op;

export function approvalPolicyIssue(policy:WorkflowApprovalPolicy|undefined,steps:ApprovalStep[]):string|undefined{
  if(!policy)return;
  if(policy.mode==='selected_steps'){
    if(!policy.steps.length)return 'Choose at least one step for the selected-step approval policy.';
    if(policy.steps.some(number=>!Number.isInteger(number)||number<1||number>steps.length)||new Set(policy.steps).size!==policy.steps.length)return 'Approval selections refer to deleted or duplicate step numbers. Review the selected steps before saving.';
  }else if(policy.mode==='risk_rules'){
    if(!policy.rules.length||policy.rules.length>16)return 'Configure between one and sixteen approval risk rules.';
    if(policy.rules.some(rule=>(!rule.operations?.length&&!rule.risks?.length)||rule.operations?.some(op=>!operations.some(([value])=>value===op))||rule.risks?.some(risk=>!riskOptions.includes(risk))))return 'Each risk rule needs at least one operation or explicitly classified risk.';
  }
}

export function approvalGateReason(policy:WorkflowApprovalPolicy|undefined,steps:ApprovalStep[],index:number):string|undefined{
  const step=steps[index];if(!step||step.enabled===false)return;
  if(step.approval_required)return 'Explicit step approval';
  if(policy?.mode==='selected_steps'&&policy.steps.includes(index+1))return 'Selected-step policy';
  if(policy?.mode==='every_invocation'&&steps.findIndex(value=>value.enabled!==false)===index)return 'Every-invocation policy';
  if(policy?.mode==='risk_rules'&&policy.rules.some(rule=>(!rule.operations||rule.operations.includes(step.op))&&(!rule.risks||rule.risks.includes(step.risk??'unspecified'))))return 'Configured risk rule';
}

export function ApprovalPolicyEditor({policy,steps,disabled,executionMode,onChange}:{policy?:WorkflowApprovalPolicy;steps:ApprovalStep[];disabled?:boolean;executionMode?:string;onChange:(policy:WorkflowApprovalPolicy)=>void}){
  const mode=policy?.mode??'none',issue=approvalPolicyIssue(policy,steps);
  function choose(value:string){
    if(value==='selected_steps')onChange({mode:'selected_steps',steps:[]});
    else if(value==='every_invocation')onChange({mode:'every_invocation'});
    else if(value==='risk_rules')onChange({mode:'risk_rules',rules:[{risks:['high','critical']}]});
    else onChange({mode:'none'});
  }
  function updateRule(index:number,rule:RiskRule){if(policy?.mode==='risk_rules')onChange({...policy,rules:policy.rules.map((value,n)=>n===index?rule:value)});}
  const required=steps.flatMap((step,index)=>approvalGateReason(policy,steps,index)?[index+1]:[]);
  return <section className="workflow-approval-policy" aria-label="Workflow approval policy"><h4>Human approval policy</h4>
    <label className="field"><span>Workflow approval policy</span><select aria-label="Workflow approval policy" value={mode} disabled={disabled} onChange={event=>choose(event.target.value)}><option value="none">Explicit step approvals only</option><option value="selected_steps">Require approval for selected steps</option><option value="every_invocation">Require approval for every invocation</option><option value="risk_rules">Require approval for configured risk rules</option></select></label>
    <p className="small-text muted">Explicit step approvals remain required under every policy. Risk is assigned by you; Hermo does not assume a click is sensitive or a read is safe. Waiting counts toward the total run timeout.</p>
    {policy?.mode==='selected_steps'&&<fieldset disabled={disabled}><legend>Steps requiring approval</legend><p className="small-text muted">Selections use the current one-based step numbers. Review them after adding, deleting, duplicating or reordering steps. Disabled steps never run.</p>{steps.length?steps.map((step,index)=><label className="checkbox-row" key={index}><input type="checkbox" checked={policy.steps.includes(index+1)} onChange={event=>onChange({...policy,steps:event.target.checked?[...policy.steps,index+1].sort((a,b)=>a-b):policy.steps.filter(number=>number!==index+1)})}/><span>{index+1}. {label(step)}{step.enabled===false?' · Disabled':''}</span></label>):<p>No steps are configured.</p>}{policy.steps.some(number=>number>steps.length)&&<button className="button secondary" type="button" onClick={()=>onChange({...policy,steps:policy.steps.filter(number=>number<=steps.length)})}>Remove deleted step references</button>}</fieldset>}
    {mode==='every_invocation'&&<p className="small-text">Approval pauses before the first enabled step on each invocation, including when that step is a wait. Later explicit step gates remain. Output-only workflows and workflows with only disabled steps pause for invocation approval before browser access.</p>}
    {policy?.mode==='risk_rules'&&<><p className="small-text muted">Any matching rule requires approval. Within one rule, selected operations and selected risks must both match. Leaving one group empty means any value in that group.</p>{policy.rules.map((rule,index)=><fieldset disabled={disabled} key={index}><legend>Approval rule {index+1}</legend><fieldset><legend>Operations · any when none selected</legend>{operations.filter(([op])=>op!=='wait_response'||executionMode==='managed_local'||rule.operations?.includes(op)).map(([op,name])=><label className="checkbox-row" key={op}><input type="checkbox" checked={rule.operations?.includes(op)??false} onChange={event=>{const values=event.target.checked?[...rule.operations??[],op]:(rule.operations??[]).filter(value=>value!==op);const next={...rule};if(values.length)next.operations=values;else delete next.operations;updateRule(index,next);}}/><span>{name}</span></label>)}</fieldset><fieldset><legend>Explicit risk classifications · any when none selected</legend>{riskOptions.map(risk=><label className="checkbox-row" key={risk}><input type="checkbox" checked={rule.risks?.includes(risk)??false} onChange={event=>{const values=event.target.checked?[...rule.risks??[],risk]:(rule.risks??[]).filter(value=>value!==risk);const next={...rule};if(values.length)next.risks=values;else delete next.risks;updateRule(index,next);}}/><span>{risk==='unspecified'?'Not classified':risk[0].toUpperCase()+risk.slice(1)}</span></label>)}</fieldset><button type="button" className="button ghost" onClick={()=>onChange({...policy,rules:policy.rules.filter((_,n)=>n!==index)})}>Remove approval rule {index+1}</button></fieldset>)}<button type="button" className="button secondary" disabled={disabled||policy.rules.length>=16} onClick={()=>onChange({...policy,rules:[...policy.rules,{risks:['high','critical']}]})}>Add approval rule</button></>}
    {issue&&<p className="notice error" role="alert">{issue}</p>}
    <p className="small-text">{mode==='every_invocation'&&!steps.some(step=>step.enabled!==false)?'Effective approval gate: invocation approval before browser access.':required.length?`Effective approval gates: steps ${required.join(', ')}.`:'No enabled step currently requires approval.'}</p>
  </section>;
}
