// Substitute one complete path segment, never a scheme, host or query.
export function pageTemplate(template,parameter,value){
  if(!/^[a-z][a-z0-9_]{1,39}$/.test(parameter)||typeof template!=='string'||template.length>2048||typeof value!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(value))throw new Error('INVALID_PAGE_PARAMETER');
  const parts=template.split('{'+parameter+'}');
  if(parts.length!==2||!parts[0].endsWith('/')||!parts[1].startsWith('/')||/[{}?#]/.test(parts.join('')))throw new Error('INVALID_PAGE_TEMPLATE');
  const url=new URL(parts[0]+'hermo-placeholder'+parts[1]);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!url.pathname.includes('/hermo-placeholder/'))throw new Error('INVALID_PAGE_TEMPLATE');
  return {url:parts[0]+encodeURIComponent(value)+parts[1],origin:url.origin};
}
export function pageParameter(actual,template,parameter){
  pageTemplate(template,parameter,'hermo-check');const [prefix,suffix]=template.split('{'+parameter+'}');
  if(!actual.startsWith(prefix)||!actual.endsWith(suffix))throw new Error('VERIFICATION_FAILED');
  const value=decodeURIComponent(actual.slice(prefix.length,actual.length-suffix.length));
  if(pageTemplate(template,parameter,value).url!==actual)throw new Error('VERIFICATION_FAILED');return value;
}
