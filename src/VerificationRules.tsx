import type {OutputMapping} from './OutputMappings';

export type VerificationRule={kind?:string;output:string;input?:string;value?:string|number|boolean;unit?:string;path?:(string|number)[];operator?:string;quantifier?:string;other_output?:string;other_path?:(string|number)[];evidence?:string};
const conditions=[['nonempty','Value is present'],['equals_input','Matches requested input'],['contains','Contains expected text'],['url','Valid URL'],['number','Numeric text'],['changed','Changed during this run'],['completion','Fresh completion marker'],['unique','Unique list values'],['rows','List row condition'],['compare','Compare two output fields']];
const operators=[['eq','Equals'],['ne','Does not equal'],['lt','Less than'],['lte','At most'],['gt','Greater than'],['gte','At least']];
const pathText=(value?:(string|number)[])=>value?.join('/')??'';
const tokens=(value:string)=>value?value.split('/').map(part=>/^\d+$/.test(part)?Number(part):part):[];

export function VerificationRules({rules,outputs,inputs,disabled,onChange}:{rules:VerificationRule[];outputs:OutputMapping[];inputs:string[];disabled?:boolean;onChange:(rules:VerificationRule[])=>void}){
  const patch=(index:number,value:Partial<VerificationRule>)=>onChange(rules.map((rule,n)=>n===index?{...rule,...value}:rule));
  return <div className="output-mappings"><p className="small-text muted">Schema checks always run. Add context checks to distinguish the intended records from unrelated page content. A completion marker must change after the final action; choose a request identifier or equivalent website evidence.</p>
    {rules.map((rule,index)=>{
      const kind=rule.kind??'equals_input';
      return <fieldset className="output-mapping" key={index} disabled={disabled}><legend>Check {index+1}</legend>
        <label className="field"><span>Output</span><select value={rule.output} onChange={event=>patch(index,{output:event.target.value})}>{outputs.map(output=><option key={output.name} value={output.name}>{output.name}</option>)}</select></label>
        <label className="field"><span>Condition</span><select value={kind} onChange={event=>{
          const kind=event.target.value;onChange(rules.map((value,n)=>n!==index?value:{output:rule.output,kind,...kind==='equals_input'?{input:inputs[0]??''}:kind==='contains'?{value:''}:kind==='completion'?{evidence:outputs.find(output=>output.name!==rule.output)?.name??''}:kind==='rows'?{path:[],operator:'eq',quantifier:'all',value:''}:kind==='compare'?{operator:'eq',other_output:outputs.find(output=>output.name!==rule.output)?.name??''}:{} }));
        }}>{conditions.map(([kind,label])=><option key={kind} value={kind}>{label}</option>)}</select></label>
        {kind==='equals_input'&&<label className="field"><span>Requested input</span><select value={rule.input??''} onChange={event=>patch(index,{input:event.target.value})}>{inputs.map(name=><option key={name}>{name}</option>)}</select></label>}
        {kind==='contains'&&<label className="field"><span>Expected text</span><input value={String(rule.value??'')} onChange={event=>patch(index,{value:event.target.value})}/></label>}
        {kind==='number'&&<label className="field"><span>Required unit (optional)</span><input value={rule.unit??''} onChange={event=>patch(index,{unit:event.target.value||undefined})}/></label>}
        {kind==='completion'&&<label className="field"><span>Completion evidence output</span><select value={rule.evidence??''} onChange={event=>patch(index,{evidence:event.target.value})}><option value="">Choose a marker</option>{outputs.filter(output=>output.name!==rule.output).map(output=><option key={output.name} value={output.name}>{output.name}</option>)}</select><small>Required scalar DOM field. It must change after the final action and remain settled while the results are read. Static banners and input echoes are insufficient. Generated media still requires fresh asset URLs.</small></label>}
        {['unique','rows','compare'].includes(kind)&&<label className="field"><span>{kind==='compare'?'Output field path':'Field path within each row'}</span><input value={pathText(rule.path)} onChange={event=>patch(index,{path:tokens(event.target.value)})} placeholder="details/price"/><small>Slash-separated declared field names or list indices. Leave blank for the complete value. No wildcards or expressions.</small></label>}
        {['rows','compare'].includes(kind)&&<label className="field"><span>Comparison</span><select value={rule.operator??'eq'} onChange={event=>patch(index,{operator:event.target.value})}>{[...operators,...kind==='rows'?[['contains','Contains text']]:[]].map(([op,label])=><option key={op} value={op}>{label}</option>)}</select></label>}
        {kind==='rows'&&<><label className="field"><span>Matching rows</span><select value={rule.quantifier??'all'} onChange={event=>patch(index,{quantifier:event.target.value})}><option value="all">All rows</option><option value="some">At least one row</option><option value="exactly_one">Exactly one row</option></select></label><ScalarValue value={rule.value??''} onChange={value=>patch(index,{value})}/></>}
        {kind==='compare'&&<><label className="field"><span>Other output</span><select value={rule.other_output??''} onChange={event=>patch(index,{other_output:event.target.value})}>{outputs.map(output=><option key={output.name} value={output.name}>{output.name}</option>)}</select></label><label className="field"><span>Other output field path</span><input value={pathText(rule.other_path)} onChange={event=>patch(index,{other_path:tokens(event.target.value)})}/></label></>}
        <button type="button" className="button ghost" onClick={()=>onChange(rules.filter((_,n)=>n!==index))}>Remove check</button>
      </fieldset>;
    })}
    <button type="button" className="button secondary" disabled={disabled||rules.length>=24} onClick={()=>onChange([...rules,{kind:'nonempty',output:outputs[0]?.name??''}])}>Add success check</button>
  </div>;
}
function ScalarValue({value,onChange}:{value:string|number|boolean;onChange:(value:string|number|boolean)=>void}){
  const type=typeof value;
  return <><label className="field"><span>Expected value type</span><select value={type} onChange={event=>onChange(event.target.value==='number'?0:event.target.value==='boolean'?false:'')}><option value="string">Text</option><option value="number">Number</option><option value="boolean">Boolean</option></select></label><label className="field"><span>Expected value</span>{type==='boolean'?<select value={String(value)} onChange={event=>onChange(event.target.value==='true')}><option value="true">true</option><option value="false">false</option></select>:<input type={type==='number'?'number':'text'} step={type==='number'?'any':undefined} value={String(value)} onChange={event=>onChange(type==='number'?Number(event.target.value):event.target.value)}/>}</label></>;
}
