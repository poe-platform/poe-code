import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { admitFile } from './admission.mjs';
import { mapImports } from './origins.mjs';

const root = process.cwd(), scope = import.meta.dirname, base = path.dirname(scope);
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const blob = body => crypto.createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
const relative = file => path.relative(root, file);
const write = (name, value) => fs.writeFileSync(path.join(scope,name), JSON.stringify(value,null,2)+'\n', {flag:'wx'});
const descriptor = (file, expected) => {
  const stat = fs.lstatSync(file); assert.ok(stat.isFile()&&!stat.isSymbolicLink()); assert.ok(stat.size<=4194304);
  const body = expected ? admitFile(file,expected,4194304) : fs.readFileSync(file);
  assert.equal(body.length,stat.size); return {record:{path:relative(file),bytes:body.length,sha256:sha(body)},body};
};
try {
  const b0Input=descriptor(path.join(base,'stage-b0-r3/PRESEAL.json'),{bytes:11952,sha256:'78e6c945ceadfb54d51d806fbe57399ab5a552ad4571791cb916c085736e27a7'});
  const b0=JSON.parse(b0Input.body), prepared=JSON.parse(fs.readFileSync(path.join(scope,'ORIGINALS.json')));
  const auth=prepared.authenticatedInputs;
  const files=new Map(), staged=[], stagedEntries=[];
  const include=(filename,expected)=>{const value=descriptor(filename,expected);assert.notEqual(path.basename(filename),'AGENTS.md');files.set(value.record.path,value.record);return value;};
  for(const entry of b0.files)include(path.join(root,entry.path),entry);
  include(path.join(root,b0Input.record.path),b0Input.record);
  for(const entry of auth.inputs)include(path.join(root,entry.path),entry);
  for(const name of ['prepare.mjs','admission.mjs','origins.mjs','bootstrap.mjs','consumer.mjs','run.mjs','controls.mjs','seal.mjs','launch.sh','PROFILE.md','ORIGINALS.json'])include(path.join(scope,name));
  const own=(name,target=name)=>{
    const value=include(path.join(scope,name));
    const origin={kind:'NEW_B1_R2_SOURCE',repositoryPath:value.record.path,computedBlob:blob(value.body),bytes:value.record.bytes,sha256:value.record.sha256,authority:'This source preseal commit; computed blob is not claimed stored before commit'};
    const entry={...value.record,source:value.record.path,target,origin};staged.push(entry);stagedEntries.push({stagedPath:'harness/node/'+target,body:value.body,origin});
  };
  const inherited=(source,target,expected,authority)=>{
    const value=include(path.join(root,source),expected);
    const origin={kind:'AUTHENTICATED_INHERITED_SOURCE',repositoryPath:source,blob:blob(value.body),bytes:value.record.bytes,sha256:value.record.sha256,authority};
    staged.push({...value.record,source,target,origin});stagedEntries.push({stagedPath:'harness/node/'+target,body:value.body,origin});
  };
  own('consumer.mjs');own('admission.mjs');
  const workflow=b0.stageFiles.find(entry=>entry.source.endsWith('/v4/workflows.mjs'));assert.ok(workflow,'B0 workflow origin');
  inherited(workflow.source,'workflows.mjs',workflow,'B0 8ab0b287 stageFiles, v4 immutable fixture');
  const neutral=b0.stageFiles.find(entry=>entry.source.endsWith('/NEUTRAL-FIXTURE.json'));assert.ok(neutral,'B0 neutral origin');
  inherited(neutral.source,'neutral.json',neutral,'B0 8ab0b287 stageFiles');
  for(const name of ['engine-adapter-v1.mjs','node-policy.mjs','node-load-guard.mjs']){
    const entry=auth.inputs.find(row=>path.basename(row.path)===name);assert.ok(entry);inherited(entry.path,name,entry,{commit:entry.commit,blob:entry.blob});
  }
  const receiptEntry=auth.inputs.find(row=>path.basename(row.path)==='PUBLIC-ENGINE-RECEIPT.json');
  const receipt=JSON.parse(admitFile(path.join(root,receiptEntry.path),receiptEntry,131072));
  const engineEntry=auth.inputs.find(row=>path.basename(row.path)==='INPUTS-v1.json.gz.base64');
  const encoded=admitFile(path.join(root,engineEntry.path),engineEntry,2097152),compressed=Buffer.from(encoded.toString('ascii').trim(),'base64');
  assert.equal(compressed.length,1454742);assert.equal(sha(compressed),'014ebf5c1f325c9f7288e8cb55970bd41bf02604ee727089d0bdb07655692c3c');
  const inflated=gunzipSync(compressed,{maxOutputLength:16777216,info:true});assert.equal(inflated.engine.bytesWritten,compressed.length);assert.ok(encoded.length+compressed.length+inflated.buffer.length<=33554432);
  const engine=JSON.parse(inflated.buffer);assert.equal(engine.engine.length,96);
  for(const entry of engine.engine){
    const expected=receipt.engine.find(row=>row.archiveTarget===entry.target);assert.ok(expected);
    const body=Buffer.from(entry.body,'base64');assert.equal(body.length,expected.bytes);assert.equal(sha(body),expected.sha256);
    const stagedPath='harness/node/'+expected.stagedRelativePath;
    stagedEntries.push({stagedPath,body,origin:{kind:'AUTHENTICATED_ARCHIVE_ENTRY',repositoryArchive:engineEntry.path,archiveCommit:engineEntry.commit,archiveBlob:engineEntry.blob,archiveSha256:engineEntry.sha256,archiveTarget:entry.target,emissionCommit:expected.emissionCommit??null,bytes:expected.bytes,sha256:expected.sha256}});
  }
  const membersEntry=b0.producerRecords.find(entry=>entry.path==='PACKAGE-MEMBERS.json');assert.ok(membersEntry);
  const members=JSON.parse(admitFile(path.join(base,'stage-a-r2/evidence/PACKAGE-MEMBERS.json'),membersEntry,2097152));assert.equal(members.length,1014);
  const memberBodies=[];
  for(const entry of members){
    const filename=path.join('/private/tmp/safe-bash-coherent-stage-a-20260829-r2/source',entry.path);
    const body=admitFile(filename,entry,16777216);
    memberBodies.push({stagedPath:'node_modules/virtual-bash/'+entry.path,body,origin:{kind:'ACTUAL_STAGE_A_GENERATED_FILE',producerEvidence:'d8524695c472cdea1e506bc234f426b4e6829cce',selectedTree:'3adc676a0ab638c9788ef007e465931d65d2c6fe',retainedFile:filename,bytes:entry.bytes,sha256:entry.sha256,storedGitBlobClaim:false}});
  }
  const edges=mapImports([...stagedEntries,...memberBodies]);
  const importMap={schema:'b1-explicit-staged-origins-v1',created:new Date().toISOString(),entries:[...stagedEntries,...memberBodies].map(({body,...entry})=>entry),edges,computedImports:[{importer:'harness/node/consumer.mjs',expression:'import(rootURL)',fixedAlias:'virtual-bash',target:'node_modules/virtual-bash/dist/index.js'},{importer:'harness/node/consumer.mjs',expression:'import(nodeURL)',fixedAlias:'virtual-bash/commands/node',target:'node_modules/virtual-bash/dist/commands/node/index.js'},{importer:'node_modules/virtual-bash/dist/commands/node/worker-main.js',expression:'configured adapter entry',target:'harness/node/engine-adapter-v1.mjs',authority:'exact policy.adapters plus authenticated loader files'}],qualification:'Literal static imports and declared computed roots; not new dynamic loader execution proof. Generated outputs are tied to actual producer/source graph, not invented Git blob identities.'};
  write('STAGED-IMPORT-ORIGINS.json',importMap);include(path.join(scope,'STAGED-IMPORT-ORIGINS.json'));
  write('AUTHENTICATED-INPUTS.json',auth);const authRecord=include(path.join(scope,'AUTHENTICATED-INPUTS.json')).record;
  const retention={B0AuthorObserved:39,B1Planned:15,B2Planned:672,totalPlanned:726,unit2PerLayout:50,B2RuntimeStatus:'UNRUN'};
  const seal={schema:'coherent-b1-public15-preseal-v1',revision:'r2-new-admission-explicit-origins',created:new Date().toISOString(),sourceTree:'3adc676a0ab638c9788ef007e465931d65d2c6fe',sourceInputs:309,package:b0.package,members:1014,actualStageAEmissions:1012,b0:b0Input.record,authenticatedInputs:authRecord,ids:['C10','C11','C15','C16','C18'],layouts:['source-built','installed','physically-moved'],knownRoles:['offline-install','workflow-source-built','workflow-installed','workflow-physically-moved'],workRoot:'/private/tmp/safe-bash-coherent-b1-public15-20260829-r2',stageFiles:staged,stageOriginsComplete:true,stageOriginEntries:importMap.entries.length,staticImportEdges:edges.length,remaining:retention,bounds:{wallSeconds:1800,activeSeconds:1620,publicationReserveSeconds:180,knownOSStarts:32,knownOSPeak:3,supervisedChildren:4,installSeconds:120,layoutSeconds:300,caseSeconds:30,cleanupSeconds:5,captureBytes:67108864,workingBytes:805306368,guestWorkersPerLayout:5,guestWorkersTotal:15,guestWorkerMaximumActive:5,guestWorkerExpectedSequentialPeak:1,regexWorkers:0,internalLoaderThreads:0,synchronousHookMainEntries:3,synchronousHookGuestEntriesMaximum:15,loadRecordsPerIsolate:2048,observerRecordsPerLayout:512},controls:{entry:relative(path.join(scope,'controls.mjs')),groups:12,harmlessNodeControllerStarts:1,productImports:0,workers:0},files:[...files.values()].sort((left,right)=>Buffer.compare(Buffer.from(left.path),Buffer.from(right.path))),actualAuthorization:'PENDING_DIFFERENT_PREEXECUTION_REVIEW_AND_FRESH_ROOT_GO'};
  assert.equal(fs.existsSync(seal.workRoot),false);
  for(const suffix of ['stdout','stderr'])assert.equal(fs.existsSync('/private/tmp/coherent-b1-public15-20260829-r2.launch.'+suffix),false);
  write('PRESEAL.json',seal);
  const preseal=descriptor(path.join(scope,'PRESEAL.json')).record;
  const launch=`B1_ROOT_GO=ROOT_B1_PUBLIC15_EXPLICIT_FRESH_AUTHORIZATION /bin/zsh tests/integration/agent-bash-coherent-author-20260829/stage-b1-r2/launch.sh ${preseal.path} ${preseal.sha256} ${preseal.bytes}`;
  write('SEAL-RECEIPT.json',{preseal,launch,status:'EXECUTABLE_SOURCE_PRESEAL_CONTROLS_AND_DIFFERENT_REVIEW_PENDING',stageOriginEntries:importMap.entries.length,staticImportEdges:edges.length,productImports:0,engineImports:0,actualCalls:0});
  console.log(JSON.stringify({preseal,launch,entries:importMap.entries.length,edges:edges.length,at:seal.created,actualCalls:0}));
}catch(error){console.error(error);process.exitCode=78;}
