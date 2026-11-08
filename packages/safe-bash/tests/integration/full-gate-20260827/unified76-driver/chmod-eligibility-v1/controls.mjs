import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {HISTORICAL_BINDING,ELIGIBILITY_PROFILE,STRICT_PROFILE_SHA256,decodeEligibility,readHistoricalEligibility,validateAuthorityRecord,validateEligibilityProfile,requireEligibilityRelease} from '../launcher-v3/historical-eligibility.mjs';
import {SETUP_STAGES,AUTHORITY_FILES,createPrerequisiteReceipt,prepareOwnedGroup,validateFreshGroup,runPrerequisiteStages} from '../launcher-v3/maintained-prerequisites.mjs';
import {BOUNDS,PHASES,gateVerdict} from '../launcher-v3/policy.mjs';
import {canonicalArguments,requireCanonicalArguments,requireRelease,verifyDriverSeal} from '../launcher-v3/admission.mjs';
import {createPhaseRunner} from '../launcher-v3/phase-runner.mjs';

const launcher=new URL('../launcher-v3/',import.meta.url);
const read=name=>readFileSync(new URL(name,launcher),'utf8');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const policy=JSON.parse(read('ELIGIBILITY.json'));
const eligibility=readHistoricalEligibility();
const strict=JSON.parse(gunzipSync(Buffer.from(read('PROFILE.json.gz.base64').trim(),'base64')));
const profile={...strict,historicalEligibility:eligibility};
const original=JSON.parse(gunzipSync(Buffer.from(policy.captureBase64,'base64')));
const clone=value=>structuredClone(value);
const rejectMutations=(value,mutations,validate)=>{for(const mutate of mutations){const changed=clone(value);mutate(changed);assert.throws(()=>validate(changed),mutate.toString());}};

function fakeGroup(options={}){
  const events=[],directory='/synthetic-owned',root=directory+'/source';
  let group=options.member?20:0;
  const operations={
    uid:()=>501,gid:()=>20,groups:()=>options.noMember?[]:[20],umask:()=>0o22,
    fs:{
      mkdirSync(path,mode){events.push(['mkdir',path,mode]);},
      lstatSync(path){return{uid:options.wrongOwner?502:501,gid:path===directory?0:group,mode:0o40700,isDirectory:()=>!options.file,isSymbolicLink:()=>Boolean(options.symlink)};},
      chownSync(path,uid,gid){events.push(['chown',path,uid,gid]);if(options.throwChown)throw options.throwChown;if(!options.lieChown)group=gid;},
    },
    run(command,args,cwd){events.push(['run',command,args,cwd]);return{command:[command,...args],cwd,status:options.aclFailure?1:0,signal:options.aclSignal?'SIGTERM':null,error:options.aclError?'denied':undefined,stdout:'synthetic ACL',stderr:options.aclStderr?'unexpected':''};},
  };
  return{events,directory,root,operations,run:()=>prepareOwnedGroup({directory,root},operations)};
}

function syntheticSetup(){
  const input={temporary:'/synthetic-owned',environment:{},historicalEligibility:clone(eligibility)};
  const events=[],privateBefore={root:'/synthetic-private',head:'synthetic',status:'',indexSha256:'synthetic'};
  const values={authorities:AUTHORITY_FILES.map(path=>({path,sha256:'synthetic'})),metadata:{issues:[],assets:[]},stageMetadata:[],archive:{issues:[]},group:fakeGroup().run(),bytes:[],privateBefore,privateCopy:{files:[],copiedRoot:'/synthetic-owned/safejs-engine'},privateAfter:clone(privateBefore)};
  const stages=Object.fromEntries(SETUP_STAGES.map(name=>[name,async()=>{events.push(name);return values[name];}]));
  return{input,events,values,stages,receipt:createPrerequisiteReceipt()};
}

function fullReport(){return{
  candidate:HISTORICAL_BINDING.candidate,historicalEligibility:clone(eligibility),bindingComplete:true,guardsPassed:true,driverProductionBuilds:1,cleanupComplete:true,
  phases:PHASES.map(([label,status])=>({label,status,clean:true,closed:true,signals:[],survivors:[],signal:null})),
  canonical:{reconciled:true,counts:{pass:100,fail:0,skipped:0,todo:0,cancelled:0}},canonicalMissingPaths:[],
};}

