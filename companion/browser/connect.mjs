// Connection-page target is captured before the page opens and never inferred from the new active tab.
const key='pairTarget:'+location.hash.slice(1),stored=await chrome.storage.session.get(key);
await chrome.storage.session.remove(key);
globalThis.hermoConnectionPageTarget=stored[key]?.expires>Date.now()?stored[key]:null;
await import('./popup.mjs');
