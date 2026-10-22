import {inputJsonSchema,outputJsonSchema} from './workflow-contract.mjs';
import {workflowEffect,workflowHasBrowserActions} from './execution-capabilities.mjs';
import {verificationRuleSummaries} from './verification-rules.mjs';
import {executionStatuses} from './execution-receipt.mjs';
import {effectiveApprovalSteps,requiresInvocationApproval} from './approval-policy.mjs';

// Schema generation shares the runtime contract; it does not infer website data.
export function workflowSpec(workflow,origin) {
  const definition=workflow.definition,effect=workflowEffect(definition,workflow.connection_config?.browser_mode);
  const json=schema=>({'application/json':{schema}});
  const input=inputJsonSchema(definition.inputs),output=outputJsonSchema(definition.outputs);
  const revisionMetadata={type:'object',required:['revision','version','created_at','execution_mode','active'],properties:{
    revision:{type:'integer',minimum:1},version:{type:'string'},created_at:{type:'string',format:'date-time'},execution_mode:{type:'string'},active:{type:'boolean'}
  }};
  return {
    openapi:'3.1.1',
    'x-hermo-revision':workflow.revision??null,
    'x-hermo-workflow-version':workflow.version,
    'x-hermo-verification-rules':verificationRuleSummaries(definition.verifiers),
    'x-hermo-approval-required-steps':effectiveApprovalSteps(definition),
    'x-hermo-approval-invocation-required':requiresInvocationApproval(definition),
    info:{title:`Hermo · ${workflow.name}`,version:'1.0.0',description:(effect==='recorded_browser_actions'?(workflow.connection_config?.browser_mode==='connected'?'Replay approved actions in a selected normal Chrome tab. Actions may submit forms or change website data. Keep Hermo unlocked and its connected website tab open. ':'Replay approved website actions in the managed local browser. HTTP submissions and secure sockets stay within reviewed origins. Keep the runtime and computer running. '):workflowHasBrowserActions(definition)?'Replay authorized browser controls in the managed local browser under GET/HEAD network restrictions. Controls can still change website state. ':'Verified retrieval action. ')+'No-match and insufficient evidence fail explicitly. Async execution; poll the returned run ID.'},
    servers:[{url:origin}],security:[{HermoKey:[]}],
    paths:{
      [`/v1/actions/${workflow.slug}/versions/1/runs`]:{post:{
        operationId:workflow.slug.replaceAll('.','_').replaceAll('-','_'),
        parameters:[{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:1,maxLength:200}}],
        requestBody:{required:true,content:json({type:'object',additionalProperties:false,required:['input'],properties:{input,expected_revision:{type:'integer',minimum:1,description:'Optional active publication guard for new admissions. Original idempotent receipts remain recoverable after publication changes.'}}})},
        responses:{
          '202':{description:'Accepted durable run',content:json({type:'object',required:['run_id','status_url','reused'],properties:{run_id:{type:'string'},status_url:{type:'string'},reused:{type:'boolean'}}})},
          '400':{description:'Invalid input or idempotency key'},'401':{description:'Invalid key'},'403':{description:'Wrong action or connection'},'409':{description:'Conflict, paused action, or expired connection'},'429':{description:'Rate or queue limit'}
        }
      }},
      [`/v1/actions/${workflow.slug}/revisions/{revision}/runs`]:{post:{
        operationId:workflow.slug.replaceAll('.','_').replaceAll('-','_')+'_revision',
        description:'Invoke an explicitly selected immutable published revision owned by this key. The /versions/1 route continues to select the active publication; its 1 is the API protocol version, not an immutable workflow revision. Fetch /v1/action-contract?revision=N for the selected input/output schema. Published status, browser authority, approvals and verification still apply.',
        parameters:[{name:'revision',in:'path',required:true,schema:{type:'integer',minimum:1,maximum:1000000}},{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:1,maxLength:200}}],
        requestBody:{required:true,content:json({type:'object',additionalProperties:false,required:['input'],properties:{input:{type:'object',additionalProperties:{},description:'Bounded JSON values; use the input_schema returned by /v1/action-contract?revision=N. This historical route can select a different contract from this generated document’s active revision.'}}})},
        responses:{
          '202':{description:'Accepted durable run pinned to the selected revision, or recovered original receipt',content:json({type:'object',required:['run_id','status_url','reused'],properties:{run_id:{type:'string'},status_url:{type:'string'},reused:{type:'boolean'}}})},
          '400':{description:'Invalid revision, input or idempotency key'},'401':{description:'Invalid, expired or revoked key'},'403':{description:'Key does not authorize this action'},'404':{description:'Published revision not found'},'409':{description:'Untested revision, paused action, changed browser authority, input conflict or IDEMPOTENCY_REVISION_CONFLICT: an existing request identifier cannot select a different revision'},'429':{description:'Rate or queue limit'}
        }
      }},
      '/v1/action-revisions':{get:{
        operationId:'list_action_revisions',description:'List immutable publication metadata for the workflow scoped to this key. The active marker reflects the current publication pointer, including rollback. Listing metadata does not authorize invocation of an unverified historical revision.',
        responses:{'200':{description:'Current active revision and saved publication metadata; no private step locators or browser credentials',content:json({type:'object',required:['active_revision','revisions'],properties:{active_revision:{type:['integer','null'],minimum:1},revisions:{type:'array',items:revisionMetadata}}})},'401':{description:'Invalid, expired or revoked key'}}
      }},
      '/v1/action-contract':{get:{
        operationId:'get_action_contract',description:'Read the active contract, or select one immutable published revision of the workflow scoped to this key. Use the selected schema for validation and interpret each result using its pinned workflow_revision.',
        parameters:[{name:'revision',in:'query',required:false,schema:{type:'integer',minimum:1,maximum:1000000},description:'Omit to read the active publication. This selects a historical contract without changing the active pointer.'}],
        responses:{'200':{description:'Selected published contract and effective owner approval requirements',content:json({type:'object',required:['action','version','revision','input_schema','output_schema','approval_required_steps','approval_invocation_required'],properties:{action:{type:'string'},action_type:{type:'string'},inputs:{type:'array',items:{type:'string'}},outputs:{type:'array',items:{type:'object'}},input_schema:{type:'object'},output_schema:{type:'object'},verification_rules:{type:'array',items:{type:'object'}},approval_required_steps:{type:'array',items:{type:'integer',minimum:1}},approval_invocation_required:{type:'boolean'},timeout_seconds:{type:'integer'},version:{type:'string'},revision:{type:['integer','null'],minimum:1}}})},'400':{description:'Invalid revision query'},'401':{description:'Invalid, expired or revoked key'},'404':{description:'Selected published revision not found'},'409':{description:'Selected historical revision has no verified publication evidence'}}
      }},
      '/v1/runs/{run_id}':{get:{
        parameters:[{name:'run_id',in:'path',required:true,schema:{type:'string'}}],
        responses:{'200':{description:'Run state; result only after success. status retains the legacy polling enum; execution_status distinguishes approval, uncertainty and timeout.',content:json({type:'object',properties:{id:{type:'string'},status:{type:'string',enum:['queued','running','verifying','succeeded','failed','cancelled']},execution_status:{type:'string',enum:executionStatuses},result:output,verification:{type:'object'},error:{type:'object'}}})},'401':{description:'Invalid key'},'404':{description:'Run not owned by this key'}}
      }},
      '/v1/runs/{run_id}/receipt':{get:{
        parameters:[{name:'run_id',in:'path',required:true,schema:{type:'string'}}],
        responses:{'200':{description:'Input-free execution receipt. Historical runs without sufficient evidence are uncertain and omit output.',content:json({type:'object',required:['schema_version','execution_id','workflow_id','status','verification'],properties:{schema_version:{const:'hermo.execution.v1'},execution_id:{type:'string'},workflow_id:{type:'string'},status:{type:'string',enum:executionStatuses},published_version:{type:'object'},execution_mode:{type:['string','null']},timing:{type:'object'},verification:{type:'object'},diagnostics:{type:'object'},step_outcomes:{type:'array',items:{type:'object'}},output}})},'401':{description:'Invalid key'},'404':{description:'Run not owned by this key'}}
      }}
    },
    components:{securitySchemes:{HermoKey:{type:'http',scheme:'bearer'}}}
  };
}
