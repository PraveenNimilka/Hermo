import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {inputJsonSchema,outputJsonSchema} from './workflow-contract.mjs';
import {workflowInputSchema} from './workflow-input.mjs';
import {workflowEffect} from './execution-capabilities.mjs';
export function installMcp(app,{origin,aliases,workflow,enqueue,db,safeRun,cancel,fail,rate}) {
  app.post('/mcp',async(req,reply)=>{
    const consumer=req.consumer,w=workflow(consumer.workflow_id),effect=workflowEffect(w.definition,w.connection_config?.browser_mode);
    // A fresh server and transport per request prevents cross-consumer context reuse.
    const server=new McpServer({name:'hermo',version:'0.1.0'});
    const result=value=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
    server.registerTool('action_'+w.slug.replaceAll('.','_').replaceAll('-','_'),{
      title:w.name,description:(effect==='recorded_browser_actions'?'Replay approved actions in the selected Chrome tab. Actions may submit forms or change website data. ':'Start this verified retrieval action. ')+'Returns a run ID. Poll get_run until terminal. Preserve request_id when retrying admission.',
      inputSchema:{input:workflowInputSchema(w.definition.inputs),request_id:z.string().min(1).max(200)},
      annotations:{readOnlyHint:effect!=='recorded_browser_actions',destructiveHint:effect==='recorded_browser_actions',idempotentHint:effect!=='recorded_browser_actions',openWorldHint:true}
    },async({input,request_id})=>{
      rate('key:admit:'+consumer.id,60);const fresh=workflow(w.id);if(fresh.status!=='published')fail('ACTION_PAUSED','This action is not currently published.',409);
      return result(enqueue(fresh,input,consumer.id,request_id));
    });
    server.registerTool('get_contract',{
      description:'Read the active published workflow contract available to this key. The declared result schema applies to this revision; older runs retain their pinned revision.',
      inputSchema:{},
      outputSchema:{workflow_id:z.string(),action:z.string(),version:z.string(),revision:z.number().int().positive().nullable(),input_schema:z.record(z.string(),z.unknown()),output_schema:z.record(z.string(),z.unknown())},
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
    },async()=>{
      const fresh=workflow(consumer.workflow_id);
      return result({workflow_id:fresh.id,action:fresh.slug,version:fresh.version,revision:fresh.revision??null,input_schema:inputJsonSchema(fresh.definition.inputs),output_schema:outputJsonSchema(fresh.definition.outputs)});
    });
    server.registerTool('get_run',{description:'Read a run owned by this consumer key.',inputSchema:{run_id:z.string().max(100)},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async({run_id})=>{
      const row=db.prepare('SELECT * FROM runs WHERE id=? AND consumer_id=?').get(run_id,consumer.id);if(!row)fail('NOT_FOUND','Run not found.',404);
      const {input,...safe}=safeRun(row);return result(safe);
    });
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
