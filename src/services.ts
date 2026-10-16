export function commonServices(value:string):{name:string;origins:string[]} | null {
  let hostname;try{hostname=new URL(value).hostname;}catch{return null;}
  if(hostname==='accounts.google.com'||hostname==='myaccount.google.com')return {name:'Google',origins:['https://accounts.google.com','https://myaccount.google.com','https://www.gstatic.com','https://ssl.gstatic.com','https://fonts.googleapis.com','https://fonts.gstatic.com','https://www.google.com','https://lh3.googleusercontent.com']};
  if(hostname==='gemini.google.com')return {name:'Gemini',origins:['https://accounts.google.com','https://gemini.gstatic.com','https://www.gstatic.com','https://ssl.gstatic.com','https://fonts.googleapis.com','https://fonts.gstatic.com','https://www.google.com','https://lh3.googleusercontent.com','https://waa-pa.clients6.google.com']};
  if(hostname==='chatgpt.com')return {name:'ChatGPT',origins:['https://auth.openai.com','https://auth0.openai.com','https://setup.auth.openai.com','https://chat.openai.com','https://cdn.openaimerge.com','https://cdn.workos.com','https://challenges.cloudflare.com','https://cdn.oaistatic.com']};
  if(hostname==='claude.ai')return {name:'Claude',origins:['https://assets-proxy.anthropic.com','https://assets.claude.ai','https://js.hcaptcha.com','https://hcaptcha.com','https://challenges.cloudflare.com']};
  return null;
}
