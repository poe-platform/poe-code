import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {candidate,directory,node24,npm,sha} from './common.mjs';
import {capture,createTreeGuard,requireBuildDelta} from './inventory.mjs';

export function createBuildAudit(source,temporary){
  const root=join(temporary,'production-build-audit');mkdirSync(root);
  const preload=join(temporary,'harness/build-audit.mjs'),bytes=readFileSync(join(directory,'build-audit.mjs'));
  writeFileSync(preload,bytes,{flag:'wx'});
  const nonce=randomUUID();
  const audit={root,source:realpathSync(source),preload,preloadSha256:sha(bytes),nonce,
    environment:{UNIFIED76_BUILD_AUDIT:root,UNIFIED76_BUILD_SOURCE:realpathSync(source),UNIFIED76_BUILD_NONCE:nonce}};
  return audit;
}
export function readBuildAudit(audit,maximum=1){
  assert.equal(sha(readFileSync(audit.preload)),audit.preloadSha256,'build audit preload changed');
  const names=readdirSync(audit.root).sort();assert.ok(names.length<=maximum,'unexpected duplicate driver production build');
  return names.map(name=>{
    assert.match(name,/^\d+-[a-f0-9-]+\.json$/u);
    const file=join(audit.root,name),stat=lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<16384);
    const entry=JSON.parse(readFileSync(file));assert.equal(entry.nonce,audit.nonce);
    assert.equal(entry.executable,realpathSync(node24));assert.equal(entry.compiler,join(audit.source,'node_modules/typescript/bin/tsc'));
    assert.equal(entry.project,join(audit.source,'tsconfig.build.json'));assert.ok(Number.isSafeInteger(entry.pid)&&entry.pid>0);
    return entry;
  });
}
export async function runBuildTypes({phase,source,output,report,beforeAuthorizedBuild,tracked,freezeSource,audit}){
  assert.equal(readBuildAudit(audit).length,0,'review/build phases require cold audit');
  const cold=await phase('cold-typecheck',[npm,'run','typecheck','--','--report',join(output,'cold-types')],source,78);
  assert.equal(cold.status,78);assert.equal(readBuildAudit(audit).length,0,'cold prerequisite must not build');
  const current=await phase('typecheck-all',[npm,'run','typecheck:all','--','--report',join(output,'typecheck-all')]);
  const typing=JSON.parse(readFileSync(join(output,'typecheck-all/report.json')));
  report.typing={builds:typing.builds,status:typing.status,processStatus:current.status};
  assert.equal(typing.builds,1);assert.equal(typing.phases.filter(entry=>entry.label==='build').length,1);
  assert.equal(typing.phases.find(entry=>entry.label==='build')?.status,0,'failed build prohibits stale package fallback');
  const events=readBuildAudit(audit);assert.equal(events.length,1,'exactly one actual compiler production-build invocation required');
  assert.equal(typing.cleaned,true,'typing-owned temporary resources must be removed');
  assert.equal(typing.runtimeExecutions,0,'typing phase must not execute consumer runtime programs');
  const {createBuiltPackageBinding}=await import(pathToFileURL(join(source,'scripts/typecheck-consumers.mjs')));
  const actualBinding=createBuiltPackageBinding(source);
  assert.deepEqual(typing.candidateBinding,{metadataSha256:actualBinding.metadataSha256,declarations:[...actualBinding.declarations].map(([path,sha256])=>({path,sha256}))},'typing must reuse the actual single-build declaration set');
  await tracked();requireBuildDelta(beforeAuthorizedBuild,await capture(source));
  const sourceGuard=await createTreeGuard(source);freezeSource(sourceGuard);
  report.afterAuthorizedSetup=sourceGuard.before();report.driverProductionBuilds=events.length;
  const {manifest}=await import(pathToFileURL(join(source,'tests/plugins/stream-five-public/harness.mjs')));
  const approvedBuild={candidate:candidate.candidate,productionBuilds:events.length,buildStatus:typing.phases.find(row=>row.label==='build').status,files:manifest(source,'dist')};
  report.buildReceipt=approvedBuild;report.actualProductionBuilds=events;
  return approvedBuild;
}
