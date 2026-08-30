import assert from 'node:assert/strict';
import {createReadStream,createWriteStream,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGzip,createGunzip} from 'node:zlib';
import {Transform,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const directory=dirname(fileURLToPath(import.meta.url)),repository=resolve(directory,'../../../../..');
const output='/private/tmp/full-gate-unified76-f5-scopedenv-20260828-r2';
const outer=realpathSync('/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/unified76-supervisor-lltDvB');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.deepEqual(process.argv.slice(2),['--capture-closed-attempt']);
const report=JSON.parse(readFileSync(join(output,'REPORT.json'))),supervisor=JSON.parse(readFileSync(join(outer,'REPORT.json')));
const packet=JSON.parse(readFileSync(join(directory,'../release-packet-v3-inherited-routes/PACKET.json')));
assert.equal(report.candidate,packet.product.candidate);assert.equal(report.driverSha256,packet.driver.normalizedSha256);
assert.equal(report.phases.length,0);assert.equal(report.driverProductionBuilds,0);assert.equal(supervisor.result.status,1);assert.equal(supervisor.result.closed,true);
assert.deepEqual(supervisor.result.signals,[]);assert.deepEqual(supervisor.result.survivors,[]);
assert.equal(report.inheritedHelperRoutes.length,1);assert.equal(report.inheritedHelperRoutes[0].restored,true);assert.equal(report.inheritedHelperRoutes[0].poisoned,false);
assert.match(report.error.message,/mandatory native fixture authority profile unavailable/u);
const authorityPath=join(report.temporary,'native-fixture-authority.json'),authority=JSON.parse(readFileSync(authorityPath));
assert.deepEqual(authority.issues.map(row=>row.mode),['2755','6755']);assert.ok(authority.groups.includes(authority.after.gid));
for(const probe of authority.probes){assert.equal(probe.execution.status,1);assert.equal(probe.execution.signal,null);assert.equal(probe.execution.stdout,'');assert.match(probe.execution.stderr,/Operation not permitted\n$/u);assert.equal(probe.before.mode,'644');assert.equal(probe.after.mode,'644');}
const helperPath='tests/integration/full-gate-20260827/combined-8670ebe8/prerequisites.mjs';
const stagedHelper=join(report.temporary,'support',helperPath),helper=readFileSync(stagedHelper);assert.equal(sha(helper),packet.helper.sha256);
const omissions=[...packet.projection.candidateEntries.map(entry=>join(report.temporary,'source',entry.path)),...packet.projection.dependencyEntries.map(entry=>join(report.temporary,'source/benchmarks/node_modules',entry.path))];
for(const path of omissions)assert.equal(existsSync(path),false);
assert.equal(existsSync(join(report.temporary,'safejs-engine')),false);assert.equal(existsSync(join(output,'SETUP-COMPLETE.json')),false);
for(const entry of packet.driver.files)assert.equal(sha(readFileSync(join(repository,entry.path))),entry.sha256);
for(const root of report.osInstructionFence.roots){const stat=lstatSync(root.path);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());assert.equal(realpathSync(root.path),root.path);assert.deepEqual([stat.dev,stat.ino,stat.mode&0o777,stat.uid],[root.device,root.inode,root.mode,root.uid]);}
const sourceFiles=[...['ADMISSION.json','REPORT.json'].map(name=>({name:'inner-'+name,path:join(output,name)})),...['OS-FENCE-RESULT.json','OS-FENCE.json','REPORT.json','stdout','stderr'].map(name=>({name:'outer-'+name,path:join(outer,name)})),{name:'native-fixture-authority.json',path:authorityPath}];
const raw=join(directory,'raw-v1');mkdirSync(raw);const index=[];let total=0;
for(const entry of sourceFiles){
  const before=lstatSync(entry.path);assert.ok(before.isFile()&&!before.isSymbolicLink());assert.ok(before.size<=256*1024*1024);total+=before.size;assert.ok(total<=4*1024*1024*1024);
  const digest=createHash('sha256');let bytes=0;const destination=join(raw,entry.name+'.gz');
  await pipeline(createReadStream(entry.path),new Transform({transform(chunk,encoding,done){bytes+=chunk.length;digest.update(chunk);done(null,chunk);}}),createGzip(),createWriteStream(destination,{flags:'wx'}));
  const sourceHash=digest.digest('hex'),roundtrip=createHash('sha256');let decodedBytes=0;
  await pipeline(createReadStream(destination),createGunzip(),new Writable({write(chunk,encoding,done){decodedBytes+=chunk.length;roundtrip.update(chunk);done();}}));
  assert.equal(decodedBytes,bytes);assert.equal(roundtrip.digest('hex'),sourceHash);const after=lstatSync(entry.path);assert.deepEqual([after.dev,after.ino,after.size,after.mtimeMs],[before.dev,before.ino,before.size,before.mtimeMs]);
  index.push({source:entry.path,capture:'raw-v1/'+entry.name+'.gz',sourceBytes:bytes,sourceSha256:sourceHash,compressedBytes:lstatSync(destination).size,compressedSha256:sha(readFileSync(destination)),roundtripVerified:true});
}
const probeFiles=authority.probes.map(probe=>{const stat=lstatSync(probe.after.path),bytes=readFileSync(probe.after.path);return{path:probe.after.path,device:stat.dev,inode:stat.ino,mode:stat.mode&0o777,uid:stat.uid,gid:stat.gid,bytes:bytes.length,sha256:sha(bytes)};});
const summary={
  capturedAt:new Date().toISOString(),candidate:report.candidate,driverSha256:report.driverSha256,profileSha256:report.profileSha256,
  rootAuthorizationCommit:'c222e17c4cbcc6bcb9da8a77414b90af3c465d88',packetCommit:'52e83606dc41297a20cbeb3e0fc4ecf703bb242d',toolSession:80997,launcherInvocations:1,launcherExit:1,
  status:'HOLD_OR_QUALIFIED_RED',startedAt:report.startedAt,finishedAt:report.finishedAt,error:report.error,
  phaseOutcomes:packet.phases.map(phase=>({...phase,outcome:'NOT_EXECUTED',reason:'mandatory native fixture authority setup failed before first phase'})),productionBuilds:0,canonicalTestsExecuted:0,canonicalCounts:null,packageRebuilt:false,
  preflight:{status:report.preflight.status,issues:report.preflight.issues,nativeBindings:report.external.native,readableBindingsVerified:report.external.readableBindingsVerified},
  setup:{logicalEntries:report.archive.logical.count,physicalEntries:report.archive.count,logicalBytes:report.archive.logical.bytes,historyBytes:report.historyTransport.bytes,checkoutPerformed:report.historyTransport.checkoutPerformed,omittedInstructionPathsAbsent:omissions,nativeStagedExecutableCopies:report.nativeStaged.length,helper:{path:helperPath,staged:stagedHelper,sha256:sha(helper)},finalSweepReached:false,setupSentinelAbsent:true},
  failure:{boundary:'native host prerequisite, not a virtual-command assertion',authorityPath,uid:authority.uid,gid:authority.gid,groups:authority.groups,umask:authority.umask,directoryGroupNormalized:authority.normalized,directoryBefore:authority.before,directoryAfter:authority.after,probes:authority.probes,probeFiles,causeQualification:'Exact admitted native chmod commands returned status1/Operation not permitted; mode stayed0644 on owned member-group files. This capture does not independently identify the kernel/sandbox policy responsible. No permission widening, repeat probe or fixture rewrite.'},
  inheritedHelperRoutes:report.inheritedHelperRoutes,
  private:{metadataAdmission:report.privateCopyAdmission,beforeStateReached:Object.hasOwn(report,'privateBefore'),afterStateReached:Object.hasOwn(report,'privateAfter'),engineCopyExists:false,guestExecutions:0,qualification:'Metadata-only would-copy admission reached. Helper fails before privateState/body copy; no current private HEAD/status/index or pre/post guarantee inferred.'},
  cleanup:{workerPid:supervisor.result.pid,workerClosed:supervisor.result.closed,workerProcessClean:supervisor.result.clean,signals:supervisor.result.signals,survivors:supervisor.result.survivors,observerSurvivors:supervisor.fence.observerReceipt.survivors,completedSupervisedPhases:supervisor.fence.phaseReceipt.completed,phaseProtocolClean:supervisor.fence.phaseReceipt.clean,aggregateFenceClean:supervisor.fence.clean,qualification:'Natural worker/observed owned closure; overall phase/final-sweep completeness false. No hard-kernel/all-background-drain claim.'},
  retained:{output,outer,workRoot:report.osInstructionFence.roots[0],temporary:report.temporary,rawFiles:index.length,rawBytes:total,rootsRemoved:false,qualification:'New failed roots and raw artifacts retained; no old attempt mutation or duplicate full snapshot.'},
  integrity:{shipping38Unchanged:true,checkedSixInstructionPathsAbsent:true,outputFiles:readdirSync(output).sort(),finalProductPackagePrivateSweeps:'NOT_REACHED',qualification:'Setup source authentication and bounded terminal checks, not a completed whole-gate integrity qualification.'},
  authority:{thisAttemptConsumed:true,retryAuthorized:false,priorAttempt:'8e6b/df89 unchanged consumed0/14 with UNKNOWN EPERM target',nextStep:'Root decides independent source/artifact diagnosis and any separately authorized correction/release; no repair or rerun performed.'},
};
writeFileSync(join(directory,'RAW-INDEX.json'),JSON.stringify({capturedAt:summary.capturedAt,files:index},null,2)+'\n',{flag:'wx'});
writeFileSync(join(directory,'TERMINAL.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({files:index.length,rawBytes:total,status:summary.status,phases:'0/14',builds:0,retries:0,retainedWorkRoot:summary.retained.workRoot.path}));
