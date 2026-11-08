import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { admitFile } from './admission.mjs';
const scope=import.meta.dirname,root=process.cwd();
const sha=body=>crypto.createHash('sha256').update(body).digest('hex');
const describe=file=>{const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=8388608);const body=fs.readFileSync(file);assert.equal(body.length,stat.size);return{path:path.relative(scope,file),bytes:body.length,sha256:sha(body)};};
const write=(name,value)=>fs.writeFileSync(path.join(scope,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
try{
  const expected={bytes:17692,sha256:'007887fff41f65481ecf7a4fe4ab68db2aa1a5c67d4782a30c5bf764d84f0fbc'};
  const seal=JSON.parse(admitFile(path.join(scope,'PRESEAL.json'),expected,1048576));
  for(const entry of seal.files)admitFile(path.join(root,entry.path),entry,4194304);
  const control=JSON.parse(fs.readFileSync(path.join(scope,'CONTROL-RESULT.json')));
  assert.equal(control.groups.length,12);assert.ok(control.groups.every(row=>row.status==='PASS'));assert.equal(control.productImports,0);assert.equal(control.engineImports,0);assert.equal(control.actualOSChildrenSpawned,0);
  const origins=JSON.parse(fs.readFileSync(path.join(scope,'STAGED-IMPORT-ORIGINS.json')));
  const owned=origins.entries.filter(entry=>entry.origin.kind==='NEW_B1_R2_SOURCE');
  const request=owned.map(entry=>'bd0f227d081829512bafc2936f0b33632e02890b:'+entry.origin.repositoryPath).join('\n')+'\n';
  const git=spawnSync('/usr/bin/git',['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],{cwd:root,input:request,maxBuffer:1048576,timeout:10000,env:{PATH:'/usr/bin:/bin',GIT_OPTIONAL_LOCKS:'0',LC_ALL:'C'}});
  fs.writeFileSync(path.join(scope,'capture/stored-origins.stdout'),git.stdout??Buffer.alloc(0),{flag:'wx'});fs.writeFileSync(path.join(scope,'capture/stored-origins.stderr'),git.stderr??Buffer.alloc(0),{flag:'wx'});
  assert.equal(git.status,0);assert.equal(git.signal,null);assert.equal(git.error,undefined);
  const actual=git.stdout.toString().trim().split('\n').map(line=>line.split(' '));assert.equal(actual.length,owned.length);
  actual.forEach((row,index)=>assert.deepEqual(row,[owned[index].origin.computedBlob,'blob',String(owned[index].origin.bytes)]));
  const evidence=path.join(scope,'evidence');fs.mkdirSync(evidence);
  let rawBytes=0;
  for(const label of ['initial','source','seal','seal-v2','controls','pure'])for(const suffix of ['stdout','stderr']){
    const source=`/private/tmp/coherent-b1-r2-prep-20260829-${label}.${suffix}`,stat=fs.lstatSync(source);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=8388608);
    const body=fs.readFileSync(source);assert.equal(body.length,stat.size);rawBytes+=body.length;fs.writeFileSync(path.join(evidence,path.basename(source)),body,{flag:'wx'});
  }
  const kinds={};for(const edge of origins.edges)kinds[edge.kind]=(kinds[edge.kind]??0)+1;
  const now=new Date();
  const summary={status:'READY_FOR_DIFFERENT_PREEXECUTION_REVIEW_NOT_RUNTIME_ACCEPTANCE',at:now.toISOString(),sourceCandidate:'bd0f227d081829512bafc2936f0b33632e02890b',preseal:expected,controlPreseal:{bytes:908,sha256:'37ba088783aa0502e0eb5649e185beb5f2288bbb5943c8d2ad663e76a086b926'},controls:{groups:12,pass:12,fail:0,actualNodeControllers:1,actualOSChildrenSpawned:0,productImports:0,engineImports:0,workers:0,qualification:control.qualification},sourceInputs:309,stageAEmissions:1012,packageMembers:1014,package:seal.package,originEntries:origins.entries.length,edges:origins.edges.length,edgeKinds:kinds,storedNewOriginBlobsVerified:actual.length,remaining:seal.remaining,actualProductCalls:0,actualRootGrant:false,knownRoles:seal.knownRoles,bounds:seal.bounds,workRoot:seal.workRoot,outerCaptures:['/private/tmp/coherent-b1-public15-20260829-r2.launch.stdout','/private/tmp/coherent-b1-public15-20260829-r2.launch.stderr'],preparation:{conservativeAnchor:'2026-08-29T12:25:00.000Z',elapsedFromConservativeAnchorSeconds:(now.getTime()-Date.parse('2026-08-29T12:25:00.000Z'))/1000,rawCaptureBytesBeforePublication:rawBytes,knownStartAccounting:{instructionContext:1,initialSourceAndAuthentication:9,helperSyntaxPreparation:5,firstSeal:4,readFirstSealFailure:1,correctedSeal:5,presealCommit:7,pureControllerDispatch:2,finalPublicationIncludingStoredBlobReadAndCommit:7,totalInclusiveConservative:41,limit:48},qualification:'Known explicit process roles; all previous tool sessions completed and metadata children report status0/signalnull. Final publication transcript records its own completion; no full descendant/PGID census.'},historical:['01406364/5a0b4923 missing-origin STOP unchanged','r2 first static scanner template false-positive retained','B0 d116d79a author39P independent audit separate','All B1 calls and B2 retained/types/mutants unrun']};
  assert.ok(rawBytes<=67108864);assert.ok(now.getTime()<Date.parse('2026-08-29T12:45:00.000Z'),'conservative preparation publication margin');
  write('RESULT.json',summary);
  const receipt=JSON.parse(fs.readFileSync(path.join(scope,'SEAL-RECEIPT.json')));
  write('REVIEW-PACKET.json',{status:summary.status,sourceCandidate:summary.sourceCandidate,preseal:{path:path.relative(root,path.join(scope,'PRESEAL.json')),...expected},controlPreseal:summary.controlPreseal,launch:receipt.launch,actualRootGrant:false,productSourceTree:seal.sourceTree,package:seal.package,profile:path.relative(root,path.join(scope,'PROFILE.md')),handoff:path.relative(root,path.join(scope,'HANDOFF.md')),fullRemainingInventory:seal.remaining});
  const files=[];const walk=(directory,prefix='')=>{for(const name of fs.readdirSync(directory).sort()){assert.notEqual(name,'AGENTS.md');const file=path.join(directory,name),relative=prefix?prefix+'/'+name:name;const stat=fs.lstatSync(file);if(stat.isDirectory())walk(file,relative);else{assert.ok(stat.isFile()&&!stat.isSymbolicLink());files.push(describe(file));}}};walk(scope);
  const totalBytes=files.reduce((sum,entry)=>sum+entry.bytes,0);assert.ok(totalBytes<402653184);
  write('EVIDENCE-MANIFEST.json',{at:new Date().toISOString(),totalBytes,files});
  console.log(JSON.stringify(summary));console.log('EVIDENCE',JSON.stringify({files:files.length,totalBytes,sha256:describe(path.join(scope,'EVIDENCE-MANIFEST.json')).sha256}));
}catch(error){console.error(error);process.exitCode=78;}
