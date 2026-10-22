import {convertOutputs} from './workflow-contract.mjs';
import {valueAt,canonicalValue,compareValues,verificationRuleSummaries} from './verification-rules.mjs';
export {verifierSchema,validateVerifierReferences as validateVerifiers} from './verification-rules.mjs';
export function verifyResult(definition,result,input,sourceCheck,observations={}){
  const checks=[sourceCheck,'nonempty_outputs'];
  const reject=(output,reason,path,keyword)=>{throw Object.assign(Error('VERIFICATION_FAILED'),{verification:{output,reason,...path?{path,keyword}:{}}});};
  const converted=convertOutputs(definition.outputs,result);
  const nonempty=value=>value!==null&&value!==undefined&&(typeof value==='string'?!!value.trim():Array.isArray(value)?value.length>0:typeof value==='object'?Object.keys(value).length>0:true);
  for(const rule of definition.verifiers){
    const value=result[rule.output],kind=rule.kind??'equals_input',mapping=definition.outputs.find(output=>output.name===rule.output);
    if(['object','array'].includes(mapping?.type)&&!['changed','nonempty','unique','rows','compare','completion'].includes(kind))reject(rule.output,'invalid_structure');
    if(kind==='unique'){
      const rows=converted[rule.output];if(!Array.isArray(rows))reject(rule.output,'invalid_structure');
      const seen=new Set();for(let i=0;i<rows.length;i++){
        const value=valueAt(rows[i],rule.path),path=[rule.output,i,...rule.path??[]];
        if(value===undefined||value===null)reject(rule.output,'missing_output',path,'required');
        const key=canonicalValue(value);if(seen.has(key))reject(rule.output,'duplicate_value',path,'uniqueItems');seen.add(key);
      }checks.push(rule.output+'_unique');
    }else if(kind==='rows'){
      const rows=converted[rule.output];if(!Array.isArray(rows)||!rows.length)reject(rule.output,'row_mismatch',[rule.output],'rows');
      const matches=rows.map(row=>compareValues(valueAt(row,rule.path),rule.value,rule.operator)),count=matches.filter(Boolean).length;
      if(rule.quantifier==='all'?count!==rows.length:rule.quantifier==='some'?count===0:count!==1){
        const index=rule.quantifier==='all'?matches.indexOf(false):0;reject(rule.output,'row_mismatch',[rule.output,index,...rule.path],'rows');
      }checks.push(rule.output+'_rows_'+rule.quantifier);
    }else if(kind==='compare'){
      if(!compareValues(valueAt(converted[rule.output],rule.path),valueAt(converted[rule.other_output],rule.other_path),rule.operator))reject(rule.output,'comparison_failed',[rule.output,...rule.path??[]],'compare');
      checks.push(rule.output+'_compare_'+rule.other_output);
    }else if(kind==='completion'){
      if(observations[rule.evidence]?.fresh!==true||observations[rule.evidence]?.stable!==true)reject(rule.output,'completion_unverified',[rule.output],'completion');
      checks.push(rule.output+'_completed_'+rule.evidence);
    }else if(kind==='equals_input'){
      if(input[rule.input]===undefined||value!==String(input[rule.input]))throw Object.assign(Error('VERIFICATION_FAILED'),{verification:{output:rule.output,input:rule.input,reason:'input_mismatch'}});
      checks.push(rule.output+'_matches_'+rule.input);
    }else if(kind==='url'){
      let url;try{url=new URL(value);}catch{reject(rule.output,'invalid_url');}
      if(!['https:','http:'].includes(url.protocol)||url.username||url.password)reject(rule.output,'invalid_url');
      checks.push(rule.output+'_url');
    }else if(kind==='changed'){
      if(observations[rule.output]?.fresh!==true)reject(rule.output,'not_fresh');
      checks.push(rule.output+'_changed');
    }else if(kind==='number'){
      if(typeof value!=='string')reject(rule.output,'invalid_number');
      const match=/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*(°\s*[CF]|%|[A-Za-z/]+)?$/.exec(value.trim());
      if(!match)reject(rule.output,'invalid_number');
      if(rule.unit&&(match[1]??'').replace(/\s/g,'')!==rule.unit.replace(/\s/g,''))reject(rule.output,'unit_mismatch');
      checks.push(rule.output+'_number');
    }else if(kind==='contains'){
      if(typeof value!=='string'||!value.includes(rule.value))reject(rule.output,'context_mismatch');checks.push(rule.output+'_context');
    }else{if(!nonempty(converted[rule.output]))reject(rule.output,'missing_output');checks.push(rule.output+'_nonempty');}
  }
  if(definition.outputs.some(output=>Object.hasOwn(output,'type')))checks.push('output_schema');
  const observedAt=new Date().toISOString();
  return {verified_at:observedAt,observed_at:observedAt,verifier_version:definition.version,checks,rules:verificationRuleSummaries(definition.verifiers)};
}
