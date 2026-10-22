// Chrome checks access against each cookie's own domain, not the URL queried.
// Exact subdomain permissions do not expose shared .google.com sign-in cookies.
export const googleOrigins=['https://google.com','https://accounts.google.com','https://myaccount.google.com','https://www.google.com','https://www.gstatic.com','https://ssl.gstatic.com','https://fonts.googleapis.com','https://fonts.gstatic.com','https://lh3.googleusercontent.com'];
const googleHosts=new Set(googleOrigins.map(origin=>new URL(origin).hostname));
// The apex permission is for shared domain cookies. Host-only apex cookies
// cannot authenticate the supported accounts/myaccount/www destinations.
const transferHosts=new Set([...googleHosts].filter(host=>host!=='google.com'));
const sharedDomains=new Set(['google.com','gstatic.com','googleapis.com','googleusercontent.com']);
function allowedCookieDomain(cookie){
  const domain=cookie.domain?.replace(/^\./,'');
  return transferHosts.has(domain)||!cookie.hostOnly&&sharedDomains.has(domain);
}
export function localWorkspace(value){let u;try{u=new URL(value);}catch{throw Error('Enter your local Hermo address.');}if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Only a local http://127.0.0.1 address is supported.');return u.origin;}
export function normalizeCookies(groups){const all=new Map();for(const c of groups.flat()){if(c.partitionKey||!allowedCookieDomain(c))continue;const expires=c.session?-1:c.expirationDate;if(!Number.isFinite(expires)||expires!==-1&&expires<=Date.now()/1000)continue;const cookie={name:c.name,value:c.value,domain:c.hostOnly?c.domain.replace(/^\./,''):c.domain.startsWith('.')?c.domain:'.'+c.domain,path:c.path,expires,httpOnly:c.httpOnly,secure:c.secure,sameSite:c.sameSite==='strict'?'Strict':c.sameSite==='no_restriction'?'None':'Lax'};all.set(JSON.stringify([cookie.domain,cookie.path,cookie.name]),cookie);}return [...all.values()];}
export async function transferGoogleSession({chrome,fetch,origin,code,authorized}){
  origin=localWorkspace(origin);if(!authorized)throw Error('Authorize the Google session transfer first.');if(!/^hi_import_[A-Za-z0-9_-]{43}$/.test(code))throw Error('Copy a fresh one-use import code from Hermo Privacy.');
  if(chrome.extension?.inIncognitoContext)throw Error('Use the companion in the normal Chrome window where you signed in to Google, rather than an Incognito window. Nothing was transferred.');
  const allowed=await chrome.permissions.request({permissions:['cookies'],origins:googleOrigins.map(o=>o+'/*')});if(!allowed)throw Error('Google cookie access was not granted. Nothing was transferred.');
  // Domain queries include non-root cookie paths. Chrome still applies exact
  // host permissions; normalization rejects unrelated domains defensively.
  // Omitting storeId intentionally stays in this popup's own cookie store.
  let cookies;
  try{cookies=normalizeCookies(await Promise.all([...googleHosts].map(domain=>chrome.cookies.getAll({domain}))));}
  catch{throw Error('Chrome could not read the permitted Google session. Reload the companion in chrome://extensions, reopen it, and approve Google access when prompted. Nothing was transferred.');}
  if(!cookies.some(c=>['SID','__Secure-1PSID','__Secure-3PSID'].includes(c.name)&&c.value)){
    const found=cookies.length?'Google cookies were found, but no supported sign-in cookie was available.':'No readable Google website session was found in this Chrome profile.';
    throw Error(found+' Open Google account below in this same window and complete website sign-in. Signing in to Hermo or Chrome Sync alone is not enough. Then reopen the companion and retry. Nothing was transferred.');
  }
  const response=await fetch(origin+'/companion/google/import',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+code,'x-hermo-extension-id':chrome.runtime.id},body:JSON.stringify({cookies,authorized:true}),signal:AbortSignal.timeout(15000)});
  if(!response.ok){let result;try{result=await response.json();}catch{}throw Error(result?.error?.message??'The local transfer failed. Keep Hermo running and use a new code.');}
  return response.json();
}
