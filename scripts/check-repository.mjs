import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDocuments=new Set(['README.md','CONTRIBUTING.md','SECURITY.md','THIRD-PARTY-NOTICES.md','CHANGELOG.md','CODE_OF_CONDUCT.md','SUPPORT.md','LICENSE.md']);
const localDirectories=new Set(['.agents','.codex','.claude','.cursor','.windsurf','.continue','node_modules','dist','coverage','work','.hermo','validation','screenshots','test-results','playwright-report']);
const maintainedReports=new Set(['docs/testing/verification-report.md']);

export function repositoryIssues(files,readText=()=> ''){
  const issues=[];
  for(const entry of files){
    const path=entry.replaceAll('\\','/'),parts=path.split('/');
    if(parts.some(part=>localDirectories.has(part))||/^docs\/(?:archive|validation)\//i.test(path)){
      issues.push({path,reason:'Local configuration or generated output must remain untracked.'});
    }else if(parts.length===1&&/\.md$/i.test(path)&&!rootDocuments.has(path)){
      issues.push({path,reason:'Keep maintained guides in docs/ and temporary notes outside the tracked tree.'});
    }else if(!maintainedReports.has(path)&&!path.startsWith('.github/')&&/(?:^|\/)[^/]+-(?:VALIDATION|BUGFIXES|REPORT|PLAN|RESEARCH|CHECK)\.(?:md|json)$/i.test(path)){
      issues.push({path,reason:'Keep generated reports and temporary development notes outside the tracked tree.'});
    }
    if((path==='README.md'||path.startsWith('docs/'))&&/\.md$/i.test(path)&&/https?:\/\/github\.com\/[^/\s]+\/(?:skills|[^/\s]+-skills?)(?=[/#?\s)"'>]|$)/i.test(readText(path))){
      issues.push({path,reason:'Keep development-tool setup links separate from product operating guides.'});
    }
  }
  return issues;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const files=execFileSync('git',['ls-files','--cached','-z'],{encoding:'utf8'}).split('\0').filter(path=>path&&existsSync(path));
  const issues=repositoryIssues(files,path=>readFileSync(path,'utf8'));
  if(issues.length){
    for(const {path,reason}of issues)console.error(`${path}: ${reason}`);
    process.exitCode=1;
  }else console.log(`Repository check passed (${files.length} tracked files).`);
}