test('H01 exact historical bytes and complete records',()=>{
  const compressed=Buffer.from(policy.captureBase64,'base64'),decoded=gunzipSync(compressed);
  assert.equal(hash(compressed),HISTORICAL_BINDING.compressedSha256);assert.equal(hash(decoded),HISTORICAL_BINDING.decodedSha256);
  assert.equal(decoded.length,6659);assert.deepEqual(eligibility.original,original);
  assert.deepEqual(eligibility.obligations.map(row=>[row.id,row.status,row.nativeParity,row.observation]),['2755','6755'].map(mode=>[`NA-${mode}`,'UNSUPPORTED_HOST_OPERATION','UNQUALIFIED','HISTORICAL']));
  assert.equal(eligibility.binding.attempt,'55db52a45e583017fba50c02ad64bddce2feb251');
});

test('H02 changed/missing/oversized encoded data refuse',()=>{
  rejectMutations(policy,[row=>row.captureBase64='',row=>row.captureBase64='A'.repeat(32769),row=>row.captureBase64+='!',row=>row.captureBase64=Buffer.from('changed').toString('base64'),row=>delete row.captureBase64],decodeEligibility);
  assert.throws(()=>decodeEligibility(undefined));
  assert.ok(read('historical-eligibility.mjs').includes('maxOutputLength:16384'));
});

test('H03 exact two modes and issue kinds',()=>{
  rejectMutations(original,[row=>row.probes.pop(),row=>row.probes.push(clone(row.probes[0])),row=>row.probes[1].mode='2755',row=>row.probes[0].mode='4755',row=>row.issues.pop(),row=>row.issues.push({kind:'other'}),row=>row.issues[0].kind='other'],validateAuthorityRecord);
});

test('H04 status/signals/errors/bytes and identities cannot be relabeled',()=>{
  rejectMutations(original,[row=>row.probes[0].execution.status=0,row=>row.probes[0].execution.signal='SIGTERM',row=>row.probes[0].execution.error='spawn failure',row=>row.probes[0].execution.stdout='unexpected',row=>row.probes[0].execution.stderr='other denial',row=>row.probes[0].execution.cwd='/other',row=>row.probes[0].execution.command[0]='/other/chmod',row=>row.probes[0].execution.command[1]='755',row=>row.probes[0].execution.command[2]='/other/file',row=>row.probes[0].before.uid=0,row=>row.probes[0].after.mode='2755',row=>row.probes[0].after.directory=true,row=>row.probes[0].before.symlink=true,row=>row.issues[0].after.mode='2755'],validateAuthorityRecord);
});

test('H05 no fresh capability, unknown policy or broad attribution',()=>{
  rejectMutations(policy,[row=>row.profile='strict-green',row=>row.schema=2,row=>row.fresh=true,row=>row.binding.observationDate='2026-08-29',row=>row.binding.candidate='HEAD',row=>row.binding.executableSha256='0'.repeat(64),row=>row.binding.scope='all chmod',row=>row.binding.attempt='other'],decodeEligibility);
  assert.equal(eligibility.freshCapabilityClaim,false);assert.equal(eligibility.admissionProbesRepeated,false);
  assert.equal(eligibility.automaticTestAttribution,false);assert.equal(eligibility.nativeSemanticPassCount,null);
  assert.equal(eligibility.binding.denialOrigin,'UNKNOWN');
});

test('H06 fresh group-only setup preserves strict failures without probes',()=>{
  for(const member of [false,true]){
    const fake=fakeGroup({member}),result=fake.run();assert.equal(result.probesExecuted,0);assert.equal(result.normalized,!member);
    assert.equal(result.TMPDIR,'/synthetic-owned/native-tmp');assert.equal(fake.events.filter(row=>row[0]==='chown').length,member?0:1);
    assert.deepEqual(fake.events.filter(row=>row[0]==='run').map(row=>row[1]),['/bin/ls']);
  }
  for(const option of ['wrongOwner','file','symlink','noMember','lieChown','aclFailure','aclSignal','aclError','aclStderr'])assert.throws(()=>fakeGroup({[option]:true}).run(),option);
  const failure=new Error('synthetic chown failure');assert.throws(()=>fakeGroup({throwChown:failure}).run(),error=>error===failure);
  rejectMutations(fakeGroup().run(),[row=>row.issues=['unknown'],row=>delete row.issues,row=>row.TMPDIR='/old/attempt',row=>row.probesExecuted=2,row=>row.after.path='/alias',row=>row.after.mode='755'],row=>validateFreshGroup(row,'/synthetic-owned'));
});

