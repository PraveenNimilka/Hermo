export type WorkflowChangeReview={fingerprint:string;breaking:boolean;permission_review_required:boolean;permissions_expanded:boolean;input_changes:{path:(string|number)[];reason:string;breaking:boolean}[];output_changes:{path:(string|number)[];reason:string;breaking:boolean}[];permission_changes:{path:(string|number)[];reason:string;direction:string}[]};
const words=(value:string)=>value.replaceAll('_',' ');
export function WorkflowChanges({review}:{review:WorkflowChangeReview}){
  const changes=[...review.input_changes,...review.output_changes];
  return <section aria-label="Publication changes"><h4>Changes from the live version</h4>
    <p>{review.breaking?'This changes the API contract. Existing clients may need updating.':'No breaking input or output changes were detected.'}</p>
    {!!changes.length&&<ul className="safety-values">{changes.map((change,index)=><li key={index}><code>{change.path.join('.')}</code> · {words(change.reason)}{change.breaking?' · Breaking change':''}</li>)}</ul>}
    {!!review.permission_changes.length&&<><p>Review the changed website authority and returned data before publishing.</p><ul className="safety-values">{review.permission_changes.map((change,index)=><li key={index}><code>{change.path.join('.')}</code> · {words(change.reason)} · {change.direction}</li>)}</ul></>}
  </section>;
}
