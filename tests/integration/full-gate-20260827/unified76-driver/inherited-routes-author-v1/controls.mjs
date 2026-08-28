import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,realpathSync,symlinkSync,unlinkSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {createToolPath,verifyToolPath,createInheritedHelperRoute} from '../launcher-v3/tool-routing.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const launcher=resolve(here,'../launcher-v3');
const repository=resolve(here,'../../../../..');
const candidate='f5e9fc49b6abb38e180cc9de16c95fced102ff75';
const helperPath='tests/integration/full-gate-20260827/combined-8670ebe8/prerequisites.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const group=process.argv[2], root=realpathSync(process.argv[3]);
assert.match(group,/^G(?:0[1-9]|10)$/u);
assert.equal(realpathSync(process.execPath),'/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node');
const nativeRoot=join(root,'native');mkdirSync(nativeRoot);
const binding=createToolPath(root);
const environment={PATH:nativeRoot+':'+binding.path,GIT_EXEC_PATH:binding.gitCore.origin,GIT_OPTIONAL_LOCKS:'0'};
const route=()=>createInheritedHelperRoute(binding,environment,nativeRoot);
const results=[],telemetry=[];
const check=async(name,body)=>{await body();results.push({name,status:'PASS'});};
const rejected=async body=>{let thrown=false,value;try{await body();}catch(error){thrown=true;value=error;}assert.equal(thrown,true,'expected rejection');return value;};
const snapshot=()=>({...process.env});
const ambient=snapshot();
const helper=readFileSync(join(repository,helperPath));
assert.equal(digest(helper),'60ae62f6bab6e0348288cd04a6f69c551ce13769bd7ea9e47fb251b9a9dfa2db');
const baseline=JSON.parse(readFileSync(join(here,'BASELINE.json')));
const guardFiles=Object.fromEntries(Object.keys(baseline.files).map(file=>[file,digest(readFileSync(join(launcher,file)))]));

