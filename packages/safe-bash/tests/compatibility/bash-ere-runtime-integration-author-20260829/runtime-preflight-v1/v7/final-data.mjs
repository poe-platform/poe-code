import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.dirname(new URL(import.meta.url).pathname);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(file){const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<4194304);const bytes=fs.readFileSync(file);assert.equal(bytes.length,stat.size);return bytes;}
const seal=JSON.parse(read(root+'/EXECUTION-SEAL.json'));
assert(Date.now()<seal.deadline);
for(const row of [...seal.files,seal.recipe,seal.oldCell]){assert.equal(hash(read(row.path)),row.sha256);assert.equal(fs.lstatSync(row.path).size,row.bytes);}
const recipe=JSON.parse(read(root+'/BINDING-RECIPE.json'));assert.equal(hash(read(recipe.definitions.path)),recipe.definitions.sha256);
assert.equal(hash(read(path.dirname(root)+'/v4/dispatch.mjs')),recipe.priorDispatchSha256);
const controls=JSON.parse(read(root+'/CONTROL-RESULT.json')),execution=JSON.parse(read(root+'/CONTROL-EXECUTION.json'));
assert.equal(controls.pass,12);assert.equal(controls.fail,0);assert.equal(execution.code,0);assert.equal(execution.signal,null);
const summary={at:new Date().toISOString(),status:'AUTHOR_CONTROL_PASS_REQUIRES_DIFFERENT_REVIEW',sourceCommit:'e33b99af9fbec345b4f5a76d50f627c3d4d9f73a',sealSha256:hash(read(root+'/EXECUTION-SEAL.json')),evidenceSha256:hash(read(root+'/CONTROL-EVIDENCE.json')),writerSha256:hash(read(root+'/event-writer.mjs')),finalizerSha256:hash(read(root+'/finalize-cell.mjs')),cellSha256:recipe.newCellSha256,dispatchSha256:recipe.newDispatchSha256,unchangedBody:recipe.unchangedBody,controls:12,product:0,Workers:0,native:0,knownRolesThroughThisHelper:15,publicationRolesReserved:4,knownFinalOnSuccess:19,knownPeak:2,execution,recipeStatus:recipe.status,workingBound:JSON.parse(read(root+'/WORKING-BOUND.json')),runtimeAuthority:false};
fs.writeFileSync(root+'/AUTHOR-SUMMARY.json',JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
const text=JSON.stringify({at:summary.at,status:summary.status,sourceCommit:summary.sourceCommit,sealSha256:summary.sealSha256,evidenceSha256:summary.evidenceSha256,writerSha256:summary.writerSha256,finalizerSha256:summary.finalizerSha256,helperPid:execution.pid,knownThrough:15,reservedPublication:4})+'\n';fs.writeSync(1,text);fs.writeSync(3,text);
