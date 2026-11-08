import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root='/Users/kjopek/Workspace/safe-bash';
const base=root+'/tests/integration/final-smoke-preparation-20260829/source-closeout-v1';
const own=path.dirname(new URL(import.meta.url).pathname);
const rows=[];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(filename,expected){const stat=fs.lstatSync(filename);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=4194304);const bytes=fs.readFileSync(filename);assert.equal(bytes.length,stat.size);if(expected){assert.equal(bytes.length,expected.bytes??expected.size);assert.equal(sha(bytes),expected.sha256);}rows.push({path:filename,bytes:bytes.length,sha256:sha(bytes)});return bytes;}
try{
 if(process.argv[2]==='verify'){
 const author='8fc9f4fc4a8833a679793a906b688f7debb7c21f';
 const prefix='tests/integration/final-smoke-preparation-20260829/source-closeout-v1';
 const git=spawnSync('/usr/bin/git',['-c','gc.auto=0','-c','maintenance.auto=false','show',author+':'+prefix+'/EVIDENCE-SHA256.txt'],{cwd:root,encoding:null,maxBuffer:1048576,timeout:10000});
 fs.writeFileSync(own+'/git.stdout',git.stdout??Buffer.alloc(0),{flag:'wx'});fs.writeFileSync(own+'/git.stderr',git.stderr??Buffer.alloc(0),{flag:'wx'});assert.equal(git.status,0);assert(!git.error);
 const manifest=read(base+'/EVIDENCE-SHA256.txt');assert(manifest.equals(git.stdout));
 const evidence=new Map();for(const line of manifest.toString().trim().split('\n')){const match=/^([a-f0-9]{64})  (.+)$/.exec(line);assert(match);assert(match[2].startsWith(prefix+'/evidence/')&&!match[2].includes('..'));assert(!evidence.has(path.basename(match[2])));const bytes=read(root+'/'+match[2]);assert.equal(sha(bytes),match[1]);evidence.set(path.basename(match[2]),bytes);}
 const sealBytes=read(base+'/PRESEAL.json',{bytes:9497,sha256:'b76e357418ba52be70ddc566bdaf7ac14716a8843c7a36a8949c580c95c66a67'});const seal=JSON.parse(sealBytes);
 for(const row of seal.files)read(row.path,row);for(const row of seal.consumerFiles)read(row.path,row);
 const binding=JSON.parse(read(seal.binding.path,seal.binding));read(seal.producerReview.path,seal.producerReview);assert.equal(binding.archive.sha256,'de8741c1be9c870650e92944020fa2785114b7046ef1774af2c27ea79238e17a');read(binding.archive.path,binding.archive);
 const scalar=JSON.parse(read(binding.scalarRows.path,binding.scalarRows));read(binding.fixture.path,binding.fixture);
 const json=name=>JSON.parse(evidence.get(name));const result=json('SOURCE-RESULT.json'),terminal=json('TERMINAL.json'),activation=json('ACTIVATION.json'),config=json('config.json'),sourceBinding=json('source-binding.json');
 assert.equal(sha(evidence.get('SOURCE-RESULT.json')),'2d9702b5d0b8858c0bb7b4a1a2355d20cfa1d6884d1e3a875c75365a90e78fa7');
 const ids=['C01','C02','C07','C12','C13','C14','R17','R16'];
 function validateResult(value){assert.equal(value.primaryPresent,false);assert.equal(value.registeredShellDisposalCompleted,true);assert.deepEqual(value.rows.map(row=>row.id),ids);assert(value.rows.every(row=>row.status==='PASS'));}
 function validateChild(value){assert.equal(value.pid,26984);for(const key of ['exitObserved','closeObserved','stdoutEnd','stderrEnd'])assert.equal(value[key],true);assert.equal(value.exitCode,0);assert.equal(value.closeCode,0);assert.deepEqual(value.signals,[]);}
 fs.writeFileSync(own+'/PRESEAL.json',JSON.stringify({author,bindings:rows,controls:['tampered-row','missing-disposal','missing-close'],sourceOnly:true,noProduct:true},null,2)+'\n',{flag:'wx'});
 validateResult(result);validateChild(terminal.child.row);assert.equal(terminal.child.faults.primaryPresent,false);assert.equal(terminal.postguards,true);assert.equal(terminal.ShellRetirement,'EXPLICIT_RESULT_COMPLETED');assert.equal(terminal.primaryPresent,false);assert.deepEqual(terminal.known.activeKnownPIDs,[]);assert.equal(terminal.known.poisoned,false);assert.equal(terminal.known.knownStarts,2);
 for(const row of result.rows.slice(0,6)){assert.equal(row.prepares,0);assert.equal(row.cleanup.length,row.id==='C01'?2:1);assert(row.cleanup.every(value=>value==='fulfilled'));}
 assert.equal(result.rows[6].stdout,'local=<1 0>\nouter=<0>\n');assert.equal(result.rows[7].stdout,'local=<>\nouter=<0>\n');
 for(const row of result.rows.slice(6)){const original=scalar.cases.find(item=>item.id===row.id);assert(original);for(const field of ['stdout','stderr','exitCode'])if(Object.hasOwn(original,field))assert.deepEqual(row[field],original[field]);assert.equal(row.stderr,'');assert.equal(row.exitCode,0);}
 for(const row of result.observations)for(const key of ['primaryPresent','cleanupPresent','reportingPresent'])assert.equal(row[key],false);
 assert.equal(new Date(activation.epochMs).toISOString(),activation.utc);assert.equal(activation.utc,'2026-08-29T18:11:26.558Z');assert(Date.parse(terminal.child.row.closeUTC)<Date.parse('2026-08-29T18:16:02.359Z'));
 assert.equal(sha(evidence.get('config.json')),terminal.child.row.argv.at(-1));assert.equal(sha(evidence.get('source-binding.json')),config.binding.sha256);assert.equal(sourceBinding.packageRoot,binding.sourceRoot);
 const members=new Map(sourceBinding.members.map(row=>[row.absolute,row]));const prepared=JSON.parse(JSON.stringify(terminal.loader.records));assert.equal(sha(evidence.get('loader.jsonl')),terminal.loader.sha256);assert.equal(sha(evidence.get('workers.jsonl')),terminal.workers.sha256);
 for(const row of prepared){if(row.kind==='authenticated-source-prepared'){const filename=new URL(row.url).pathname;const member=members.get(filename);assert(member);assert.equal(row.sha256,member.sha256);}}
 assert(terminal.workers.records.some(row=>row.kind==='before-exit'&&row.attempts===0&&row.created===0));assert.equal(evidence.get('source-only-eight.stdout').length,0);assert.equal(evidence.get('source-only-eight.stderr').length,823);
 const controls=[];for(const [id,fn] of [['tampered-row',()=>validateResult({...result,rows:result.rows.slice(1)})],['missing-disposal',()=>validateResult({...result,registeredShellDisposalCompleted:false})],['missing-close',()=>validateChild({...terminal.child.row,closeObserved:false})]]){assert.throws(fn);controls.push({id,pass:true});}
 for(const row of [...rows])read(row.path,row);
 const receipt={verdict:'QUALIFIED_SOURCE_ONLY_EIGHT_OBSERVATIONS_ACCEPT',author,ids,controls,evidenceFiles:evidence.size,evidenceBytes:[...evidence.values()].reduce((sum,bytes)=>sum+bytes.length,0),resultSha256:sha(evidence.get('SOURCE-RESULT.json')),presealSha256:sha(sealBytes),bindings:rows,child:terminal.child.row,postguards:terminal.postguards,activation,loaderAdmissions:1,guestRegexObservedAttempts:0,guestRegexObservedCreates:0,qualifications:['No runtime replay; source-built direct ESM only; no installed/moved/bare-specifier proof','Owner exit0 ROOT-reported/source-consistent, self-record remains pending; no independent OS attestation','Loader source-preparation traces are not independent evaluation/individual-thread-exit census','Scoped registered Shell disposal, not opaque provider/background closure','Strict npm adapter and successor callsite SOURCE/PURE only, live npm unexecuted','Original dd8db75a and24UNRUN remain; invalid historical UTC not repaired'],endedUTC:new Date().toISOString()};
 const encoded=JSON.stringify(receipt,null,2)+'\n';fs.writeFileSync(own+'/RESULT.json',encoded,{flag:'wx'});console.log(JSON.stringify({verdict:receipt.verdict,ids,controls,receiptSha256:sha(encoded),evidenceFiles:receipt.evidenceFiles,evidenceBytes:receipt.evidenceBytes,endedUTC:receipt.endedUTC}));
 }else{
 console.log(read(base+'/ACTUAL-HANDOFF.md').toString());
 console.log('FILES',fs.readdirSync(base));
 fs.writeFileSync(own+'/INSPECTION.json',JSON.stringify(rows,null,2)+'\n',{flag:'wx'});
 }
}catch(reason){console.error(reason);process.exitCode=1;}
