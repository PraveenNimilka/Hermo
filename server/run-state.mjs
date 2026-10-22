import {assertObservationWindow,executionStatus} from './execution-receipt.mjs';

// Durable execution observations. Never copy browser text, selectors or field values here.
export const activeRunStatuses = ['queued', 'running', 'verifying'];
export const terminalRunStatuses = ['succeeded', 'failed', 'cancelled'];
const stamp = () => new Date().toISOString();
const elapsed = (from, to) => Math.max(0, Date.parse(to) - Date.parse(from));
const transitions = {queued:['preparing','running','failed','uncertain','cancelled','timed_out'],preparing:['running','failed','uncertain','cancelled','timed_out'],running:['awaiting_approval','verifying','failed','uncertain','cancelled','timed_out'],awaiting_approval:['running','failed','uncertain','cancelled','timed_out'],verifying:['succeeded','failed','uncertain','cancelled','timed_out']};
const invalidTransition = () => {throw Error('INVALID_RUN_TRANSITION');};
const phaseOf = payload => payload.phase ?? (payload.started_at ? 'running' : 'queued');
const terminal = payload => [...terminalRunStatuses,'uncertain','timed_out'].includes(phaseOf(payload));
function requireSuccessEvidence(payload,verifierVersion){
  const proof=payload.verification;
  if(!Array.isArray(payload.steps)||payload.steps.some(step=>!['succeeded','skipped'].includes(step.status))||!proof||!Array.isArray(proof.checks)||!proof.checks.length||!proof.checks.every(check=>typeof check==='string'&&/^[a-zA-Z][a-zA-Z0-9_:. -]{0,159}$/.test(check))||typeof proof.verified_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(proof.verified_at)||!Number.isFinite(Date.parse(proof.verified_at))||(verifierVersion!==undefined&&proof.verifier_version!==verifierVersion))throw Object.assign(Error('VERIFICATION_FAILED'),{verification:{output:'result',reason:'invalid_evidence'}});
}

export function transitionRun(payload, next, at = stamp()) {
  const previous=phaseOf(payload);
  if(terminal(payload))return payload;
  if(previous===next)return payload;
  if(!transitions[previous]?.includes(next))invalidTransition();
  if(next==='succeeded')requireSuccessEvidence(payload);
  payload.phase=next;
  payload.phase_changed_at=at;
  return payload;
}

// All run writers use this compare-and-swap boundary. Finished rows are immutable,
// including their payload and updated_at; awaiting approval remains public running.
export function persistRun(store,id,status,payload,expectedStatuses=activeRunStatuses) {
  const row=store.db.prepare('SELECT status FROM runs WHERE id=?').get(id);
  if(!row||terminalRunStatuses.includes(row.status)||!expectedStatuses.includes(row.status))return false;
  if(!activeRunStatuses.includes(status)&&!terminalRunStatuses.includes(status))invalidTransition();
  if(status!==row.status&&!transitions[row.status]?.includes(status))invalidTransition();
  const phase=phaseOf(payload);
  if(({awaiting_approval:'running',preparing:'running',uncertain:'failed',timed_out:'failed'}[phase]??phase)!==status)invalidTransition();
  if(status==='succeeded')requireSuccessEvidence(payload);
  return store.db.prepare('UPDATE runs SET status=?,payload=?,updated_at=? WHERE id=? AND status=?').run(status,store.seal(payload),payload.finished_at??stamp(),id,row.status).changes===1;
}

export function prepareRun(payload,acceptedAt,at=stamp()) {
  if(terminal(payload))return payload;
  if(phaseOf(payload)!=='queued')invalidTransition();
  transitionRun(payload,'preparing',at);
  payload.started_at=at;
  payload.queue_duration_ms=elapsed(acceptedAt,at);
  return payload;
}

export function startRun(payload, definition, acceptedAt, at = stamp()) {
  if(terminal(payload))return payload;
  if(!['queued','preparing'].includes(phaseOf(payload)))invalidTransition();
  transitionRun(payload,'running',at);
  payload.started_at ??= at;
  payload.queue_duration_ms ??= elapsed(acceptedAt, at);
  payload.steps = definition.steps.map((step, index) => ({
    number: index + 1, operation: step.op, status: 'pending',
    .../^step_[A-Za-z0-9_-]{8,80}$/.test(step.id??'')?{step_id:step.id}:{},
    ...step.parameter ? {input_name: step.parameter} : {},
    ...step.selector ? {locator: {strategy: 'recorded_selector', framed: !!step.frame_path?.length}} : {}
  }));
  return payload;
}

