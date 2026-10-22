import type {InputDefinition,JsonValue} from './WorkflowContract';

type Schema=Record<string,any>;
export type ExampleLanguage='curl'|'javascript'|'typescript'|'python'|'mcp';
const own=(value:object,key:string)=>Object.prototype.hasOwnProperty.call(value,key);
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** Decode the whole request without converting JSON scalar types through form strings. */
export function jsonRequestInput(text:string,inputs:Record<string,InputDefinition>,validate:(values:Record<string,string>,omitted:Record<string,boolean>)=>{input:Record<string,JsonValue>;errors:Record<string,string>}){
  if(text.length>24576)throw Error('Keep the request within 24 KB.');
  let request:unknown;try{request=JSON.parse(text);}catch{throw Error('Enter valid request JSON.');}
  if(!plain(request)||Object.keys(request).length!==1||!own(request,'input')||!plain(request.input))throw Error('Use an object containing only an input object: {"input": {...}}.');
  const input=request.input,values:Record<string,string>={},omitted:Record<string,boolean>={};
  if(Object.keys(input).some(name=>['__proto__','constructor','prototype'].includes(name)||!own(inputs,name)))throw Error('The input contains an undeclared or unsafe field.');
  for(const[name,definition]of Object.entries(inputs)){
    if(!own(input,name)){if(definition.required!==false&&!own(definition,'default'))throw Error(`Missing required input: ${name}.`);omitted[name]=true;continue;}
    const value=input[name],structured=['object','array','null'].includes(definition.type)||definition.nullable;
    if(!structured){
      const expected=definition.type==='integer'?'number':definition.type;
      const coerced=definition.coercion==='number'&&expected==='number'&&typeof value==='string'||definition.coercion==='boolean'&&expected==='boolean'&&typeof value==='string';
      if(typeof value!==expected&&!coerced)throw Error(`${name}: expected a JSON ${definition.type}.`);
    }
    values[name]=structured?JSON.stringify(value):String(value);
  }
  const result=validate(values,omitted);if(Object.keys(result.errors).length)throw Error(Object.entries(result.errors).map(([name,error])=>`${name}: ${error}`).join(' '));
  return {...result,values,omitted};
}

