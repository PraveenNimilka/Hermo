import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {build,transform} from 'esbuild';
import {jsonRequestInput,sanitizedExamples} from '../src/api-examples.ts';

const execute=promisify(execFile);
const inputSchema={type:'object',additionalProperties:false,required:['message','quantity','enabled','details'],properties:{message:{type:'string',minLength:1,default:'PRIVATE_DEFAULT',examples:['PRIVATE_EXAMPLE']},quantity:{type:'integer',minimum:1,maximum:9},enabled:{type:'boolean'},details:{type:'object',additionalProperties:false,required:['items'],properties:{items:{type:'array',minItems:1,items:{type:'string'}}}}}};
const outputSchema={type:'object',required:['answer'],properties:{answer:{type:'string',examples:['PRIVATE_RESULT'],enum:['PRIVATE_ENUM']}}};

test('sanitized exports contain synthetic input and shape only, with immutable local routes',()=>{
  const examples=sanitizedExamples({origin:'http://127.0.0.1:4317',slug:'example.action',revision:3,inputSchema,outputSchema});
  for(const value of [examples.json,examples.markdown,...Object.values(examples.code)]){for(const secret of ['PRIVATE_DEFAULT','PRIVATE_EXAMPLE','PRIVATE_RESULT','PRIVATE_ENUM'])assert.equal(value.includes(secret),false);assert.match(value,/synthetic|invoke_revision/);}
  const sample=JSON.parse(examples.json);assert.deepEqual(sample.request.input,{message:'example',quantity:1,enabled:false,details:{items:['example']}});assert.match(sample.endpoint,/revisions\/3\/runs$/);assert.equal(sample.mcp.request.params.arguments.revision,3);assert.equal(sample.response_schema.properties.answer.examples,undefined);assert.match(examples.markdown,/recipient's own local runtime/);
  for(const origin of ['https://remote.example','http://key:secret@127.0.0.1:4317','http://127.0.0.1:4317/?key=secret'])assert.throws(()=>sanitizedExamples({origin,slug:'example',revision:1,inputSchema,outputSchema}));
});

test('whole JSON editor shares published constraint validation and rejects lossy scalar conversion',async()=>{
  const bundled=await build({entryPoints:[resolve('src/WorkflowContract.tsx')],bundle:true,write:false,platform:'node',format:'esm'}),helpers=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  const inputs=Object.fromEntries(Object.entries(inputSchema.properties).map(([name,value])=>[name,helpers.inputDefinitionFromSchema(value,true)])),validate=(values,omitted)=>helpers.typedInput(inputs,values,omitted),parse=value=>jsonRequestInput(JSON.stringify(value),inputs,validate);
  const input={message:'actual user text',quantity:2,enabled:true,details:{items:['a','b']}};assert.deepEqual(parse({input}).input,input);
  for(const invalid of [{input:{...input,quantity:'2'}},{input:{...input,message:42}},{input:{...input,enabled:'true'}},{input:{...input,details:{items:[false]}}},{input:{...input,quantity:20}},{input:{...input,undeclared:'x'}},{input,extra:true},{input:{message:'missing'}}])assert.throws(()=>parse(invalid));
  assert.throws(()=>jsonRequestInput('{"input":{"__proto__":{},"message":"x"}}',inputs,validate),/unsafe/);assert.throws(()=>jsonRequestInput('{',inputs,validate),/valid request JSON/);
  const optional={message:{type:'string',required:false},flag:{type:'boolean',required:true}},parsed=jsonRequestInput('{"input":{"flag":false}}',optional,(values,omitted)=>helpers.typedInput(optional,values,omitted));assert.deepEqual(parsed.input,{flag:false});assert.equal(parsed.omitted.message,true);
});

test('generated JavaScript, TypeScript and Python clients execute against a controlled local recipient',{timeout:30000},async()=>{
  const requests=[],key='synthetic-scoped-test-key';
  const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push({url:req.url,authorization:req.headers.authorization,idempotency:req.headers['idempotency-key'],body:JSON.parse(body)});res.writeHead(202,{'Content-Type':'application/json'});res.end(JSON.stringify({run_id:'controlled',status_url:'http://127.0.0.1/status'}));});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));const folder=await mkdtemp(resolve('work/playground-examples-'));
  try{
    const origin='http://127.0.0.1:'+server.address().port,examples=sanitizedExamples({origin,slug:'sample.workflow',revision:2,inputSchema,outputSchema}),env={...process.env,HERMO_API_KEY:key,HERMO_REQUEST_ID:'controlled-logical-request'};
    await writeFile(join(folder,'client.mjs'),examples.code.javascript);await execute(process.execPath,[join(folder,'client.mjs')],{env,timeout:10000});
    const ts=await transform(examples.code.typescript,{loader:'ts',format:'esm'});await writeFile(join(folder,'client-ts.mjs'),ts.code);await execute(process.execPath,[join(folder,'client-ts.mjs')],{env,timeout:10000});
    await writeFile(join(folder,'client.py'),examples.code.python);await execute('python',[join(folder,'client.py')],{env,timeout:10000});
    await writeFile(join(folder,'client.sh'),examples.code.curl);await execute('C:/Program Files/Git/bin/bash.exe',[join(folder,'client.sh').replaceAll('\\','/')],{env,timeout:10000});
    assert.equal(requests.length,4);for(const request of requests){assert.equal(request.url,'/v1/actions/sample.workflow/revisions/2/runs');assert.equal(request.authorization,'Bearer '+key);assert.equal(request.idempotency,'controlled-logical-request');assert.deepEqual(request.body,JSON.parse(examples.body));}
    assert.doesNotThrow(()=>JSON.parse(examples.code.mcp));
  }finally{await new Promise(done=>server.close(done));await rm(folder,{recursive:true,force:true});}
});