export function observeProgress(payload, definition, index, total, event = {}, at = stamp()) {
  if(terminal(payload))return payload;
  if (event.phase === 'verifying') {
    if(payload.steps?.some(step=>!['succeeded','skipped'].includes(step.status)))invalidTransition();
    transitionRun(payload,'verifying',at);
    payload.verification_started_at ??= at;
    if(definition.outputs?.some(field=>field.name===event.output)&&['missing_output','loading','waiting_for_new_result','settling'].includes(event.wait_state))payload.verification_wait={output:event.output,state:event.wait_state,checked_at:at};
    payload.progress = 100;
    return payload;
  }
  const step = payload.steps?.[index];
  if (!step)invalidTransition();
  if(['succeeded','skipped'].includes(step.status)){
    if(event.phase==='completed'||event.phase==='skipped')return payload;
    invalidTransition();
  }
  if(phaseOf(payload)!=='running')invalidTransition();
  if(payload.steps.slice(0,index).some(previous=>!['succeeded','skipped'].includes(previous.status)))invalidTransition();
  payload.current_step = {number: index + 1, total, operation: step.operation,...step.step_id?{step_id:step.step_id}:{}};
  if (event.phase === 'completed'||event.phase==='skipped') {
    if(step.status!=='running')invalidTransition();
    step.status = event.phase==='skipped'?'skipped':'succeeded';
    if(event.phase==='skipped'&&event.warning==='WAIT_TIMEOUT_CONTINUED'&&definition.steps[index]?.op.startsWith('wait_')&&definition.steps[index]?.error_policy==='continue')step.warning='WAIT_TIMEOUT_CONTINUED';
    step.finished_at = at;
    step.duration_ms = elapsed(step.started_at ?? at, at);
    payload.progress = Math.round((index + 1) / Math.max(total, 1) * 100);
  } else if (event.phase === 'issuing') {
    if(step.status!=='running')invalidTransition();
    // On-change handlers can submit data for fill/select/check as well as click.
    if (definition.steps[index]?.enabled!==false&&['click','fill','select','check'].includes(step.operation)) {
      payload.submission_may_have_occurred = true;
    }
  } else {
    step.status = 'running';
    step.started_at ??= at;
    payload.progress = Math.round(index / Math.max(total, 1) * 100);
  }
  return payload;
}

export function finishRun(payload, status, acceptedAt, error, at = stamp(), options = {}) {
  if(terminal(payload))return payload;
  if(!terminalRunStatuses.includes(status))invalidTransition();
  if(status==='succeeded'){
    if(phaseOf(payload)!=='verifying')throw Object.assign(Error('VERIFICATION_FAILED'),{verification:{output:'result',reason:'invalid_evidence'}});
    requireSuccessEvidence(payload,options.verifierVersion);
    if(options.observationWindow)assertObservationWindow(payload,payload.verification,at);
  }
  transitionRun(payload,executionStatus({error},status),at);
  payload.finished_at = at;
  payload.duration_ms = elapsed(acceptedAt, at); // Existing total-duration contract includes queue time.
  if (payload.started_at) payload.execution_ms = elapsed(payload.started_at, at);
  for (const step of payload.steps ?? []) {
    if (step.status === 'running'||step.status==='awaiting_approval') {
      step.status = status === 'cancelled' ? 'cancelled' : 'failed';
      step.finished_at = at;
      step.duration_ms = elapsed(step.started_at ?? at, at);
    } else if (step.status === 'pending') step.status = 'skipped';
  }
  if(payload.approval?.status==='pending'){
    payload.approval.status=error?.cause_code==='APPROVAL_REJECTED'?'rejected':['TIMEOUT','WORKFLOW_TIMEOUT'].includes(error?.cause_code)?'expired':'cancelled';
    payload.approval.decided_at=at;
    payload.approval.actor='runtime';
    payload.approval.wait_ms=elapsed(payload.approval.requested_at??at,at);
    const historical=payload.approval_history?.find(item=>item.id===payload.approval.id);
    if(historical)Object.assign(historical,payload.approval);
  }
  if (status !== 'succeeded') {
    delete payload.result;
    delete payload.verification;
    payload.error = error;
    payload.outcome = error?.outcome ?? 'unverified';
    if(error?.verification)payload.verification_evidence={status:'failed',workflow_version:payload.workflow_version,workflow_revision:payload.workflow_revision??null,...payload.run_id?{run_id:payload.run_id}:{},checked_at:at,failed_checks:[error.verification]};
  } else {
    delete payload.error;
    payload.outcome = 'verified';
    payload.progress = 100;
  }
  return payload;
}

