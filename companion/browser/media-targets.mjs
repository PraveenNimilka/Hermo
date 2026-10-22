// Explicit repair choices for result streams. Plain catalogs and galleries keep
// their selected element locators. No provider domains, asset IDs or URLs are
// part of these selectors. inspectDocument is serialized into Chrome and keeps
// the same container vocabulary locally; browser regression tests cover both.
const streams=['[data-message-author-role="assistant"]','[data-turn="assistant"]','[data-testid="assistant-message"]','[role="log"]'];
export const mediaTargetPresets=Object.freeze([
  ['image','img'],['video','video'],['audio','audio'],
].map(([value,tag])=>Object.freeze({value,label:'Latest '+value+' result',selector:[...streams,...value==='image'?['[data-testid="generated-image-preview"]']:[]].map(scope=>scope+' '+tag).join(', '),read_attribute:'src'})));
