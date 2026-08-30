import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,lstatSync,readlinkSync,existsSync,rmSync,createWriteStream} from 'node:fs';
import {join,dirname,relative,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGzip} from 'node:zlib';
import {once} from 'node:events';
import {finished} from 'node:stream/promises';
const owned=dirname(fileURLToPath(import.meta.url)),repository='/Users/kjopek/Workspace/safe-bash';
const read=name=>JSON.parse(readFileSync(join(owned,name)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=(name,value)=>writeFileSync(join(owned,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const bindings=read('BINDINGS.json'),first=read('COMPONENT-RESULTS.json'),second=read('COMPONENT-FOLLOWUP-RESULTS.json'),last=read('SAFE-REMAINDER-RESULTS.json');
const cohorts=[first,second,last];
for(const[path,hash]of Object.entries(bindings.prior))assert.equal(sha(readFileSync(join(repository,path))),hash,'historical independent artifact changed: '+path);
const tools=[];
for(const[path,identity]of Object.entries(bindings.tools)){
  assert.equal(sha(readFileSync(path)),identity.sha256,'tool changed during review');
  const declared=bindings.externalTools.find(entry=>entry.origin===path);
  if(declared){assert.equal(identity.sha256,declared.sha256);assert.equal(identity.bytes,declared.bytes);}
  else{assert.equal(path,'/usr/bin/sandbox-exec');assert.equal(identity.sha256,last.shipping.envelope.external.binary.sha256);}
  tools.push({path,sha256:identity.sha256,declaredIdentityMatched:true});
}
const observed=cohorts.flatMap(cohort=>[...cohort.shipping.result.observed,...cohort.shipping.phaseReceipt.events.flatMap(event=>event.result?.observed??[])]);
const ps=execFileSync('/bin/ps',['-axo','pid=,ppid=,pgid=,lstart=,command='],{encoding:'utf8',timeout:5000,maxBuffer:8*1024*1024});
const processes=ps.trim().split('\n').map(line=>{const fields=line.trim().split(/\s+/u);return{pid:Number(fields[0]),parent:Number(fields[1]),group:Number(fields[2]),born:fields.slice(3,8).join(' '),command:fields.slice(8).join(' ')};});
const identities=[...new Map(observed.map(entry=>[entry.pid+':'+entry.born,entry])).values()];
const survivors=identities.filter(entry=>processes.some(current=>entry.pid===current.pid&&entry.born===current.born));assert.deepEqual(survivors,[],'owned observed process survives');
assert.ok(cohorts.every(cohort=>cohort.sentinel.survived&&cohort.sentinel.close.signal==='SIGTERM'));
const roots=[bindings.temporary,...cohorts.flatMap(cohort=>cohort.shipping.envelope.roots.map(entry=>entry.path))];assert.equal(new Set(roots).size,roots.length);
const metadata=[],instructionPaths=[];let bytes=0;
function walk(root,current=root){
  for(const name of readdirSync(current).sort()){
    const path=join(current,name),stat=lstatSync(path);const entry={root,path:relative(root,path),mode:stat.mode&0o777,device:stat.dev,inode:stat.ino,links:stat.nlink};
    if(/^agents\.md$/iu.test(name)){instructionPaths.push(path);entry.kind='instruction-name-metadata-only';metadata.push(entry);continue;}
    if(stat.isSymbolicLink()){entry.kind='symlink';entry.target=readlinkSync(path);}
    else if(stat.isDirectory()){entry.kind='directory';metadata.push(entry);walk(root,path);continue;}
    else{assert.ok(stat.isFile());entry.kind='file';entry.bytes=stat.size;bytes+=stat.size;assert.ok(bytes<=64*1024*1024,'frozen scratch bound');entry.sha256=sha(readFileSync(path));}
    metadata.push(entry);
  }
}
for(const root of roots){assert.match(root,/^\/private\/tmp\/(?:unified76-independent-os-v8-|unified76-os-write-|unified76-build-types-review-independent-os-v8-)/u);assert.ok(lstatSync(root).isDirectory());walk(root);}
assert.deepEqual(instructionPaths,[],'unexpected physical instruction name: do not read payload');
const rawRoots=[join(bindings.temporary,'raw'),join(bindings.temporary,'raw-followup'),join(bindings.temporary,'raw-safe-remainder'),...cohorts.map(cohort=>cohort.shipping.envelope.roots[1].path)];
const rawEntries=metadata.filter(entry=>entry.kind==='file'&&rawRoots.some(root=>join(entry.root,entry.path).startsWith(root+'/')));
const stream=createGzip({level:9}),destination=createWriteStream(join(owned,'RAW.ndjson.gz'),{flags:'wx'});stream.pipe(destination);
let captureBytes=0;const rawHash=createHash('sha256');
for(const entry of rawEntries){assert.ok(entry.bytes<=1024*1024);const bytes=readFileSync(join(entry.root,entry.path));captureBytes+=bytes.length;assert.ok(captureBytes<=16*1024*1024);const line=JSON.stringify({...entry,bodyBase64:bytes.toString('base64')})+'\n';rawHash.update(line);if(!stream.write(line))await once(stream,'drain');}
stream.end();await finished(destination);
save('RAW-INDEX.json',{schema:1,encoding:'gzip of UTF8 NDJSON containing exact small raw file bytes as base64',files:rawEntries,rawFileBytes:captureBytes,ndjsonSha256:rawHash.digest('hex'),gzipSha256:sha(readFileSync(join(owned,'RAW.ndjson.gz'))),noSourceOrInstructionPayloadCopies:true});
save('FILESYSTEM.json',{roots,entries:metadata,regularBytes:bytes,instructionPaths,qualification:'Complete post-cohort lstat/hash namespace, symlinks not followed. Does not claim every intermediate namespace state or hard RSS limit.'});
const sevenNew76Proofs=[{id:'binding-complete',status:'HOLD_DIRECTORY_IMPORT_POLICY_COUNTEREXAMPLE_NEW_RELEASE_ABSENT'},...['binding-pending-template','binding-mutable-head','binding-missing-asset','binding-missing-classification','binding-missing-cleanup-manifest','binding-skipped-case'].map(id=>({id,status:'PRIOR_BOUNDED_REFUSAL_HISTORY_NOT_RERUN_ON_NEW_SOURCE'}))];
save('RESULTS.json',{
  schema:1,status:'HOLD_NOT_SCOPED_DRIVER_ACCEPTANCE',source:bindings.source,additionalControls:bindings.additionalControls,evidence:bindings.evidence,candidate:bindings.candidate,driverSha256:bindings.normalizedDriverSha256,profileSha256:bindings.profileSha256,projectionSha256:bindings.projectionSha256,packet:bindings.packet,
  commands:[{command:'node24 prepare.mjs',exit:0,scope:'metadata/copy only; no author imports'},{command:'node24 review.mjs',exit:1,scope:'initial setup failure; no probe completed'},{command:'node24 review-followup.mjs',exit:1,scope:'ordinary0,names0,imports1; later phases not started'},{command:'node24 review-safe-remainder.mjs',exit:0,scope:'descendants0,shipping-fds0; explicit FD limitation observed'}],
  cohorts:{initial:{passed:0,failedSetup:1,probeExecuted:0},corrected:{completePhasePass:2,phaseFailure:1,notStarted:['descendants','shipping-fds','explicit-fd-limitation']},safeRemainder:{completePhasePass:2,explicitFdLimitationObserved:1}},
  matrix:[{id:'F01',status:'PARTIAL_STATIC_BINDING_AND_SHIPPING_CALLPATH; FULL_EXTERNAL_CLOSURE_NOT_REVERIFIED'},{id:'F02',status:'NODE_ORDINARY_AND_BACKSLASH_PASS; NATIVE_CREATE_APPEND_PASS; NATIVE_RENAME_NOT_EXECUTED'},{id:'F03',status:'HOLD_OUTSIDE_DIRECTORY_SYMLINK_IMPORT_ALLOWED; SEVEN_INSTRUCTION_NAME_OPERATIONS_DENIED'},{id:'F04',status:'PASS_SCOPED_ENV_CLEARED_NODE_NATIVE_DESCENDANTS'},{id:'F05',status:'PASS_SHIPPING_CANARY_FD_NOT_INHERITED; RAW_EXPLICIT_FD_WRITE_ESCAPE_OBSERVED'},{id:'F06',status:'NOT_EXECUTED_STOPPED_AFTER_F03_COUNTEREXAMPLE'},{id:'F07',status:'NATURAL_WORKER_PHASE_CLOSE_AND_THREE_FOREIGN_SENTINELS_VERIFIED; LEAK_MUTANT_NOT_EXECUTED'},{id:'F08',status:'NOT_EXECUTED_NEW_FENCE_A10_ADMISSION_STOPPED_AFTER_F03'}],
  attempts:{instructionNameOperations:9,denied:9,unexpectedInstructionFilesObserved:0,qualification:'Seven direct create/rename/link attempts plus one cleared-env Node and one native instruction write. Outside-directory symlink publication succeeded; do not call zero attempts or universal no-copy proof.'},
  counterexample:'FINDING.json',fdLimitation:last.fdLimitation,tools,systemBoundary:{originalReferencePairs:11,additionalReferencePairs:2,additional:last.shipping.envelope.external.systemReferences,qualification:'Only macOS26.4.1/build25E253 metadata-qualified references; not13 unique libraries/binaries, no readable library filehash or full OS attestation. No new exception introduced.'},
  provenance:{driverFilesVerified:Object.keys(bindings.files).length,guardOrigin:'candidate:tests/integration/full-gate-20260827/combined-8670ebe8/import-guard.mjs',guardSha256:sha(readFileSync(join(bindings.temporary,'guard.mjs'))),osFenceSourceSha256:bindings.files['os-instruction-fence.mjs'].sha256,supervisorSourceSha256:bindings.files['fenced-supervisor.mjs'].sha256,qualification:'Fresh regular copies exactly match frozen driver Git blobs; custom benign component probes only. Actual shipping phaseRunner and outer OS launch used. No independent write interceptor; copied compiler entry bytes never executed. Short-lived grandchildren may escape polling; child output/status is separately retained.'},
  history:{priorArtifactsUnchanged:Object.keys(bindings.prior).length,original22:'21 inherited+1 scoped5c32 history unchanged; not rerun',projection:'e584515f scoped8/A10/13observer unchanged; not new OS-fence A10 proof',oldFullAttempt:'a9ec/31d stopped0/14 and forbidden-copy incident preserved',authorCountsCountedAsIndependent:0},
  sevenNew76Proofs,package:{sha256:'c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd',status:'CARRIED_IDENTICAL_CANDIDATE_NO_REPACK_NO_NEW_EMIT'},publicPrerequisites:'Root HTML/DU/Expr accepted; no old pending-state reinterpretation',fullGateLaunched:false,rootRelease:'ABSENT_HOLD',privateAccess:false,
  limitations:['No full Git/archive reconstruction or A10/832 emits on this new fence after actual F03 failure','No inherited directory-stream or separate read-only-FD control; r+ canary supplied intentional writable FD limitation','Only observed natural child closures and foreign sentinels; no new leak/forcedcleanup mutant','No hard RSS/disk watchdog claim; all completed bounded processes below recipe deadlines and measured scratch/capture budgets','This publication counterexample does not establish outside write-through escape or instruction plaintext materialization']
});
for(const root of roots)rmSync(root,{recursive:true,force:false});
assert.ok(roots.every(root=>!existsSync(root)));
for(const[path,hash]of Object.entries(bindings.prior))assert.equal(sha(readFileSync(join(repository,path))),hash);
save('CLEANUP.json',{at:new Date().toISOString(),removedRoots:roots,allAbsent:true,priorArtifactsUnchanged:Object.keys(bindings.prior).length,observedIdentities:identities,survivors,sentinels:cohorts.map(cohort=>cohort.sentinel),qualification:'Only exact review-created roots removed; no foreign cleanup, no real-user processes signalled. Sentinels deliberately terminated by their own controllers, not natural completion. All watched workers/phases closed naturally, including failing phases. No product/native/fullgate process launched.'});
console.log(JSON.stringify({status:'SEALED_HOLD',priorArtifacts:Object.keys(bindings.prior).length,rawFiles:rawEntries.length,captureBytes,scratchBytes:bytes,observedIdentities:identities.length,removedRoots:roots.length}));