const errors = {
  BROWSER_INSTALLATION_REQUIRED: ['BROWSER_UNAVAILABLE', 'Install the managed browser with npx playwright install chromium, or configure HERMO_BROWSER_PATH to a trusted Chrome or Edge executable, then restart Hermo.'],
  MANAGED_PROFILE_BUSY: ['BROWSER_BUSY', 'This managed session is already in use. Finish its browser operation before starting another execution.'],
  MANAGED_PROFILE_STORAGE_INVALID: ['BROWSER_UNAVAILABLE', 'The managed profile could not be safely restored or saved. Check disk space, profile size limits and runtime-directory permissions. Inspect the website before repeating a submission.'],
  BROWSER_BUSY: ['BROWSER_BUSY', 'This browser is busy with another operation. Finish it before starting another execution.'],
  MEDIA_UNSUPPORTED: ['OUTPUT_VALIDATION_FAILED', 'The selected image cannot be exported. Choose a loaded PNG, JPEG, WebP or GIF image; page-local video, audio and canvas-only results are not supported.'],
  MEDIA_TOO_LARGE: ['OUTPUT_VALIDATION_FAILED', 'The selected image exceeds the 8 MiB capture limit.'],
  MEDIA_STORAGE_FULL: ['OUTPUT_VALIDATION_FAILED', 'The temporary image storage limit was reached. Image links expire after one hour.'],
  AUTH_REQUIRED: ['AUTHENTICATION_REQUIRED', 'The website session needs attention. Complete sign-in or verification before retrying.'],
  ACTION_UNAVAILABLE: ['ELEMENT_NOT_FOUND', 'A recorded control is missing, disabled or changed. Review the failed step.'],
  ELEMENT_NOT_FOUND: ['ELEMENT_NOT_FOUND', 'The recorded element is missing. Inspect the website and repair this step.'],
  REVISION_PERMISSION_CHANGED: ['PERMISSION_DENIED', 'The accepted revision no longer matches its browser permissions. Restore and retest it.'],
  COMPANION_UPDATE_REQUIRED: ['COMPANION_UPDATE_REQUIRED', 'Reload the updated Hermo companion in Chrome extensions and reconnect this tab.'],
  OUTPUT_LIMIT_EXCEEDED: ['OUTPUT_VALIDATION_FAILED', 'The extracted output exceeded the supported item or size limit. Narrow the extraction.'],
  ELEMENT_CHANGED: ['ELEMENT_NOT_FOUND', 'The recorded element changed. Inspect the website and repair this step.'],
  ELEMENT_AMBIGUOUS: ['ELEMENT_AMBIGUOUS', 'More than one element matches this step. Select a more specific target.'],
  VERIFICATION_FAILED: ['OUTPUT_VALIDATION_FAILED', 'The captured output did not pass its verification checks.'],
  ACTION_PAUSED: ['PERMISSION_DENIED', 'The action or consumer key is paused or revoked.'],
  APPROVAL_REQUIRED: ['PERMISSION_DENIED', 'This workflow step requires explicit approval from the workspace owner.'],
  APPROVAL_REJECTED: ['PERMISSION_DENIED', 'The workspace owner declined this step. It was not executed.'],
  VERSION_CHANGED: ['VERSION_CHANGED', 'The accepted workflow version changed before execution.'],
  POLICY_BLOCKED: ['PERMISSION_DENIED', 'The website left its authorized origin or path. Return to the paired website.'],
  PERMISSION_REVOKED: ['PERMISSION_DENIED', 'Chrome access to the selected tab was revoked. Open the companion on that tab again.'],
  BROWSER_DISCONNECTED: ['BROWSER_DISCONNECTED', 'The authorized browser connection ended. Reconnect the website tab.'],
  TAB_CLOSED: ['TAB_UNAVAILABLE', 'The selected website tab was closed. Open the website and pair it again.'],
  TIMEOUT: ['WORKFLOW_TIMEOUT', 'The run exceeded its configured execution budget.'],
  WORKFLOW_TIMEOUT: ['WORKFLOW_TIMEOUT', 'The run exceeded its configured execution budget.'],
  WORKFLOW_CANCELLED: ['WORKFLOW_CANCELLED', 'Execution was cancelled. Cancellation cannot undo website changes.'],
  CONNECTION_STOPPED: ['BROWSER_DISCONNECTED', 'Connection stopped. Your saved setup remains available.'],
  INTERRUPTED: ['RUNTIME_RESTARTED', 'The local runtime restarted before this execution finished. The interrupted run was not replayed.'],
  EXECUTION_OUTCOME_UNKNOWN: ['EXECUTION_OUTCOME_UNKNOWN', 'The browser operation may have completed without an acknowledged result.'],
  INVALID_RUN_TRANSITION: ['EXECUTION_FAILED', 'Execution stopped because its recorded lifecycle was inconsistent. Inspect this run before retrying.'],
  EXECUTION_FAILED: ['EXECUTION_FAILED', 'The recorded page or output could not be reached. Review the workflow.']
};

