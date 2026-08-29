import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const own=path.dirname(fileURLToPath(import.meta.url));
const root='/Users/kjopek/Workspace/safe-bash';
const author=root+'/tests/compatibility/bash-ere-core-public-pilot-preparation-20260829/runtime-author-v1';
const relative=path.relative(root,own);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(filename,limit=2097152){const stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=limit);const bytes=fs.readFileSync(filename);assert.equal(bytes.length,stat.size);return bytes;}
function git(args){const child=spawnSync('/usr/bin/git',['-c','gc.auto=0','-c','maintenance.auto=false',...args],{cwd:root,stdio:['ignore',1,2]});assert.equal(child.status,0);}
const profileBytes=read(author+'/PROFILE.json');assert.equal(hash(profileBytes),'446f44cea9091ce59a12c5591bc1d6e91049003848bef33bd75f520c98728aa6');
const profile=JSON.parse(profileBytes),inspection=JSON.parse(read(own+'/INSPECTION.json'));
for(const [name,pin]of Object.entries(inspection.sources)){const bytes=read(author+'/'+name,32768);assert.equal(bytes.length,pin.bytes);assert.equal(hash(bytes),pin.sha256);}
const {bind,archiveAdmission}=await import(pathToFileURL(author+'/data.mjs'));
for(const row of profile.assets)bind(row);for(const row of profile.tools)bind(row);
bind(profile.archive);const compressed=read(profile.archive.path,909885);assert.equal(archiveAdmission(profile.archive,compressed),compressed);
const original=read(author+'/controls.mjs',32768).toString();assert.ok(original.startsWith("import './prepare.mjs';\n"));
let controls=original.slice("import './prepare.mjs';\n".length);
for(const name of ['observer.mjs','process-owner.mjs','core.mjs','data.mjs'])controls=controls.replaceAll("'./"+name+"'",JSON.stringify(pathToFileURL(author+'/'+name).href));
const oldTarget="path.join(root, 'PURE-RECEIPT.json')";assert.equal(controls.split(oldTarget).length,2);controls=controls.replace(oldTarget,JSON.stringify(own+'/AUTHOR-REPLAY.json'));
controls=controls.replace("evaluatedModules: ['prepare.mjs', 'core.mjs'", "evaluatedModules: ['core.mjs'");
const source=read(author+'/coordinator.mjs',32768).toString();
const finalMatch=source.match(/finally \{ for \(const descriptor of descriptors\) fs\.closeSync\(descriptor\); if \(ownership\.every\(row => row\.receipt\.retired\)\) retainedInvocations\.delete\(ownerRoot\); \}/);assert.ok(finalMatch);
const seal={utc:new Date().toISOString(),profileSha256:hash(profileBytes),sourceHashes:inspection.sources,helperSha256:hash(read(fileURLToPath(import.meta.url))),originalControlsSha256:hash(Buffer.from(original)),executedControlsSha256:hash(Buffer.from(controls)),exactFinally:finalMatch[0],controlGroups:15,actualWorkers:0,actualChildren:0,toolRecords:profile.tools.length,archive:profile.archive};
fs.writeFileSync(own+'/EXECUTION-SEAL.json',JSON.stringify(seal,null,2)+'\n',{flag:'wx'});fs.writeFileSync(own+'/author-controls-version.mjs',controls,{flag:'wx'});
git(['add','--',relative]);git(['commit','--only','-m','test: preseal CORE pilot source-linked PURE successor','--',relative]);
await import(pathToFileURL(own+'/author-controls-version.mjs'));
const authorReceipt=JSON.parse(read(own+'/AUTHOR-REPLAY.json'));assert.equal(authorReceipt.count,10);
const {createObserver}=await import(pathToFileURL(author+'/observer.mjs'));
const {captureBudget,writer,schedule,validateSelection}=await import(pathToFileURL(author+'/core.mjs'));
const novel=[],probes=[];
async function control(id,body){try{await body();novel.push({id,status:'PASS'});}catch(reason){novel.push({id,status:'FAIL',error:String(reason),stack:String(reason?.stack??'')});}}
await control('N01-undefined-identity-after-acquisition',()=>{
  class IdentityFault extends EventEmitter{constructor(url,options){super();this.url=url;this.options=options;this.stdout=new EventEmitter();this.stderr=new EventEmitter();}get threadId(){throw undefined;}postMessage(){}terminate(){throw Error('no recovery');}}
  const url=new URL('file:///fixed/worker-entry.js'),options=Object.freeze({});
  const observer=createObserver({NativeWorker:IdentityFault,expectedUrl:url.href,emit(){}});
  const worker=new observer.Constructor(url,options);assert.equal(observer.owned[0].worker,worker);assert.equal(worker.url,url);assert.equal(worker.options,options);
  assert.equal(observer.failures.state.present,true);assert.equal(observer.failures.state.reason,undefined);
  assert.equal(worker.stdout.listenerCount('end'),1);assert.equal(worker.stderr.listenerCount('end'),1);assert.equal(worker.terminate,IdentityFault.prototype.terminate);
  worker.emit('exit',0);worker.stdout.emit('end');worker.stderr.emit('end');assert.throws(()=>observer.assertRetired());
});
await control('N02-partial-false-no-refund',()=>{
  const aggregate=captureBudget(4);let calls=0;
  const sink=writer({maximum:4,aggregate,write(){calls++;if(calls===1)return 1;throw false;}});
  let present=false;try{sink.bytes(Buffer.from('abcd'));}catch(reason){present=true;assert.equal(reason,false);}assert.equal(present,true);
  assert.equal(aggregate.snapshot().admitted,4);assert.equal(sink.snapshot().written,1);const before=calls;assert.throws(()=>sink.bytes(Buffer.from('x')));assert.equal(calls,before);
});
await control('N03-fit-after-sample-no-next',async()=>{
  let current=1007000,runs=0,samples=0;
  const result=await schedule(profile,{started:0,now:()=>current,prepare:async()=>{},sample:async()=>{samples++;current=1007001;},run:async()=>{runs++;throw Error('must not run');},publish:async()=>{},emergency:async()=>{}});
  assert.equal(runs,0);assert.equal(result.outcomes.length,24);assert.ok(result.outcomes.every(row=>row.status==='UNRUN'));assert.equal(result.complete,false);assert.ok(samples>=1);
});
await control('N04-selector-and-oracle-identity',()=>{
  const duplicate=[...profile.cells];duplicate[1]=duplicate[0];assert.throws(()=>validateSelection(duplicate));const hole=[...profile.cells];delete hole[1];assert.throws(()=>validateSelection(hole));
  for(let index=0;index<8;index++){assert.deepEqual(profile.cells[index].definition,profile.cells[index+8].definition);assert.deepEqual(profile.cells[index].definition,profile.cells[index+16].definition);assert.deepEqual(profile.cells[index].inheritedLimits,profile.cells[index+16].inheritedLimits);}
});
await control('N05-coordinator-finally-preserves-primary',()=>{
  const probe=vm.runInNewContext('(function(fs,descriptors,ownership,retainedInvocations,ownerRoot,primary){try{throw primary;} '+finalMatch[0]+'})');
  const ownerRoot={},retained=new Set([ownerRoot]);let closes=0,present=false,observed;
  try{probe({closeSync(){closes++;throw false;}},[17],[],retained,ownerRoot,0);}catch(reason){present=true;observed=reason;}
  probes.push({id:'N05',sourceSha256:inspection.sources['coordinator.mjs'].sha256,exactFinally:finalMatch[0],sourceDerivedNotWholeCoordinator:true,primary:0,closeReason:false,observedPresent:present,observed,closeCalls:closes,retainedAfter:retained.has(ownerRoot)});
  assert.equal(present,true);assert.equal(observed,0,'journal close must not mask original raw0');assert.equal(retained.has(ownerRoot),false);
});
for(const row of profile.assets)bind(row);for(const row of profile.tools)bind(row);bind(profile.archive);
const margin=268435456-254938146;assert.equal(margin,13497310);
const result={utc:new Date().toISOString(),profileSha256:hash(profileBytes),author:authorReceipt,novel,sourceProbes:probes,passed:authorReceipt.passed+novel.filter(row=>row.status==='PASS').length,total:15,verdict:novel.some(row=>row.status==='FAIL')||authorReceipt.passed!==10?'HOLD_SOURCE_FINDING':'QUALIFIED_PREEXEC_PENDING_OUTER_BINDING',actualWorkers:0,actualChildren:0,archiveInflations:0,productImports:0,coordinatorEvaluated:false,cellEvaluated:false,logicalMarginBytes:margin,knownConservativePublicationInclusive:32,maximumKnownOS:36,peak:2,oldCaptureStopPreserved:true};
fs.writeFileSync(own+'/RESULT.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
const report=[
 '# CORE public pilot independent SOURCE/PURE review',
 `${result.verdict}. Author${authorReceipt.passed}/10 plus novel${novel.filter(row=>row.status==='PASS').length}/5 = ${result.passed}/15 expected groups. No actual Worker/native child/product/coordinator/cell/npm/install/build/compiler or archive inflation.`,
 'N05 is a source-linked coordinator harness defect, not engine finding. Exact finally lets closefalse replace raw0 and skips retainedInvocations.delete despite no outstanding child. PURE extracted control flow, not whole coordinator or native fault. Old source/control passes and ab57 STOP preserved.',
 'Minimal author scope: coordinator cleanup/publication provenance. Independently attempt close/bookkeeping, retain primary presence/identity and bounded ordered secondaries; keep genuinely UNKNOWN references. Neighbor catch emergencyJournal-before-rethrow and journal acquisition outside protected try need source review; not dynamically tested here.',
 'Exact R01/R02/R05/R06/R07/R11/R12/R22 across three layouts:24 calls,30 regex visits,at most24 Workers one-live. Same definitions/oracles/limits checked. Fit rechecked after sample; N03 one-ms-short prevents next call and records24UNRUN. No promise all24 finish under global bound.',
 'Observer forwards original URL/options/actual fake Worker, retains before identity/enrollment, independently observes streams, no method mutation/terminate/recovery. N01 rawundefined retained. Pure doubles are not real native lifetime evidence. Cell intercepts constructor before public import, not stock; no explicit Shell.dispose call, hence no new disposal proof.',
 `Profile ${hash(profileBytes)}; repaired4abb archive ${profile.archive.sha256},909885B. Type/size/hash before use, archiveAdmission returns same Buffer, no inflate. Existing1305/1002/1002 DATA sets and24 configs verified, NOT actual install/move. Node+2027 npm regular pins rechecked, not appended-file/symlink directory census; final binding needs explicit trusted-npm directory qualification.`,
 'Prospective40 knownOS/36 enumerated/peak4,24Workers one-live,1200s incl180pub,64MiB capture,256MiB sampled work. Conditional254938146B leaves13497310B (~12.87MiB,5.03%) headroom. Two32MiB sampled npm areas, bounded metadata/capture/copy assumptions required. Not prewrite work bound/RSS/native peak/atomic snapshot/kernelquota; no live cache census.',
 'Startup outer8MiB reservation postchecked, not prewrite/EOF proof; Git internal physical storage excluded. No qualified outer owner/window supplied. After source repair, bind exact owner/command/role graph/monotonic origin before bootstrap, wall expiry, capture accounting, final publication/sample and UNKNOWN ownership cleanup. No actual24GO or fullCORE/T1 acceptance; private135/six deferred/seven broader gates OPEN.',
 'Review: two DATA/PURE helpers; editor TTY line-cap failure interrupted before source application, then fixed patch redirection used. No executed control retry.32 conservative known-role allowance incl publication/readout, peak2, no global descendant/native-thread count. Captures retained; own scoped status checked.'
].join('\n\n')+'\n';
fs.writeFileSync(own+'/REPORT.md',report,{flag:'wx'});
fs.mkdirSync(own+'/raw');for(const [filename,name]of [['/tmp/core-pilot-review-v2-inspect.stdout','inspect.stdout'],['/tmp/core-pilot-review-v2-inspect.stderr','inspect.stderr'],['/tmp/core-pilot-review-v2-controls-edit.stderr','editor.stderr']])fs.copyFileSync(filename,own+'/raw/'+name,fs.constants.COPYFILE_EXCL);
git(['add','--',relative]);git(['commit','--only','-m','test: retain CORE pilot coordinator finalization finding','--',relative]);git(['status','--porcelain','--',relative]);git(['rev-parse','HEAD']);
console.log(JSON.stringify({utc:new Date().toISOString(),verdict:result.verdict,pass:result.passed,total:15,receiptSha256:hash(read(own+'/RESULT.json')),sourceProbes:probes,activeOwnedChildren:0}));
process.exitCode=result.passed===15?0:1;
