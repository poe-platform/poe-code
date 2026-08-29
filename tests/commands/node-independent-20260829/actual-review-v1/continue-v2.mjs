import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const home=path.dirname(fileURLToPath(import.meta.url));
const previous=path.join(home,'capsule-v2');
const next=path.join(home,'capsule-v3');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function read(file,max=4194304){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw Error('bounded regular input');return fs.readFileSync(file);}
function write(name,value){fs.writeFileSync(path.join(next,name),value,{flag:'wx'});}
function replace(text,from,to){if(text.split(from).length!==2)throw Error('unique correction anchor');return text.replace(from,to);}
const oldSeal=JSON.parse(read(path.join(home,'ACTUAL-PRESEAL.json')));
for(const row of oldSeal.inputs){const bytes=read(path.join(home,row.path));if(bytes.length!==row.bytes||hash(bytes)!==row.sha256)throw Error('original executable drift');}
const outer=JSON.parse(read(path.join(previous,'outer/RECEIPT.json')));
const summary=JSON.parse(read(path.join(previous,'validation-v2/evidence/r1-SUMMARY.json')));
const encodedRaw=read(path.join(previous,'validation-v2/evidence/r1-RAW.json.gz.base64'));
if(encodedRaw.length!==summary.raw.bytes||hash(encodedRaw)!==summary.raw.sha256||summary.unsafe||!summary.cleanup||!outer.closed||!outer.cleanup||outer.captureFault||outer.timeout)throw Error('unsafe original attempt');
const packedRaw=Buffer.from(encodedRaw.toString().trim(),'base64');
const raw=JSON.parse(gunzipSync(packedRaw,{maxOutputLength:16777216}));
const independent=read(path.join(previous,'validation-v2/capture/r1-source-independent.stdout')).toString().trim().split('\n').map(JSON.parse);
if(raw.stopped.message!=='receipt role'||raw.cases.length!==63||raw.cases.some(row=>!row.pass)||!raw.allChildrenClosed||independent.length!==23||independent.some(row=>!row.pass||!row.clean))throw Error('original outcome not exact expected parser stop');
const actualWorkers=raw.workers+independent.reduce((sum,row)=>sum+(row.workers??0),0);
const actualEntries=raw.guestEntries+independent.reduce((sum,row)=>sum+(row.guestEntries??0),0);
fs.mkdirSync(next);
for(const row of oldSeal.inputs.filter(row=>row.path.startsWith('capsule-v2/'))){const name=path.basename(row.path);if(['CONTROL-v5.json','PRESEAL-v5.json','owner-v5.mjs'].includes(name))continue;write(name,read(path.join(previous,name)));}
let owner=read(path.join(previous,'owner-v5.mjs')).toString();
owner=replace(owner,"function receipts(record){","function receipts(record,roles=['case-receipt-v1','focused-summary','worker-summary']){");
owner=replace(owner,"if(row.role!=='case-receipt-v1'&&row.role!=='focused-summary'&&row.role!=='worker-summary')throw Error('receipt role');","if(!roles.includes(row.role))throw Error('receipt role');");
owner=replace(owner,"const rows=receipts(record);const last=rows.pop();const expected=configuration.independentIds;","const rows=receipts(record,['raw-parent-synthetic','actual-engine-or-preflight','independent-summary']);const last=rows.pop();const expected=configuration.independentIds;");
owner=replace(owner,"if(row.id!==expected[index]||typeof row.pass","if(row.role!==(expected[index].startsWith('R')?'raw-parent-synthetic':'actual-engine-or-preflight')||row.id!==expected[index]||typeof row.pass");
owner=replace(owner,"const sourceModule=path.join(sourceRoot,'dist');await oneCase('source',sourceModule,'focused','focused');for(const id of configuration.workerIds)await oneCase('source',sourceModule,id);await types('source',sourceModule);await oneCase('source',sourceModule,'independent','independent');","const sourceModule=path.join(sourceRoot,'dist');state.sourceMainInherited=configuration.sourceMainInherited;await oneCase('source',sourceModule,'independent','independent');");
write('owner-v5.mjs',owner);
const config=JSON.parse(read(path.join(previous,'CONTROL-v5.json')));
config.readRoots=config.readRoots.map(value=>value.replace(previous,next));
for(const key of Object.keys(config.environment))config.environment[key]=config.environment[key].replace(previous,next);
config.children=100;config.totalOwnedProcesses=102;config.workers=150;config.guests=150;
config.captureBytes=134217728;config.workBytes=536870912;
config.absoluteDeadline=Date.parse(outer.start)+4500000;
config.wallMs=2700000;config.outerWallMs=2820000;
config.planned={...config.planned,mainAuthorExecutions:126,sourceAuthorInherited:63,mainIndependentRows:66,typeProcesses:4,sourceTypesInherited:24,expectedOwnerChildStarts:88};
config.sourceMainInherited={source:raw.source,rawSha256:summary.raw.sha256,authorIdentities:63,types:24,allPassed:true,notRerun:true};
write('CONTROL-v5.json',JSON.stringify(config,null,2)+'\n');
const files=fs.readdirSync(next).sort().map(name=>{const bytes=read(path.join(next,name));return{path:name,bytes:bytes.length,sha256:hash(bytes)};});
const seal={schema:'independent-node-actual-preseal-continuation-v2',nodeSha256:JSON.parse(read(path.join(previous,'PRESEAL-v5.json'))).nodeSha256,source:raw.source,files,phase:'DISARMED_UNTIL_COMMITTED',priorActualPreserved:true};
write('PRESEAL-v5.json',JSON.stringify(seal,null,2)+'\n');
let launcher=read(path.join(home,'launch.mjs')).toString().replace("'capsule-v2'","'capsule-v3'").replaceAll('ACTIVATE-COMMITTED-a2f3983','ACTIVATE-COMMITTED-a2f3983-v2').replace("'ACTUAL-PRESEAL.json'","'ACTUAL-PRESEAL-v2.json'");
fs.writeFileSync(path.join(home,'launch-v2.mjs'),launcher,{flag:'wx'});
const inputs=['launch-v2.mjs',...fs.readdirSync(next).sort().map(name=>'capsule-v3/'+name)].map(name=>{const bytes=read(path.join(home,name));return{path:name,bytes:bytes.length,sha256:hash(bytes)};});
const result={...oldSeal,schema:'independent-node-executable-continuation-v2',inputs,plan:config.planned,ownerReserved:{children:100,workers:150,guests:150,wallMs:2700000},priorAttempt:{commit:'cc6eb305',rawSha256:summary.raw.sha256,parserFailure:'receipt role',sourceAuthorPass:63,sourceTypes:24,independentChildPass:22,ownerRecordedWorkers:raw.workers,actualWorkers,ownerRecordedEntries:raw.guestEntries,actualEntries,ownerProcessCount:raw.processCount,outerAdditionalProcesses:1,allRetired:true,captureBytes:raw.captureBytes+outer.captureBytes,writtenBytes:raw.writtenBytes,originalOutcome:'HOLD, not rewritten'},correction:'Only role-aware independent receipt grammar and exact per-ID role. No product/engine/case assertions changed. Source63/types24 retained from prior exact candidate; independent22 rerun. Installed/moved and all controls previously unrun.',cumulativeAdmission:{rootAllOS:192,priorOwnerAndLauncher:36,remainingOwnerAndLauncherCeiling:102,administrationReserve:54,workers:actualWorkers+150,guests:actualEntries+150,captureCeiling:raw.captureBytes+134217728,workingCeiling:raw.writtenBytes+536870912,deadline:new Date(config.absoluteDeadline).toISOString()},timing:'Versioned ordinary parser repair after fully captured clean first attempt; no continuation activation before committed seal'};
fs.writeFileSync(path.join(home,'ACTUAL-PRESEAL-v2.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(path.join(home,'ATTEMPT-v1.json'),JSON.stringify(result.priorAttempt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({source:raw.source,sourcePass:63,independentChildPass:22,workers:actualWorkers,entries:actualEntries,continuationSha256:hash(Buffer.from(JSON.stringify(result,null,2)+'\n')),activation:false}));
