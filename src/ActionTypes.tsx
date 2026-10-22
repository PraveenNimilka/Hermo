export type ActionType='chat'|'generate_media'|'read'|'read_data'|'search_extract'|'submit_form'|'custom';
export type ReadAttribute='src'|'href'|'alt'|'download'|'poster';
export type CapturedOutput={name:string;type?:'string'|'number'|'integer'|'boolean'|'url'|'array'|'object';media_type?:'image'|'video'|'audio'|'file';required?:boolean;nullable?:boolean;fields?:CapturedOutput[];items?:Omit<CapturedOutput,'name'>;read_attribute?:ReadAttribute;enum?:(string|number|boolean)[];minimum?:number;maximum?:number;minLength?:number;maxLength?:number;pattern?:string;format?:'date'|'date-time'|'time';minItems?:number;maxItems?:number;uniqueItems?:boolean};

export function isConversationOutput(item:{read_mode?:string;semantic_role?:string;label:string}){
  return item.read_mode==='last'&&(item.semantic_role==='user'||item.semantic_role==='assistant'||!item.semantic_role&&['Latest submitted message','Latest assistant response'].includes(item.label));
}

export const actionTypes=[
  {value:'chat',label:'Chat and text',detail:'Send a message or instruction and capture the completed reply. Works with the website you connect.',example:'Ask a question, summarize text, or translate a document.'},
  {value:'generate_media',label:'Generate media',detail:'Record the generate control, then select the finished image, video, audio, or download link. Hermo checks that a new result arrived.',example:'Generate an image, create audio, or export a video.'},
  {value:'read',label:'Read data',detail:'Select the values you need from the page. Inputs and clicks are optional; valid unchanged values can be read again.',example:'Read weather, stock levels, prices, or a dashboard status.'},
  {value:'search_extract',label:'Search and extract',detail:'Bind the search input, record the search, and select the result fields or links you want returned.',example:'Look up an order, search a directory, or extract records.'},
  {value:'submit_form',label:'Submit and update',detail:'Bind the form fields, record its submit control, and select the confirmation. Review the website changes before approving replay.',example:'Create a ticket, update a record, or submit a request.'},
  {value:'custom',label:'Custom',detail:'Record the inputs, controls, and outputs needed for your own task. The same verification and API flow applies.',example:'Combine navigation, filters, selections, and captured results.'}
] as const;

export function actionTypeLabel(value?:ActionType){return actionTypes.find(item=>item.value===(value==='read_data'?'read':value))?.label??'Custom';}

export function ActionTypePicker({value,onChange}:{value:ActionType;onChange:(value:ActionType)=>void}){
  const selected=actionTypes.find(item=>item.value===value)??actionTypes[5];
  return <div className="action-type-picker"><label className="field"><span>What should this action do?</span><select aria-label="What should this action do?" value={value} onChange={event=>onChange(event.target.value as ActionType)} aria-describedby="task-guidance">{actionTypes.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label><div className="task-guidance" id="task-guidance"><p>{selected.detail}</p><span>{selected.example}</span></div></div>;
}
