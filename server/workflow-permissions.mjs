import {hash} from './store.mjs';
import {snapshotConnection} from './workflow-revisions.mjs';
import {workflowEffect,executionCapabilities} from './execution-capabilities.mjs';
import {resolveApprovalPolicy} from './approval-policy.mjs';

const mutations=new Set(['click','fill','select','check']);
const target=field=>({
  ...(field.selector?{selector:field.selector}:{}),
  ...(field.locators?.length?{locators:field.locators}:{}),
  ...(field.frame_path?.length?{frame_path:field.frame_path}:{}),
  ...(field.read_attribute?{attribute:field.read_attribute}:{}),
  ...(field.read_mode?{read_mode:field.read_mode}:{})
});
const output=field=>({name:field.name,type:field.type??'string',required:field.required!==false,...field.coercion?{coercion:field.coercion}:{},...target(field),
  ...(field.fields?{fields:field.fields.map(output)}:{}),...(field.items?{items:output(field.items)}:{})});

// Owner-visible description, derived from the same definition and frozen browser
// scope used at execution. Never include examples, fixed values or credentials.
export function workflowPermissions(workflow,connection){
  const definition=workflow.definition,mode=connection.browser_mode==='connected'?'connected_chrome':'managed_local',policy=resolveApprovalPolicy(definition);
  const steps=definition.steps.map((step,index)=>({number:index+1,operation:step.op,enabled:step.enabled!==false,
    approval_required:policy.required_steps.includes(index+1),risk:policy.classifications[index].risk,approval_reason:policy.classifications[index].reason,...(step.label?{label:step.label}:{}),...target(step),
    ...(step.parameter?{input:step.parameter}:{}),
    ...(['fill','select','check'].includes(step.op)&&!step.parameter?{fixed_value:true}:{}),
    ...(step.url||step.template?{destination_origin:new URL(step.url??step.template).origin}:{}),
    may_change_website:mutations.has(step.op)||step.op==='navigate'}));
  return {
    workflow_id:workflow.id,version:workflow.version,revision:workflow.revision??null,
    fingerprint:hash(JSON.stringify({workflow_id:workflow.id,definition,connection:snapshotConnection(connection)})),
    connection:{id:connection.id,name:connection.name,website_origin:new URL(connection.url).origin,
      browser_workspace_id:connection.browser_workspace_id??null,mode,available:connection.available===true},
    allowed_origins:[...connection.origins].sort(),
    allowed_actions:[...new Set(steps.filter(step=>step.enabled).map(step=>step.operation))],
    capabilities:executionCapabilities(mode),
    session_requirements:{authorization:'explicit_website_connection',authentication:connection.access==='public'?'anonymous':'existing_website_session',binding:mode==='connected_chrome'?'selected_tab':'dedicated_connection',dashboard_required:false,computer_required:true},
    network_interactions:{statically_known:steps.filter(step=>step.enabled&&step.destination_origin).map(step=>({step:step.number,origin:step.destination_origin})),runtime_evaluated:true,restriction:mode==='managed_local'?(definition.effect==='recorded_browser_actions'?'authorized_origins_http_and_wss':'authorized_origins_get_head'):'selected_tab_origin',website_initiated_requests:mode==='managed_local'?'All website requests must remain within the published exact origins. Website-action permission includes submissions and secure sockets.':'Website scripts may contact other services; connected tabs are not a network sandbox.'},
    secret_handling:{stored:'encrypted_at_rest',consumer_keys:'hashed',form_values:'redacted_from_permission_preview',personal_session_transfer:false},
    approval_policy:policy.policy,approval_invocation_required:policy.invocation_gate,
    effect:workflowEffect(definition,mode),timeout_seconds:Math.round((definition.timeout_ms??45000)/1000),
    inputs:Object.entries(definition.inputs).map(([name,field])=>({name,type:field.type??'string',required:field.required!==false})),
    outputs:definition.outputs.map(output),steps,
    approval_steps:steps.filter(step=>step.enabled&&step.approval_required).map(step=>step.number),
    legacy_target_steps:steps.filter(step=>step.enabled&&mutations.has(step.operation)&&!step.locators?.some(locator=>locator.kind!=='css')).map(step=>step.number),
    key_scope:{workflow_id:workflow.id,operations:['run','read_own_runs','cancel_own_runs'],can_approve:false},
    limitations:[
      'This is a configuration preview. It does not execute steps or predict their business effects.',
      'Website handlers, including typing and GET navigation, can change data or contact other services. The origin boundary is not a sandbox for website code.',
      'Connected Chrome uses the account currently signed in to its paired tab. Hermo does not pin that account.',
      'A unique CSS target can change meaning. Review legacy targets and repair them with stable semantic locators.',
      'Only declared outputs are returned, but selecting a broad container can include other visible data.',
      'Approval waits count toward the total timeout and hold the local execution queue. Earlier actions are not undone by rejection or cancellation.'
    ]
  };
}

// Consumer metadata describes authority, never private locators, fixed values,
// browser profile identifiers, account markers or credentials.
export function publicWorkflowPermissions(workflow,connection){
  const review=workflowPermissions(workflow,connection);
  return {version:1,execution_mode:review.connection.mode,allowed_origins:review.allowed_origins,
    allowed_actions:review.allowed_actions,approval_required_steps:review.approval_steps,
    approval_policy:review.approval_policy,approval_invocation_required:review.approval_invocation_required,session_requirements:review.session_requirements,
    capabilities:review.capabilities,network_interactions:{restriction:review.network_interactions.restriction,runtime_evaluated:true},
    steps:review.steps.map(step=>({number:step.number,operation:step.operation,enabled:step.enabled,risk:step.risk,approval_required:step.approval_required,may_change_website:step.may_change_website})),
    inputs:review.inputs,returned_fields:review.outputs.map(field=>({name:field.name,type:field.type,required:field.required}))};
}