test('H07 every synthetic mandatory stage runs once in order',async()=>{
  const fixture=syntheticSetup();const receipt=await runPrerequisiteStages(fixture.input,fixture.stages,fixture.receipt);
  assert.equal(receipt,fixture.receipt);assert.deepEqual(fixture.events,SETUP_STAGES);assert.deepEqual(receipt.completedStages,SETUP_STAGES);
  assert.deepEqual(receipt.safejs.after,receipt.safejs.before);assert.equal(fixture.input.environment.SAFEJS_LOCAL_ROOT,'/synthetic-owned/safejs-engine');
  assert.equal(receipt.native.authority,undefined);assert.equal(receipt.native.group.probesExecuted,0);
});

test('H08 each stage error, missing/unknown issues and private drift stay failures',async()=>{
  for(const name of SETUP_STAGES){
    const fixture=syntheticSetup(),failure=new Error('synthetic '+name),index=SETUP_STAGES.indexOf(name);
    fixture.stages[name]=()=>{fixture.events.push(name);throw failure;};
    await assert.rejects(runPrerequisiteStages(fixture.input,fixture.stages,fixture.receipt),error=>error===failure);
    assert.deepEqual(fixture.events,SETUP_STAGES.slice(0,index+1));assert.deepEqual(fixture.receipt.completedStages,SETUP_STAGES.slice(0,index));
    assert.equal(fixture.input.environment.SAFEJS_LOCAL_ROOT,undefined);
  }
  for(const name of ['metadata','archive','group'])for(const issues of [undefined,[{kind:'unknown'}],[{kind:'native-fixture-authority',mode:'2755'}]]){
    const fixture=syntheticSetup();fixture.values[name].issues=issues;
    await assert.rejects(runPrerequisiteStages(fixture.input,fixture.stages,fixture.receipt));
    assert.deepEqual(fixture.events,SETUP_STAGES.slice(0,SETUP_STAGES.indexOf(name)+1));
  }
  const fixture=syntheticSetup();fixture.values.privateAfter.head='drift';await assert.rejects(runPrerequisiteStages(fixture.input,fixture.stages,fixture.receipt),/private state changed/);
  assert.equal(fixture.input.environment.SAFEJS_LOCAL_ROOT,undefined);assert.equal(fixture.receipt.safejs.before.head,'synthetic');
});

test('H09 bad historical input or missing stage causes zero setup callbacks',async()=>{
  for(const change of [fixture=>delete fixture.input.historicalEligibility,fixture=>fixture.input.historicalEligibility.obligations.pop(),fixture=>fixture.input.historicalEligibility.original.probes[0].execution.status=0,fixture=>delete fixture.stages.privateAfter,fixture=>fixture.stages.extra=()=>{}]){
    const fixture=syntheticSetup();change(fixture);await assert.rejects(runPrerequisiteStages(fixture.input,fixture.stages,fixture.receipt));assert.deepEqual(fixture.events,[]);
  }
});

test('H10 exact strict632 profile remains, no eligibility-driven selection',()=>{
  assert.equal(hash(JSON.stringify(strict)),STRICT_PROFILE_SHA256);assert.equal(validateEligibilityProfile(profile),profile);
  assert.equal(strict.canonicalFiles.length,632);assert.equal(strict.classifiedMts.length,192);assert.equal(Object.keys(strict.cleanup.files).length,256);assert.equal(strict.native.length,51);
  rejectMutations(profile,[row=>row.canonicalFiles.pop(),row=>row.canonicalFiles.reverse(),row=>row.testConcurrency=1,row=>row.reporter='spec',row=>row.historicalEligibility.obligations.pop(),row=>row.historicalEligibility.freshCapabilityClaim=true,row=>row.extra='unbound',row=>row.sourceBindings['src/index.ts']='changed'],validateEligibilityProfile);
  const admission=read('admission.mjs');assert.ok(admission.includes('...profile.canonicalFiles'));assert.ok(admission.includes('assert.deepEqual(args,canonicalArguments(profile)'));
  assert.doesNotMatch(admission,/--test-name-(?:pattern|skip-pattern)/u);
  const args=canonicalArguments(profile);requireCanonicalArguments(args,profile);assert.deepEqual(args.slice(5),profile.canonicalFiles);
  assert.throws(()=>requireCanonicalArguments([...args,'--test-name-pattern=green'],profile));
});

