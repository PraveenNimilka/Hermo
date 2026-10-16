export function browserProblem(code){
  return {
    ORIGIN_CHANGED:'The website left the selected origin. Finish sign-in yourself, return to the selected website, then open the extension there again.',
    LOGIN_REQUIRED:'Complete sign-in or verification directly in the website tab, then refresh Hermo.',
    TAB_CLOSED:'The selected website tab was closed. Open it and pair that tab again.',
    PERMISSION_REVOKED:'Chrome did not grant access to the selected website tab. Open this extension on that website tab again, then retry in Hermo.',
    PAGE_READ_FAILED:'Hermo could not inspect this page. Reload the updated Hermo companion in chrome://extensions, then pair the website tab again.',
    ACTION_UNAVAILABLE:'This website control changed or is unavailable. Refresh the tab content in Hermo and select the control again.',
    ELEMENT_AMBIGUOUS:'More than one website element matches this step. Choose a more specific target in Hermo before retrying.',
    OUTPUT_LIMIT_EXCEEDED:'The selected output exceeds its extraction limit. Narrow the list selector or increase its maximum up to 100 rows.',
    UNSUPPORTED_FRAME:'This control is in an unsupported frame. Use the website tab directly.',
    TIMEOUT:'The website operation timed out. Check the selected tab, then retry in Hermo.'
  }[code]??'The local connection ended. Unlock Hermo and pair the selected tab again.';
}
