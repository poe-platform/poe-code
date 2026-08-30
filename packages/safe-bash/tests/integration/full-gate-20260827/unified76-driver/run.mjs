import assert from 'node:assert/strict';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {cpSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {candidate,directory,repository,copyDependencies,blob,sha,save,node24,npm,git,copySelection} from './common.mjs';
import {readProfile} from './profile.mjs';
import {admission,parse,requireRelease,verifyDriverSeal,requireOrdered,canonicalArguments,requireCanonicalArguments} from './admission.mjs';
import {capture,createTreeGuard,requireBuildDelta,verifyArchive} from './inventory.mjs';

let output,report,temporary,source,privateModule,sourceGuard;
const completed=[];
async function streamCommands(left,right){
  const producer=spawn(left[0],left.slice(1),{cwd:repository,stdio:['pipe','pipe','pipe']});
  const consumer=spawn(right[0],right.slice(1),{cwd:repository,stdio:['pipe','pipe','pipe']});
  let producerError='',consumerError='';producer.stderr.on('data',bytes=>{producerError+=bytes;});consumer.stderr.on('data',bytes=>{consumerError+=bytes;});consumer.stdout.resume();
  const wait=child=>new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(status,signal)=>resolve({status,signal}));});
  const producerDone=wait(producer),consumerDone=wait(consumer);
  let expired=false,escalation;
  const timer=setTimeout(()=>{expired=true;producer.kill('SIGTERM');consumer.kill('SIGTERM');escalation=setTimeout(()=>{producer.kill('SIGKILL');consumer.kill('SIGKILL');},2000);},600000);
  if(left[1]==='pack-objects')producer.stdin.end(candidate.candidate+'\n');else producer.stdin.end();
  try{await pipeline(producer.stdout,consumer.stdin);const results=await Promise.all([producerDone,consumerDone]);assert.equal(expired,false,'streamed archive/history setup deadline exceeded');for(const result of results){assert.equal(result.status,0,producerError+'\n'+consumerError);assert.equal(result.signal,null);}return results;}
  catch(error){producer.kill('SIGTERM');consumer.kill('SIGTERM');await Promise.allSettled([producerDone,consumerDone]);throw error;}
  finally{clearTimeout(timer);clearTimeout(escalation);}
}
try{
  const options=parse(process.argv.slice(2)),profile=readProfile(),seal=verifyDriverSeal();
  const preflight=await admission(profile);console.log(JSON.stringify({candidate:candidate.candidate,driverSha256:sha(JSON.stringify(seal)),profileSha256:sha(JSON.stringify(profile)),preflight}));
  if(preflight.issues.length)throw Object.assign(new Error('mandatory prerequisite refused before suite'),{exitCode:78});
  if(!options.execute)process.exit(0);
  requireRelease(JSON.parse(readFileSync(options.release)),seal,profile);
  output=options.output;assert.ok(output.startsWith('/tmp/full-gate-unified76-')&&!existsSync(output),'unique owned external evidence directory required');mkdirSync(output);
  temporary=realpathSync(mkdtempSync(join(tmpdir(),'unified76-execution-')));source=join(temporary,'source');
  for(const name of ['source','harness','home','tmp','native','consumer'])mkdirSync(join(temporary,name));
  report={startedAt:new Date().toISOString(),candidate:candidate.candidate,tree:candidate.tree,sourceTree:candidate.sourceTree,driverSha256:sha(JSON.stringify(seal)),profileSha256:sha(JSON.stringify(profile)),preflight,temporary,output,phases:[],fullGateLaunched:false,scope:'new unified76 profile; not rescore or continuation of historical gates'};
  save(join(output,'ADMISSION.json'),report);
  const support=join(temporary,'support');mkdirSync(support);
  const supportInputs=copySelection(support,Object.keys(profile.support));for(const entry of supportInputs)assert.equal(entry.sha256,profile.support[entry.path]);
  const supportModule=path=>import(pathToFileURL(join(support,'tests/integration/full-gate-20260827',path)));
  const {stageNative,verifyNativeStaging}=await supportModule('preflight-repair/preflight.mjs');
  const {supervise}=await supportModule('supervise.mjs');const {account}=await supportModule('account.mjs');
  const {probeGuardedRuntime}=await supportModule('runtime-profile-20260827/profile.mjs');
  privateModule=await supportModule('combined-8670ebe8/prerequisites.mjs');
  const environment={PATH:`${join(temporary,'native')}:${dirname(node24)}:/usr/bin:/bin:/usr/sbin:/sbin`,HOME:join(temporary,'home'),TMPDIR:join(temporary,'tmp'),TMP:join(temporary,'tmp'),TEMP:join(temporary,'tmp'),LANG:'C',LC_ALL:'C',TZ:'UTC',NO_COLOR:'1',GIT_OPTIONAL_LOCKS:'0',TSX_DISABLE_CACHE:'1',RIPGREP_CONFIG_PATH:'',npm_config_cache:join(temporary,'npm-cache'),npm_config_userconfig:join(temporary,'npmrc'),npm_config_globalconfig:join(temporary,'global-npmrc'),npm_config_registry:'http://127.0.0.1:1',npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false'};
  writeFileSync(environment.npm_config_userconfig,'');writeFileSync(environment.npm_config_globalconfig,'');
  report.archiveTransport=await streamCommands(['git','archive',candidate.candidate],['/usr/bin/tar','-xf','-','-C',source]);
  report.archive=await verifyArchive(source,profile.scopeInputs);assert.equal(report.archive.count,profile.scopeInputs.length);
  execFileSync('git',['init','--quiet','--template=',source]);
  report.historyTransport=await streamCommands(['git','pack-objects','--stdout','--revs'],['git','--git-dir',join(source,'.git'),'index-pack','--stdin']);
  writeFileSync(join(source,'.git/HEAD'),candidate.candidate+'\n');execFileSync('git',['read-tree',candidate.candidate],{cwd:source});
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),candidate.candidate);
  assert.equal(existsSync(join(source,'.git/objects/info/alternates')),false);
  copyDependencies(join(source,'node_modules'));copyDependencies(join(source,'benchmarks/node_modules'),join(repository,'benchmarks/node_modules'));
  for(const prefix of ['', 'benchmarks']){
    const lock=JSON.parse(readFileSync(join(source,prefix,'package-lock.json')));
    for(const[path,metadata]of Object.entries(lock.packages).filter(([path])=>path)){
      const target=join(source,prefix,path,'package.json');if(!existsSync(target)){assert.equal(metadata.optional,true,`missing dependency ${prefix}/${path}`);continue;}
      assert.equal(JSON.parse(readFileSync(target)).version,metadata.version,`dependency version ${prefix}/${path}`);
    }
  }
  report.nativeStaged=stageNative(preflight,{snapshot:source,nativeRoot:join(temporary,'native'),environment});
  report.prerequisites=await privateModule.prerequisites({repository,source,temporary,environment,candidate:candidate.candidate});
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
  const positive=spawnSync(node24,[...permission,`import{readFileSync}from'node:fs';if(readFileSync(${JSON.stringify(join(allowed,'allowed.txt'))},'utf8')!=='allowed')throw Error('bad');`],{env:environment,encoding:'utf8'});
  const denied=spawnSync(node24,[...permission,`import{readFileSync}from'node:fs';readFileSync(${JSON.stringify(forbidden)});`],{env:environment,encoding:'utf8'});
  report.permission={positive:{status:positive.status,stderr:positive.stderr},denied:{status:denied.status,stderr:denied.stderr}};if(positive.status!==0||denied.status!==1||!denied.stderr.includes('ERR_ACCESS_DENIED')||!denied.stderr.includes(forbidden))throw Object.assign(new Error('permission positive and exact denial admission refused before suites'),{exitCode:78});
  const protectedInputs=await Promise.all(['src','tests','scripts','docs','benchmarks','node_modules'].filter(name=>existsSync(join(source,name))).map(async name=>({name,guard:await createTreeGuard(join(source,name))})));
  const beforeAuthorizedBuild=await capture(source);
  const tracked=()=>{for(const entry of profile.scopeInputs){const stat=lstatSync(join(source,entry.path));assert.equal(stat.isSymbolicLink(),entry.mode==='120000');if(entry.mode!=='120000')assert.equal(sha(readFileSync(join(source,entry.path))),report.archive.files[entry.path].sha256,entry.path);}};
  report.npmCli={path:npm,sha256:sha(readFileSync(npm))};
  const verify=async()=>{if(sourceGuard)assert.deepEqual((await sourceGuard.check()).changes,[],'source additions/removals/content/type/mode changed after setup');else for(const entry of protectedInputs)assert.deepEqual((await entry.guard.check()).changes,[],entry.name);verifyNativeStaging(report.nativeStaged);assert.equal(sha(readFileSync(node24)),preflight.runtime.identity.sha256);assert.equal(sha(readFileSync(npm)),report.npmCli.sha256);assert.equal(sha(readFileSync(cleanup)),sha(JSON.stringify(profile.cleanup,null,2)+'\n'));verifyDriverSeal();};
  const artifactGuard=await createTreeGuard(support);const privateGuard=await createTreeGuard(report.prerequisites.safejs.copiedRoot);
  async function phase(label,args,cwd=source,expectedStatus=0,timeoutMs=360000){
    requireOrdered(completed,label);await verify();assert.deepEqual((await artifactGuard.check()).changes,[]);assert.deepEqual((await privateGuard.check()).changes,[]);
    const env={...environment,FULL_GATE_IMPORTS:join(output,'imports',label),...label==='public-runtime'?{}:{NODE_OPTIONS:'--import='+pathToFileURL(guard).href}};
    const result=await supervise(node24,args,{cwd,env,timeoutMs,stdout:join(output,label+'.stdout'),stderr:join(output,label+'.stderr'),observeSockets:true});
    const row={...result,label,expectedStatus,args,cwd,loaderPolicy:label==='public-runtime'?'permission confines all module reads to authenticated moved package and consumer; outer preload intentionally unavailable under that fence':'outer authenticated source guard; child harnesses with explicit environments retain their separately declared fences'};report.phases.push(row);completed.push(label);
    if(label==='canonical')row.accounting=account(readFileSync(join(output,label+'.stdout'),'utf8'));
    row.observedNodeExecutables=result.observed.filter(entry=>/^(?:\S+\/)?node(?:\s|$)/u.test(entry.command)).map(entry=>entry.command.split(/\s+/u)[0]);
    assert.ok(row.observedNodeExecutables.every(path=>!path.startsWith('/')||realpathSync(path)===realpathSync(node24)),'mixed observed Node runtime');
    await verify();assert.deepEqual((await artifactGuard.check()).changes,[]);assert.deepEqual((await privateGuard.check()).changes,[]);save(join(output,label+'.json'),row);return row;
  }
  await phase('safejs-availability',['--import','tsx','--input-type=module','-e',"import assert from 'node:assert/strict';import {pathToFileURL}from'node:url';const {run}=await import(pathToFileURL(process.env.SAFEJS_LOCAL_ROOT+'/src/run.ts'));const result=await run('1+2');assert.equal(result.ok,true);console.log(JSON.stringify(result));"]);
  const cold=await phase('cold-typecheck',[npm,'run','typecheck','--','--report',join(output,'cold-types')],source,78);assert.equal(cold.status,78);
  await phase('typecheck-all',[npm,'run','typecheck:all','--','--report',join(output,'typecheck-all')]);
  const typing=JSON.parse(readFileSync(join(output,'typecheck-all/report.json')));report.typing={builds:typing.builds,status:typing.status};assert.equal(typing.builds,1);assert.equal(typing.phases.find(entry=>entry.label==='build')?.status,0,'failed build prohibits stale package fallback');
  tracked();requireBuildDelta(beforeAuthorizedBuild,await capture(source));sourceGuard=await createTreeGuard(source);report.afterAuthorizedSetup=sourceGuard.before();
  await phase('benchmark-types',[join(source,'benchmarks/node_modules/typescript/bin/tsc'),'--noEmit','-p','tsconfig.json'],join(source,'benchmarks'));
  await phase('env-source-binding',['--import','tsx','--input-type=module','-e',"await import('./src/commands/execution.ts');await import('./src/commands/env-split.ts');console.log('candidate env source loaded')"]);
  const args=canonicalArguments(profile);requireCanonicalArguments(args,profile);report.fullGateLaunched=true;const canonical=await phase('canonical',args,source,0,3600000);
  const canonicalLogs=join(output,'imports/canonical');
  const loaded=new Set(readdirSync(canonicalLogs).flatMap(name=>readFileSync(join(canonicalLogs,name),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line).relative)));
  report.canonicalCoverage={expected:profile.canonicalFiles.length,observed:profile.canonicalFiles.filter(path=>loaded.has(path)),missing:profile.canonicalFiles.filter(path=>!loaded.has(path)),qualification:'resolved main-thread module paths observed by outer hook; not an invented worker-thread transitive trace'};
  const consumerResult=await phase('current-consumers',['scripts/verify-current-consumers.mjs','--source-commit',candidate.candidate],source,0,900000);
  report.currentConsumerQualification='Unchanged candidate runner executes maintained runtime groups and permission/source-denial controls in its separately built installed package. Its own build is separate from the single source typecheck:all build. Nested runner environments do not promise inheritance of the outer import hook; its existing exact declaration/runtime binding and permission fences remain mandatory.';
  const pack=join(temporary,'pack');mkdirSync(pack);const packed=await phase('pack',[npm,'pack','--ignore-scripts','--json','--pack-destination',pack]);assert.equal(packed.status,0);
  const tarball=join(pack,'virtual-bash-0.0.0.tgz');report.packageSha256=sha(readFileSync(tarball));assert.equal(report.packageSha256,candidate.expectedPackageSha256);
  const consumer=join(temporary,'consumer'),installed=join(consumer,'node_modules/virtual-bash');mkdirSync(installed,{recursive:true});execFileSync('/usr/bin/tar',['-xf',tarball,'--strip-components=1','-C',installed]);
  writeFileSync(join(consumer,'package.json'),JSON.stringify({name:'unified76-public',private:true,type:'module'}));
  for(const[name,target]of [['public.mjs','public.mjs'],['consumer.mts.fixture','consumer.mts'],['negative.mts.fixture','negative.mts']])writeFileSync(join(consumer,target),readFileSync(join(directory,name)));
  const moved=join(temporary,'moved package');renameSync(consumer,moved);const packageRoot=join(moved,'node_modules/virtual-bash'),packageGuard=await createTreeGuard(packageRoot);
  const publicResult=await phase('public-runtime',['--permission',`--allow-fs-read=${moved}`,'--allow-worker','--unhandled-rejections=strict','public.mjs'],moved);assert.equal(publicResult.status,0);
  const compiler=join(source,'node_modules/typescript/bin/tsc'),typeArgs=['--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--types','node','--typeRoots',join(source,'node_modules/@types'),'--traceResolution'];
  const positiveTypes=await phase('public-types',[compiler,...typeArgs,'consumer.mts'],moved);assert.equal(positiveTypes.status,0);
  const negativeTypes=await phase('negative-types',[compiler,...typeArgs,'negative.mts'],moved,2);assert.equal(negativeTypes.status,2);
  const negativeText=readFileSync(join(output,'negative-types.stdout'),'utf8');assert.deepEqual([...negativeText.matchAll(/error (TS\d+):/gu)].map(match=>match[1]),['TS2305','TS2353','TS2353']);
  const bindingModule=await import(pathToFileURL(join(source,'scripts/typecheck-consumers.mjs')));const binding=bindingModule.createBuiltPackageBinding(source);
  for(const label of ['public-types','negative-types'])bindingModule.assertBuiltConsumerResolution(readFileSync(join(output,label+'.stdout'),'utf8'),moved,source,binding);
  for(const[label,specifier,file]of [['missing-root','virtual-bash','dist/index.js'],['missing-contracts','virtual-bash/contracts','dist/contracts/index.js']]){
    const missing=join(temporary,label);mkdirSync(missing);cpSync(packageRoot,join(missing,'node_modules/virtual-bash'),{recursive:true});rmSync(join(missing,'node_modules/virtual-bash',file));
    const result=await phase(label,['--input-type=module','-e',`await import(${JSON.stringify(specifier)});`],missing,1);assert.equal(result.status,1);assert.match(readFileSync(join(output,label+'.stderr'),'utf8'),/ERR_MODULE_NOT_FOUND/u);
  }
  requireOrdered(completed,'final-sweep');await verify();tracked();assert.deepEqual((await packageGuard.check()).changes,[]);assert.equal(sha(readFileSync(tarball)),report.packageSha256);assert.deepEqual(privateModule.privateState(),report.privateBefore);report.phases.push({label:'final-sweep',status:0,expectedStatus:0});completed.push('final-sweep');
  report.status=report.phases.every(row=>row.status===row.expectedStatus&&row.clean!==false)&&canonical.accounting.reconciled&&report.canonicalCoverage.missing.length===0?'qualified-measurement-completed':'qualified-red-measurement';report.canonical=canonical.accounting;report.currentConsumerStatus=consumerResult.status;
}catch(error){if(!report)report={candidate:candidate.candidate,fullGateLaunched:false};report.status='infrastructure-refused-or-failed';report.error={message:error.message,stack:error.stack};process.exitCode=error.exitCode===78?78:1;}
finally{
  if(report){if(report.privateBefore&&privateModule){try{report.privateAfter=privateModule.privateState();report.privateUnchanged=JSON.stringify(report.privateBefore)===JSON.stringify(report.privateAfter);report.privateFileChanges=report.prerequisites.safejs.files.filter(entry=>{const file=join(report.privateBefore.root,'packages/safejs',entry.path),stat=lstatSync(file);return!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o777)!==entry.mode||sha(readFileSync(file))!==entry.sha256;}).map(entry=>entry.path);if(!report.privateUnchanged||report.privateFileChanges.length)process.exitCode=1;}catch(error){report.privateGuardError=error.stack;process.exitCode=1;}}
    report.finishedAt=new Date().toISOString();report.temporary=temporary;report.cleanup='Temporary evidence retained for exact inspection; supervised phase children recorded and drained. No broad cleanup of live or private trees.';
    if(output)save(join(output,'REPORT.json'),report);console.log(JSON.stringify({candidate:candidate.candidate,status:report.status,fullGateLaunched:report.fullGateLaunched,error:report.error,output}));}
}