test('H11 all synthetic runtime outcomes pass but aggregate must remain nonzero',()=>{
  const report=fullReport(),before=JSON.stringify(report),verdict=gateVerdict(report);
  assert.equal(verdict.exitCode,1);assert.equal(verdict.status,'QUALIFIED_DIAGNOSTIC_UNQUALIFIED_NATIVE');assert.equal(verdict.runtimeQualified,true);
  assert.equal(verdict.historicalObligations.length,2);assert.equal(verdict.problems.length,2);assert.equal(JSON.stringify(report),before);
  assert.deepEqual(PHASES.map(row=>row[1]),[0,78,0,0,0,0,0,0,0,0,2,1,1,0]);
  const partial=fullReport();partial.phases=[];assert.ok(gateVerdict(partial).phaseOutcomes.every(row=>row.execution==='NOT_EXECUTED'&&row.actualStatus===null));
});

test('H12 raw failures, skips and lifecycle/integrity errors cannot turn green',async context=>{
  for(const change of [row=>row.canonical.counts.fail=1,row=>row.canonical.counts.skipped=1,row=>row.canonical.counts.todo=1,row=>row.canonical.counts.cancelled=1,row=>row.canonicalMissingPaths=['a'],row=>row.phases.reverse(),row=>row.phases[5].status=1,row=>row.phases[5].signals=['SIGTERM'],row=>row.phases[5].survivors=[1],row=>row.phases[5].spawnError='unknown',row=>row.bindingComplete=false,row=>row.guardsPassed=false,row=>row.driverProductionBuilds=2,row=>row.cleanupComplete=false,row=>row.phases.pop(),row=>delete row.historicalEligibility]){
    const report=fullReport();change(report);const before=JSON.stringify(report),verdict=gateVerdict(report);
    assert.equal(verdict.exitCode,1);assert.equal(verdict.status,'HOLD_OR_QUALIFIED_RED');assert.equal(JSON.stringify(report),before);
  }
  const temporary=mkdtempSync(join(tmpdir(),'eligibility-synthetic-phases-'));context.after(()=>rmSync(temporary,{recursive:true,force:true}));
  const auditRoot=join(temporary,'audit');mkdirSync(auditRoot);const preload=join(temporary,'preload.mjs');writeFileSync(preload,'');
  const completed=[],report={phases:[]},audit={root:auditRoot,preload,preloadSha256:hash(''),environment:{}};
  const phase=createPhaseRunner({completed,report,source:temporary,output:temporary,environment:{},guard:preload,audit,verify:async()=>{},requireOrdered:(seen,next)=>assert.equal(next,PHASES[seen.length][0]),supervision:async(_executable,args)=>({status:args[0]==='synthetic-failure'?1:78,outputBytes:0,clean:true,closed:true,signals:[],survivors:[],observed:[]})});
  const failed=await phase('safejs-availability',['synthetic-failure']);assert.equal(failed.status,1);
  const independent=await phase('cold-typecheck',['synthetic-expected-negative'],temporary,78);assert.equal(independent.status,78);
  assert.deepEqual(completed,['safejs-availability','cold-typecheck']);assert.deepEqual(report.phases.map(row=>row.status),[1,78]);
});

