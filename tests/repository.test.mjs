import test from 'node:test';
import assert from 'node:assert/strict';
import {repositoryIssues} from '../scripts/check-repository.mjs';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

test('repository rules preserve maintained guides, legal notices, source and fixtures',()=>{
  assert.deepEqual(repositoryIssues(['README.md','CONTRIBUTING.md','SECURITY.md','THIRD-PARTY-NOTICES.md','LICENSE','licenses/react-bits.md','docs/architecture.md','.github/ISSUE_TEMPLATE/bug_report.md','tests/fixtures/README.md','tests/fixtures/preview.webm','server/verification.mjs','validation-apps/README.md']),[]);
});

test('repository rules reject temporary root documents while allowing operating guides in docs',()=>{
  assert.deepEqual(repositoryIssues(['NOTES.md','NEXT-RELEASE-PLAN.md','docs/installation.md']).map(issue=>issue.path),['NOTES.md','NEXT-RELEASE-PLAN.md']);
});

test('repository rules reject tracked local state and generated output at any depth',()=>{
  for(const path of ['.hermo/state.sqlite','work/session.json','dist/index.html','companion/node_modules/package/index.js','.agents/skills/example/SKILL.md','docs/archive/README.md','docs/validation/run.json','validation/results.json','screenshots/page.png']){
    assert.equal(repositoryIssues([path]).length,1,path);
  }
});

test('repository rules detect nested milestone reports and Windows path separators',()=>{
  const paths=['docs/RELEASE-VALIDATION.md','docs/debug/NETWORK-CHECK.json','docs\\validation\\result.json','work\\capture.png'];
  assert.equal(repositoryIssues(paths).length,paths.length);
});

test('product documentation keeps development-tool setup links separate from operating guides',()=>{
  const text='[Setup](https://github.com/example/interface-skills/tree/main)';
  assert.equal(repositoryIssues(['README.md'],()=>text).length,1);
  assert.equal(repositoryIssues(['docs/installation.md'],()=>text).length,1);
  assert.deepEqual(repositoryIssues(['THIRD-PARTY-NOTICES.md'],()=>text),[]);
  assert.deepEqual(repositoryIssues(['README.md'],()=> '[React](https://github.com/facebook/react)'),[]);
});

test('repository check permits ignored local output but rejects it when force-tracked',()=>{
  mkdirSync('work',{recursive:true});
  const directory=mkdtempSync(resolve('work/repository-'));
  const git=(...args)=>execFileSync('git',args,{cwd:directory,stdio:'pipe',windowsHide:true});
  git('init','--quiet');
  writeFileSync(join(directory,'README.md'),'# Test repository\n');
  writeFileSync(join(directory,'.gitignore'),'work/\n');
  mkdirSync(join(directory,'work'));
  writeFileSync(join(directory,'work','result.json'),'{}');
  git('add','README.md','.gitignore');
  const run=()=>spawnSync(process.execPath,[resolve('scripts/check-repository.mjs')],{cwd:directory,encoding:'utf8',windowsHide:true});
  assert.equal(run().status,0);
  git('add','--force','work/result.json');
  const rejected=run();
  assert.equal(rejected.status,1);
  assert.match(rejected.stderr,/work\/result\.json/);
});
