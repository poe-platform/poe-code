import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { makeAuthority } from '../candidate-753-review-executor-v2/manifest.mjs';
import { describe, inventory } from '../candidate-753-review-executor-v2/common.mjs';

const own=path.dirname(fileURLToPath(import.meta.url)),review=path.dirname(own),repository=path.resolve(own,'../../../..'),executor=path.join(review,'candidate-753-review-executor-v2');
function read(directory,name,maximum){assert.match(name,/^[A-Za-z0-9_./-]+\.(json|raw)$/);assert.ok(!name.split('/').includes('..'));const filename=path.join(directory,name),stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maximum);return fs.readFileSync(filename);}
const parse=(directory,name,maximum)=>JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(read(directory,name,maximum)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function write(directory,name,value){const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');assert.ok(bytes.length<=262144);const descriptor=fs.openSync(path.join(directory,name),'wx',0o644);try{fs.writeFileSync(descriptor,bytes);fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}return {bytes:bytes.length,sha256:hash(bytes)};}
function ownFiles(directory){const files={};for(const name of fs.readdirSync(directory).sort()){assert.match(name,/^[A-Za-z0-9_.-]+\.(mjs|json|md|patch)$/);const filename=path.join(directory,name),entry=describe(filename);assert.ok(entry.bytes<=2*1024*1024);files[name]=entry;}return files;}
function checkFiles(directory,files){for(const [name,expected] of Object.entries(files))assert.deepEqual(describe(path.join(directory,name)),expected,name);}
const phase=process.argv[2];
if(phase==='authority'){
 const binding=parse(executor,'BINDINGS.json',165223),pkg=parse(executor,'PACKAGE-INVENTORY.json',164921),variants=parse(executor,'VARIANTS.json',404120);
 const authority=makeAuthority(pkg,binding.selectedInputs,binding.candidate,variants);assert.equal(Object.keys(authority.graphs).length,31);
 const body='export const authority = Object.freeze('+JSON.stringify(authority,null,2)+');\n';
 const patch='*** Begin Patch\n*** Add File: '+path.relative(repository,path.join(executor,'authority.mjs'))+'\n'+body.trimEnd().split('\n').map(line=>'+'+line).join('\n')+'\n*** End Patch\n';
 const result=write(own,'AUTHORITY.patch',patch);console.log(JSON.stringify({phase,...result,approvedGraphIds:Object.keys(authority.graphs).length,at:new Date().toISOString()}));
}else if(phase==='controls'){
 const previous=parse(path.join(review,'candidate-753-review-executor-v1'),'PRESEAL.json',108224);
 const files=ownFiles(own),executorFiles=ownFiles(executor);
 for(const tool of [previous.node,previous.git]){const {path:filename,...expected}=tool;assert.deepEqual(describe(filename),expected);}
 const seal={schema:'AP753-manifest-controls-preseal-v2',phase:'before qualification and any product build/load',created:new Date().toISOString(),files,executorFiles,node:previous.node,git:previous.git,expectedControls:31,qualificationAttempts:1,qualificationProcesses:2,qualificationPeak:2,qualificationTimeoutMs:120000,candidate:previous.candidate,selectedTree:previous.selectedTree,packageSha256:previous.packageSha256,original23:'historical22/23 unchanged;22 bodies retained;D02-v2 exact30+IDs;8 new controls',conditionalActual:'Only PASS31 plus complete committed full54 PRESEAL and all-source preflight permits the new ROOT-authorized one actual attempt'};
 console.log(JSON.stringify({phase,...write(own,'CONTROL-PRESEAL.json',seal),files:Object.keys(files).length,executorFiles:Object.keys(executorFiles).length}));
}else if(phase==='actual'){
 const control=parse(own,'CONTROL-PRESEAL.json',32768);checkFiles(own,control.files);checkFiles(executor,control.executorFiles);
 const receipt=parse(own,'qualification-01/RECEIPT.json',16384),result=parse(own,'qualification-01/stdout.raw',32768);
 assert.equal(receipt.code,0);assert.equal(receipt.signal,null);assert.equal(receipt.primary,null);assert.equal(receipt.closed,true);assert.equal(receipt.absent,true);assert.equal(receipt.observedBytes,receipt.retainedBytes);
 assert.equal(result.pass,31);assert.equal(result.fail,0);assert.equal(result.results.length,31);assert.equal(new Set(result.results.map(row=>row.id)).size,31);assert.equal(result.productEvaluations,0);
 assert.equal(result.sourcePresealSha256,hash(read(own,'CONTROL-PRESEAL.json',32768)));
 const seal=parse(path.join(review,'candidate-753-review-executor-v1'),'PRESEAL.json',108224);
 const jobFile=parse(executor,'JOBS.json',30000);assert.deepEqual(jobFile,seal.jobs);assert.equal(jobFile.length,54);
 seal.files=ownFiles(executor);seal.phase='fresh full54 after versioned31 DATA/SYNTHETIC controls; no inherited old passes';
 seal.date='2026-08-28';seal.bounds.plannedOwnerAndChildren=62;seal.administrativeGit.splice(-1,0,'runtime-sizes: bounded exact --batch-check before framed capture');
 seal.runtimeSealGit.splice(-1,0,'cat-file --batch-check exact known commit and two payload object IDs; whole16MiB framing rechecked');
 seal.qualification='Original685cdd0d setup3/54, 569a4b89 22/23 and all older failures remain. New full54 from fresh source/build/consumer staging; no inherited product passes. D02-v2=30 exact phase IDs. Both records and65536-byte commit reservation admitted before publication; exact graph ID/catalog allowlist. Additional serialized runtime-sizes child within70.';
 for(const name of ['CONTROL-PRESEAL.json','CONTROL-PLAN.json','qualification-01/stdout.raw','qualification-01/stderr.raw','qualification-01/RECEIPT.json','qualification-01/OWNER.jsonl'])seal.sourceBindings[path.relative(repository,path.join(own,name))]=describe(path.join(own,name));
 for(const [name,expected] of Object.entries(seal.sourceBindings))assert.deepEqual(describe(path.join(repository,name)),expected,name);
 for(const tool of [seal.node,seal.git]){const {path:filename,...expected}=tool;assert.deepEqual(describe(filename),expected,filename);}
 for(const tool of seal.tools)assert.deepEqual(inventory(path.join(repository,tool.directory),128*1024*1024),tool.entries,tool.directory);
 const resultSeal=write(executor,'PRESEAL.json',seal);
 write(own,'ALL-SOURCE-PREFLIGHT.json',{schema:'AP753-all-source-preflight-v2',performed:new Date().toISOString(),sourceFiles:Object.keys(seal.files).length,externalBindings:Object.keys(seal.sourceBindings).length,toolInventories:seal.tools.length,node:seal.node,git:seal.git,jobs:54,plannedAllOwned:62,bounds:seal.bounds,controlSealSha256:hash(read(own,'CONTROL-PRESEAL.json',32768)),actualSeal:resultSeal,productEvaluations:0,builds:0,qualification:{pass:31,fail:0,retired:true}});
 console.log(JSON.stringify({phase,...resultSeal,jobs:54,plannedAllOwned:62,at:new Date().toISOString()}));
}else if(phase==='grant'){
 const sourceCommit=process.argv[3];assert.match(sourceCommit,/^[a-f0-9]{40}$/);
 const bytes=read(executor,'PRESEAL.json',160000),seal=JSON.parse(bytes),sealSha256=hash(bytes);checkFiles(executor,seal.files);
 for(const [name,expected] of Object.entries(seal.sourceBindings))assert.deepEqual(describe(path.join(repository,name)),expected,name);
 const command='exec -c '+seal.node.path+' --no-warnings '+path.join(executor,'controller.mjs')+' '+sourceCommit+' '+sealSha256;
 const grant={binding:{authorization:'ROOT AP753 ONE REVIEW',attempt:1,candidate:seal.candidate,sealSha256,sourceCommit},command,cwd:repository,login:false,authority:'ROOT latest explicit conditional ONE actual753 full54 GO: after versioned D02 exact30/IDs and two rootcause admission repairs pass all controls and complete full54 source/tool/consumer/loader/runtime budget seal is committed.110min/70 all-owned/peak4/128MiB combined capture/512MiB work/case30s/build120s. Fresh setup no old passes. No production/rootexports/native/private/network. Stop safety/capture/integrity/unknown retirement, no retry; ordinary clean assertions aggregate.',historicalIntegrity:'685cdd0d HOLD3/54/51 unrun;569a4b89 original22/23 wrong10;5f336d1a binary-output HOLD and all exact raw loss qualifications unchanged. This is fresh representation setup, not retroactive qualification.'};
 const temporary=path.join(executor,'ROOT-GO.pending');assert.ok(!fs.existsSync(path.join(executor,'ROOT-GO.json')));write(executor,'ROOT-GO.pending',grant);fs.renameSync(temporary,path.join(executor,'ROOT-GO.json'));const descriptor=fs.openSync(executor,'r');try{fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}console.log(JSON.stringify({phase,command,cwd:repository,login:false,grant:describe(path.join(executor,'ROOT-GO.json')),sealSha256,sourceCommit}));
}else throw Error('exact phase required');