export function runError(error, payload = {}) {
  const cause = Object.hasOwn(errors, error?.message) ? error.message : 'EXECUTION_FAILED';
  const [category, fallback] = errors[cause];
  const uncertain = !!payload.submission_may_have_occurred && ['TIMEOUT', 'WORKFLOW_TIMEOUT', 'WORKFLOW_CANCELLED', 'CONNECTION_STOPPED', 'BROWSER_DISCONNECTED', 'TAB_CLOSED', 'POLICY_BLOCKED', 'PERMISSION_REVOKED', 'ACTION_PAUSED', 'APPROVAL_REQUIRED', 'APPROVAL_REJECTED', 'INTERRUPTED', 'EXECUTION_OUTCOME_UNKNOWN', 'EXECUTION_FAILED', 'INVALID_RUN_TRANSITION'].includes(cause)||!!payload.submission_may_have_occurred&&cause==='VERIFICATION_FAILED'&&['missing_output','not_fresh','still_streaming','not_settled','completion_unverified','invalid_evidence'].includes(error?.verification?.reason);
  // Retain legacy authentication/verification/element codes for existing consumers.
  const code = uncertain ? 'EXECUTION_OUTCOME_UNKNOWN' : cause === 'TIMEOUT' ? 'WORKFLOW_TIMEOUT' : cause;
  const verification = error?.verification;
  const allowedReasons = new Set(['invalid_url','missing_output','still_streaming','not_fresh','not_settled','input_mismatch','invalid_number','invalid_boolean','unit_mismatch','context_mismatch','invalid_structure','collection_limit','output_limit','duplicate_value','row_mismatch','comparison_failed','completion_unverified','invalid_evidence','invalid_integer','enum_mismatch','below_minimum','above_maximum','string_too_short','string_too_long','invalid_format','pattern_mismatch','duplicate_items']);
  const allowedKeywords=new Set(['type','required','minimum','maximum','enum','minLength','maxLength','format','pattern','minItems','maxItems','uniqueItems','additionalProperties','rows','compare','completion']);
  const safePath=Array.isArray(verification?.path)&&verification.path.length<=24&&verification.path.every(token=>typeof token==='string'&&/^[a-z][a-z0-9_]{1,39}$/.test(token)||Number.isSafeInteger(token)&&token>=0&&token<=100000)?verification.path:undefined;
  const safeVerification = verification && /^[a-z][a-z0-9_]{1,39}$/.test(verification.output ?? '') && allowedReasons.has(verification.reason)
    ? {output: verification.output, reason: verification.reason, .../^[a-z][a-z0-9_]{1,39}$/.test(verification.input ?? '') ? {input: verification.input} : {},...safePath?{path:[...safePath]}:{},...allowedKeywords.has(verification.keyword)?{keyword:verification.keyword}:{}} : undefined;
  const detail_code=['TIMEOUT','WORKFLOW_TIMEOUT'].includes(cause)&&payload.phase==='awaiting_approval'?'APPROVAL_EXPIRED':safeVerification?['not_fresh','completion_unverified'].includes(safeVerification.reason)?'OUTPUT_STALE':['invalid_number','invalid_boolean','invalid_url','invalid_structure','invalid_integer','enum_mismatch','below_minimum','above_maximum','string_too_short','string_too_long','invalid_format','pattern_mismatch','duplicate_items','collection_limit','output_limit'].includes(safeVerification.reason)?'OUTPUT_SCHEMA_INVALID':'OUTPUT_VERIFICATION_FAILED':undefined;
  let message = fallback;
  if (error?.phase === 'managed_browser') message = 'The managed local browser disconnected before verification. Inspect this run; a new request can start a replacement browser. This run was not repeated.';
  else if (error?.phase === 'website_session') message = 'The website needs sign-in or verification. Complete it in the selected Chrome tab, then retry; the tab connection is still available while its link is active.';
  else if (error?.phase === 'account_identity') message = 'Your saved account marker is missing or changed. Open the isolated connection and confirm your account name or email.';
  else if (cause === 'ACTION_UNAVAILABLE' && payload.current_step) message = `Recorded step ${payload.current_step.number} of ${payload.current_step.total} (${payload.current_step.operation}) is unavailable or disabled. Review this step in your recording.`;
  else if (safeVerification) message = {
    invalid_url: `Output ${safeVerification.output} is not a usable HTTP or HTTPS URL. Select the website asset or download link again.`,
    missing_output: `Output ${safeVerification.output} was not found on the selected page. Confirm it is visible, then repair the output selection.`,
    still_streaming: `Output ${safeVerification.output} was still generating when verification ended.`,
    not_fresh: `Output ${safeVerification.output} did not produce a fresh result for this run.`,
    not_settled: `Output ${safeVerification.output} did not settle before verification ended.`,
    input_mismatch: `Output ${safeVerification.output} did not exactly match input ${safeVerification.input}.`,
    invalid_number: `Output ${safeVerification.output} does not match its declared number type or numeric check.`,
    invalid_boolean: `Output ${safeVerification.output} must be exactly true or false. Select an explicit boolean value on the website.`,
    unit_mismatch: `Output ${safeVerification.output} does not use the required unit.`,
    invalid_structure: `Output ${safeVerification.output} does not match its declared structure. Repair its field mappings.`,
    collection_limit: `Output ${safeVerification.output} does not meet its declared list limits. Narrow the selector or update the limits.`,
    output_limit: `Output ${safeVerification.output} exceeds the supported extraction size. Narrow the selection.`,
    context_mismatch: `Output ${safeVerification.output} does not contain the expected context or unit.`
  }[safeVerification.reason]??`Output ${safeVerification.output} did not pass its declared verification check.`;
  if (uncertain || payload.submission_may_have_occurred) message += ' A website submission may have occurred; inspect the website before retrying. Hermo did not repeat it.';
  return {code, category: uncertain ? 'EXECUTION_OUTCOME_UNKNOWN' : category, cause_code: cause,
    ...detail_code?{detail_code}:{},
    message, outcome: uncertain ? 'unknown' : 'unverified', requires_human: true,
    retry_safe: !payload.submission_may_have_occurred,
    ...payload.steps?.some(step=>['running','awaiting_approval'].includes(step.status)) ? {step: payload.steps.find(step=>['running','awaiting_approval'].includes(step.status)).number} : {},
    ...safeVerification ? {verification: safeVerification} : {}};
}

export function recoverInterruptedRuns(store) {
  const {db,unseal,audit}=store;
  for (const row of db.prepare("SELECT * FROM runs WHERE status IN ('running','verifying')").all()) {
    const payload = unseal(row.payload);
    finishRun(payload, 'failed', row.created_at, runError(Error('INTERRUPTED'), payload));
    if(persistRun(store,row.id,'failed',payload,['running','verifying']))audit('run.interrupted', row.id);
  }
}
