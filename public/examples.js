const base=document.body.dataset.api||'/studio/examples';
let csrf='',building=false,pollTimer;
const byId=id=>document.getElementById(id),status=message=>{byId('status').textContent=message;};
async function api(path,body){let response;try{response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json','X-Hermo-CSRF':csrf},body:body===undefined?undefined:JSON.stringify(body)});}catch{throw new Error('The local server is unavailable. Keep Hermo running.');}const data=await response.json();if(!response.ok){if(response.status===401){byId('apps').replaceChildren();byId('setup').hidden=true;byId('unlock').hidden=false;}throw new Error(data.error?.message??'The request did not complete.');}return data;}
function text(tag,value,className){const element=document.createElement(tag);element.textContent=value;if(className)element.className=className;return element;}
function render(apps){
  byId('apps').replaceChildren();
  for(const app of apps){
    const card=text('article','','app');card.append(text('span',app.name[0],'app-icon'),text('h2',app.name),text('p','A generated, scoped retrieval API.'));
    card.append(text('div',app.endpoint,'endpoint'));
    const form=document.createElement('form'),label=text('label',app.parameter.replaceAll('_',' ')),select=document.createElement('select');select.setAttribute('aria-label',app.name+' reference');for(const sample of [...app.samples,'UNKNOWN-RECORD']){const option=text('option',sample);option.value=sample;select.append(option);}label.append(select);const button=text('button','Run '+app.name);form.append(label,button);card.append(form);
    const links=text('div','','app-links'),website=text('a','Open test website ↗');website.href=app.website;website.target='_blank';website.rel='noopener';const docs=text('a','API documentation');docs.href='/#api-docs';links.append(website,docs);card.append(links);
    const result=text('div','Waiting for a run.','result');result.setAttribute('role','status');card.append(result);
    form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;result.className='result';result.textContent='Queued · calling the generated consumer API…';try{const receipt=await api(base+'/'+app.id+'/run',{reference:select.value}),deadline=Date.now()+55000;let run;
      do{run=await api(base+'/'+app.id+'/runs/'+receipt.run_id);if(['succeeded','failed','cancelled'].includes(run.status))break;result.textContent=run.status+' · browser execution in progress';await new Promise(resolve=>setTimeout(resolve,1000));}while(Date.now()<deadline);
      if(run.status!=='succeeded'){result.className='result error';result.textContent=run.error?.message??'The run did not return a verified result. Review Runs in Hermo.';}else{result.replaceChildren(text('strong','Verified browser result','verified'),text('div',JSON.stringify(run.result,null,2)));}
    }catch(error){result.className='result error';result.textContent=error.message;}finally{button.disabled=false;}});
    byId('apps').append(card);
  }
}
async function refresh(){try{const data=await api(base);building=data.status==='building';status(data.stage+(data.error?' · '+data.error:''));byId('progress').hidden=!building;byId('progress').value=data.progress;byId('build').disabled=building||!byId('consent').checked;if(!building)render(data.apps);if(building)pollTimer=setTimeout(refresh,600);}catch(error){building=false;status(error.message);}}
byId('consent').addEventListener('change',()=>{byId('build').disabled=building||!byId('consent').checked;});
byId('build').addEventListener('click',async()=>{byId('build').disabled=true;try{await api(base+'/setup',{authorized:true});await refresh();}catch(error){status(error.message);byId('build').disabled=false;}});
byId('login').addEventListener('submit',async event=>{event.preventDefault();const field=event.target.elements.password;try{const data=await api('/studio/login',{password:field.value});field.value='';csrf=data.csrf;byId('unlock').hidden=true;byId('setup').hidden=false;await refresh();}catch(error){field.value='';status(error.message);}});
(async()=>{try{const session=await api('/studio/session');csrf=session.csrf;if(session.setup_required){status('Create your private workspace in Hermo first, then return to this lab.');return;}byId('unlock').hidden=session.authenticated;byId('setup').hidden=!session.authenticated;if(session.authenticated)await refresh();}catch(error){status(error.message);}})();
window.addEventListener('pagehide',()=>clearTimeout(pollTimer));
