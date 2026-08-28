import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {candidate,repository,directory,node24,npm,sha,save,blob,copyDependencies} from './common.mjs';
import {readProfile} from './profile.mjs';
import {verifyDriverSeal} from './admission.mjs';
import {verifyExternal} from './external-admission.mjs';
import {extractCommitted,cleanGitEnvironment} from './transport.mjs';
import {capture,createTreeGuard,verifyArchive} from './inventory.mjs';
import {createBuildAudit,runBuildTypes,readBuildAudit} from './build-types.mjs';
import {createPhaseRunner} from './phase-runner.mjs';
import {BOUNDS,PRODUCT} from './policy.mjs';
import {superviseFencedWorker} from './fenced-supervisor.mjs';
import {createToolPath,verifyToolPath} from './tool-routing.mjs';

export function parseReviewArgs(args){
  assert.equal(args.length,4,'explicit candidate and --review-build-types/output required');
  assert.equal(args[0],'--candidate');assert.equal(args[1],PRODUCT);
  assert.equal(args[2],'--review-build-types');
  assert.match(args[3],/^\/tmp\/unified76-build-types-review-[A-Za-z0-9_-]+$/u);
  return{candidate:PRODUCT,output:args[3]};
}
export async function reviewBuildTypes(options,scope){
  assert.equal(options.candidate,PRODUCT);assert.equal(realpathSync(process.execPath),realpathSync(node24));
  const seal=verifyDriverSeal(),profile=readProfile(),external=await verifyExternal();
  assert.ok(scope?.observer&&scope?.supervise,'restricted worker and outer observer required');assert.equal(scope.envelope.output,options.output);
  const output=realpathSync(options.output),temporary=realpathSync(mkdtempSync(join(tmpdir(),'unified76-build-types-'))),source=join(temporary,'source');
  for(const name of ['harness','home','tmp'])mkdirSync(join(temporary,name));
  const report={candidate:PRODUCT,tree:candidate.tree,driverSha256:sha(JSON.stringify(seal)),profileSha256:sha(JSON.stringify(profile)),external,temporary,output,
    startedAt:new Date().toISOString(),phases:[],driverProductionBuilds:0,fullGateLaunched:false,reviewOnly:true,osInstructionFence:scope.envelope,
    excluded:['native semantic gate','SafeJS/private engine','canonical tests','runtime consumer programs','package/public runtime phases'],
    qualification:'Actual shared cold/typecheck-all implementation, guards and receipt only; not a full-gate verdict or independent acceptance'};
  let sourceGuard;
  try{
    report.toolRoutes=createToolPath(temporary);
    const environment=cleanGitEnvironment({PATH:report.toolRoutes.path,HOME:join(temporary,'home'),TMPDIR:join(temporary,'tmp'),TMP:join(temporary,'tmp'),TEMP:join(temporary,'tmp'),
      LANG:'C',LC_ALL:'C',TZ:'UTC',NO_COLOR:'1',TSX_DISABLE_CACHE:'1',npm_config_cache:join(temporary,'npm-cache'),npm_config_userconfig:join(temporary,'npmrc'),npm_config_globalconfig:join(temporary,'global-npmrc'),npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false',npm_config_registry:'http://127.0.0.1:1'});
    environment.GIT_EXEC_PATH=report.toolRoutes.gitCore.origin;verifyToolPath(report.toolRoutes,environment);
    for(const path of [environment.npm_config_userconfig,environment.npm_config_globalconfig])writeFileSync(path,'',{flag:'wx'});
    report.archiveTransport=await extractCommitted({git:'/Applications/Xcode.app/Contents/Developer/usr/bin/git',repository,candidate:PRODUCT,entries:profile.scopeInputs,destination:source,environment,observer:scope.observer});
    report.archive=await verifyArchive(source,profile.scopeInputs,report.archiveTransport);
    const git='/Applications/Xcode.app/Contents/Developer/usr/bin/git';
    execFileSync(git,['init','--quiet','--template=',source],{env:environment,timeout:10000});
    execFileSync(git,['update-index','-z','--index-info'],{cwd:source,env:environment,input:profile.scopeInputs.map(entry=>`${entry.mode} ${entry.blob}\t${entry.path}\0`).join(''),timeout:10000});
    writeFileSync(join(source,'.git/HEAD'),PRODUCT+'\n');
    assert.deepEqual(execFileSync(git,['ls-files','-z'],{cwd:source,env:environment,maxBuffer:8*1024*1024}).toString().split('\0').filter(Boolean).sort(),profile.scopeInputs.map(entry=>entry.path).sort());
    report.indexQualification='Exact candidate path/blob index for typing inventory; no history transport or Git object alternate/source fallback';
    report.dependencyProjection=[copyDependencies(join(source,'node_modules')),copyDependencies(join(source,'benchmarks/node_modules'),join(repository,'benchmarks/node_modules'))];
    const guard=join(temporary,'harness/import-guard.mjs');writeFileSync(guard,blob('tests/integration/full-gate-20260827/combined-8670ebe8/import-guard.mjs'),{flag:'wx'});
    const expected=join(temporary,'harness/critical.json');save(expected,Object.fromEntries(['src/commands/execution.ts','src/commands/env-split.ts'].map(path=>[path,profile.sourceBindings[path]])));
    Object.assign(environment,{FULL_GATE_ROOT:temporary,FULL_GATE_SOURCE:source,FULL_GATE_EXPECTED:expected,FULL_GATE_TOOL_ROOTS:JSON.stringify([realpathSync(join(dirname(npm),'..'))])});
    const beforeAuthorizedBuild=await capture(source);
    const protectedInputs=await Promise.all(['src','tests','scripts','docs','benchmarks','node_modules','.git'].map(async name=>({name,guard:await createTreeGuard(join(source,name))})));
    const audit=createBuildAudit(source,temporary),harnessGuard=await createTreeGuard(join(temporary,'harness'));
    const verify=async()=>{
      verifyDriverSeal();await verifyExternal();
      verifyToolPath(report.toolRoutes,environment);
      if(sourceGuard)assert.deepEqual((await sourceGuard.check()).changes,[]);
      else for(const entry of protectedInputs)assert.deepEqual((await entry.guard.check()).changes,[],entry.name);
    };
    const completed=[],order=['cold-typecheck','typecheck-all'];
    const requireOrdered=(previous,next)=>{assert.deepEqual(previous,order.slice(0,previous.length));assert.equal(next,order[previous.length]);};
    const phase=createPhaseRunner({completed,report,source,output,environment,guard,verify,extraGuards:[harnessGuard],requireOrdered,audit,supervision:scope.supervise});
    report.audit={preloadSha256:audit.preloadSha256,nonce:audit.nonce};
    save(join(output,'SETUP-COMPLETE.json'),{candidate:PRODUCT,reviewOnly:true,archiveFiles:report.archive.count,logicalArchiveFiles:report.archive.logical.count,instructionProjection:report.archive.projection,dependencyProjection:report.dependencyProjection});
    await runBuildTypes({phase,source,output,report,beforeAuthorizedBuild,tracked:async()=>{if(sourceGuard)assert.deepEqual((await sourceGuard.check()).changes,[]);},freezeSource:guard=>{sourceGuard=guard;},audit});
    await verify();assert.deepEqual(completed,order);assert.equal(readBuildAudit(audit).length,1);
    report.guardsPassed=true;report.cleanupComplete=report.phases.every(row=>row.clean&&row.closed&&!row.signals.length&&!row.survivors.length);
    assert.equal(report.cleanupComplete,true);report.status=report.phases.every(row=>row.status===row.expectedStatus)?'REVIEW_ONLY_BUILD_TYPES_PASS':'REVIEW_ONLY_TYPECHECK_RED';
  }catch(error){report.status='REVIEW_ONLY_HOLD';report.error={message:error.message,stack:error.stack};}
  report.finishedAt=new Date().toISOString();report.fullGateLaunched=false;
  save(join(output,'REPORT.json'),report);console.log(JSON.stringify({candidate:PRODUCT,output,temporary,status:report.status,fullGateLaunched:false,builds:report.driverProductionBuilds,error:report.error}));
  return report.status==='REVIEW_ONLY_BUILD_TYPES_PASS'?0:1;
}
export async function reviewMain(args){
  const options=parseReviewArgs(args);verifyDriverSeal();await verifyExternal();
  assert.equal(existsSync(options.output),false);
  const outer=realpathSync(mkdtempSync(join(tmpdir(),'unified76-build-types-outer-')));
  const fence=await superviseFencedWorker({output:options.output,outer,script:join(directory,'review-build-types-worker.mjs'),args,cwd:directory,environment:process.env,phases:['cold-typecheck','typecheck-all'],limits:{
    setupSentinel:join(options.output,'SETUP-COMPLETE.json'),setupTimeoutMs:BOUNDS.setupTimeoutMs,
    timeoutMs:BOUNDS.setupTimeoutMs+2*BOUNDS.phaseTimeoutMs+BOUNDS.cleanupTimeoutMs,
    maxOutputBytes:BOUNDS.phaseOutputBytes,observeSockets:true,
  }});
  const result=fence.result;
  let inner;
  try{inner=JSON.parse(readFileSync(join(options.output,'REPORT.json')));}
  catch(error){inner={status:'REVIEW_ONLY_HOLD',error:{message:error.message}};}
  const success=fence.clean&&result.status===0&&result.clean&&result.closed&&!result.signals.length&&!result.survivors.length
    &&inner.candidate===PRODUCT&&inner.reviewOnly===true&&inner.fullGateLaunched===false
    &&inner.status==='REVIEW_ONLY_BUILD_TYPES_PASS'&&inner.driverProductionBuilds===1&&inner.guardsPassed&&inner.cleanupComplete;
  const receipt={candidate:PRODUCT,outer,result,fence,innerStatus:inner.status,innerError:inner.error,reviewOnly:true,fullGateLaunched:false,status:success?'REVIEW_ONLY_BUILD_TYPES_PASS':'REVIEW_ONLY_HOLD'};
  save(join(outer,'REPORT.json'),receipt);console.log(JSON.stringify({outer,output:options.output,status:receipt.status,candidate:PRODUCT,fullGateLaunched:false}));
  return success?0:result.status===78?78:1;
}
if(import.meta.main){
  try{process.exitCode=await reviewMain(process.argv.slice(2));}
  catch(error){console.error(error.stack);process.exitCode=error.exitCode??78;}
}
