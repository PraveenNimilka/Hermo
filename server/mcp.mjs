import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {inputJsonSchema,outputJsonSchema} from './workflow-contract.mjs';
import {workflowInputSchema,jsonInputSchema} from './workflow-input.mjs';
import {workflowEffect,workflowHasBrowserActions} from './execution-capabilities.mjs';
import {verificationRuleSummaries} from './verification-rules.mjs';
import {effectiveApprovalSteps,requiresInvocationApproval} from './approval-policy.mjs';
export function installMcp(app,{origin,aliases,workflow,enqueue,db,safeRun,cancel,fail,rate,receiptFor,permissionsFor}) {
  app.post('/mcp',async(req,reply)=>{
    const consumer=req.consumer,w=workflow(consumer.workflow_id),effect=workflowEffect(w.definition,w.connection_config?.browser_mode),browserActions=workflowHasBrowserActions(w.definition);
    // A fresh server and transport per request prevents cross-consumer context reuse.
    const server=new McpServer({name:'hermo',version:'0.1.0'},{maxToolInputElements:10000});
    const result=value=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
    server.registerTool('action_'+w.slug.replaceAll('.','_').replaceAll('-','_'),{
      title:w.name,description:(effect==='recorded_browser_actions'?(w.connection_config?.browser_mode==='connected'?'Replay approved actions in the selected Chrome tab. Actions may submit forms or change website data. ':'Replay approved actions in the managed local browser. Submissions and secure sockets are restricted to reviewed website origins. '):browserActions?'Replay authorized browser controls in the managed local browser under GET/HEAD network restrictions. Controls can still change website state. ':'Start this verified retrieval action. ')+((effectiveApprovalSteps(w.definition).length>0||requiresInvocationApproval(w.definition))?'Selected steps pause for owner approval in the unlocked dashboard; this key cannot approve them. ':'')+'Returns a run ID. Poll get_run until terminal. Preserve request_id when retrying admission.',
      inputSchema:{input:workflowInputSchema(w.definition.inputs),request_id:z.string().min(1).max(200),expected_revision:z.number().int().positive().optional()},
      annotations:{readOnlyHint:!browserActions&&effect!=='recorded_browser_actions',destructiveHint:browserActions||effect==='recorded_browser_actions',idempotentHint:false,openWorldHint:true}
    },async({input,request_id,expected_revision})=>{
      rate('key:admit:'+consumer.id,60);const fresh=workflow(w.id);if(fresh.status!=='published')fail('ACTION_PAUSED','This action is not currently published.',409);
      return result(enqueue(fresh,input,consumer.id,request_id,expected_revision));
    });
    server.registerTool('get_contract',{
      description:'Read the active or explicitly selected immutable published workflow contract available to this key. The declared result schema applies to this revision; older runs retain their pinned revision.',
      inputSchema:{revision:z.number().int().positive().max(1000000).optional()},
      outputSchema:{workflow_id:z.string(),action:z.string(),version:z.string(),revision:z.number().int().positive().nullable(),approval_required_steps:z.array(z.number().int().positive()),approval_invocation_required:z.boolean(),verification_rules:z.array(z.record(z.string(),z.unknown())),input_schema:z.record(z.string(),z.unknown()),output_schema:z.record(z.string(),z.unknown())},
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
    },async({revision})=>{
      const fresh=workflow(consumer.workflow_id,revision);
      return result({workflow_id:fresh.id,action:fresh.slug,version:fresh.version,revision:fresh.revision??null,approval_required_steps:effectiveApprovalSteps(fresh.definition),approval_invocation_required:requiresInvocationApproval(fresh.definition),verification_rules:verificationRuleSummaries(fresh.definition.verifiers),input_schema:inputJsonSchema(fresh.definition.inputs),output_schema:outputJsonSchema(fresh.definition.outputs)});
    });
    server.registerTool('invoke_revision',{
      description:'Invoke one explicitly selected immutable published revision. Uses the same scoped authority, approval gates, verification and run queue. A reused request_id cannot switch revisions.',
      inputSchema:{revision:z.number().int().positive().max(1000000),input:jsonInputSchema,request_id:z.string().min(1).max(200)},
      annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}
    },async({revision,input,request_id})=>{
      rate('key:admit:'+consumer.id,60);const selected=workflow(consumer.workflow_id,revision);if(selected.status!=='published')fail('ACTION_PAUSED','This action is not currently published.',409);
      return result(enqueue(selected,input,consumer.id,request_id,undefined,revision));
    });
    server.registerTool('get_run',{description:'Read a run owned by this consumer key.',inputSchema:{run_id:z.string().max(100)},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async({run_id})=>{
      const row=db.prepare('SELECT * FROM runs WHERE id=? AND consumer_id=?').get(run_id,consumer.id);if(!row)fail('NOT_FOUND','Run not found.',404);
      const {input,...safe}=safeRun(row);return result(safe);
    });
    server.registerTool('get_permissions',{description:'Read the selected published workflow authority, browser limitations and owner approval requirements. Contains no private locators, fixed form values or credentials.',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async()=>result(permissionsFor(workflow(consumer.workflow_id))));
    server.registerTool('get_execution_receipt',{description:'Read the versioned, input-free execution receipt for an owned run. Distinguishes uncertain outcomes and timeouts; returns output only with execution-bound verification evidence.',inputSchema:{run_id:z.string().max(100)},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async({run_id})=>result(receiptFor(run_id,consumer.id)));
    server.registerTool('cancel_run',{description:'Request cancellation of an owned run. Does not undo external effects.',inputSchema:{run_id:z.string().max(100)},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async({run_id})=>{
      rate('key:control:'+consumer.id,60);const {input,...safe}=await cancel(run_id,consumer.id);return result(safe);
    });
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true,enableDnsRebindingProtection:true,allowedHosts:[...aliases],allowedOrigins:[origin,origin.replace('127.0.0.1','localhost')]});
    await server.connect(transport);
    for(const [name,value]of Object.entries(reply.getHeaders()))reply.raw.setHeader(name,value);
    reply.hijack();reply.raw.once('close',()=>{server.close().catch(()=>{});});
    try{await transport.handleRequest(req.raw,reply.raw,req.body);}catch{if(!reply.raw.headersSent){reply.raw.writeHead(500,{'Content-Type':'application/json'});reply.raw.end(JSON.stringify({error:{code:'MCP_ERROR',message:'The MCP request could not complete.'}}));}else reply.raw.end();}
  });
  app.route({method:['GET','DELETE'],url:'/mcp',handler:async(_,reply)=>reply.code(405).header('Allow','POST').send({error:{code:'METHOD_NOT_ALLOWED',message:'This stateless MCP endpoint accepts POST requests.'}})});
}
