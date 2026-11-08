import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const own=path.dirname(fileURLToPath(import.meta.url));
const raw='/tmp/pipestatus-preexec-review-20260829';
const work='/private/tmp/pipestatus-independent-preexec-20260829';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function snapshot(root){const rows=[];function walk(directory){for(const name of fs.readdirSync(directory)){const filename=path.join(directory,name),stat=fs.lstatSync(filename);assert.ok(!stat.isSymbolicLink());if(stat.isDirectory())walk(filename);else{assert.ok(stat.isFile()&&stat.size<=33554432);const bytes=fs.readFileSync(filename);rows.push({path:path.relative(root,filename),bytes:bytes.length,sha256:hash(bytes)});}}}walk(root);rows.sort((left,right)=>Buffer.compare(Buffer.from(left.path),Buffer.from(right.path)));return {rows,bytes:rows.reduce((sum,row)=>sum+row.bytes,0)};}
fs.mkdirSync(own+'/raw');for(const name of fs.readdirSync(raw)){if(name.startsWith('publication.'))continue;const filename=raw+'/'+name,stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&stat.size<1048576);fs.copyFileSync(filename,own+'/raw/'+name,fs.constants.COPYFILE_EXCL);}
fs.copyFileSync(work+'/RESULT.json',own+'/RESULT.json',fs.constants.COPYFILE_EXCL);
fs.mkdirSync(own+'/harmless');for(const name of fs.readdirSync(work+'/harmless')){const filename=work+'/harmless/'+name,stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&stat.size<2097152);fs.copyFileSync(filename,own+'/harmless/'+name,fs.constants.COPYFILE_EXCL);}
const result=JSON.parse(fs.readFileSync(work+'/RESULT.json'));assert.equal(result.passed,20);assert.equal(result.retired,true);
const evidence=snapshot(own),scratch=snapshot(work),captures=snapshot(raw);
const total=evidence.bytes+scratch.bytes+captures.bytes;assert.ok(total<268435456);assert.ok(captures.bytes<67108864);
const report={utc:new Date().toISOString(),verdict:'HOLD_EXECUTION_BINDING_AND_WORK_BOUND',qualifiedControls:20,authorMap:'C01-C10 plus caught-boundary C11-v2/C12-v2',novel:8,harmlessChildren:2,productCalls:0,Workers:0,loaderThreads:0,knownOsConservativePublicationAndReadout:31,maximum:40,peak:3,logical:{evidence:evidence.bytes,scratch:scratch.bytes,captures:captures.bytes,total,excludes:'Git internals/RSS/physical allocation; publication ongoing external raw tail not in prepublication snapshot'},snapshotDomain:'relative UTF8 paths; Buffer.compare; invocation-local counters',evidenceManifest:hash(Buffer.from(JSON.stringify(evidence.rows))),scratchManifest:hash(Buffer.from(JSON.stringify(scratch.rows))),resultSha256:hash(fs.readFileSync(work+'/RESULT.json')),findings:['F01 outer tool command needs terminal exec or changed peak authority','F02 working bound only sampled after growth; no complete pre-growth derivation'],recentB2Race:'same function can ENOENT, but no sampling during awaited install in this coordinator',activeChildren:0};
fs.writeFileSync(own+'/PUBLICATION.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
const relative=path.relative(process.cwd(),own);
for(const args of [['add','--',relative],['commit','--only','-m','test: review PIPESTATUS coordinator preexec and retain binding holds','--',relative],['status','--porcelain','--',relative],['rev-parse','HEAD']]){const child=spawnSync('/usr/bin/git',['-c','gc.auto=0','-c','maintenance.auto=false',...args],{stdio:['ignore',1,2]});assert.equal(child.status,0);}
console.log(JSON.stringify({...report,receiptSha256:hash(fs.readFileSync(own+'/PUBLICATION.json'))}));
