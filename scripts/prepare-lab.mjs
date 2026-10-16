// Only prepares the explicitly disposable UI lab. Never resets a workspace or
// prints keys. This is intentionally separate from normal server startup.
const origin='http://127.0.0.1:4320';let cookie='',csrf='';
async function call(path,body){const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{cookie,...body===undefined?{}:{'content-type':'application/json','x-hermo-csrf':csrf}},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const result=await r.json();if(!r.ok)throw new Error(result.error?.message??'Lab request failed');return result;}
csrf=(await call('/studio/session')).csrf;csrf=(await call('/studio/login',{password:'synthetic-ui-lab-password-2026'})).csrf;
for(const base of ['/studio/examples','/studio/public-examples']){await call(base+'/setup',{authorized:true});let ready=false;for(let i=0;i<300;i++){const job=await call(base);if(i%10===0)console.log(job.stage);if(job.status==='failed')throw new Error(job.error);if(job.status==='ready'){ready=true;console.log(base+' ready: '+job.apps.length+' verified APIs');break;}await new Promise(r=>setTimeout(r,1000));}if(!ready)throw new Error('Lab preparation timed out');}
await call('/studio/logout',{});
