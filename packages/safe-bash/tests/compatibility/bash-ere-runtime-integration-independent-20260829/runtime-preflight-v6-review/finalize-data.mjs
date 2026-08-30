import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.dirname(new URL(import.meta.url).pathname),deadline=Math.floor(fs.statSync('/tmp/core70-preexec-review-bootstrap-20260829.stdout').birthtimeMs)+1200000;
assert(Date.now()<deadline);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(file){const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=4194304);const bytes=fs.readFileSync(file);assert.equal(bytes.length,stat.size);return bytes;}
const admission=JSON.parse(read(root+'/ADMISSION.json')),seal=JSON.parse(read(root+'/EXECUTION-PRESEAL.json'));
for(const pin of [...admission.authenticated,...seal.files,...seal.own]){const stat=fs.lstatSync(pin.path);assert.equal(stat.size,pin.size);assert.equal(stat.mode&511,pin.mode);assert.equal(hash(read(pin.path)),pin.sha256);}
const raw=root+'/supervision';fs.mkdirSync(raw);
const captured=[];
for(const directory of ['/tmp/core70-review-prepare-ntu2xm','/tmp/core70-review-seal-bk8tMN','/tmp/core70-review-run-rLxyFp']){
 const target=raw+'/'+path.basename(directory);fs.mkdirSync(target);
 for(const name of fs.readdirSync(directory).sort()){const bytes=read(directory+'/'+name);fs.writeFileSync(target+'/'+name,bytes,{flag:'wx',mode:0o600});captured.push({path:directory+'/'+name,bytes:bytes.length,sha256:hash(bytes)});}
}
const pure=JSON.parse(read(seal.control+'/ADDITIONAL-CONTROLS.json')),owner=JSON.parse(read(seal.control+'/RESULT.json'));
const source=read('/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-ere-runtime-integration-author-20260829/runtime-preflight-v1/v4/cell-v4.mjs').toString();
const lines=source.split('\n');const emitterLine=lines.findIndex(line=>line.startsWith('const emit ='))+1;
const summary={at:new Date().toISOString(),verdict:'HOLD',source:admission.source,sourceInputs:admission.sourceInputs,archive:admission.archive,layouts:admission.layoutRows,presealSha256:hash(read(root+'/EXECUTION-PRESEAL.json')),purePass:pure.results.filter(row=>row.status==='PASS').length,ownerPass:owner.rows.filter(row=>row.status==='PASS').length,actualHarmless:owner.actual,novel:{count:8,qualified:0,sourceLiteralAssertionFailed:true,negativeEmitterProbesExecuted:0,coordinatorExit:1},cellEmitterSource:{line:emitterLine,text:lines[emitterLine-1],sha256:hash(Buffer.from(source))},captures:captured,knownRolesThroughThisDataFinalizer:31,reservedPublicationRoles:4,knownFinalOnSuccess:35,peak:3,processScope:'known invocation-local roles, no universal/transitive census',product:0,Workers:0,privateTransport:0,native:0};
fs.writeFileSync(root+'/SOURCE-SUMMARY.json',JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
const text=JSON.stringify({at:summary.at,purePass:summary.purePass,ownerPass:summary.ownerPass,novelQualified:0,emitterLine,summarySha256:hash(read(root+'/SOURCE-SUMMARY.json')),knownThrough:31,publicationReserve:4})+'\n';fs.writeSync(1,text);fs.writeSync(3,text);
