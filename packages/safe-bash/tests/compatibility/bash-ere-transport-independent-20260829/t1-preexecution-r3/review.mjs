import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
const own=import.meta.dirname;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sealBytes=fs.readFileSync(own+'/PRESEAL.json');
assert.equal(sha(sealBytes),process.argv[2]);
const seal=JSON.parse(sealBytes);
assert.ok(Date.now()<Date.parse(seal.deadline));
for(const entry of seal.files){const stat=fs.lstatSync(own+'/'+entry.path);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===entry.bytes);assert.equal(sha(fs.readFileSync(own+'/'+entry.path)),entry.sha256);}
const inputs=JSON.parse(fs.readFileSync(own+'/INPUTS.json'));
const inherited=JSON.parse(fs.readFileSync(own+'/INHERITED.json'));
function body(name){const candidates=inputs.filter(row=>row.path.endsWith('/'+name));assert.equal(candidates.length,1,name);const row=candidates[0],bytes=Buffer.from(row.base64,'base64');assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.sha256);return bytes;}
assert.equal(sha(body('EXECUTION-PRESEAL.json')),'8cfe3fc49116f9db553fa85a23683e711bc6766574780e6e33c25f5a6bf0e74a');
const execution=JSON.parse(body('EXECUTION-PRESEAL.json'));
const run=own+'/run',r3=run+'/preparation-r3';fs.mkdirSync(run);fs.mkdirSync(r3);fs.mkdirSync(r3+'/capture');
for(const entry of inherited){const bytes=Buffer.from(entry.base64,'base64');assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);fs.writeFileSync(run+'/'+entry.name,bytes,{flag:'wx'});}
const control=JSON.parse(body('CONTROL-PRESEAL-v2.json'));
for(const entry of control.inputs){const bytes=body(entry.name);assert.equal(bytes.length,entry.size);assert.equal(sha(bytes),entry.sha256);fs.writeFileSync(r3+'/'+entry.name,bytes,{flag:'wx'});}
for(const name of ['CONTROL-PRESEAL-v2.json','OWNER-PRESEAL-v2.json'])fs.writeFileSync(r3+'/'+name,body(name),{flag:'wx'});
process.argv[2]=sha(body('CONTROL-PRESEAL-v2.json'));
await import(pathToFileURL(r3+'/controls-v2.mjs'));
const author=JSON.parse(fs.readFileSync(r3+'/CONTROL-RESULT-v2.json'));
assert.equal(author.pass,true);assert.equal(author.retained14,14);assert.equal(author.versionedOld19.length,19);assert.equal(author.novel8.length,8);assert.equal(author.additional.length,10);
const {fixture,resequence}=await import(pathToFileURL(r3+'/receipt-fixture.mjs'));
const {judge,processTrace}=await import(pathToFileURL(r3+'/receipt-gate.mjs'));
const {admitCaseGrant}=await import(pathToFileURL(r3+'/data-support.mjs'));
const independent=[];
function check(id,callback){try{callback();independent.push({id,status:'PASS'});}catch(reason){independent.push({id,status:'FAIL',message:reason instanceof Error?reason.message:typeof reason});}}
check('R01-finite-timestamp-domains',()=>{for(const invalid of [NaN,Infinity,-1,0.5,'100']){for(const domain of ['trace','process']){const row=fixture();(domain==='trace'?row.receipt.trace:row.observed.trace)[0].at=invalid;assert.throws(()=>judge(row.receipt,row.observed,row.config));}}const row=fixture();row.observed.clockDomain=row.receipt.clockDomain;assert.throws(()=>judge(row.receipt,row.observed,row.config));});
check('R02-retained-C2-only-no-process',()=>{const bytes=body('capture/normal.receipt.json');assert.equal(sha(bytes),'9aefed73be3050238834b794a2c80de30e3a87c506bd9fcd2a451f6155d64f68');const row=JSON.parse(bytes);processTrace(row);assert.equal(row.pid,34371);assert.ok(row.trace.findIndex(event=>event.kind==='close')<row.trace.findIndex(event=>event.kind==='stderrClose'));});
check('R03-A03-bound-neighbors',()=>{for(const mutation of ['digest','duplicate','entry','env','argv','workerData']){const row=fixture('A03/workerData-env-execArgv');if(mutation==='digest')row.receipt.nestedLoads[1].sha256='f'.repeat(64);if(mutation==='duplicate')row.receipt.nestedLoads[1]={...row.receipt.nestedLoads[0]};if(mutation==='entry')row.receipt.workerIdentity.entry='file:///other';if(mutation==='env')row.receipt.workerIdentity.envKeys.push('UNREQUESTED');if(mutation==='argv')row.receipt.workerIdentity.argv[1]='/fixture/worker-entry.actual.js';if(mutation==='workerData')row.receipt.workerIdentity.workerData.version=2;assert.throws(()=>judge(row.receipt,row.observed,row.config));}});
check('R04-delivery-and-own-data',()=>{for(const mutation of ['delivery','duplicate','accessor']){const row=fixture();let calls=0;if(mutation==='delivery')row.receipt.trace.find(event=>event.kind==='posted').id=2;if(mutation==='duplicate'){const event=row.receipt.trace.find(event=>event.kind==='posted');row.receipt.trace.splice(5,0,{...event});resequence(row.receipt.trace);}if(mutation==='accessor')Object.defineProperty(row.receipt.workerIdentity??row.receipt,'extra',{get(){calls++;throw false;},enumerable:true});assert.throws(()=>judge(row.receipt,row.observed,row.config));assert.equal(calls,0);}});
check('R05-null-prototype-valid-and-sticky-unknown',()=>{const row=fixture();Object.setPrototypeOf(row.receipt,null);Object.setPrototypeOf(row.observed,null);assert.equal(judge(row.receipt,row.observed,row.config).pass,true);row.observed.state='STOP_UNKNOWN';assert.throws(()=>judge(row.receipt,row.observed,row.config));});
check('R06-root-clock-conflict-is-real-admission',()=>{const grant={schema:1,authorized:true,profileSha256:sha(body('EXECUTION-PRESEAL.json')),runId:'ERE-PRIVATE-RUNTIME-v3',cases:135,Workers:111,wallMilliseconds:1800000,knownOS:146,captureBytes:67108864,workingBytes:268435456};assert.throws(()=>admitCaseGrant(grant,grant.profileSha256,135,111));assert.equal(execution.limits.observationWindowMilliseconds,2100000);grant.wallMilliseconds=2100000;assert.equal(admitCaseGrant(grant,grant.profileSha256,135,111),grant);});
const prepared=JSON.parse(body('DATA-PREPARATION-RESULT.json'));
const archiveText=body('CASES.json.gz.base64.data');assert.equal(archiveText.length,prepared.archive.textBytes);assert.equal(sha(archiveText),prepared.archive.textSha256);
const compressed=Buffer.from(archiveText.toString('ascii').trim(),'base64');assert.equal(compressed.length,prepared.archive.compressedBytes);assert.equal(sha(compressed),prepared.archive.compressedSha256);
const raw=gunzipSync(compressed,{maxOutputLength:33554432,info:true});assert.equal(raw.engine.bytesWritten,compressed.length);assert.equal(raw.buffer.length,prepared.archive.decodedBytes);assert.equal(sha(raw.buffer),prepared.archive.decodedSha256);
const archive=JSON.parse(raw.buffer);assert.equal(archive.entries.length,4191);const byPath=new Map();let archiveBytes=0;for(const entry of archive.entries){assert.equal(byPath.has(entry.path),false);const bytes=Buffer.from(entry.base64,'base64');assert.equal(bytes.length,entry.size);assert.equal(sha(bytes),entry.sha256);archiveBytes+=bytes.length;byPath.set(entry.path,entry);}
assert.equal(archiveBytes,15168573);
const inventoryText=body('CASE-INVENTORY.json.gz.base64.data');const inventoryCompressed=Buffer.from(inventoryText.toString('ascii').trim(),'base64');const inventoryRaw=gunzipSync(inventoryCompressed,{maxOutputLength:2097152,info:true});assert.equal(inventoryRaw.engine.bytesWritten,inventoryCompressed.length);assert.equal(sha(inventoryRaw.buffer),execution.caseInventorySha256);const inventory=JSON.parse(inventoryRaw.buffer);assert.equal(inventory.cases.length,135);
const mapping=JSON.parse(fs.readFileSync(run+'/CASE-MAPPING.json'));const eligible=mapping.cases.filter(row=>row.method!=='BLOCKED');const deferred=mapping.cases.filter(row=>row.method==='BLOCKED');assert.equal(eligible.length,47);assert.equal(deferred.length,13);const cells=eligible.flatMap(row=>row.layouts.map(layout=>({id:row.id,layout,Workers:row.workerCeiling})));assert.equal(cells.length,135);assert.equal(cells.reduce((sum,row)=>sum+row.Workers,0),111);
const configRows=[];for(const cell of inventory.cases){assert.ok(cells.some(row=>row.id===cell.id&&row.layout===cell.layout));for(const file of cell.files){const entry=byPath.get(cell.folder+'/'+file.path);assert.ok(entry);assert.equal(entry.size,file.size);assert.equal(entry.sha256,file.sha256);}const entry=byPath.get(cell.folder+'/CASE.json');assert.equal(entry.sha256,cell.caseSha256);const config=JSON.parse(Buffer.from(entry.base64,'base64'));if(config.id==='A03/workerData-env-execArgv')configRows.push({id:config.id,layout:config.layout,expectedNestedLoads:config.expectedNestedLoads,expectedWorkerIdentity:config.expectedWorkerIdentity});}
fs.writeFileSync(own+'/MAP-AND-A03.json',JSON.stringify({eligible:eligible.map(row=>({id:row.id,layouts:row.layouts})),deferred:execution.mapping,cells,configRows,archiveBytes},null,2)+'\n',{flag:'wx'});
fs.writeFileSync(own+'/RESULT.json',JSON.stringify({author,independent,normalRetainedDATAOnly:true,archiveFiles:4191,archiveBytes,actualWorkers:0,productImports:0,compiler:0,clockConflict:{rootRequested:1800000,candidate:2100000}},null,2)+'\n',{flag:'wx'});
assert.ok(Date.now()<Date.parse(seal.deadline));
console.log(JSON.stringify({oldPurposes:33,rejections:8,additional:10,independentPassed:independent.filter(row=>row.status==='PASS').length,independentFailed:independent.filter(row=>row.status==='FAIL').length,Workers:0}));