test('H13 shipping uses maintained orchestration and preserves outer private scopes',()=>{
  const execute=read('execute.mjs'),maintained=read('maintained-prerequisites.mjs'),runner=read('run.mjs');
  assert.ok(execute.includes("helperRoute.run('prerequisites',()=>maintainedPrerequisites("));
  assert.ok(execute.includes("helperRoute.run('private-final-sweep',()=>privateModule.privateState())"));
  assert.ok(execute.includes("helperRoute.run('private-finally',()=>privateModule.privateState())"));
  assert.ok(execute.includes('report.prerequisites?.safejs?.before'));assert.ok(maintained.includes('progress.files=files'));
  assert.ok(execute.includes('report.privateGuardError=error.stack'));assert.ok(execute.includes('report.canonical=canonical.accounting;'));
  assert.doesNotMatch(maintained,/fixtureAuthority\(|authority-2755|authority-6755|privateModule\.prerequisites/u);
  assert.ok(execute.includes("assertNoInstructionCopyTree('/Users/kjopek/Workspace/poe-code/packages/safejs'"));
  assert.ok(execute.includes('probeGuardedRuntime('));assert.ok(execute.includes("'--permission'"));
  assert.ok(runner.includes("return result.status===78?78:1"));assert.doesNotMatch(runner,/QUALIFIED_ZERO_SKIP_GATE/u);
});

test('H14 fresh release must explicitly accept historical nonzero policy',()=>{
  const receipt={eligibilityProfile:ELIGIBILITY_PROFILE,historicalEligibilitySha256:hash(JSON.stringify(eligibility)),acceptsUnqualifiedHistoricalNative:true};
  requireEligibilityRelease(receipt,profile);
  rejectMutations(receipt,[row=>delete row.eligibilityProfile,row=>row.eligibilityProfile='old',row=>delete row.historicalEligibilitySha256,row=>row.historicalEligibilitySha256='0'.repeat(64),row=>row.acceptsUnqualifiedHistoricalNative=false],row=>requireEligibilityRelease(row,profile));
  const seal=verifyDriverSeal(),candidate=JSON.parse(read('CANDIDATE.json'));
  const complete={...receipt,action:'ROOT_RELEASE_UNIFIED76',candidate:candidate.candidate,driverSha256:hash(JSON.stringify(seal)),profileSha256:hash(JSON.stringify(profile)),packageSha256:candidate.expectedPackageSha256,public74:true,public75:true,public76:true,independentDriverAccepted:true,authorization:'SYNTHETIC CONTROL ONLY; not a ROOT release',independentEvidence:'SYNTHETIC CONTROL ONLY'};
  requireRelease(complete,seal,profile);
  rejectMutations(complete,[row=>row.driverSha256='old',row=>row.profileSha256=STRICT_PROFILE_SHA256,row=>row.packageSha256='wrong',row=>row.public76=false,row=>row.candidate='HEAD',row=>row.authorization='',row=>delete row.acceptsUnqualifiedHistoricalNative],row=>requireRelease(row,seal,profile));
  assert.ok(read('admission.mjs').includes('requireEligibilityRelease(receipt,profile)'));
});

test('H15 frozen helper/guards and exact shipping closure remain bound',()=>{
  const baseline=JSON.parse(readFileSync(new URL('./BASELINE.json',import.meta.url))),seal=JSON.parse(read('DRIVER.json'));
  const changed=['admission.mjs','execute.mjs','policy.mjs','profile.mjs','run.mjs'];
  for(const [file,expected]of Object.entries(baseline.files))if(!changed.includes(file))assert.equal(hash(readFileSync(new URL(file,launcher))),expected,file);
  for(const [file,expected]of Object.entries(seal.files))assert.equal(hash(readFileSync(new URL(file,launcher))),expected,file);
  assert.deepEqual(Object.keys(seal.files).sort(),[...Object.keys(baseline.files),'ELIGIBILITY.json','historical-eligibility.mjs','maintained-prerequisites.mjs'].sort());
  assert.equal(seal.profileSha256,hash(JSON.stringify(profile)));assert.equal(seal.candidate,HISTORICAL_BINDING.candidate);
  const admission=read('admission.mjs');assert.ok(admission.includes("runtimeFiles.push('historical-eligibility.mjs','ELIGIBILITY.json','maintained-prerequisites.mjs')"));
  assert.equal(BOUNDS.setupTimeoutMs,600000);assert.equal(BOUNDS.phaseTimeoutMs,1800000);assert.equal(BOUNDS.cleanupTimeoutMs,5000);
  const repository=new URL('../../../../../',launcher);
  for(const [file,expected]of Object.entries(baseline.frozenHelpers))assert.equal(hash(readFileSync(new URL(file,repository))),expected,file);
  for(const snippet of ["canonical.verifySetup({primary})","archives.archiveSetup(join(repository,archives.tarRelative),repository)","assert.equal(sha(readFileSync(origin)),identity.sha256","assert.equal(version.status,0)","assert.equal(stat.isSymbolicLink(),false","assert.equal(sha(readFileSync(target)),sha(bytes))"]){assert.ok(read('maintained-prerequisites.mjs').includes(snippet),snippet);}
});