if(group==='G01'){
  for(const present of [false,true])await check('success restoration '+(present?'present-empty':'absent'),async()=>{
    for(const key of ['GIT_EXEC_PATH','GIT_OPTIONAL_LOCKS'])if(present)process.env[key]='';else delete process.env[key];
    const before=snapshot(),handle=route(),value={identity:true};
    assert.equal(await handle.run('prerequisites',()=>{for(const[key,item]of Object.entries(environment))assert.equal(process.env[key],item);assert.equal(process.env.HOME,before.HOME);return value;}),value);
    assert.deepEqual(snapshot(),before);assert.equal(handle.records[0].restored,true);assert.equal(handle.records[0].poisoned,false);handle.assertIdle();
  });
}
if(group==='G02'){
  for(const reason of [new Error('sync marker'),undefined,null,false,0,''])await check('sync rejection '+String(reason),async()=>{
    const before=snapshot(),handle=route();assert.equal(await rejected(()=>handle.run('prerequisites',()=>{throw reason;})),reason);assert.deepEqual(snapshot(),before);assert.equal(handle.records[0].failures[0].stage,'callback');handle.assertIdle();
  });
  await check('async identity and restoration',async()=>{const reason={marker:'async'},handle=route(),before=snapshot();assert.equal(await rejected(()=>handle.run('prerequisites',async()=>{await Promise.resolve();throw reason;})),reason);assert.deepEqual(snapshot(),before);handle.assertIdle();});
}
if(group==='G03'){
await check('await retains scope until controlled release',async()=>{
  let release,entered=false,settled=false;const deferred=new Promise(done=>{release=done;}),before=snapshot(),handle=route();
  const pending=handle.run('prerequisites',async()=>{entered=true;await deferred;return 17;});pending.then(()=>{settled=true;});
  await Promise.resolve();assert.equal(entered,true);assert.equal(settled,false);assert.equal(process.env.PATH,environment.PATH);assert.throws(()=>handle.assertIdle(),/already owned/u);
  release();assert.equal(await pending,17);assert.deepEqual(snapshot(),before);handle.assertIdle();
});
await check('cancellation and observed deadline do not release unresolved owner',async()=>{
  const controller=new AbortController(),reason=new Error('cooperative cancellation');let release,settled=false;const deferred=new Promise(done=>{release=done;}),handle=route(),before=snapshot();
  const pending=handle.run('prerequisites',async()=>{await deferred;if(controller.signal.aborted)throw controller.signal.reason;});pending.then(()=>{settled=true;},()=>{settled=true;});
  controller.abort(reason);assert.equal(await Promise.race([pending,Promise.resolve('observer deadline')]),'observer deadline');assert.equal(settled,false);assert.throws(()=>handle.assertIdle(),/already owned/u);assert.equal(process.env.PATH,environment.PATH);release();assert.equal(await rejected(()=>pending),reason);assert.deepEqual(snapshot(),before);handle.assertIdle();
});
}
if(group==='G04')await check('nested and concurrent handles reject before callback',async()=>{
  let release,attempts=0;const deferred=new Promise(done=>{release=done;}),handle=route(),second=route(),before=snapshot();
  const pending=handle.run('prerequisites',async()=>{assert.match((await rejected(()=>second.run('private-finally',()=>{attempts++;}))).message,/already owned/u);await deferred;});
  await Promise.resolve();assert.match((await rejected(()=>handle.run('private-final-sweep',()=>{attempts++;}))).message,/already owned/u);assert.equal(attempts,0);release();await pending;assert.deepEqual(snapshot(),before);second.assertIdle();
});
if(group==='G05'){
  for(const change of ['value','delete'])await check('routed drift '+change,async()=>{const handle=route(),before=snapshot();await rejected(()=>handle.run('prerequisites',()=>{if(change==='value')process.env.PATH='/unadmitted';else delete process.env.GIT_EXEC_PATH;}));assert.equal(handle.records[0].failures[0].stage,'drift');assert.deepEqual(snapshot(),before);handle.assertIdle();});
  await check('unrelated drift and object replacement poison',async()=>{
    const original=process.env,handle=route();await rejected(()=>handle.run('prerequisites',()=>{process.env.ROUTE_UNRELATED='added';process.env.HOME='changed';process.env={...process.env};}));
    assert.equal(handle.records[0].poisoned,true);assert.equal(handle.records[0].restored,false);assert.throws(()=>handle.assertIdle(),/poisoned/u);let entered=false;await rejected(()=>route().run('private-finally',()=>{entered=true;}));assert.equal(entered,false);
    process.env=original;delete process.env.ROUTE_UNRELATED;process.env.HOME=ambient.HOME;
  });
}
if(group==='G06'){
await check('partial installation failure restores without invoking callback',async()=>{
  const original=process.env,backing={...original},failure=new Error('partial install');let armed=true,entered=false;
  process.env=new Proxy(backing,{set(target,key,value){if(armed&&key==='GIT_EXEC_PATH'){armed=false;throw failure;}return Reflect.set(target,key,value);}});
  const handle=route(),error=await rejected(()=>handle.run('prerequisites',()=>{entered=true;}));assert.equal(entered,false);assert.ok(error.errors.includes(failure));assert.equal(handle.records[0].failures[0].stage,'installation');assert.equal(handle.records[0].restored,true);assert.deepEqual(backing,{...original});handle.assertIdle();process.env=original;
});
await check('all restoration attempts and distinct failures preserved',async()=>{
  const original=process.env,backing={...original,GIT_OPTIONAL_LOCKS:''};delete backing.GIT_EXEC_PATH;
  const attempted=[],callbackError=new Error('callback sentinel'),deleteError=new Error('delete sentinel'),setError=new Error('set sentinel');let fault=false;
  process.env=new Proxy(backing,{set(target,key,value){if(fault){attempted.push('set:'+key);if(key==='GIT_OPTIONAL_LOCKS')throw setError;}return Reflect.set(target,key,value);},deleteProperty(target,key){if(fault){attempted.push('delete:'+key);if(key==='GIT_EXEC_PATH')throw deleteError;}return Reflect.deleteProperty(target,key);}});
  const handle=route(),error=await rejected(()=>handle.run('prerequisites',()=>{backing.PATH='/drift';fault=true;throw callbackError;}));
  assert.ok(error instanceof AggregateError);assert.ok(error.errors.includes(callbackError));assert.ok(error.errors.includes(deleteError));assert.ok(error.errors.includes(setError));
  assert.deepEqual(attempted,['set:PATH','delete:GIT_EXEC_PATH','set:GIT_OPTIONAL_LOCKS']);
  assert.deepEqual(handle.records[0].failures.map(row=>row.stage),['callback','drift','restore:GIT_EXEC_PATH','restore:GIT_OPTIONAL_LOCKS','restore-verification']);
  assert.equal(handle.records[0].poisoned,true);assert.throws(()=>route().assertIdle(),/poisoned/u);process.env=original;
});
}
if(group==='G07'){
  for(const[key,value]of [['PATH',environment.PATH+':/usr/bin'],['GIT_EXEC_PATH','/unbound'],['GIT_OPTIONAL_LOCKS','1']])await check('wrong admitted '+key,async()=>{let called=false;await rejected(()=>createInheritedHelperRoute(binding,{...environment,[key]:value},nativeRoot).run('prerequisites',()=>{called=true;}));assert.equal(called,false);});
  for(const key of ['GIT_PAGER','GIT_CONFIG_COUNT','NODE_OPTIONS','NODE_PATH','DEVELOPER_DIR','DYLD_INSERT_LIBRARIES'])await check('parent injection '+key,async()=>{process.env[key]='unadmitted';let called=false;await rejected(()=>route().run('prerequisites',()=>{called=true;}));assert.equal(called,false);delete process.env[key];});
  await check('unexpected native executable',async()=>{const extra=join(nativeRoot,'rogue');writeFileSync(extra,'unbound',{mode:0o755});let called=false;await rejected(()=>route().run('prerequisites',()=>{called=true;}));assert.equal(called,false);unlinkSync(extra);});
  for(const variant of ['missing','changed'])await check('alias '+variant,async()=>{const alias=join(binding.path,'git');unlinkSync(alias);if(variant==='changed')symlinkSync(process.execPath,alias);let called=false;await rejected(()=>route().run('prerequisites',()=>{called=true;}));assert.equal(called,false);if(variant==='changed')unlinkSync(alias);symlinkSync(binding.aliases.find(row=>row.name==='git').physical,alias);});
  await check('normal scope remains usable',async()=>{assert.equal(await route().run('prerequisites',()=>23),23);});
}
if(group==='G08'){
  const source=readFileSync(join(launcher,'execute.mjs'),'utf8');
  await check('three awaited source-bound helper callsites',async()=>{assert.equal((source.match(/helperRoute\.run\(/gu)??[]).length,3);assert.ok(source.includes("await helperRoute.run('prerequisites',()=>privateModule.prerequisites({repository,source,temporary,environment,candidate:candidate.candidate}))"));for(const label of ['private-final-sweep','private-finally'])assert.ok(source.includes(`await helperRoute.run('${label}',()=>privateModule.privateState())`));assert.equal((source.match(/privateModule\.privateState\(\)/gu)??[]).length,2);});
  await check('idle before ambient checks and unchanged explicit phase environment',async()=>{assert.ok(source.includes('helperRoute.assertIdle();await verifyExternal()'));for(const file of ['phase-runner.mjs','build-types.mjs','build-audit.mjs','fenced-supervisor.mjs','external-admission.mjs'])assert.equal(guardFiles[file],baseline.files[file]);});
  await check('caller injection refusal remains after restoration',async()=>{const handle=route(),before=snapshot();await handle.run('private-finally',()=>5);assert.deepEqual(snapshot(),before);const external=await import('../launcher-v3/external-admission.mjs');external.rejectAmbientInjection(process.env);process.env.NODE_OPTIONS='unadmitted';assert.throws(()=>external.rejectAmbientInjection(process.env),/injection refused/u);delete process.env.NODE_OPTIONS;});
}
if(group==='G09'){
  const paths=['tests/commands/metadata-stress/canonical-env/runner.mjs','tests/plugins/qualified-current-release/prerequisites.mjs'];
  const profile=JSON.parse(gunzipSync(Buffer.from(readFileSync(join(launcher,'PROFILE.json.gz.base64'),'utf8').trim(),'base64')));
  const source=join(root,'selected-source');mkdirSync(source);
  const direct=binding.aliases.find(row=>row.name==='git');let calls=0;
  const boundedExec=(command,args,options)=>{
    assert.ok(++calls<=4);assert.ok(command==='git'||command===direct.physical);assert.equal(options.cwd,repository);
    assert.equal(args.length,3);assert.equal(args[0],'--no-replace-objects');assert.equal(args[1],'show');const selected=args[2].slice(candidate.length+1);assert.ok(paths.includes(selected));assert.equal(args[2],candidate+':'+selected);
    if(command==='git')assert.equal(Object.hasOwn(options,'env'),false,'literal helper must inherit, not receive repaired env');
    const effective=options.env??process.env;verifyToolPath(binding,effective,nativeRoot);assert.equal(effective.GIT_OPTIONAL_LOCKS,'0');
    const target=command==='git'?realpathSync(join(binding.path,'git')):realpathSync(command);assert.equal(target,direct.physical);
    const before={command,args,cwd:options.cwd,PATH:effective.PATH,GIT_EXEC_PATH:effective.GIT_EXEC_PATH,resolvedTarget:target,sha256:digest(readFileSync(target)),gitCore:binding.gitCore,qualification:'Pre-dispatch unique PATH/alias resolution, not kernel exec telemetry'};assert.equal(before.sha256,direct.sha256);writeFileSync(join(root,'git-'+calls+'-before.json'),JSON.stringify(before,null,2)+'\n',{flag:'wx'});
    const result=spawnSync(command,args,{...options,timeout:5000,killSignal:'SIGKILL',maxBuffer:2*1024*1024});
    telemetry.push({command,args,cwd:options.cwd,PATH:effective.PATH,GIT_EXEC_PATH:effective.GIT_EXEC_PATH,resolvedTarget:target,sha256:digest(readFileSync(target)),pid:result.pid,status:result.status,signal:result.signal,error:result.error?{message:result.error.message,code:result.error.code??null,errno:result.error.errno??null,syscall:result.error.syscall??null,path:result.error.path??null,spawnargs:result.error.spawnargs??null}:null,stdoutBytes:result.stdout?.length,stdoutSha256:result.stdout&&digest(result.stdout),stderrBytes:result.stderr?.length,targetEvidence:'Unique pre-dispatch PATH resolution plus exact alias/binary/closure verified before and after; not a kernel exec event trace.'});
    writeFileSync(join(root,'git-'+calls+'-after.json'),JSON.stringify(telemetry.at(-1),null,2)+'\n',{flag:'wx'});assert.equal(result.error,undefined);assert.equal(result.status,0);assert.equal(result.signal,null);assert.equal(result.stderr.length,0);verifyToolPath(binding,effective,nativeRoot);return result.stdout;
  };
  await check('two exact selected fixtures via admitted direct Git',async()=>{for(const selected of paths){const bytes=boundedExec(direct.physical,['--no-replace-objects','show',candidate+':'+selected],{cwd:repository,env:{...process.env,...environment}}),expected=profile.scopeInputs.find(row=>row.path===selected);assert.equal(bytes.length,expected.bytes);assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),expected.blob);const target=join(source,selected);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});}});
  await check('unchanged frozen authority map uses inherited actual Git route',async()=>{const text=helper.toString(),start=text.indexOf('  const authorityFiles = '),end=text.indexOf('\n  const canonical = ',start);assert.ok(start>0&&end>start);const excerpt=text.slice(start,end),result={};const before=snapshot(),handle=route();await handle.run('prerequisites',()=>vm.runInNewContext(excerpt,{result,execFileSync:boundedExec,repository,source,candidate,assert,sha:digest,readFileSync,join},{timeout:15000}));assert.equal(result.authorities.length,2);assert.deepEqual(snapshot(),before);assert.equal(calls,4);telemetry.push({excerptSha256:digest(excerpt),helperSha256:digest(helper),callback:'authority map only; prerequisites/private/import routes NOT invoked'});});
}
if(group==='G10'){
  await check('driver has exactly two changed members',async()=>{const seal=JSON.parse(readFileSync(join(launcher,'DRIVER.json')));assert.equal(seal.candidate,candidate);assert.deepEqual(Object.keys(seal.files).sort(),Object.keys(baseline.files).sort());assert.deepEqual(Object.keys(seal.files).filter(file=>seal.files[file]!==baseline.files[file]).sort(),['execute.mjs','tool-routing.mjs']);assert.deepEqual(seal.files,guardFiles);const receipt=JSON.parse(readFileSync(join(launcher,'CANDIDATE.json')));assert.equal(receipt.expectedPackageSha256,'c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd');});
  await check('settled callback is not detached-task cleanup',async()=>{let finish,closed=false;const background=new Promise(done=>{finish=()=>{closed=true;done();};});const handle=route();await handle.run('prerequisites',()=>0);assert.equal(closed,false);assert.match(handle.records[0].qualification,/not detached-child closure/u);finish();await background;assert.equal(closed,true);});
}
for(const[file,hash]of Object.entries(guardFiles))assert.equal(digest(readFileSync(join(launcher,file))),hash,'shipping input changed: '+file);
assert.equal(digest(readFileSync(join(repository,helperPath))),digest(helper));
console.log(JSON.stringify({group,status:'PASS',checks:results,telemetry,pid:process.pid,root,productExecutions:0,fullGate:0,privateReads:0}));
