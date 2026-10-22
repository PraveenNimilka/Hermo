// Versioned, input-free execution metadata shared by owner, REST and MCP reads.
// The original status enum remains available for clients that already poll it.
export const executionStatuses = Object.freeze(['queued','preparing','running','awaiting_approval','verifying','succeeded','failed','uncertain','cancelled','timed_out']);
const statuses = new Set(executionStatuses);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const code = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : undefined;

export function executionStatus(payload, legacyStatus) {
  // A terminal storage row wins over a stale in-progress payload.
  if (legacyStatus === 'cancelled') return 'cancelled';
  if (legacyStatus === 'failed') {
    if (payload.outcome === 'unknown' || payload.error?.outcome === 'unknown') return 'uncertain';
    if (['TIMEOUT','WORKFLOW_TIMEOUT'].includes(payload.error?.cause_code ?? payload.error?.code)) return 'timed_out';
    return 'failed';
  }
  if (legacyStatus === 'succeeded') return 'succeeded';
  return statuses.has(payload.phase) && !['succeeded','failed','uncertain','cancelled','timed_out'].includes(payload.phase) ? payload.phase : legacyStatus ?? 'queued';
}

export function assertObservationWindow(payload, proof, finishedAt) {
  const started = Date.parse(payload.started_at), observed = Date.parse(proof?.observed_at), verified = Date.parse(proof?.verified_at), finished = Date.parse(finishedAt);
  if (!Array.isArray(payload.steps) || payload.steps.some(step=>!['succeeded','skipped'].includes(step.status)||!timestamp(step.finished_at))) {
    throw Object.assign(Error('VERIFICATION_FAILED'), {verification:{output:'result',reason:'invalid_evidence'}});
  }
  const lastStep = Math.max(started, ...payload.steps.map(step => Date.parse(step.finished_at)));
  if (![started, observed, verified, finished, lastStep].every(Number.isFinite) || observed < lastStep || verified < observed || finished < verified) {
    throw Object.assign(Error('VERIFICATION_FAILED'), {verification:{output:'result',reason:'invalid_evidence'}});
  }
}

export function executionReceipt(row, payload) {
  let verified = row.status === 'succeeded' && payload.outcome === 'verified' && timestamp(payload.verification?.verified_at) && Array.isArray(payload.verification?.checks) && payload.verification.checks.length > 0 && payload.verification.checks.every(value=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_:. -]{0,159}$/.test(value)) && payload.result !== null && typeof payload.result === 'object' && !Array.isArray(payload.result) && payload.verification.run_id === row.id && typeof payload.workflow_version === 'string' && payload.workflow_version.length > 0 && payload.verification.verifier_version === payload.workflow_version;
  if (verified) { try { assertObservationWindow(payload,payload.verification,payload.finished_at); } catch { verified=false; } }
  const status = executionStatus(payload, row.status);
  const safeCode = code(payload.error?.code), cause = code(payload.error?.cause_code), detail = code(payload.error?.detail_code);
  return {
    schema_version:'hermo.execution.v1', execution_id:row.id, workflow_id:row.workflow_id,
    published_version:{version:payload.workflow_version ?? null, revision:payload.workflow_revision ?? null},
    status:status === 'succeeded' && !verified ? 'uncertain' : status,
    legacy_status:row.status, execution_mode:payload.execution_mode ?? null,
    timing:{accepted_at:row.created_at,started_at:payload.started_at ?? null,finished_at:payload.finished_at ?? null,
      queue_ms:payload.queue_duration_ms ?? null,execution_ms:payload.execution_ms ?? null,total_ms:payload.duration_ms ?? null},
    verification:{status:verified?'passed':status==='succeeded'?'unrecorded':status==='verifying'?'pending':'unverified',
      observed_at:verified ? payload.verification.observed_at ?? null : null,
      verified_at:verified ? payload.verification.verified_at : null,
      checks:verified ? payload.verification.checks.filter(value=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_:. -]{0,159}$/.test(value)) : []},
    ...(verified ? {output:payload.result} : {}),
    diagnostics:{...(safeCode?{code:safeCode}:{}),...(cause?{cause_code:cause}:{}),...(detail?{detail_code:detail}:{}),
      ...(status==='succeeded'&&!verified?{code:'HISTORICAL_EVIDENCE_UNAVAILABLE'}:{}),
      retry_safe:payload.error?.retry_safe === true,requires_human:payload.error?.requires_human === true || status==='uncertain'||status==='succeeded'&&!verified},
    step_outcomes:(payload.steps ?? []).map(step=>({number:step.number,.../^step_[A-Za-z0-9_-]{8,80}$/.test(step.step_id??'')?{step_id:step.step_id}:{},status:step.status,...step.warning==='WAIT_TIMEOUT_CONTINUED'?{warning:step.warning}:{},duration_ms:step.duration_ms ?? null}))
  };
}
