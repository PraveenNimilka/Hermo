import {z} from 'zod';
import {workflowHealth} from './workflow-health.mjs';
import {executionReceipt} from './execution-receipt.mjs';

// Owner-only diagnostics inherit the dashboard's session and origin checks.
// Never return run payloads or website-derived labels in this export.
export function installHealthRoutes(app,{store,workflow,revisions,fail}){
  const query=z.object({from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional(),download:z.enum(['json']).optional()}).strict();
  app.get('/studio/workflows/:wid/health',async(req,reply)=>{
    const parsed=query.safeParse(req.query);if(!parsed.success)fail('INVALID_MEASUREMENT_PERIOD','Choose an ISO date period of at most 366 days.');
    const w=workflow(req.params.wid),to=parsed.data.to??new Date().toISOString(),from=parsed.data.from??new Date(Date.parse(to)-30*86400000).toISOString();
    if(!Number.isFinite(Date.parse(from))||Date.parse(to)<=Date.parse(from)||Date.parse(to)-Date.parse(from)>366*86400000)fail('INVALID_MEASUREMENT_PERIOD','Choose a positive period of at most 366 days.');
    const selected=[];
    // Stream encrypted rows and retain metadata only. Fetching every full run
    // payload would make large reports retain all private inputs/results in RAM.
    const rows=store.db.prepare('SELECT * FROM runs WHERE workflow_id=? AND created_at>=? AND created_at<? ORDER BY created_at,id LIMIT 10001').iterate(w.id,new Date(from).toISOString(),new Date(to).toISOString());
    for(const source of rows){
      if(selected.length>=10000)fail('REPORT_LIMIT','Narrow the period to at most 10,000 retained runs.',409);
      const value=store.unseal(source.payload),payload={};
      for(const key of ['run_id','workflow_version','workflow_revision','execution_mode','phase','outcome','started_at','finished_at','execution_ms','duration_ms','queue_duration_ms'])payload[key]=value[key];
      payload.result=value.result&&typeof value.result==='object'&&!Array.isArray(value.result)?{}:undefined;
      payload.steps=Array.isArray(value.steps)?value.steps.map(step=>({number:step.number,status:step.status,step_id:step.step_id,started_at:step.started_at,finished_at:step.finished_at,duration_ms:step.duration_ms})):[];
      if(value.verification)payload.verification=Object.fromEntries(['run_id','verifier_version','observed_at','verified_at','checks'].map(key=>[key,value.verification[key]]));
      if(value.error)payload.error=Object.fromEntries(['code','cause_code','detail_code','step','outcome'].map(key=>[key,value.error[key]]));
      payload.approval={status:value.approval?.status};payload.approval_history=Array.isArray(value.approval_history)?value.approval_history.map(item=>({status:item?.status})):[];
      selected.push({row:{id:source.id,workflow_id:source.workflow_id,status:source.status,created_at:source.created_at},payload});
    }
    const history=revisions.history(w),active=history.find(value=>value.active);
    const report=workflowHealth({workflow:{id:w.id,published_revision:active?.revision??w.published_revision},runs:selected,revisions:history,from,to,retentionDays:Number(store.getSetting('retention_days')??7)});
    // Absence of a continuous history ledger is disclosed by retained_from:null.
    // A retention preference cannot prove older records were never removed.
    report.recent_executions=selected.slice(-20).reverse().map(({row,payload})=>{
      const r=executionReceipt(row,payload),revision=r.published_version.revision,duration=r.timing.execution_ms;
      return {id:r.execution_id,status:r.status,revision:Number.isSafeInteger(revision)&&revision>0?revision:null,accepted_at:new Date(r.timing.accepted_at).toISOString(),execution_ms:typeof duration==='number'&&Number.isFinite(duration)&&duration>=0?duration:null};
    });
    if(parsed.data.download)reply.header('Content-Disposition','attachment; filename="hermo-reliability.json"');
    return report;
  });
}
