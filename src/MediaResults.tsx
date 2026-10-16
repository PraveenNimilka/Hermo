import {useEffect,useRef,useState} from 'react';

export function MediaResults({result,schema}:{result:Record<string,unknown>;schema:unknown}){
  const host=useRef<HTMLDivElement>(null),[available,setAvailable]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    let alive=true;setError('');setAvailable(false);host.current?.replaceChildren();
    const modulePath='/media-results.js';
    import(/* @vite-ignore */ modulePath).then(module=>{
      if(!alive||!host.current)return;
      const entries=module.mediaEntries(result,schema,location.origin);
      module.renderMedia(host.current,entries);setAvailable(entries.length>0);
    }).catch(()=>{if(alive)setError('Media previews could not load. Verified URLs remain available in the JSON response.');});
    return()=>{alive=false;host.current?.replaceChildren();};
  },[result,schema]);
  return <section className="verified-media-preview" hidden={!available&&!error} aria-label="Verified media"><h3>Verified media</h3><p>Preview a result without running the workflow again. Media loads only when you choose it.</p><div ref={host}/>{error&&<p role="status">{error}</p>}</section>;
}