// Deliberately omit examples, defaults, enum values, descriptions and URL values:
// contract authors can accidentally put credentials into any of those fields.
function safeSchema(raw:unknown,depth=0):Schema{
  if(depth>5||!plain(raw))return {};
  const result:Schema={};for(const key of ['type','nullable','additionalProperties','minimum','maximum','minLength','maxLength','minItems','maxItems','uniqueItems'])if(['string','number','boolean'].includes(typeof raw[key]))result[key]=raw[key];
  if(Array.isArray(raw.required))result.required=raw.required.filter(value=>typeof value==='string');
  if(plain(raw.properties))result.properties=Object.fromEntries(Object.entries(raw.properties).filter(([name])=>!['__proto__','constructor','prototype'].includes(name)).map(([name,field])=>[name,safeSchema(field,depth+1)]));
  if(raw.items)result.items=safeSchema(raw.items,depth+1);
  if(Array.isArray(raw.anyOf))result.anyOf=raw.anyOf.map(value=>safeSchema(value,depth+1));return result;
}
function synthetic(raw:unknown,depth=0):JsonValue{
  if(depth>5||!plain(raw))return 'example';
  if(Array.isArray(raw.anyOf))return synthetic(raw.anyOf.find(value=>plain(value)&&value.type!=='null')??raw.anyOf[0],depth+1);
  if(raw.type==='object')return Object.fromEntries(Object.entries(plain(raw.properties)?raw.properties:{}).filter(([name])=>Array.isArray(raw.required)?raw.required.includes(name):true).map(([name,field])=>[name,synthetic(field,depth+1)]));
  if(raw.type==='array')return Array.from({length:Math.min(10,Math.max(0,Number(raw.minItems)||0))},(_,index)=>{const value=synthetic(raw.items,depth+1);return raw.uniqueItems&&typeof value==='string'?value+index:value;});
  if(raw.type==='null')return null;if(raw.type==='boolean')return false;
  if(raw.type==='number'||raw.type==='integer')return Math.min(typeof raw.maximum==='number'?raw.maximum:Infinity,Math.max(typeof raw.minimum==='number'?raw.minimum:-Infinity,0));
  return 'example'.padEnd(Math.min(4096,Math.max(1,Number(raw.minLength)||1)),'x').slice(0,Math.max(0,Math.min(4096,typeof raw.maxLength==='number'?raw.maxLength:4096)));
}
const shell=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
export function sanitizedExamples({origin,slug,revision,inputSchema,outputSchema}:{origin:string;slug:string;revision:number;inputSchema:unknown;outputSchema:unknown}){
  const host=new URL(origin);if(!['http:','https:'].includes(host.protocol)||host.username||host.password||host.search||host.hash||host.pathname!=='/'||!['127.0.0.1','localhost','[::1]'].includes(host.hostname))throw Error('Examples require a credential-free local runtime origin.');
  if(!Number.isSafeInteger(revision)||revision<1)throw Error('Select a published revision before exporting an example.');
  const endpoint=host.origin+`/v1/actions/${encodeURIComponent(slug)}/revisions/${revision}/runs`,input=synthetic(inputSchema),body=JSON.stringify({input}),literal=JSON.stringify(endpoint),schema={input:safeSchema(inputSchema),output:safeSchema(outputSchema)};
  const warning='Sanitized synthetic sample. No actual inputs, responses or keys are included. Review constraints and replace sample values locally before execution. Enum values, patterns, defaults and examples are intentionally omitted.';
  const javascript=`// ${warning}\nconst key = process.env.HERMO_API_KEY;\nif (!key) throw new Error('Set HERMO_API_KEY locally');\nconst idempotencyKey = process.env.HERMO_REQUEST_ID || crypto.randomUUID();\n// Preserve this ID to recover the same logical request; use a new ID for a new request.\nconsole.log('Request ID:', idempotencyKey);\nconst response = await fetch(${literal}, {\n  method: 'POST', redirect: 'error',\n  headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey},\n  body: JSON.stringify(${body}), signal: AbortSignal.timeout(15000)\n});\nconst receipt = await response.json();\nif (!response.ok) throw new Error(receipt.error?.message || 'Request rejected');\nconsole.log(receipt);\n// Poll /v1/runs/{run_id} on this runtime with the same key. Do not resubmit an uncertain run.`;
  const curl=`# ${warning}\n# Set HERMO_API_KEY locally. Keep HERMO_REQUEST_ID for recovery only.\n: "\${HERMO_API_KEY:?Set HERMO_API_KEY locally}"\n: "\${HERMO_REQUEST_ID:?Set a unique HERMO_REQUEST_ID for this logical request}"\ncurl --fail-with-body --max-time 15 -X POST ${shell(endpoint)} \\\n  -H "Authorization: Bearer $HERMO_API_KEY" \\\n  -H 'Content-Type: application/json' \\\n  -H "Idempotency-Key: $HERMO_REQUEST_ID" \\\n  --data ${shell(body)}`;
  const python=`# ${warning}\nimport json\nimport os\nimport uuid\nimport urllib.request\n\nkey = os.environ['HERMO_API_KEY']\nrequest_id = os.environ.get('HERMO_REQUEST_ID') or str(uuid.uuid4())\nprint('Request ID:', request_id)  # Preserve for recovery only.\nclass NoRedirect(urllib.request.HTTPRedirectHandler):\n    def redirect_request(self, req, fp, code, msg, headers, newurl):\n        return None\nrequest = urllib.request.Request(\n    ${JSON.stringify(endpoint)},\n    data=${JSON.stringify(body)}.encode('utf-8'),\n    headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': request_id},\n    method='POST'\n)\nwith urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:\n    receipt = json.load(response)\nprint(receipt)\n# Poll /v1/runs/{run_id} on this runtime with the same key; do not repeat uncertain actions.`;
  const mcp=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'invoke_revision',arguments:{revision,input,request_id:'UNIQUE_ID_FOR_THIS_LOGICAL_REQUEST'}}},null,2);
  const typescript=javascript.replace("const key = process.env.HERMO_API_KEY;","const key: string | undefined = process.env.HERMO_API_KEY;");
  const code:Record<ExampleLanguage,string>={curl,javascript,typescript,python,mcp};
  const json=JSON.stringify({kind:'hermo-sanitized-api-example',notice:warning,endpoint,revision,request:{input},response_schema:schema.output,input_schema:schema.input,mcp:{endpoint:host.origin+'/mcp',authentication:'Authorization: Bearer <locally supplied scoped key>',request:JSON.parse(mcp)}},null,2);
  const markdown=`# Hermo API example\n\n${warning}\n\nRecipient: ${host.origin}. This address refers to the recipient's own local runtime. A matching published action, revision, authorized browser and scoped key are required.\n\n## Request (synthetic)\n\n\`\`\`json\n${JSON.stringify({input},null,2)}\n\`\`\`\n\n## cURL\n\n\`\`\`sh\n${curl}\n\`\`\`\n\n## Minimal Node.js client\n\n\`\`\`javascript\n${javascript}\n\`\`\`\n\n## MCP\n\nSend to ${host.origin}/mcp using a configured MCP client and locally supplied Authorization header. Initialize the MCP session first.\n\n\`\`\`json\n${mcp}\n\`\`\`\n\n## Response schema (sanitized shape)\n\n\`\`\`json\n${JSON.stringify(schema.output,null,2)}\n\`\`\`\n`;
  return {code,json,markdown,warning,endpoint,body};
}
