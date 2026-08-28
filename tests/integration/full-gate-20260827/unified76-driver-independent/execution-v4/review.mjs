import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {join,resolve,dirname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
import childProcess from 'node:child_process';

const directory=dirname(fileURLToPath(import.meta.url));
const repository=resolve(directory,'../../../../..');
const plan=JSON.parse(fs.readFileSync(join(directory,'PLAN.json')));
const binding=plan.bindings;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>structuredClone(value);
const data=join(directory,'data');
assert.equal(process.version,'v24.11.1');
assert.equal(fs.realpathSync(process.execPath),binding.node);
assert.ok(!fs.existsSync(data),'Each execution has a unique retained attempt; no hidden rerun');
fs.mkdirSync(data);
const cleanEnvironment=Object.fromEntries(Object.entries(process.env).filter(([key])=>!(/^(GIT_|DYLD_|LD_)/u.test(key)||['NODE_OPTIONS','NODE_PATH'].includes(key))));
cleanEnvironment.HOME=data;cleanEnvironment.TMPDIR=data;
const raw=[];
const result={schema:'unified76-independent-execution/v4',started:new Date().toISOString(),bindings:binding,planSha256:sha(fs.readFileSync(join(directory,'PLAN.json'))),groups:[],sources:[],effects:[],moduleTrace:[],commands:[],wholeGateLaunched:false,rootRelease:'HOLD',attempt:1};
const staged=[];
const command=(executable,args,options={})=>{
  const response=childProcess.spawnSync(executable,args,{cwd:repository,env:cleanEnvironment,encoding:'utf8',timeout:240000,maxBuffer:8388608,...options});
  const stdoutBuffer=Buffer.from(response.stdout??''),stderrBuffer=Buffer.from(response.stderr??'');
  const record={executable,args,cwd:options.cwd??repository,status:response.status,signal:response.signal,error:response.error?.message,stdout:stdoutBuffer.toString(),stderr:stderrBuffer.toString()};
  assert.ok(Buffer.byteLength(record.stdout)+Buffer.byteLength(record.stderr)<=8388608);
  const receipt={...record,stdout:undefined,stderr:undefined,stdoutBytes:stdoutBuffer.length,stderrBytes:stderrBuffer.length,stdoutSha256:sha(stdoutBuffer),stderrSha256:sha(stderrBuffer)};
  result.commands.push(receipt);
  raw.push({...receipt,stdout:stdoutBuffer.length<=16384?record.stdout:undefined,stderr:stderrBuffer.length<=16384?record.stderr:undefined,largeMetadataOutput:'Outputs above16KiB retained by immutable Git origin and complete byte hashes, not copied archives'});
  Object.defineProperty(record,'stdoutBuffer',{value:stdoutBuffer});return record;
};
const git=(args,options={})=>{
  const record=command(binding.git,['--no-replace-objects',...args],options);
  assert.equal(record.status,0,record.stderr);assert.equal(record.signal,null);return record.stdout;
};
const blob=(path,revision=binding.candidate)=>{
  const size=Number(git(['cat-file','-s',`${revision}:${path}`]));assert.ok(size<=8388608,'bounded individual blob');
  const response=command(binding.git,['--no-replace-objects','show',`${revision}:${path}`],{encoding:null});assert.equal(response.status,0,response.stderr);const bytes=response.stdoutBuffer;assert.equal(bytes.length,size);return bytes;
};
const save=(name,value)=>fs.writeFileSync(join(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const stage=(name,path,revision=binding.driver)=>{
  const bytes=blob(path,revision),destination=join(directory,name);assert.ok(!fs.existsSync(destination));
  fs.mkdirSync(dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes,{flag:'wx'});staged.push(destination);
  const source={local:name,revision,path,bytes:bytes.length,sha256:sha(bytes)};result.sources.push(source);return source;
};
const oldNames=['PHASE-A.json','PHASE-B.json','RECEIPT.md','integrityvalidation.mjs','AUTHORITY-v2.json','static-predicate-v2.mjs','REVIEW-v2.md','STATIC-POLICY-v3.json','HANDOFF-v3.md'];
const history=Object.fromEntries(oldNames.map(name=>[name,sha(fs.readFileSync(join(directory,'..',name)))]));
result.workspaceBefore={head:git(['rev-parse','HEAD']).trim(),status:git(['status','--short']),index:git(['diff','--cached','--raw']),history};
const sealBytes=blob(binding.prefix+'DRIVER.json',binding.driver);assert.equal(sha(sealBytes),binding.driverFileSha256);
const seal=JSON.parse(sealBytes);
for(const[name,expected]of Object.entries(seal.files)){assert.equal(stage(name,binding.prefix+name).sha256,expected);}
stage('DRIVER.json',binding.prefix+'DRIVER.json');
for(const path of ['tests/plugins/qualified-current-release/inventory-check.mjs','tests/plugins/qualified-current-release/consumers.mjs','tests/plugins/stream-five-public/current-profile.mjs'])stage('data/helpers/'+path,path,binding.candidate);
stage('data/pinned-import-guard.mjs','tests/integration/full-gate-20260827/combined-8670ebe8/import-guard.mjs',binding.candidate);
const allowed=new Map(result.sources.map(source=>[join(directory,source.local),source.sha256]));
const forbidden=new Set(['execute.mjs','public.mjs','controls.mjs']);
const originalSpawn=childProcess.spawn;
childProcess.spawn=function(executable,args,options){
  assert.ok(!args.some(argument=>String(argument).includes('worker.mjs')||String(argument).includes('execute.mjs')),'Independent full-gate process sentinel');
  assert.ok([binding.git,binding.node,'/bin/ps'].includes(executable),'Unexpected asynchronous executable');
  return originalSpawn(executable,args,options);
};
syncBuiltinESMExports();
const hooks=registerHooks({
  resolve(specifier,context,next){const resolved=next(specifier,context);if(!resolved.url.startsWith('node:')){
    const path=fs.realpathSync(fileURLToPath(resolved.url));assert.ok(allowed.has(path),'No live module fallback: '+path);
    assert.ok(!forbidden.has(relative(directory,path)),'Independent full-gate load sentinel');assert.equal(sha(fs.readFileSync(path)),allowed.get(path));
    result.moduleTrace.push({stage:'resolve',specifier,parent:context.parentURL,path,sha256:allowed.get(path)});
  }return resolved;},
  load(url,context,next){if(!url.startsWith('node:')){const path=fs.realpathSync(fileURLToPath(url));assert.ok(allowed.has(path));assert.ok(!forbidden.has(relative(directory,path)));assert.equal(sha(fs.readFileSync(path)),allowed.get(path));result.moduleTrace.push({stage:'load',path,sha256:allowed.get(path)});}return next(url,context);}
});
const module=name=>import(pathToFileURL(join(directory,name)));
let group;
async function check(name,operation){const started=Date.now();try{const detail=await operation();group.controls.push({name,status:'PASS',elapsedMs:Date.now()-started,detail});}catch(error){group.controls.push({name,status:'FAIL',elapsedMs:Date.now()-started,error:String(error),stack:error.stack});}}
async function reject(name,operation){await check(name,async()=>{try{await operation();}catch(error){return{rejected:true,error:String(error).slice(0,1500),code:error.code};}assert.fail('Mutation unexpectedly accepted');});}
async function runGroup(id,operation,hold){group={id,status:'RUNNING',controls:[]};result.groups.push(group);console.log(id+' START');try{await operation();}catch(error){group.controls.push({name:'group infrastructure',status:'FAIL',error:String(error),stack:error.stack});}group.status=group.controls.some(control=>control.status==='FAIL')?'FAIL':hold?'HOLD':'PASS';if(hold)group.unexecuted=hold;console.log(id+' '+group.status);}
const fresh=name=>{const path=join(data,name);fs.mkdirSync(path,{recursive:true});return path;};
const hashFile=async path=>{const digest=createHash('sha256');let bytes=0;for await(const chunk of fs.createReadStream(path,{highWaterMark:65536})){digest.update(chunk);bytes+=chunk.length;}return{sha256:digest.digest('hex'),bytes};};
const gitEntries=revision=>git(['ls-tree','-rlz',revision]).split('\0').filter(Boolean).map(row=>{const match=/^(\d+) blob ([a-f0-9]{40})\s+(\d+)\t([\s\S]+)$/u.exec(row);assert.ok(match);return{path:match[4],mode:match[1],blob:match[2],bytes:Number(match[3])};});
const entryFor=(path,content,mode='100644')=>({path,mode,bytes:Buffer.byteLength(content),blob:createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex')});
let profile,common,admission,policy,inventory,external,transport;
try{
  common=await module('common.mjs');admission=await module('admission.mjs');policy=await module('policy.mjs');inventory=await module('inventory.mjs');external=await module('external-admission.mjs');transport=await module('transport.mjs');
  const profileModule=await module('profile.mjs');
  const profileBytes=gunzipSync(Buffer.from(fs.readFileSync(join(directory,'PROFILE.json.gz.base64'),'utf8').trim(),'base64'),{maxOutputLength:16777216});
  assert.equal(sha(profileBytes),binding.profileSha256);profile=JSON.parse(profileBytes);
  const entries=gitEntries(binding.candidate);
  const packetBytes=blob(binding.prefix+'evidence/REPORT.json',binding.evidence);assert.equal(sha(packetBytes),binding.reportSha256);result.packet=JSON.parse(packetBytes);
  await runGroup('A01',async()=>{
    await check('actual frozen assembly and driver seal',()=>{common.verifyAssembly();assert.deepEqual(admission.verifyDriverSeal(),seal);assert.equal(git(['rev-parse',binding.candidate+'^']).trim(),binding.base);assert.equal(git(['rev-parse',binding.base+':src']).trim(),binding.sourceTree);return{candidate:binding.candidate,tree:binding.tree,seal:sha(sealBytes)};});
    await reject('empty release cannot authorize',()=>admission.requireRelease({},seal,profile));
    await reject('wrong candidate argv',()=>policy.parseArgs(['--candidate',binding.base,'--inspect']));
  });
  await runGroup('A02',async()=>{
    const expected=['tests/commands/split/integration.test.ts','tests/commands/stream-format-author-stress/contracts.test.ts','tests/integration/stream-inspection-public-author/public.test.ts','tests/plugins/stream-five-public/consumer.mjs'];
    const changed=git(['diff','--name-only',binding.base,binding.candidate]).trim().split('\n');
    const proof=(paths,alter)=>{assert.deepEqual(paths,expected);for(const change of common.candidate.changes){let before=blob(change.path,binding.base).toString(),after=blob(change.path).toString();if(alter)after=alter(change.path,after);assert.equal(sha(before),change.beforeSha256);assert.equal(sha(after),change.afterSha256);let reverse=after;for(const[from,to,count=1]of change.replacements){assert.equal(reverse.split(to).length-1,count);reverse=reverse.split(to).join(from);}assert.equal(reverse,before);}};
    await check('exact four paths and reversible complete literal sweep',()=>{proof(changed);result.fixtureProof={changes:common.candidate.changes,diff:git(['diff','--no-ext-diff','--no-textconv','--full-index',binding.base,binding.candidate,'--',...expected]),sourceTree:binding.sourceTree};return{paths:changed,productTreeUnchanged:true,custom77Occurrences:2,laterWhichAndStage2Excluded:true};});
    await reject('fifth helper/WHICH path',()=>proof([...changed,'src/commands/which.ts']));
    await reject('custom count collapsed to76',()=>proof(changed,(path,text)=>path===expected[2]?text.replace('target.commands.list().length, 77','target.commands.list().length, 76'):text));
    await reject('non-count assertion deleted',()=>proof(changed,(path,text)=>path===expected[0]?text+'\n':text));
  });
  await runGroup('A03',async()=>{
    const root=fresh('runtime-guard'),names=['helper.mjs','config.json','golden.bin','loader.mjs','child-entry.mjs'];for(const name of names)fs.writeFileSync(join(root,name),'frozen '+name);
    const guard=await inventory.createTreeGuard(root);await check('unchanged runtime namespace',async()=>assert.deepEqual((await guard.check()).changes,[]));
    for(const name of names){await check('changed runtime-only '+name,async()=>{fs.appendFileSync(join(root,name),'!');assert.ok((await guard.check()).changes.some(change=>change.path===name));fs.writeFileSync(join(root,name),'frozen '+name);});await check('missing runtime-only '+name,async()=>{fs.unlinkSync(join(root,name));assert.ok((await guard.check()).changes.some(change=>change.path===name));fs.writeFileSync(join(root,name),'frozen '+name);});}
    await check('new runtime input',async()=>{fs.writeFileSync(join(root,'new.json'),'{}');assert.ok((await guard.check()).changes.some(change=>change.kind==='added'));});
  });
  let externalVerified;
  await runGroup('A04',async()=>{
    await check('full runtime Git membership not typing subset',()=>{assert.deepEqual(profile.scopeInputs,entries);assert.equal(entries.length,37397);assert.equal(entries.reduce((sum,entry)=>sum+entry.bytes,0),2382440321);policy.validateBounds(policy.BOUNDS,profile.closure);result.bounds=policy.BOUNDS;return profile.closure;});
    await check('actual readable tool and dependency closure',async()=>{externalVerified=await external.verifyExternal(cleanEnvironment);result.externalVerification=externalVerified;return externalVerified;});
    for(const key of ['NODE_OPTIONS','NODE_PATH','DYLD_INSERT_LIBRARIES','LD_PRELOAD','GIT_CONFIG'])await reject('ambient injection '+key,()=>external.rejectAmbientInjection({[key]:'unbound'}));
    const receipt=external.externalReceipt();result.systemBoundary=external.validateSystemBoundary(receipt.report);
    await check('declared directory-link boundary',()=>{const links=Object.values(receipt.report.directories).flatMap(tree=>tree.entries.filter(entry=>entry.kind==='symlink').map(entry=>({origin:tree.origin,...entry})));result.dependencyLinks=links;assert.ok(links.every(entry=>entry.insideOrigin||entry.targetFile),'unbound external directory symlink');return links;});
  });
  await runGroup('A05',async()=>{
    await check('actual profile validates complete memberships',()=>{profileModule.validateProfile(profile);return{canonical:profile.canonicalFiles.length,classified:profile.classifiedMts.length};});
    for(const field of ['canonicalFiles','classifiedMts','scopeInputs'])for(const mutation of ['missing','replaced','extra'])await reject(field+' '+mutation,()=>{const changed=clone(profile);if(mutation==='missing')changed[field].pop();if(mutation==='extra')changed[field].push(changed[field][0]);if(mutation==='replaced')changed[field][0]=field==='canonicalFiles'?'tests/not-selected.test.ts':{...changed[field][0],blob:'0'.repeat(40)};profileModule.validateProfile(changed);});
  });
  await runGroup('A06',async()=>{
    const root=fresh('archive-guard');fs.writeFileSync(join(root,'input.mjs'),'frozen');fs.symlinkSync('input.mjs',join(root,'fixture-link'));const expected=[entryFor('input.mjs','frozen'),entryFor('fixture-link','input.mjs','120000')];
    await check('regular source plus separately declared contained fixture link',()=>inventory.verifyArchive(root,expected));
    fs.unlinkSync(join(root,'input.mjs'));fs.symlinkSync('fixture-link',join(root,'input.mjs'));await reject('source origin swapped to link',()=>inventory.verifyArchive(root,expected));fs.unlinkSync(join(root,'input.mjs'));fs.writeFileSync(join(root,'input.mjs'),'frozen');
    fs.unlinkSync(join(root,'fixture-link'));fs.symlinkSync('../archive-guard/input.mjs',join(root,'fixture-link'));await reject('link lexical escape even if target returns owned tree',()=>inventory.verifyArchive(root,[expected[0],entryFor('fixture-link','../archive-guard/input.mjs','120000')]));
    fs.unlinkSync(join(root,'fixture-link'));fs.symlinkSync('input.mjs',join(root,'fixture-link'));fs.writeFileSync(join(root,'added'),'new');await reject('undeclared addition',()=>inventory.verifyArchive(root,expected));
  });
  await runGroup('A07',async()=>{
    const identity=await hashFile(binding.node);result.nodeIdentity={...identity,realpath:fs.realpathSync(binding.node),version:process.version};
    const predicate=value=>{assert.equal(value.sha256,binding.nodeSha256);assert.equal(value.version,'v24.11.1');assert.equal(value.realpath,binding.node);};
    await check('actual Node realpath hash and child version',()=>{predicate(result.nodeIdentity);const child=command(binding.node,['-p','JSON.stringify({version:process.version,path:process.execPath})']);assert.equal(child.status,0);assert.deepEqual(JSON.parse(child.stdout),{version:'v24.11.1',path:binding.node});return result.nodeIdentity;});
    await reject('wrong Node hash',()=>predicate({...result.nodeIdentity,sha256:'0'.repeat(64)}));await reject('wrong Node version',()=>predicate({...result.nodeIdentity,version:'v22.0.0'}));
  });
  await runGroup('A08',async()=>{
    const root=fresh('loader'),outside=join(data,'outside-marker.mjs'),marker=join(root,'marker.mjs'),expected=join(root,'expected.json'),logs=fresh('loader-logs');fs.writeFileSync(marker,'console.log("BOUND_MARKER");\n');fs.writeFileSync(outside,'console.log("OUTSIDE_UNBOUND");\n');
    const guard=join(data,'pinned-import-guard.mjs');const loaderEnv={...cleanEnvironment,FULL_GATE_ROOT:root,FULL_GATE_SOURCE:root,FULL_GATE_EXPECTED:expected,FULL_GATE_IMPORTS:logs};
    const flags=['--permission','--allow-fs-read='+root,'--allow-fs-read='+guard,'--allow-fs-write='+logs,'--import',guard];
    fs.writeFileSync(expected,JSON.stringify({'marker.mjs':sha(fs.readFileSync(marker))}));
    await check('pinned actual loader bound marker with permission',()=>{const child=command(binding.node,[...flags,marker],{env:loaderEnv});assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),'BOUND_MARKER');});
    await check('permission blocks outside-owned probe read',()=>{const child=command(binding.node,['--permission','--allow-fs-read='+root,'-e',`require('node:fs').readFileSync(${JSON.stringify(outside)})`]);assert.notEqual(child.status,0);assert.match(child.stderr,/ERR_ACCESS_DENIED/u);});
    await check('loader blocks outside origin despite broader filesystem read',()=>{const child=command(binding.node,[...flags,'--allow-fs-read='+outside,outside],{env:loaderEnv});assert.notEqual(child.status,0);assert.match(child.stderr,/FROZEN_IMPORT_OUTSIDE/u);assert.ok(!child.stdout.includes('OUTSIDE_UNBOUND'));});
    fs.writeFileSync(expected,JSON.stringify({'marker.mjs':'0'.repeat(64)}));await check('actual loader wrong critical digest',()=>{const child=command(binding.node,[...flags,marker],{env:loaderEnv});assert.notEqual(child.status,0);assert.match(child.stderr,/Frozen env source bytes/u);});
    result.pinnedLoaderTrace=fs.readdirSync(logs).flatMap(name=>fs.readFileSync(join(logs,name),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)));
  });
  await runGroup('A09',async()=>{
    const args=admission.canonicalArguments(profile);await check('actual explicit TAP argv before632 files',()=>{admission.requireCanonicalArguments(args,profile);assert.deepEqual(args.slice(0,5),['--import','tsx','--test','--test-reporter=tap','--test-concurrency=2']);return{prefix:args.slice(0,5),paths:args.length-5};});
    await reject('misordered TAP',()=>admission.requireCanonicalArguments([...args.filter(arg=>arg!=='--test-reporter=tap'),'--test-reporter=tap'],profile));await reject('loader omitted',()=>admission.requireCanonicalArguments(args.slice(2),profile));await reject('concurrency changed',()=>admission.requireCanonicalArguments(args.map(arg=>arg==='--test-concurrency=2'?'--test-concurrency=3':arg),profile));
    const file=join(data,'tiny-node-test.mjs');fs.writeFileSync(file,'import test from "node:test"; import assert from "node:assert/strict"; test("independent bounded marker",()=>assert.equal(2+2,4));\n');const tap=await module('tap.mjs');
    const child=command(binding.node,['--test','--test-reporter=tap','--test-concurrency=2',file]);fs.writeFileSync(join(data,'tiny.tap'),child.stdout);
    await check('real bounded TAP capture reconciles',async()=>{assert.equal(child.status,0);const account=await tap.accountFile(join(data,'tiny.tap'));result.tinyTap=account;assert.equal(account.reconciled,true);assert.equal(account.counts.pass,1);return account;});
    fs.writeFileSync(join(data,'truncated.tap'),child.stdout.split('# tests')[0]);await check('truncated raw TAP not green',async()=>assert.notEqual((await tap.accountFile(join(data,'truncated.tap'))).reconciled,true));
  });
  await runGroup('A10',async()=>{
    const built=await module('built-consumers.mjs'),path='scripts/verify-current-consumers.mjs';const source=blob(path).toString();
    await check('actual authenticated build-seam rendering only',()=>{const rendered=built.renderBuiltConsumerRunner(source,sha(source),join(data,'hypothetical-frozen-root'));let restored=rendered.source.replace(built.REUSED_BUILD,built.ORIGINAL_BUILD);for(const item of rendered.imports)restored=restored.replace(item.after,'from '+JSON.stringify(item.specifier)+';');assert.equal(restored,source);assert.equal(rendered.imports.length,5);result.buildSeam={path,originalSha256:sha(source),renderedSha256:sha(rendered.source),replacement:rendered.buildReplacement,imports:rendered.imports};return{imports:5,driverBuilds:1,testOwnedBuildsSeparate:true};});
    await reject('wrong runner hash',()=>built.renderBuiltConsumerRunner(source,'0'.repeat(64),data));await reject('missing exact seam',()=>{const changed=source.replace(built.ORIGINAL_BUILD,'');built.renderBuiltConsumerRunner(changed,sha(changed),data);});
  },'No production build, typing or current-consumer execution. Actual reused emitted artifacts/lineage integration remains UNEXECUTED; original universal-one-build assertion is not rescored.');
  await runGroup('A11',async()=>{
    await check('full expected c109 binding and unchanged package source',()=>{assert.equal(common.candidate.expectedPackageSha256,binding.packSha256);assert.equal(profile.expectedPackageSha256,binding.packSha256);assert.equal(sha(blob('package.json')),binding.packageJsonSha256);assert.equal(git(['rev-parse',binding.base+':src']).trim(),git(['rev-parse',binding.candidate+':src']).trim());return{expected:binding.packSha256,artifactHashIndependentlyVerified:false};});
    await reject('prefix-only pack binding',()=>assert.equal('c109',binding.packSha256));await reject('targeted consumer pack substituted',()=>assert.equal(sha('targeted consumer fixture'),binding.packSha256));
  },'Packet-declared retained full tarball and independently established build derivation not yet available in this execution; no new pack/build. Author two-build c109 reproduction is separate.');
  let smallRepository,smallCommit,smallEntries;
  await runGroup('A12',async()=>{
    smallRepository=fresh('tiny-git');git(['init','--quiet',smallRepository]);fs.writeFileSync(join(smallRepository,'helper.mjs'),'export const marker = 76;\n');fs.writeFileSync(join(smallRepository,'golden.bin'),'bounded golden\n');fs.symlinkSync('helper.mjs',join(smallRepository,'fixture-link'));git(['add','--','helper.mjs','golden.bin','fixture-link'],{cwd:smallRepository});git(['-c','user.name=Independent bounded fixture','-c','user.email=bounded@example.invalid','-c','core.hooksPath=/dev/null','commit','--quiet','-m','Small independent transport fixture'],{cwd:smallRepository});smallCommit=git(['rev-parse','HEAD'],{cwd:smallRepository}).trim();smallEntries=git(['ls-tree','-rlz','HEAD'],{cwd:smallRepository}).split('\0').filter(Boolean).map(row=>{const parts=/^(\d+) blob ([a-f0-9]{40})\s+(\d+)\t(.+)$/u.exec(row);return{path:parts[4],mode:parts[1],blob:parts[2],bytes:Number(parts[3])};});
    const bounds={...policy.BOUNDS,archiveEntries:smallEntries.length,archiveBytes:smallEntries.reduce((sum,entry)=>sum+entry.bytes,0)};
    await check('actual streamed Git blob extraction',async()=>{const target=fresh('transport-output');const receipt=await transport.extractCommitted({git:binding.git,repository:smallRepository,candidate:smallCommit,entries:smallEntries,destination:target,environment:cleanEnvironment,bounds});assert.ok(receipt.transferBytes<=1048576);const verified=await inventory.verifyArchive(target,smallEntries);return{receipt,verified};});
    await check('actual streamed reachable-object transfer',async()=>{const target=fresh('history-output');git(['init','--quiet',target]);const receipt=await transport.transferHistory({git:binding.git,repository:smallRepository,candidate:smallCommit,destination:target,environment:cleanEnvironment});assert.ok(receipt.bytes<=8388608);assert.equal(git(['cat-file','-t',smallCommit],{cwd:target}).trim(),'commit');return receipt;});
    for(const mutation of ['size','missing'])await reject('Git transport '+mutation,()=>{const changed=clone(smallEntries);if(mutation==='size')changed[0].bytes++;else changed[0].blob='0'.repeat(40);return transport.extractCommitted({git:binding.git,repository:smallRepository,candidate:smallCommit,entries:changed,destination:fresh('transport-'+mutation),environment:cleanEnvironment,bounds:{...bounds,archiveBytes:changed.reduce((sum,entry)=>sum+entry.bytes,0)}});});
    await reject('charge before excessive growth',()=>policy.enforceCharge(63,2,64));
  });
  await runGroup('A13',async()=>{
    for(const path of ['../escape','/absolute','a/../b','.git/config','a\\b'])await reject('transport path '+path,()=>transport.validateEntries([entryFor(path,'x')],{archiveEntries:1,archiveBytes:1}));
    await reject('duplicate declared path',()=>transport.validateEntries([entryFor('a','x'),entryFor('a','x')],{archiveEntries:2,archiveBytes:2}));
    await reject('declared link ancestor',()=>transport.validateEntries([entryFor('a','x','120000'),entryFor('a/b','x')],{archiveEntries:2,archiveBytes:2}));
    await check('normalized contained path accepted',()=>transport.validateEntries([entryFor('a/b','x')],{archiveEntries:1,archiveBytes:1}));
    fs.symlinkSync('../outside',join(smallRepository,'escape-link'));git(['add','--','escape-link'],{cwd:smallRepository});const object=git(['rev-parse',':escape-link'],{cwd:smallRepository}).trim();const entry={...entryFor('escape-link','../outside','120000'),blob:object};
    await reject('actual extraction refuses escaping symlink target',()=>transport.extractCommitted({git:binding.git,repository:smallRepository,candidate:smallCommit,entries:[entry],destination:fresh('transport-escape'),environment:cleanEnvironment,bounds:{archiveEntries:1,archiveBytes:entry.bytes}}));assert.equal(fs.existsSync(join(data,'outside')),false);
  });
  await runGroup('A14',async()=>{
    const root=fresh('delta');fs.writeFileSync(join(root,'source.mjs'),'fixed');const before=await inventory.capture(root),guard=await inventory.createTreeGuard(root);fs.mkdirSync(join(root,'dist'));fs.writeFileSync(join(root,'dist','entry.js'),'emitted');await check('only new dist accepted',async()=>inventory.requireBuildDelta(before,await inventory.capture(root)));
    fs.mkdirSync(join(root,'empty-new'));await reject('new non-dist empty directory rejected',async()=>inventory.requireBuildDelta(before,await inventory.capture(root)));await check('guard detects new empty directory',async()=>assert.ok((await guard.check()).changes.some(change=>change.path==='empty-new')));
    fs.chmodSync(join(root,'source.mjs'),0o755);await check('mode mutation detected',async()=>assert.ok((await guard.check()).changes.some(change=>change.path==='source.mjs')));fs.unlinkSync(join(root,'source.mjs'));fs.mkdirSync(join(root,'source.mjs'));await check('type mutation detected',async()=>assert.ok((await guard.check()).changes.some(change=>change.path==='source.mjs')));
  });
  await runGroup('A15',async()=>{
    const receipt=external.externalReceipt(),identity=await module('external.mjs');
    await check('qualified native49+2 membership with actual readable identities',()=>{assert.equal(profile.native.length,51);assert.equal(receipt.report.native.assets.length,51);assert.ok(externalVerified?.readableBindingsVerified,'Actual external prerequisite failed; do not skip green');return{native:51,readableToolIdentities:externalVerified.tools,logicalCommandsNotNecessarilyUniqueBinaries:true,systemReferences:external.SYSTEM_REFERENCES};});
    await reject('missing required tool',()=>identity.fileIdentity(join(data,'nonexistent-tool')));
    await reject('wrong readable tool hash',async()=>assert.deepEqual(await identity.fileIdentity(binding.node),{...receipt.report.tools.find(tool=>tool.origin===binding.node),sha256:'0'.repeat(64)}));
    for(const mutation of ['new-reference','host','readable'])await reject('system boundary '+mutation,()=>{const changed=clone(receipt.report);if(mutation==='new-reference')changed.linkage[0].dependencies[0].path='/opt/homebrew/lib/unbound.dylib';if(mutation==='host')changed.host.stdout='ProductVersion: 26.4.2\nBuildVersion: 25E253\n';if(mutation==='readable')changed.linkage[0].dependencies[0].identity={sha256:'x'};external.validateSystemBoundary(changed);});
    await reject('newly readable system reference requires hash',()=>external.verifyUnreadableSystemReferences(async()=>({sha256:'x'})));
  });
  await runGroup('A16',async()=>{
    await check('exact256 cleanup candidate/hash membership',()=>{const cleanup=JSON.parse(fs.readFileSync(join(directory,'CLEANUP.json')));assert.deepEqual(cleanup,profile.cleanup);assert.equal(Object.keys(cleanup.files).length,256);assert.equal(cleanup.revision,binding.candidate);return{count:256,old244HistoricalOnly:true,sha256:binding.cleanupSha256};});
    for(const mutation of ['missing','wrong-hash','stale-revision'])await reject('actual profile cleanup '+mutation,()=>{const changed=clone(profile),path=Object.keys(changed.cleanup.files)[0];if(mutation==='missing')delete changed.cleanup.files[path];if(mutation==='wrong-hash')changed.cleanup.files[path]='0'.repeat(64);if(mutation==='stale-revision')changed.cleanup.revision=binding.base;profileModule.validateProfile(changed);});
  });
  await runGroup('A17',async()=>{
    const supervisor=await module('supervise.mjs');
    const probe=async(name,code,timeoutMs,maxOutputBytes=65536)=>{const receipt=await supervisor.supervise(binding.node,['-e',code],{cwd:data,env:cleanEnvironment,stdout:join(data,name+'.stdout'),stderr:join(data,name+'.stderr'),timeoutMs,maxOutputBytes});result.effects.push({name,...receipt});assert.deepEqual(receipt.survivors,[]);assert.equal(receipt.closed,true);return receipt;};
    await check('natural process closes cleanly',async()=>{const receipt=await probe('natural','console.log("natural marker")',5000);assert.equal(receipt.status,0);assert.equal(receipt.clean,true);return receipt;});
    await check('timeout is non-green even after successful drain',async()=>{const receipt=await probe('timeout','setInterval(()=>{},100)',250);assert.equal(receipt.timedOut,true);assert.equal(receipt.clean,false);return receipt;});
    await check('output overflow is non-green',async()=>{const receipt=await probe('overflow','process.stdout.write("x".repeat(32768)); setTimeout(()=>{},1000)',5000,1024);assert.equal(receipt.outputExceeded,true);assert.equal(receipt.clean,false);return receipt;});
    await check('observed descendant is reaped and forced cleanup stays non-green',async()=>{const receipt=await probe('descendant',`require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},4000)'],{stdio:'inherit'});setTimeout(()=>process.exit(0),400)`,6000);assert.ok(receipt.observed.length>=2);assert.ok(receipt.signals.length>0);assert.equal(receipt.clean,false);return receipt;});
  });
  await runGroup('A18',async()=>{},'Product registered-before-acquisition, sibling output scopes, root cleanup barrier and opaque-host behavior not executed. Supervisor tests are NOT substitutes; root/public integration is outside this bounded authorization.');
  const green={candidate:binding.candidate,bindingComplete:true,guardsPassed:true,driverProductionBuilds:1,cleanupComplete:true,phases:policy.PHASES.map(([label,status])=>({label,status,clean:true,closed:true,signal:null,survivors:[],signals:[]})),canonical:{reconciled:true,counts:{pass:1,fail:0,skipped:0,todo:0,cancelled:0}},canonicalMissingPaths:[]};
  await runGroup('A19',async()=>{
    await check('clearly synthetic strict policy positive (not a gate report)',()=>assert.equal(policy.gateVerdict(green).exitCode,0));
    const mutations={guard:value=>value.guardsPassed=false,cleanup:value=>value.cleanupComplete=false,binding:value=>value.bindingComplete=false,secondBuild:value=>value.driverProductionBuilds=2,survivor:value=>value.phases[0].survivors=[{pid:1}],forcedCleanup:value=>value.phases[0].signals=['SIGTERM'],wrongStatus:value=>value.phases[0].status=1,unclosed:value=>value.phases[0].closed=false,missingPhase:value=>value.phases.pop(),missingCapture:value=>value.canonical.reconciled=false,missingPath:value=>value.canonicalMissingPaths=['unexecuted']};for(const field of ['skipped','todo','cancelled','fail'])mutations[field]=value=>value.canonical.counts[field]=1;
    for(const[name,mutate]of Object.entries(mutations))await check('strict nonzero HOLD '+name,()=>{const changed=clone(green);mutate(changed);const verdict=policy.gateVerdict(changed);assert.equal(verdict.exitCode,1);assert.equal(verdict.status,'HOLD_OR_QUALIFIED_RED');return verdict;});
  });
  await runGroup('A20',async()=>{
    const before=await inventory.capture(data),saved=process.argv.slice();process.argv=[binding.node,join(directory,'run.mjs'),'--candidate',binding.candidate,'--run','/tmp/full-gate-unified76-independent-never-created','--release',join(data,'NO-RELEASE.json'),'--committed-archive'];
    const run=await module('run.mjs');await module('worker.mjs');process.argv=saved;
    await check('run/worker imports inert despite spoofed argv',async()=>{assert.deepEqual(inventory.compare(before,await inventory.capture(data)),[]);assert.ok(!result.moduleTrace.some(entry=>entry.path===join(directory,'execute.mjs')));});
    await check('actual legitimate unreleased --run refuses before product work',async()=>{let error;try{await run.main(['--candidate',binding.candidate,'--run','/tmp/full-gate-unified76-independent-never-created','--release',join(data,'NO-RELEASE.json'),'--committed-archive']);}catch(observed){error=observed;}assert.ok(error);assert.equal(error.code,'ENOENT','If prerequisite failed first, release-check boundary is not established');assert.match(error.message,/NO-RELEASE/u);assert.equal(fs.existsSync('/tmp/full-gate-unified76-independent-never-created'),false);return{error:String(error),noReleaseCreated:true,noWorkerOrProductLoaded:true};});
    await reject('obsolete --execute refused',()=>policy.parseArgs(['--candidate',binding.candidate,'--execute','/tmp/full-gate-unified76-unused','--release',join(data,'NO-RELEASE.json'),'--committed-archive']));await reject('no explicit flag',()=>policy.parseArgs([]));await reject('load sentinel itself denies execute module',()=>module('execute.mjs'));
  });
  await runGroup('A21',async()=>{
    const checker=await module('data/helpers/tests/plugins/qualified-current-release/inventory-check.mjs'),consumers=await module('data/helpers/tests/plugins/qualified-current-release/consumers.mjs'),records=JSON.parse(blob('tests/plugins/qualified-current-release/inventory.json'));
    const current=consumers.currentConsumerPaths(),negative=consumers.negativeGroups.map(record=>record.path),tracked=entries.map(entry=>entry.path),read=path=>blob(path);
    const verify=record=>checker.verifyInventory(record,tracked,current,negative,read);
    await check('actual selected inventory including NONCURRENT nested evidence',()=>verify(records));
    const path='tests/fs/webdav/consumer/provider.mts',currentRecord=records.entries.find(entry=>entry.path===path),route=consumers.consumerGroups.find(record=>record.files.includes(path)),actual=entries.find(entry=>entry.path===path);
    const providerPredicate=(routeName,entry,bytes)=>{assert.equal(routeName,'webdav-loopback');assert.equal(entry.blob,'21f5fe464f028b4e056d2aae40b26612f560bd95');assert.equal(sha(bytes),'af9ffdb0f991696818512c5f50dab94fdb76387d3b66a2abca80fb799d6d30b6');};
    await check('CURRENT actual candidate route/blob/byte authority',()=>{providerPredicate(route.name,actual,read(path));assert.equal(currentRecord.sha256,'288d17dca5b6950fababb945cf21c15594dfbf37897d1cdcaab2aba1088a6b9b');return{path,route,actual,oldInformationalSha256:currentRecord.sha256,actualSha256:sha(read(path)),oldExit1Preserved:true};});
    await reject('CURRENT wrong route',()=>providerPredicate('wrong',actual,read(path)));await reject('CURRENT wrong blob',()=>providerPredicate('webdav-loopback',{...actual,blob:'0'.repeat(40)},read(path)));await reject('CURRENT actual byte mutation',()=>providerPredicate('webdav-loopback',actual,Buffer.from('mutation')));
    await reject('actual checker missing route',()=>checker.verifyInventory(records,tracked,current.filter(name=>name!==path),negative,read));
    for(const mutation of ['unknown','noncurrent-hash','captured-evidence'])await reject('inventory '+mutation,()=>{const changed=clone(records);if(mutation==='unknown')changed.entries[0].classification='unclassified';if(mutation==='noncurrent-hash')changed.entries.find(entry=>entry.classification!=='current').sha256='0'.repeat(64);if(mutation==='captured-evidence')changed.entries.find(entry=>entry.freeze).freeze.evidence[0].sha256='0'.repeat(64);verify(changed);});
  });
  await runGroup('A22',async()=>{
    await check('all original/v2/v3 artifacts byte-immutable',()=>{for(const name of oldNames){const old=blob('tests/integration/full-gate-20260827/unified76-driver-independent/'+name,plan.workspaceReceipt.historyCommit);assert.equal(sha(old),history[name]);assert.equal(sha(fs.readFileSync(join(directory,'..',name))),history[name]);}return history;});
    await check('provenance and denominators disjoint',()=>{result.historical={original22:'NOT_EXECUTED historical assertions; only v4 versioned controls scored',Meitner:'71 PASS / 7 NOT_EXECUTED unchanged',staticF01v2:'10 controls separate; old exit1 retained',authorComponents:'34+12 separate',authorLauncher:'56 separate',authorFixtures:'49 PASS / 1 missing-helper launch failure, then separate19/19 prior-unexecuted bodies',supersededCandidate2ff:'20/1 remains historical; not rescored'};assert.equal(result.groups.length,22);assert.equal(result.rootRelease,'HOLD');return result.historical;});
  });
}catch(error){result.infrastructureError={error:String(error),stack:error.stack};}
finally{
  hooks.deregister();childProcess.spawn=originalSpawn;syncBuiltinESMExports();
  for(const file of staged){const expected=allowed.get(file);assert.equal(sha(fs.readFileSync(file)),expected,'staged frozen bytes changed');fs.unlinkSync(file);}
  for(const name of oldNames)assert.equal(sha(fs.readFileSync(join(directory,'..',name))),history[name]);
  result.finished=new Date().toISOString();result.workspaceAfter={head:git(['rev-parse','HEAD']).trim(),index:git(['diff','--cached','--raw'])};
  result.summary=Object.fromEntries(['PASS','FAIL','HOLD'].map(status=>[status,result.groups.filter(group=>group.status===status).length]));
  result.processCapture=result.effects.map(effect=>({name:effect.name,stdout:fs.readFileSync(join(data,effect.name+'.stdout'),'utf8'),stderr:fs.readFileSync(join(data,effect.name+'.stderr'),'utf8')}));
  result.generatedData=await inventory.capture(data);assert.ok(result.generatedData.entries.reduce((sum,entry)=>sum+(entry.bytes??0),0)<=67108864);fs.rmSync(data,{recursive:true});result.ownedTemporaryTreeRemoved=!fs.existsSync(data);
  result.rawCommandCount=raw.length;
  const commandsPath=join(directory,'RAW-COMMANDS.ndjson');const bytes=raw.map(record=>JSON.stringify(record)+'\n').join('');assert.ok(Buffer.byteLength(bytes)<=33554432);fs.writeFileSync(commandsPath,bytes,{flag:'wx'});
  save('RESULTS.json',result);console.log(JSON.stringify({summary:result.summary,infrastructureError:result.infrastructureError,rawCommandCount:raw.length,wholeGateLaunched:false}));
}
