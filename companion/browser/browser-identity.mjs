// One identity writer per worker. Concurrent tab connections must wait for the
// same local-storage read/write rather than create competing profile identities.
export function createBrowserIdentity(storage,randomUUID=()=>crypto.randomUUID()){
  let pending;
  return ()=>{
    if(!pending)pending=(async()=>{
      const saved=(await storage.get('browserContext')).browserContext;
      if(typeof saved==='string'&&/^bc_[A-Za-z0-9_-]{36}$/.test(saved))return saved;
      const context='bc_'+randomUUID();
      await storage.set({browserContext:context});return context;
    })().catch(error=>{pending=undefined;throw error;});
    return pending;
  };
}
