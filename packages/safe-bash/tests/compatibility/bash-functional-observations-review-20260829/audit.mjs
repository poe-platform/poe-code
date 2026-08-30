import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const home=path.dirname(fileURLToPath(import.meta.url));
const hash=body=>createHash('sha256').update(body).digest('hex');
const read=name=>{const file=home+'/'+name,stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=4194304);return fs.readFileSync(file);};
const unpack=body=>JSON.parse(gunzipSync(Buffer.from(body.toString().trim(),'base64'),{maxOutputLength:8388608}));
const rows=unpack(read('m02-INPUTS.json.gz.base64')),extra=unpack(read('m04-INPUTS.json.gz.base64'));
const inventory=JSON.parse(read('m01-INVENTORY.json')),reviewInventory=JSON.parse(read('m03-INVENTORY.json'));
const prefix='tests/compatibility/bash-surface-independent-20260829/functional-reference-v3/';
const get=name=>{const entry=inventory.find(row=>row.path===prefix+name);assert(entry&&entry.mode==='100644');const row=rows.find(row=>row.oid===entry.oid);assert(row);const bytes=Buffer.from(row.body,'base64');assert.equal(bytes.length,entry.bytes);assert.equal(hash(bytes),row.sha256);return bytes;};
const json=name=>JSON.parse(get(name));
const review=name=>{const entry=reviewInventory.find(row=>row.path.endsWith('/v3/'+name));assert(entry);return Buffer.from(extra.find(row=>row.oid===entry.oid).body,'base64');};
const checks=[];
const check=(name,operation)=>{operation();checks.push(name);};
const verify=(body,pin)=>{assert.equal(body.length,pin.bytes);assert.equal(hash(body),pin.sha256);};
const seal=json('PRESEAL.json'),actualSeal=json('actual-v1/SEAL.json'),go=json('GO.json'),obs=json('actual-v1/OBSERVATIONS.json'),requests=json('REQUESTS.json'),audit=json('AUDIT.json');
check('all52 immutable input blobs',()=>{assert.equal(rows.length,52);for(const entry of inventory)get(entry.path.slice(prefix.length));});
check('source21 and full preseal24',()=>{assert.equal(seal.files.length,24);for(const pin of seal.files){verify(get(pin.path),pin);if(pin.role==='source-commit'){const source=extra.find(row=>row.spec===seal.sourceCommit+':'+prefix+pin.path);assert(source);assert.deepEqual(Buffer.from(source.body,'base64'),get(pin.path));}}assert.equal(hash(get('PRESEAL.json')),actualSeal.presealSha256);});
check('actual seven artifact seal',()=>{for(const pin of actualSeal.artifacts)verify(get('actual-v1/'+pin.path),pin);});
check('acyclic review GO command and exact recorded request',()=>{
 const generic=review('SCOPED-RECEIPT.json'),slot=review('activation-v1/RESULT.json'),manifest=json('activation-v1/MANIFEST.json');
 verify(generic,manifest.originalReview);assert.equal(hash(slot),actualSeal.slotResultSha256);
 assert.equal(hash(get('GO.json')),actualSeal.grantSha256);verify(get('REVIEW-ACCEPTANCE.json'),go.independentReviewReceipt);
 const resolved=json('activation-v1/APPROVAL-REQUEST.resolved.json'),actual=json('actual-v1/EXACT-REQUEST.json');
 assert.deepEqual(actual.parameters,resolved.parameters);assert.equal(actual.parameters.login,false);assert.equal(actual.parameters.sandbox_permissions,'require_escalated');assert(!Object.hasOwn(actual.parameters,'prefix_rule'));
 assert.equal(hash(Buffer.from(actual.parameters.cmd)),actualSeal.commandSha256);assert.deepEqual(get('activation-v1/COMMAND.txt'),Buffer.from(actual.parameters.cmd+'\n'));
 const template=json('APPROVAL-REQUEST.template.json');template.parameters.cmd=template.parameters.cmd.replace('ROOT_APPROVED_GRANT_SHA256',actualSeal.grantSha256);assert.deepEqual(template,resolved);
 assert.equal(go.deadlineEpochMs,1787994219808);assert.equal(actual.latestFullStart,go.deadlineEpochMs-600000);assert(actual.at<=actual.latestFullStart);
});
check('inherited native version provenance',()=>{const provenance=json('VERSION-PROVENANCE.json');for(const pin of provenance.files){const source=extra.find(row=>row.spec===provenance.commit+':'+pin.path);assert(source);verify(Buffer.from(source.body,'base64'),pin);}const version=extra.find(row=>row.spec.endsWith('/bash-version.stdout.raw'));assert(Buffer.from(version.body,'base64').toString().startsWith('GNU bash, version 3.2.57(1)-release (arm64-apple-darwin25)\n'));});
const compressed=Buffer.from(get('actual-v1/RAW-NATIVE-RUN.json.gz.base64').toString().trim(),'base64');
assert.equal(hash(compressed),actualSeal.nativeArchiveGzipSha256);
const raw=JSON.parse(gunzipSync(compressed,{maxOutputLength:4194304}));
const entries=new Map();let rawBytes=0,files=0,dirs=0;
check('complete raw inventory byte integrity',()=>{assert.equal(raw.entries.length,490);for(const entry of raw.entries){assert(!entries.has(entry.path));assert(!entry.path.startsWith('/')&&!entry.path.split('/').includes('..'));entries.set(entry.path,entry);if(entry.type==='file'){const bytes=Buffer.from(entry.base64,'base64');verify(bytes,entry);rawBytes+=bytes.length;files++;}else{assert.equal(entry.type,'directory');dirs++;}}assert.equal(files,265);assert.equal(dirs,225);assert.equal(rawBytes,146676);});
const rawFile=name=>{const item=entries.get(name);assert.equal(item?.type,'file');return Buffer.from(item.base64,'base64');};
const results=JSON.parse(rawFile('RESULTS.json')),journal=rawFile('JOURNAL.jsonl').toString().trim().split('\n').map(JSON.parse),oracle=[];
check('raw RESULTS exact bytes and owner boundary',()=>{assert.deepEqual(rawFile('RESULTS.json'),get('actual-v1/RESULTS.original.json'));assert.equal(results.completed,37);assert.equal(results.halted,false);assert.equal(results.ledger.active,1);assert.equal(results.ledger.confirmedStarts,38);assert.equal(results.deadline,Math.min(go.deadlineEpochMs,obs.owner.started+600000));assert.equal(json('actual-v1/TOOL-OUTCOME.json').observedToolResponses.at(-1).exitCode,0);});
check('exact37 selection and three withheld',()=>{assert.equal(requests.length,37);assert.deepEqual(requests.map(row=>row.id),audit.cases.filter(row=>!['B26','B27','B28'].includes(row.id)).map(row=>row.id));assert.deepEqual(obs.withheld,['B26','B27','B28']);assert.equal(obs.cases.length,37);});
const expectedStatus={B24:2,B32:1,B36:2,B38:7};let stdoutBytes=0,stderrBytes=0,last=obs.owner.started;const pids=new Set();
for(const request of requests)check(request.id+' raw script input output status effects lifecycle',()=>{
 const literal=audit.cases.find(row=>row.id===request.id),record=JSON.parse(rawFile(request.id+'.json')),observation=obs.cases.find(row=>row.id===request.id),caseRoot=raw.runRoot+'/cases/'+request.id;
 assert.equal(request.executable,'/bin/bash');assert.deepEqual(request.argv,['--noprofile','--norc','-c',literal.program,'surface-case']);assert.equal(hash(Buffer.from(literal.program)),literal.programSha256);assert.equal(request.programSha256,literal.programSha256);assert.equal(request.stdinBase64,literal.stdinBase64);assert.equal(request.cwd,caseRoot+'/work');assert.deepEqual(request.environment,{LC_ALL:'C',LANG:'C',TZ:'UTC',HOME:caseRoot+'/home',TMPDIR:caseRoot+'/tmp',PATH:caseRoot+'/empty-path'});
 assert.equal(record.status,expectedStatus[request.id]??0);assert.equal(observation.status,record.status);assert.equal(record.signal,null);assert.equal(record.stop,null);assert.deepEqual(record.errors,[]);assert.deepEqual(record.signals,[]);assert.equal(record.spawnObserved,true);assert.equal(record.exit,true);assert.equal(record.close,true);assert.equal(record.retired,true);assert.equal(record.filesVerified,true);assert.equal(record.regularCaptureCompletion,true);assert.equal(record.streamEOF,null);assert.equal(record.receiptPublished,false);assert.equal(observation.receiptPublishedStored,false);
 assert(!pids.has(record.pid));pids.add(record.pid);assert(record.started>=last&&record.finished>=record.started&&record.finished<=results.deadline);assert(record.finished-record.started<3000);last=record.finished;
 assert.equal(record.group.state,'absent');assert.equal(record.group.error.fields.code.value,'ESRCH');assert.deepEqual(observation.group,record.group);for(const group of record.groupObservations){assert(group.at>=record.started&&group.at<=record.finished);assert.equal(group.afterKill,false);}
 for(const name of ['stdout','stderr']){const capture=record.capture.find(row=>row.name===name),bytes=rawFile('captures/'+request.id+'/'+name);verify(bytes,capture);assert.deepEqual(bytes,Buffer.from(capture.base64,'base64'));assert.deepEqual(capture,observation[name]);for(const field of ['flush','size','hash','close'])assert.equal(capture[field],true);if(name==='stdout')stdoutBytes+=bytes.length;else stderrBytes+=bytes.length;}
 assert.equal(record.filesBefore.length,8);for(const fixture of audit.fixtures){verify(Buffer.from(fixture.base64,'base64'),fixture);assert.deepEqual(rawFile('cases/'+request.id+'/work/'+fixture.path),Buffer.from(fixture.base64,'base64'));const before=record.filesBefore.find(row=>row.path==='work/'+fixture.path);assert.equal(before.base64,fixture.base64);assert.equal(before.mode,fixture.mode);}
 for(const before of record.filesBefore)assert.deepEqual(record.filesAfter.find(row=>row.path===before.path),before);
 const added=record.filesAfter.filter(row=>!record.filesBefore.some(before=>before.path===row.path));assert.equal(added.length,['B23','B25'].includes(request.id)?1:0);for(const item of added){assert.equal(item.path,'work/out');assert.equal(item.mode,420);assert.equal(Buffer.from(item.base64,'base64').toString(),request.id==='B23'?'O':'OE');assert.deepEqual(rawFile('cases/'+request.id+'/work/out'),Buffer.from(item.base64,'base64'));}
 const events=journal.filter(row=>row.id===request.id||row.row?.id===request.id);assert.deepEqual(events.map(row=>row.event),['CHILD_ENROLLED','CHILD_TERMINAL','OBSERVATION_READY_FOR_CREDIT']);assert.deepEqual(events[0].args,request.argv);assert(events[0].at>=record.started&&events[0].at<=record.finished);for(const key of ['pid','status','started','finished','capture','group','errors','retired','exit','close'])assert.deepEqual(events[1].row[key],record[key]);
 oracle.push({id:request.id,status:record.status,programSha256:literal.programSha256,stdinSha256:hash(Buffer.from(request.stdinBase64,'base64')),stdoutSha256:observation.stdout.sha256,stderrSha256:observation.stderr.sha256,stdoutBytes:observation.stdout.bytes,stderrBytes:observation.stderr.bytes,receiptSha256:hash(rawFile(request.id+'.json')),started:record.started,finished:record.finished,addedFiles:added,classification:'NATIVE_OBSERVATION_NOT_PASS'});
});
check('totals and raw binary preservation',()=>{assert.equal(stdoutBytes,580);assert.equal(stderrBytes,679);assert.equal(pids.size,37);assert.deepEqual(rawFile('captures/B40/stdout'),Buffer.from([65,0,66,10]));assert.deepEqual(rawFile('captures/B40/stderr'),Buffer.from([195,169,10]));assert.equal(journal.filter(row=>row.event==='OBSERVATION_READY_FOR_CREDIT').length,37);assert.equal(requests.reduce((sum,row)=>sum+row.extraProcessReservation,0),13);});
const admin=unpack(get('actual-v1/ADMIN-CAPTURE.json.gz.base64'));
check('administrative archive file integrity',()=>{for(const file of admin.files)verify(Buffer.from(file.base64,'base64'),file);});
const adminFile=name=>Buffer.from(admin.files.find(row=>row.path===name).base64,'base64');
const adminState=JSON.parse(adminFile('STATE.json'));
const result={schema:'independent-bash37-artifact-audit-v1',created:new Date().toISOString(),sourceCommit:seal.sourceCommit,publicationCommit:'664b178c018c9de76a061b84b905c438ff02735b',actualCommit:'eaa9889d98eaa6d15acc31f4e39a33d000b67d2c',checks,checkCount:checks.length,observations:37,statusCounts:{0:33,1:1,2:2,7:1},withheld:obs.withheld,stdoutBytes,stderrBytes,nativeArchiveSha256:hash(compressed),rawInventory:{files,dirs,rawBytes},sourceFiles:21,sealedFiles:24,authorReportedToolApprovalOnly:true,authorReportedFinalKnownStarts:51,durableAdminState:adminState,allProcessCensus:false,targetExecutionsThisAudit:0,normalized:false};
fs.writeFileSync(home+'/AUDIT.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});fs.writeFileSync(home+'/ORACLE-MAP.json',JSON.stringify(oracle,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({checks:checks.length,observations:37,stdoutBytes,stderrBytes,targetExecutions:0}));
