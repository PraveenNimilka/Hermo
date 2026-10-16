export const deletionPhrase = (name:string) => `Delete "${name}"`;

export function DeletionConfirmation({name,value,onChange,disabled=false}:{name:string;value:string;onChange:(value:string)=>void;disabled?:boolean}) {
  return <label className="field deletion-confirmation"><span>Type <strong>{deletionPhrase(name)}</strong> to confirm</span><input aria-label="Deletion confirmation" autoComplete="off" spellCheck={false} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}/></label>;
}
