import {inputJsonSchema,outputJsonSchema} from './workflow-contract.mjs';

// Schema generation shares the runtime contract; it does not infer website data.
export function workflowSpec(workflow,origin) {
  const definition=workflow.definition;
  const json=schema=>({'application/json':{schema}});
  const input=inputJsonSchema(definition.inputs),output=outputJsonSchema(definition.outputs);
  return {
    openapi:'3.1.1',
    'x-hermo-revision':workflow.revision??null,
    'x-hermo-workflow-version':workflow.version,
    info:{title:`Hermo · ${workflow.name}`,version:'1.0.0',description:(definition.effect==='recorded_browser_actions'?'Replay approved actions in a selected normal Chrome tab. Actions may submit forms or change website data. Keep Hermo unlocked and its connected website tab open. ':'Verified retrieval action. ')+'No-match and insufficient evidence fail explicitly. Async execution; poll the returned run ID.'},
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
      '/v1/runs/{run_id}':{get:{
        parameters:[{name:'run_id',in:'path',required:true,schema:{type:'string'}}],
        responses:{'200':{description:'Run state; result only after success',content:json({type:'object',properties:{id:{type:'string'},status:{type:'string',enum:['queued','running','verifying','succeeded','failed','cancelled']},result:output,verification:{type:'object'},error:{type:'object'}}})},'401':{description:'Invalid key'},'404':{description:'Run not owned by this key'}}
      }}
    },
    components:{securitySchemes:{HermoKey:{type:'http',scheme:'bearer'}}}
  };
}
