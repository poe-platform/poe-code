import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';

const own=path.dirname(fileURLToPath(import.meta.url)),review=path.dirname(own),repository=path.resolve(own,'../../../..');
const executor=path.join(review,'candidate-753-review-executor-v2'),run=path.join(executor,'attempt-01');
async function describe(filename,maximum=512*1024*1024){const stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maximum);const digest=createHash('sha256');let bytes=0;for await(const chunk of fs.createReadStream(filename,{highWaterMark:65536})){bytes+=chunk.length;assert.ok(bytes<=stat.size);digest.update(chunk);}assert.equal(bytes,stat.size);return {bytes,sha256:digest.digest('hex'),mode:stat.mode&511};}
function text(filename,maximum){assert.match(filename,/\.(json|jsonl|raw)$/);const stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maximum);return new TextDecoder('utf8',{fatal:true}).decode(fs.readFileSync(filename));}
const parse=(filename,maximum)=>JSON.parse(text(filename,maximum));
const outcome=parse(path.join(run,'OUTCOME.json'),16*1024*1024),membership=parse(path.join(run,'CAPTURE-MEMBERSHIP.json'),2*1024*1024),seal=parse(path.join(executor,'PRESEAL.json'),160000);
assert.equal(outcome.sourceCommit,'e0c80061c212929159ee3e727018d116f1534e8b');assert.equal(outcome.sealHash,'d75db6e78b9a891705c8d8ffd753ef54624df4bb64b1670a523ecb365290e364');
assert.equal((await describe(path.join(executor,'PRESEAL.json'))).sha256,outcome.sealHash);
assert.equal(outcome.status,'COMPLETED_ASSERTIONS_REQUIRE_REVIEW');assert.equal(outcome.primary,null);assert.equal(outcome.completedJobs.length,54);assert.equal(outcome.knownRetired,true);assert.equal(outcome.active,null);
const members=Object.keys(membership.members);assert.deepEqual(fs.readdirSync(run).sort(),[...members,'CAPTURE-MEMBERSHIP.json'].sort());
for(const [name,expected] of Object.entries(membership.members)){assert.ok(!name.includes('/')&&!name.includes('\\')&&name!=='.'&&name!=='..');assert.deepEqual(await describe(path.join(run,name)),expected,name);}
for(const [name,expected] of Object.entries(membership.externalRecords))assert.deepEqual(await describe(path.join(executor,name)),expected,name);
for(const [name,expected] of Object.entries(seal.files))assert.deepEqual(await describe(path.join(executor,name)),expected,name);
for(const [name,expected] of Object.entries(seal.sourceBindings))assert.deepEqual(await describe(path.join(repository,name)),expected,name);
assert.equal(outcome.cleanup.removed,true);assert.equal(fs.existsSync(path.join(run,'work')),false);
let observed=0,retained=0;
for(const receipt of outcome.receipts){assert.equal(receipt.closeObserved,true);assert.equal(receipt.absent,true);assert.equal(receipt.failure,null);assert.equal(receipt.signal,null);for(const channel of ['stdout','stderr']){const entry=receipt[channel];assert.equal(entry.observedBytes,entry.bytes);assert.equal(entry.lostBytes,0);assert.equal(membership.members[entry.path].sha256,entry.sha256);observed+=entry.observedBytes;retained+=entry.bytes;}}
assert.equal(retained,outcome.rawBytes);
const archiveNames=members.filter(name=>name.endsWith('.gz')&&membership.members[name].sha256===outcome.cleanup.archive.sha256);assert.equal(archiveNames.length,1);
let archiveDecodedBytes=0;const gunzip=fs.createReadStream(path.join(run,archiveNames[0]),{highWaterMark:65536}).pipe(createGunzip());
for await(const fragment of gunzip){archiveDecodedBytes+=fragment.length;assert.ok(archiveDecodedBytes<=384*1024*1024,'bounded archive CRC stream');}
const byRole={},jobs=[],failures=[];
function caseNodes(value,location=[],result=[]){if(!value||typeof value!=='object')return result;if(typeof value.status==='string'&&typeof value.id==='string'&&['PASS','FAIL','HARNESS_ERROR'].includes(value.status))result.push({location,id:value.id,status:value.status,error:value.error??value.failure??null});for(const [key,child] of Object.entries(value))if(!['raw','loads','markers'].includes(key))caseNodes(child,[...location,key],result);return result;}
function shape(value){if(Array.isArray(value))return {array:value.length,first:value.length?shape(value[0]):null};if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,Array.isArray(entry)?{length:entry.length}:entry&&typeof entry==='object'?{keys:Object.keys(entry)}:entry]));}
for(const observation of outcome.observations){
 if(observation.role==='type'){const bucket=byRole.type??={jobs:0,passed:0};bucket.jobs++;if(observation.pass)bucket.passed++;jobs.push(observation);continue;}
 if(!observation.final)continue;
 const final=observation.final,role=final.role,cases=caseNodes(final.outcomes),counts={PASS:0,FAIL:0,HARNESS_ERROR:0};for(const entry of cases){counts[entry.status]++;if(entry.status!=='PASS')failures.push({job:observation.id,role,...entry});}
 const groups=Array.isArray(final.outcomes)?final.outcomes.map((entry,index)=>({index,kind:entry.kind??null,shape:shape(entry),cases:caseNodes(entry)})):[];
 const bucket=byRole[role]??={jobs:0,complete:0,statuses:{PASS:0,FAIL:0,HARNESS_ERROR:0},unhandled:0};bucket.jobs++;if(final.complete)bucket.complete++;bucket.unhandled+=final.unhandled??0;for(const [key,count] of Object.entries(counts))bucket.statuses[key]+=count;
 jobs.push({id:observation.id,role,complete:final.complete,unhandled:final.unhandled,loads:final.loads.length,uniqueLoadedURLs:new Set(final.loads.map(entry=>entry.url)).size,groups,outcomes:final.outcomes});
}
const ownerEvents=text(path.join(run,'OWNER-EVENTS.jsonl'),2*1024*1024).trimEnd().split('\n').map(line=>JSON.parse(line));
const publication=ownerEvents.find(entry=>entry.kind==='whole-runtime-publication-admitted');assert.ok(publication);
const runtimeObjects=outcome.receipts.find(entry=>entry.id==='runtime-objects');assert.ok(runtimeObjects.stdout.bytes<16*1024*1024);
const actualCaptureBytes=membership.totalBytes+(await describe(path.join(run,'CAPTURE-MEMBERSHIP.json'))).bytes+Object.values(membership.externalRecords).reduce((sum,row)=>sum+row.bytes,0);
assert.ok(actualCaptureBytes<=128*1024*1024);
const report={schema:'AP753-independent-actual-review-v2',created:new Date().toISOString(),sourceCommit:outcome.sourceCommit,runtimeCommit:outcome.runtimeCommit,presealSha256:outcome.sealHash,candidate:seal.candidate,selectedTree:seal.selectedTree,packageSha256:seal.packageSha256,completedJobs:54,processCompletionNotCaseAcceptance:true,byRole,jobs,failures,capture:{members:members.length,totalBytes:actualCaptureBytes,rawObserved:observed,rawRetained:retained,rawLost:0,externalRecords:membership.externalRecords,runtimeFramedBytes:runtimeObjects.stdout.bytes,publication},archive:{name:archiveNames[0],...outcome.cleanup.archive,crcStreamVerified:true,decodedBytes:archiveDecodedBytes,independentPerFileReconstruction:false,ownerRecordedFiles:outcome.cleanup.files,ownerRecordedLogicalBytes:outcome.cleanup.logicalBytes,ownerVerifiedWorkRemoved:true},cleanup:{controllerOwned:outcome.allOwnedAdmitted,childReceipts:outcome.receipts.length,allReceiptCloseAndAbsence:true,active:null,totalPeak:outcome.totalPeak,elapsedMs:outcome.clockMs,toolOwnerExitObserved:0},postguard:{sourceFiles:Object.keys(seal.files).length,externalBindings:Object.keys(seal.sourceBindings).length,exactRunMembership:true},budgetAccounting:'62 controller-owned processes;1 grant materializer;7 bounded postflight/editor/Git archival processes including final status=70 conservatively. Separate preparation before actual remains22 processes including grant, below32. No test replay.',historical:'Original685cdd0d3/54/51UNRUN,569a4b89 22/23 and all prior byte losses remain unchanged. No source patch or expectation rewrite during actual review.'};
const body=Buffer.from(JSON.stringify(report,null,2)+'\n');assert.ok(body.length<=16*1024*1024);fs.writeFileSync(path.join(own,'REPORT.json'),body,{flag:'wx'});
fs.writeFileSync(path.join(own,'CAPTURE-VERIFICATION.json'),JSON.stringify({schema:'AP753-capture-postguard-v2',report:await describe(path.join(own,'REPORT.json')),outcome:await describe(path.join(run,'OUTCOME.json')),membership:await describe(path.join(run,'CAPTURE-MEMBERSHIP.json')),capture:report.capture,archive:report.archive,postguard:report.postguard},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({byRole,failures:failures.map(row=>({job:row.job,id:row.id,status:row.status,error:typeof row.error==='string'?row.error.slice(0,180):row.error})),groups:jobs.filter(row=>row.groups).map(row=>({id:row.id,groups:row.groups.map(group=>({kind:group.kind,shape:group.shape,statuses:group.cases.reduce((counts,item)=>(counts[item.status]=(counts[item.status]??0)+1,counts),{})}))})),captureBytes:actualCaptureBytes,rawLost:0,archiveCrc:true,archiveDecodedBytes,runtimeCommit:outcome.runtimeCommit}));
