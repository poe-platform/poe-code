import assert from 'node:assert/strict';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {cpSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {candidate,directory,repository,copyDependencies,blob,sha,save,node24,npm,git,copySelection} from './common.mjs';
import {readProfile} from './profile.mjs';
import {admission,requireRelease,verifyDriverSeal,requireOrdered,canonicalArguments,requireCanonicalArguments} from './admission.mjs';
import {capture,createTreeGuard,requireBuildDelta,verifyArchive} from './inventory.mjs';

import {BOUNDS,gateVerdict,enforceCharge} from './policy.mjs';
import {extractCommitted,transferHistory,cleanGitEnvironment} from './transport.mjs';
import {verifyExternal,externalReceipt} from './external-admission.mjs';
import {createToolPath,verifyToolPath,createInheritedHelperRoute} from './tool-routing.mjs';
import {fileIdentity} from './external.mjs';
import {renderBuiltConsumerRunner,renderConsumerEntry} from './built-consumers.mjs';
import {accountFile} from './tap.mjs';
import {supervise} from './supervise.mjs';
import {verifyConsumerSelection} from './consumer-admission.mjs';
import {createBuildAudit,runBuildTypes,readBuildAudit} from './build-types.mjs';
import {createPhaseRunner} from './phase-runner.mjs';
import {assertNoInstructionCopyTree} from './projection.mjs';
import {createPrerequisiteReceipt,prerequisites as maintainedPrerequisites} from './maintained-prerequisites.mjs';

export function benchmarkTypeInvocation(source){
  const records=externalReceipt().report.directories.main.entries;
  const bindings=[];
  for(const path of ['typescript/package.json','typescript/bin/tsc','typescript/lib/tsc.js','typescript/lib/_tsc.js']){
    const expected=records.find(entry=>entry.path===path&&entry.kind==='file');
    assert.ok(expected,'benchmark compiler lacks admitted root dependency: '+path);
    const file=join(source,'node_modules',path),stat=lstatSync(file);
    assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(realpathSync(file),file);
    assert.equal(stat.size,expected.bytes);assert.ok(stat.size<=8*1024*1024);
    assert.equal(stat.mode&0o777,expected.mode);assert.equal(sha(readFileSync(file)),expected.sha256);
    bindings.push({path:file,sha256:expected.sha256});
  }
  assert.equal(JSON.parse(readFileSync(join(source,'node_modules/typescript/package.json'))).version,'5.9.3');
  return{args:[join(source,'node_modules/typescript/bin/tsc'),'--noEmit','-p','tsconfig.json'],cwd:join(source,'benchmarks'),bindings};
}

export async function execute(options,scope){
let output,report,temporary,source,privateModule,sourceGuard,helperRoute,exitCode=0,totalOutput=0;
const completed=[];
const readEvidenceText=path=>{const stat=lstatSync(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=8*1024*1024,'bounded secondary diagnostic/trace input');return readFileSync(path,'utf8');};

try{
  const external=await verifyExternal();
  const seal=verifyDriverSeal(),profile=readProfile();
  const preflight=await admission(profile);console.log(JSON.stringify({candidate:candidate.candidate,driverSha256:sha(JSON.stringify(seal)),profileSha256:sha(JSON.stringify(profile)),preflight}));
  if(preflight.issues.length)throw Object.assign(new Error('mandatory prerequisite refused before suite'),{exitCode:78});
  if(!options.execute)return 0;
  requireRelease(JSON.parse(readFileSync(options.release)),seal,profile);
  assert.ok(scope?.observer&&scope?.supervise,'restricted worker and outer observer required');assert.equal(scope.envelope.output,options.output);
  output=options.output;
  temporary=realpathSync(mkdtempSync(join(tmpdir(),'unified76-execution-')));source=join(temporary,'source');
  for(const name of ['source','harness','home','tmp','native','consumer'])mkdirSync(join(temporary,name));
  report={startedAt:new Date().toISOString(),candidate:candidate.candidate,tree:candidate.tree,sourceTree:candidate.sourceTree,driverSha256:sha(JSON.stringify(seal)),profileSha256:sha(JSON.stringify(profile)),preflight,external,temporary,output,phases:[],driverProductionBuilds:0,bindingComplete:false,guardsPassed:false,cleanupComplete:false,fullGateLaunched:false,scope:'new unified76 profile; not rescore or continuation of historical gates'};
  report.historicalEligibility=profile.historicalEligibility;
  report.scope='prospective historical-file-authority profile; native parity remains UNQUALIFIED; fixed632 canonical inputs unchanged; no old gate rescore';
  report.osInstructionFence=scope.envelope;save(join(output,'ADMISSION.json'),report);
  const support=join(temporary,'support');mkdirSync(support);
  const supportInputs=copySelection(support,Object.keys(profile.support));for(const entry of supportInputs)assert.equal(entry.sha256,profile.support[entry.path]);
  const supportModule=path=>import(pathToFileURL(join(support,'tests/integration/full-gate-20260827',path)));
  const {stageNative,verifyNativeStaging}=await supportModule('preflight-repair/preflight.mjs');
  const {probeGuardedRuntime}=await supportModule('runtime-profile-20260827/profile.mjs');
  privateModule=await supportModule('combined-8670ebe8/prerequisites.mjs');
  report.toolRoutes=createToolPath(temporary);
  const environment={PATH:`${join(temporary,'native')}:${report.toolRoutes.path}`,HOME:join(temporary,'home'),TMPDIR:join(temporary,'tmp'),TMP:join(temporary,'tmp'),TEMP:join(temporary,'tmp'),LANG:'C',LC_ALL:'C',TZ:'UTC',NO_COLOR:'1',GIT_OPTIONAL_LOCKS:'0',TSX_DISABLE_CACHE:'1',RIPGREP_CONFIG_PATH:'',npm_config_cache:join(temporary,'npm-cache'),npm_config_userconfig:join(temporary,'npmrc'),npm_config_globalconfig:join(temporary,'global-npmrc'),npm_config_registry:'http://127.0.0.1:1',npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false'};
  writeFileSync(environment.npm_config_userconfig,'');writeFileSync(environment.npm_config_globalconfig,'');
  Object.assign(environment,cleanGitEnvironment(environment));
  environment.GIT_EXEC_PATH=report.toolRoutes.gitCore.origin;verifyToolPath(report.toolRoutes,environment,join(temporary,'native'));
  report.archiveTransport=await extractCommitted({git:'/Applications/Xcode.app/Contents/Developer/usr/bin/git',repository,candidate:candidate.candidate,entries:profile.scopeInputs,destination:source,environment,observer:scope.observer});
  report.archive=await verifyArchive(source,profile.scopeInputs,report.archiveTransport);assert.equal(report.archive.logical.count,profile.scopeInputs.length);
  const consumerSelection=await verifyConsumerSelection(source,profile);report.consumerInventory={counts:consumerSelection.counts,selectedTests:consumerSelection.tests.length,qualification:consumerSelection.qualification};
  execFileSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git',['init','--quiet','--template=',source],{env:environment,timeout:10000,maxBuffer:BOUNDS.setupStderrBytes});
  report.historyTransport=await transferHistory({git:'/Applications/Xcode.app/Contents/Developer/usr/bin/git',repository,candidate:candidate.candidate,destination:source,environment,observer:scope.observer});
  writeFileSync(join(source,'.git/HEAD'),candidate.candidate+'\n');execFileSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git',['read-tree',candidate.candidate],{cwd:source,env:environment,timeout:10000,maxBuffer:BOUNDS.setupStderrBytes});
  assert.equal(execFileSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git',['rev-parse','HEAD'],{cwd:source,env:environment,encoding:'utf8',timeout:10000,maxBuffer:BOUNDS.setupStderrBytes}).trim(),candidate.candidate);
  assert.equal(existsSync(join(source,'.git/objects/info/alternates')),false);
  report.dependencyProjection=[copyDependencies(join(source,'node_modules')),copyDependencies(join(source,'benchmarks/node_modules'),join(repository,'benchmarks/node_modules'))];
  for(const prefix of ['', 'benchmarks']){
    const lock=JSON.parse(readFileSync(join(source,prefix,'package-lock.json')));
    for(const[path,metadata]of Object.entries(lock.packages).filter(([path])=>path)){
      const target=join(source,prefix,path,'package.json');if(!existsSync(target)){assert.equal(metadata.optional,true,`missing dependency ${prefix}/${path}`);continue;}
      assert.equal(JSON.parse(readFileSync(target)).version,metadata.version,`dependency version ${prefix}/${path}`);
    }
  }
  report.nativeStaged=stageNative(preflight,{snapshot:source,nativeRoot:join(temporary,'native'),environment});
  helperRoute=createInheritedHelperRoute(report.toolRoutes,environment,join(temporary,'native'));report.inheritedHelperRoutes=helperRoute.records;
  report.privateCopyAdmission=assertNoInstructionCopyTree('/Users/kjopek/Workspace/poe-code/packages/safejs',['node_modules','.git','dist','.cache','.turbo']);
  report.prerequisites=createPrerequisiteReceipt();
  await helperRoute.run('prerequisites',()=>maintainedPrerequisites({repository,source,temporary,environment,candidate:candidate.candidate,receipt:report.prerequisites,historicalEligibility:profile.historicalEligibility,privateState:()=>privateModule.privateState()}));
  report.privateBefore=report.prerequisites.safejs.before;
  const guard=join(temporary,'harness/import-guard.mjs');writeFileSync(guard,blob('tests/integration/full-gate-20260827/combined-8670ebe8/import-guard.mjs'),{flag:'wx'});
  const critical=Object.fromEntries(['src/commands/execution.ts','src/commands/env-split.ts'].map(path=>[path,profile.sourceBindings[path]]));
  const expected=join(temporary,'harness/critical.json');save(expected,critical);
  const cleanup=join(temporary,'harness/cleanup.json');save(cleanup,profile.cleanup);
  environment.VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED=cleanup;environment.VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT=candidate.candidate;
  Object.assign(environment,{FULL_GATE_ROOT:temporary,FULL_GATE_SOURCE:source,FULL_GATE_EXPECTED:expected,FULL_GATE_TOOL_ROOTS:JSON.stringify([resolve(dirname(npm),'..')])});
  report.runtimeProbe=probeGuardedRuntime({executable:node24,root:temporary,source,harness:join(temporary,'harness'),guard,expectedSource:critical,environment});if(report.runtimeProbe.status!==0)throw Object.assign(new Error('guarded runtime feature admission refused before suites'),{exitCode:78});
  const forbidden=join(source,'src/index.ts'),allowed=join(temporary,'permission-probe');mkdirSync(allowed);writeFileSync(join(allowed,'allowed.txt'),'allowed');
  const permission=['--permission',`--allow-fs-read=${allowed}`,'--allow-worker','--unhandled-rejections=strict','--input-type=module','-e'];
  const positive=spawnSync(node24,[...permission,`import{readFileSync}from'node:fs';if(readFileSync(${JSON.stringify(join(allowed,'allowed.txt'))},'utf8')!=='allowed')throw Error('bad');`],{env:environment,encoding:'utf8',timeout:10000,maxBuffer:BOUNDS.setupStderrBytes});
  const denied=spawnSync(node24,[...permission,`import{readFileSync}from'node:fs';readFileSync(${JSON.stringify(forbidden)});`],{env:environment,encoding:'utf8',timeout:10000,maxBuffer:BOUNDS.setupStderrBytes});
  report.permission={positive:{status:positive.status,stderr:positive.stderr},denied:{status:denied.status,stderr:denied.stderr}};if(positive.status!==0||denied.status!==1||!denied.stderr.includes('ERR_ACCESS_DENIED')||!denied.stderr.includes(forbidden))throw Object.assign(new Error('permission positive and exact denial admission refused before suites'),{exitCode:78});
  const protectedInputs=await Promise.all(['src','tests','scripts','docs','benchmarks','node_modules'].filter(name=>existsSync(join(source,name))).map(async name=>({name,guard:await createTreeGuard(join(source,name))})));
  const beforeAuthorizedBuild=await capture(source);
  const tracked=async()=>{if(sourceGuard)assert.deepEqual((await sourceGuard.check()).changes,[]);};
  report.npmCli={path:npm,sha256:sha(readFileSync(npm))};
  const verify=async()=>{helperRoute.assertIdle();await verifyExternal();verifyToolPath(report.toolRoutes,environment,join(temporary,'native'));if(sourceGuard)assert.deepEqual((await sourceGuard.check()).changes,[],'source additions/removals/content/type/mode changed after setup');else for(const entry of protectedInputs)assert.deepEqual((await entry.guard.check()).changes,[],entry.name);verifyNativeStaging(report.nativeStaged);assert.equal(sha(readFileSync(node24)),preflight.runtime.identity.sha256);assert.equal(sha(readFileSync(npm)),report.npmCli.sha256);assert.equal(sha(readFileSync(cleanup)),sha(JSON.stringify(profile.cleanup,null,2)+'\n'));verifyDriverSeal();};
  const artifactGuard=await createTreeGuard(support);const privateGuard=await createTreeGuard(report.prerequisites.safejs.copiedRoot);
  save(join(output,'SETUP-COMPLETE.json'),{candidate:candidate.candidate,archiveFiles:report.archive.count,logicalArchiveFiles:report.archive.logical.count,instructionProjection:report.archive.projection,dependencyProjection:report.dependencyProjection,external:report.external.sha256});
  const audit=createBuildAudit(source,temporary);
  const phase=createPhaseRunner({completed,report,source,output,environment,guard,verify,extraGuards:[artifactGuard,privateGuard],requireOrdered,audit,supervision:scope.supervise});
  await phase('safejs-availability',['--import','tsx','--input-type=module','-e',"import assert from 'node:assert/strict';import {pathToFileURL}from'node:url';const {run}=await import(pathToFileURL(process.env.SAFEJS_LOCAL_ROOT+'/src/run.ts'));const result=await run('1+2');assert.equal(result.ok,true);console.log(JSON.stringify(result));"]);
  const approvedBuild=await runBuildTypes({phase,source,output,report,beforeAuthorizedBuild,tracked,freezeSource:guard=>{sourceGuard=guard;},audit});
  const transformed=renderBuiltConsumerRunner(blob('scripts/verify-current-consumers.mjs').toString(),sha(blob('scripts/verify-current-consumers.mjs')),source);
  const externalRunner=join(temporary,'harness/current-consumers.mjs');writeFileSync(externalRunner,transformed.source,{flag:'wx'});
  const consumerDirectory=join(temporary,'current-consumers');mkdirSync(consumerDirectory);
  const consumerInput=join(temporary,'harness/current-consumers-input.json');
  save(consumerInput,{root:source,directory:consumerDirectory,sourceCommit:candidate.candidate,approvedBuild,steps:[],inventory:consumerSelection.inventory,tests:consumerSelection.tests.map(row=>({path:row.path,sha256:report.archive.files[row.path].sha256}))});
  const consumerDriver=join(temporary,'harness/current-consumers-entry.mjs');
  writeFileSync(consumerDriver,renderConsumerEntry(externalRunner,consumerInput,join(consumerDirectory,'REPORT.json')),{flag:'wx'});
  report.externalConsumerBinding={...transformed,source:undefined,entrySha256:sha(readFileSync(consumerDriver)),inputSha256:sha(readFileSync(consumerInput)),driverManagedBuilds:1};
  const consumerHarnessGuard=await createTreeGuard(join(temporary,'harness'));
  const benchmark=benchmarkTypeInvocation(source);report.benchmarkCompiler=benchmark.bindings;
  await phase('benchmark-types',benchmark.args,benchmark.cwd);
  await phase('env-source-binding',['--import','tsx','--input-type=module','-e',"await import('./src/commands/execution.ts');await import('./src/commands/env-split.ts');console.log('candidate env source loaded')"]);
  const args=canonicalArguments(profile);requireCanonicalArguments(args,profile);report.fullGateLaunched=true;const canonical=await phase('canonical',args,source,0,3600000);
  report.canonical=canonical.accounting;
  const canonicalLogs=join(output,'imports/canonical');
  const loaded=new Set(readdirSync(canonicalLogs).flatMap(name=>readEvidenceText(join(canonicalLogs,name)).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line).relative)));
  report.canonicalCoverage={expected:profile.canonicalFiles.length,observed:profile.canonicalFiles.filter(path=>loaded.has(path)),missing:profile.canonicalFiles.filter(path=>!loaded.has(path)),qualification:'resolved main-thread module paths observed by outer hook; not an invented worker-thread transitive trace'};
  assert.deepEqual((await consumerHarnessGuard.check()).changes,[]);
  assert.deepEqual(manifest(source,'dist'),approvedBuild.files);
  const consumerResult=await phase('current-consumers',[consumerDriver],source,0,900000);
  assert.deepEqual((await consumerHarnessGuard.check()).changes,[]);
  const consumerReport=JSON.parse(readFileSync(join(consumerDirectory,'REPORT.json')));assert.equal(consumerReport.productionBuildsInThisPhase,0);assert.ok(!consumerReport.steps.some(row=>row.label==='current-consumers-build'));report.currentConsumerReport=consumerReport;
  report.currentConsumerQualification='Versioned external verifier reuses one authenticated production build; exact candidate current consumer bodies, strict/TAP counts and permissions remain unchanged. Nested test-owned isolated builds are not driver builds. Explicit nested environments retain their own authenticated fences.';
  const pack=join(temporary,'pack');mkdirSync(pack);const packed=await phase('pack',[npm,'pack','--ignore-scripts','--json','--pack-destination',pack]);assert.equal(packed.status,0);
  const tarball=join(pack,'virtual-bash-0.0.0.tgz');report.packageSha256=(await fileIdentity(tarball)).sha256;assert.equal(report.packageSha256,candidate.expectedPackageSha256);
  const consumer=join(temporary,'consumer'),installed=join(consumer,'node_modules/virtual-bash');mkdirSync(installed,{recursive:true});execFileSync('/usr/bin/tar',['-xf',tarball,'--strip-components=1','-C',installed],{env:environment,timeout:60000,maxBuffer:BOUNDS.setupStderrBytes});
  writeFileSync(join(consumer,'package.json'),JSON.stringify({name:'unified76-public',private:true,type:'module'}));
  for(const[name,target]of [['public.mjs','public.mjs'],['consumer.mts.fixture','consumer.mts'],['negative.mts.fixture','negative.mts']])writeFileSync(join(consumer,target),readFileSync(join(directory,name)));
  const moved=join(temporary,'moved package');renameSync(consumer,moved);const packageRoot=join(moved,'node_modules/virtual-bash'),packageGuard=await createTreeGuard(packageRoot);
  const publicResult=await phase('public-runtime',['--permission',`--allow-fs-read=${moved}`,'--allow-worker','--unhandled-rejections=strict','public.mjs'],moved);assert.equal(publicResult.status,0);
  const compiler=join(source,'node_modules/typescript/bin/tsc'),typeArgs=['--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--types','node','--typeRoots',join(source,'node_modules/@types'),'--traceResolution'];
  const positiveTypes=await phase('public-types',[compiler,...typeArgs,'consumer.mts'],moved);assert.equal(positiveTypes.status,0);
  const negativeTypes=await phase('negative-types',[compiler,...typeArgs,'negative.mts'],moved,2);assert.equal(negativeTypes.status,2);
  const negativeText=readEvidenceText(join(output,'negative-types.stdout'));assert.deepEqual([...negativeText.matchAll(/error (TS\d+):/gu)].map(match=>match[1]),['TS2305','TS2353','TS2353']);
  const bindingModule=await import(pathToFileURL(join(source,'scripts/typecheck-consumers.mjs')));const binding=bindingModule.createBuiltPackageBinding(source);
  for(const label of ['public-types','negative-types'])bindingModule.assertBuiltConsumerResolution(readEvidenceText(join(output,label+'.stdout')),moved,source,binding);
  for(const[label,specifier,file]of [['missing-root','virtual-bash','dist/index.js'],['missing-contracts','virtual-bash/contracts','dist/contracts/index.js']]){
    const missing=join(temporary,label);mkdirSync(missing);cpSync(packageRoot,join(missing,'node_modules/virtual-bash'),{recursive:true});rmSync(join(missing,'node_modules/virtual-bash',file));
    const result=await phase(label,['--input-type=module','-e',`await import(${JSON.stringify(specifier)});`],missing,1);assert.equal(result.status,1);assert.match(readEvidenceText(join(output,label+'.stderr')),/ERR_MODULE_NOT_FOUND/u);
  }
  assert.equal(readBuildAudit(audit).length,1,'complete gate must reuse the single production build');
  requireOrdered(completed,'final-sweep');await verify();await tracked();assert.deepEqual((await packageGuard.check()).changes,[]);assert.equal((await fileIdentity(tarball)).sha256,report.packageSha256);assert.deepEqual(await helperRoute.run('private-final-sweep',()=>privateModule.privateState()),report.privateBefore);report.phases.push({label:'final-sweep',status:0,expectedStatus:0});completed.push('final-sweep');
  report.canonical=canonical.accounting;report.canonicalMissingPaths=report.canonicalCoverage.missing;report.currentConsumerStatus=consumerResult.status;report.bindingComplete=true;report.guardsPassed=true;report.cleanupComplete=report.phases.every(row=>row.label==='final-sweep'||row.clean&&row.closed&&!row.signals.length&&!row.survivors.length);
}catch(error){if(!report)report={candidate:candidate.candidate,fullGateLaunched:false};report.status='infrastructure-refused-or-failed';report.error={message:error.message,stack:error.stack};exitCode=error.exitCode===78?78:1;}
finally{
  if(report&&!report.privateBefore&&report.prerequisites?.safejs?.before)report.privateBefore=report.prerequisites.safejs.before;
  if(report){if(report.privateBefore&&privateModule){try{report.privateAfter=await helperRoute.run('private-finally',()=>privateModule.privateState());report.privateUnchanged=JSON.stringify(report.privateBefore)===JSON.stringify(report.privateAfter);report.privateFileChanges=report.prerequisites.safejs.files.filter(entry=>{const file=join(report.privateBefore.root,'packages/safejs',entry.path),stat=lstatSync(file);return!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o777)!==entry.mode||sha(readFileSync(file))!==entry.sha256;}).map(entry=>entry.path);if(!report.privateUnchanged||report.privateFileChanges.length)exitCode=1;}catch(error){report.privateGuardError=error.stack;exitCode=1;}}
    report.finishedAt=new Date().toISOString();report.temporary=temporary;report.cleanup='Temporary evidence retained for exact inspection; supervised phase children recorded and drained. No broad cleanup of live or private trees.';
    report.verdict=gateVerdict(report);if(exitCode)report.verdict={...report.verdict,status:'HOLD_OR_QUALIFIED_RED',exitCode,problems:[...report.verdict.problems,report.error?.message??'final guard failed']};exitCode=report.verdict.exitCode;report.status=report.verdict.status;
    if(output)save(join(output,'REPORT.json'),report);console.log(JSON.stringify({candidate:candidate.candidate,status:report.status,fullGateLaunched:report.fullGateLaunched,error:report.error,output}));}
}

return exitCode;
}
