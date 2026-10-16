import {renderVerifiedResults} from './media-results.js';
const el=id=>document.getElementById(id),status=el('status');let config,busy=false;
const action=new URLSearchParams(location.search).get('action');if(/^[a-z][a-z0-9.-]{2,59}$/.test(action??''))el('action').value=action;
async function request(path,key,body){const response=await fetch(path,{method:body?'POST':'GET',credentials:'omit',cache:'no-store',redirect:'error',headers:{authorization:'Bearer '+key,...body?{'content-type':'application/json','idempotency-key':crypto.randomUUID()}:{}},...body?{body:JSON.stringify(body)}:{},signal:AbortSignal.timeout(12000)});const value=await response.json();if(!response.ok)throw Error(value.error?.message??'The local request failed.');return value;}
el('settings').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;busy=true;el('configure').disabled=true;el('read').disabled=true;config=undefined;el('results').replaceChildren();
  try{
    if(location.protocol!=='http:'||location.hostname!=='127.0.0.1')throw Error('Open this app from your local Hermo address.');
    const key=el('key').value.trim();el('key').value='';if(!/^hm_live_[A-Za-z0-9_-]{43}$/.test(key))throw Error('Paste the API key created for your published action.');
    const contract=await request('/v1/action-contract',key);if(contract.action!==el('action').value)throw Error('This API key belongs to '+contract.action+'. Choose that action or use its correct key.');
    config={key,contract};el('read').textContent=['read','read_data'].includes(contract.action_type)?'Read data':'Run action';el('key').value='';el('inputs').replaceChildren();
    for(const name of contract.inputs){
      const field=contract.input_schema?.properties?.[name]??{type:'string'},required=contract.input_schema?contract.input_schema.required?.includes(name)===true:true;
      const label=document.createElement('label'),input=document.createElement(field.type==='boolean'||field.enum?'select':'input');label.textContent=name+(required?'':' (optional)');input.name=name;input.required=required;
      if(input.tagName==='SELECT'){
        if(!required){const option=document.createElement('option');option.value='';option.textContent=Object.hasOwn(field,'default')?'Use default':'Omit · clear recorded text field';input.append(option);}
        for(const value of field.enum??[true,false]){const option=document.createElement('option');option.value=String(value);option.textContent=String(value);input.append(option);}
      }else{input.type=field.type==='number'?'number':'text';if(field.type==='number'){input.step='any';if(field.minimum!==undefined)input.min=field.minimum;if(field.maximum!==undefined)input.max=field.maximum;}else{input.maxLength=field.maxLength??4096;if(field.minLength!==undefined)input.minLength=field.minLength;if(field.pattern)input.pattern=field.pattern;}}
      if(Object.hasOwn(field,'default'))input.value=String(field.default);label.append(input);el('inputs').append(label);
    }
    el('configuration').open=false;status.textContent=contract.inputs.length?'Enter the requested inputs, then run your action.':'Ready. No input is needed.';el('read').disabled=false;
  }catch(error){status.textContent=error.message;}finally{busy=false;el('configure').disabled=false;}
});
el('read-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!config||busy)return;busy=true;el('read').disabled=true;el('configure').disabled=true;el('results').replaceChildren();status.textContent='Running your website action…';
  try{
    const input={};for(const name of config.contract.inputs){const value=el('inputs').querySelector(`[name="${name}"]`).value,field=config.contract.input_schema?.properties?.[name]??{type:'string'},required=config.contract.input_schema?config.contract.input_schema.required?.includes(name)===true:true;if(value===''&&!required)continue;input[name]=field.type==='number'?Number(value):field.type==='boolean'?value==='true':value;}
    const receipt=await request('/v1/actions/'+encodeURIComponent(config.contract.action)+'/versions/1/runs',config.key,{input,...config.contract.revision?{expected_revision:config.contract.revision}:{}}),deadline=Date.now()+Math.min(305000,Math.max(20000,(config.contract.timeout_seconds??45)*1000+10000));let run;
    while(Date.now()<deadline){run=await request('/v1/runs/'+encodeURIComponent(receipt.run_id),config.key);if(['succeeded','failed','cancelled'].includes(run.status))break;await new Promise(resolve=>setTimeout(resolve,500));}
    if(run?.status!=='succeeded'||!run.verification?.verified_at)throw Error(run?.error?.message??'No verified result arrived. Check the run in Hermo before trying again.');
    renderVerifiedResults(el('results'),run.result,config.contract.output_schema??{type:'object',properties:Object.fromEntries(config.contract.outputs.map(field=>[field.name,{type:field.type==='url'?'string':field.type??'string',...field.type==='url'?{format:'uri'}:{}}])),required:config.contract.outputs.filter(field=>field.required!==false).map(field=>field.name)},{verified:true,baseOrigin:location.origin});
    status.textContent=(['read','read_data'].includes(config.contract.action_type)?'Verified data received':'Verified results received')+' · observed '+new Date(run.verification.observed_at??run.verification.verified_at).toLocaleTimeString();
  }catch(error){status.textContent=error.message;}finally{busy=false;el('read').disabled=false;el('configure').disabled=false;}
});
