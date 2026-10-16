import {workflowEffect} from './execution-capabilities.mjs';

// Durable execution observations. Never copy browser text, selectors or field values here.
export const activeRunStatuses = ['queued', 'running', 'verifying'];
const stamp = () => new Date().toISOString();
const elapsed = (from, to) => Math.max(0, Date.parse(to) - Date.parse(from));

export function startRun(payload, definition, acceptedAt, at = stamp()) {
  payload.started_at = at;
  payload.queue_duration_ms = elapsed(acceptedAt, at);
  payload.phase = 'running';
  payload.steps = definition.steps.map((step, index) => ({
    number: index + 1, operation: step.op, status: 'pending',
    ...step.parameter ? {input_name: step.parameter} : {},
    ...step.selector ? {locator: {strategy: 'recorded_selector', framed: !!step.frame_path?.length}} : {}
  }));
  return payload;
}

export function observeProgress(payload, definition, index, total, event = {}, at = stamp()) {
  if (event.phase === 'verifying') {
    payload.phase = 'verifying';
    payload.verification_started_at = at;
    payload.progress = 100;
    return;
  }
  const step = payload.steps?.[index];
  if (!step) return;
  payload.current_step = {number: index + 1, total, operation: step.operation};
  if (event.phase === 'completed'||event.phase==='skipped') {
    step.status = event.phase==='skipped'?'skipped':'succeeded';
    step.finished_at = at;
    step.duration_ms = elapsed(step.started_at ?? at, at);
    payload.progress = Math.round((index + 1) / Math.max(total, 1) * 100);
  } else if (event.phase === 'issuing') {
    // On-change handlers can submit data for fill/select/check as well as click.
    if (definition.steps[index]?.enabled!==false&&workflowEffect(definition,payload.execution_mode)==='recorded_browser_actions'&&['click','fill','select','check'].includes(step.operation)) {
      payload.submission_may_have_occurred = true;
    }
  } else {
    step.status = 'running';
    step.started_at = at;
    payload.progress = Math.round(index / Math.max(total, 1) * 100);
  }
}

export function finishRun(payload, status, acceptedAt, error, at = stamp()) {
  payload.phase = status;
  payload.finished_at = at;
  payload.duration_ms = elapsed(acceptedAt, at); // Existing total-duration contract includes queue time.
  if (payload.started_at) payload.execution_ms = elapsed(payload.started_at, at);
  for (const step of payload.steps ?? []) {
    if (step.status === 'running') {
      step.status = status === 'succeeded' ? 'succeeded' : status === 'cancelled' ? 'cancelled' : 'failed';
      step.finished_at = at;
      step.duration_ms = elapsed(step.started_at ?? at, at);
    } else if (step.status === 'pending') step.status = 'skipped';
  }
  if (status !== 'succeeded') {
    delete payload.result;
    delete payload.verification;
    payload.error = error;
    payload.outcome = error?.outcome ?? 'unverified';
  } else {
    delete payload.error;
    payload.outcome = 'verified';
    payload.progress = 100;
  }
  return payload;
}

const errors = {
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
  EXECUTION_FAILED: ['EXECUTION_FAILED', 'The recorded page or output could not be reached. Review the workflow.']
};

export function runError(error, payload = {}) {
  const cause = Object.hasOwn(errors, error?.message) ? error.message : 'EXECUTION_FAILED';
  const [category, fallback] = errors[cause];
  const uncertain = !!payload.submission_may_have_occurred && ['TIMEOUT', 'WORKFLOW_TIMEOUT', 'WORKFLOW_CANCELLED', 'CONNECTION_STOPPED', 'BROWSER_DISCONNECTED', 'TAB_CLOSED', 'POLICY_BLOCKED', 'PERMISSION_REVOKED', 'ACTION_PAUSED', 'INTERRUPTED', 'EXECUTION_OUTCOME_UNKNOWN', 'EXECUTION_FAILED'].includes(cause)||!!payload.submission_may_have_occurred&&cause==='VERIFICATION_FAILED'&&['missing_output','not_fresh','still_streaming','not_settled'].includes(error?.verification?.reason);
  // Retain legacy authentication/verification/element codes for existing consumers.
  const code = uncertain ? 'EXECUTION_OUTCOME_UNKNOWN' : cause === 'TIMEOUT' ? 'WORKFLOW_TIMEOUT' : cause;
  const verification = error?.verification;
  const allowedReasons = new Set(['invalid_url','missing_output','still_streaming','not_fresh','not_settled','input_mismatch','invalid_number','invalid_boolean','unit_mismatch','context_mismatch','invalid_structure','collection_limit','output_limit']);
  const safeVerification = verification && /^[a-z][a-z0-9_]{1,39}$/.test(verification.output ?? '') && allowedReasons.has(verification.reason)
    ? {output: verification.output, reason: verification.reason, .../^[a-z][a-z0-9_]{1,39}$/.test(verification.input ?? '') ? {input: verification.input} : {}} : undefined;
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
  }[safeVerification.reason];
  if (uncertain || payload.submission_may_have_occurred) message += ' A website submission may have occurred; inspect the website before retrying. Hermo did not repeat it.';
  return {code, category: uncertain ? 'EXECUTION_OUTCOME_UNKNOWN' : category, cause_code: cause,
    message, outcome: uncertain ? 'unknown' : 'unverified', requires_human: true,
    retry_safe: !payload.submission_may_have_occurred,
    ...payload.steps?.some(step=>step.status==='running') ? {step: payload.steps.find(step=>step.status==='running').number} : {},
    ...safeVerification ? {verification: safeVerification} : {}};
}

export function recoverInterruptedRuns({db, seal, unseal, audit}) {
  for (const row of db.prepare("SELECT * FROM runs WHERE status IN ('running','verifying')").all()) {
    const payload = unseal(row.payload);
    finishRun(payload, 'failed', row.created_at, runError(Error('INTERRUPTED'), payload));
    db.prepare("UPDATE runs SET status='failed',payload=?,updated_at=? WHERE id=?").run(seal(payload), payload.finished_at, row.id);
    audit('run.interrupted', row.id);
  }
}
