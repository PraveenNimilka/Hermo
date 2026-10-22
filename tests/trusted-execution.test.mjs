import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runTrustedDemos} from '../scripts/verify-trusted-execution.mjs';

test('three actual companion demos verify structured data, approved POSTs, and SDK MCP key scope',{timeout:240000},async()=>{
  const report=await runTrustedDemos({outputDir:resolve('work/trusted-execution-reports',randomUUID())});
  assert.equal(report.status,'passed');assert.equal(report.demos.length,3);assert.ok(report.demos.every(demo=>demo.status==='passed'));
  assert.equal(report.demos[0].record_count,2);assert.equal(report.demos[0].rejected_runs.length,2);assert.equal(report.demos[1].posts_after_rejection,0);
  assert.equal(report.runtime_counts.observed_runs,report.runs.length);assert.ok(report.runtime_counts.by_status.succeeded>0);assert.ok(report.runtime_counts.by_status.failed>=3);
  assert.ok(report.runs.every(run=>run.execution_mode==='connected_chrome'));assert.equal(/hm_live_|hb_session_|hb_pair_/.test(JSON.stringify(report)),false,'Evidence exports never contain API keys or browser transport credentials');
});
