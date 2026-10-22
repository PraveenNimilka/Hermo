// Shared bounded wait lifecycle. Observers read state only; they never issue an
// action or replay a preceding action. A continued timeout is visibly skipped.
export async function runWorkflowWait(step,{deadline,signal,check,observe}){
  const began=Date.now(),until=Math.min(deadline,began+(step.timeout_ms??8000));
  const assertActive=()=>{check();if(signal?.aborted)throw signal.reason??Error('WORKFLOW_CANCELLED');if(Date.now()>=deadline)throw Error('TIMEOUT');};
  function bounded(task,ms){
    return new Promise((resolve,reject)=>{
      let done=false,timer;
      const finish=(fn,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value);};
      const abort=()=>finish(reject,signal.reason??Error('WORKFLOW_CANCELLED'));
      signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>finish(reject,Object.assign(Error('TIMEOUT'),{phase:'step_wait'})),Math.max(1,ms));
      if(signal?.aborted)return abort();
      Promise.resolve().then(task).then(value=>finish(resolve,value),error=>finish(reject,error));
    });
  }
  try{
    while(true){
      assertActive();if(Date.now()>=until)throw Object.assign(Error('TIMEOUT'),{phase:'step_wait'});
      const observed=step.op==='wait_delay'?Date.now()-began>=step.duration_ms:await bounded(()=>observe(until),until-Date.now());
      assertActive();if(Date.now()>=until)throw Object.assign(Error('TIMEOUT'),{phase:'step_wait'});
      if(observed)return true;
      await new Promise(resolve=>setTimeout(resolve,Math.max(1,Math.min(50,until-Date.now(),step.op==='wait_delay'?step.duration_ms-(Date.now()-began):50))));
    }
  }catch(error){
    assertActive();
    if(step.error_policy==='continue'&&error.message==='TIMEOUT'&&error.phase==='step_wait')return false;
    throw error;
  }
}

export function outputWaitMatches(step,value){
  if(step.predicate==='equals')return value===step.value;
  return value!==undefined&&value!==null&&(typeof value==='string'?value.trim().length>0:Array.isArray(value)?value.length>0:typeof value==='object'?Object.keys(value).length>0:true);
}
