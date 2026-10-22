import {bootstrap,el,jsonView} from '/shared/ui.mjs';

bootstrap({title:'Workflow Approval Console',description:'Call a published form workflow and follow its owner checkpoints. This application has consumer permissions only.',endpoint:'/v1/actions/demo.approval/versions/1/runs',input:{message:'A synthetic test request'},footer:'Approve or reject in the unlocked Hermo dashboard. This application cannot make owner decisions.'},ctx=>{
  const checkpoint=el('section',{id:'approval-state','aria-label':'Approval checkpoint','aria-live':'polite'});
  ctx.controls.append(el('p',{class:'notice'},'A pending checkpoint pauses the selected action. Earlier steps may already have affected the website. Cancelling cannot undo them.'),checkpoint);
  function observe(run){
    const pending=run.approval?.status==='pending';
    checkpoint.dataset.state=pending?'pending':run.status;
    checkpoint.replaceChildren(el('h2',{},pending?'Owner decision required':'Approval history'));
    if(pending){
      const approval=run.approval,context=approval.context??{};
      checkpoint.append(el('p',{},`Step ${approval.step}: ${approval.operation}. Run ${run.id}.`),el('p',{},`Website: ${context.website_origin??'See the owner dashboard'}. Expires ${new Date(approval.expires_at).toLocaleTimeString()}.`),el('p',{id:'owner-instructions'},'Open this run in Hermo, inspect the live website, then approve or reject. This key cannot approve actions.'));
    }
    if(run.approval_history?.length)checkpoint.append(jsonView(run.approval_history));
  }
  ctx.execute=input=>ctx.standard(input,{onStatus:observe});
});
