import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const own = path.dirname(fileURLToPath(import.meta.url)), prior = path.resolve(own,'../v2'), repo = path.resolve(own,'../../../..');
const phase = process.argv[2]; assert.ok(['--inspect','--seal'].includes(phase));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const gitHash = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
const log = fs.openSync(path.join(own,'capture',phase.slice(2)+'.events.jsonl'),'wx');
const note = event => fs.writeSync(log,JSON.stringify(event)+'\n');
let children=0;
function read(filename, maximum=1048576, expected) {
  assert.ok(!filename.split('/').includes('AGENTS.md')); const stat=fs.lstatSync(filename);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maximum);
  if(expected) assert.equal(stat.size,expected.bytes);
  const bytes=fs.readFileSync(filename);assert.equal(bytes.length,stat.size);
  if(expected) assert.equal(sha(bytes),expected.sha256);
  return bytes;
}
function put(name,value){fs.writeFileSync(path.join(own,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
function git(args,input,cap=1048576){
 const prefix=path.join(own,'capture',phase.slice(2)+'-git-'+children++),out=fs.openSync(prefix+'.stdout','wx'),err=fs.openSync(prefix+'.stderr','wx');let result;
 try{result=spawnSync('/usr/bin/git',args,{cwd:repo,input,stdio:['pipe',out,err],timeout:15000,env:{PATH:'/usr/bin:/bin',HOME:'/tmp',GIT_OPTIONAL_LOCKS:'0'}});}finally{fs.closeSync(out);fs.closeSync(err);}
 note({pid:result.pid,args,status:result.status,signal:result.signal});assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0);return read(prefix+'.stdout',cap);
}
function objects(refs){
 const lines=git(['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],refs.join('\n')+'\n').toString().trimEnd().split('\n');assert.equal(lines.length,refs.length);
 const rows=lines.map((line,index)=>{const match=/^([a-f0-9]{40}) blob ([0-9]+)$/.exec(line);assert.ok(match,refs[index]);const bytes=Number(match[2]);assert.ok(bytes<=1048576);return{reference:refs[index],blob:match[1],bytes};});
 const total=rows.reduce((sum,row)=>sum+row.bytes+128,0);assert.ok(total<=4194304);
 const raw=git(['cat-file','--batch'],rows.map(row=>row.blob).join('\n')+'\n',total);let cursor=0;const result=[];
 for(const row of rows){const end=raw.indexOf(10,cursor);assert.equal(raw.subarray(cursor,end).toString(),`${row.blob} blob ${row.bytes}`);const body=raw.subarray(end+1,end+1+row.bytes);assert.equal(body.length,row.bytes);assert.equal(gitHash('blob',body),row.blob);assert.equal(raw[end+1+row.bytes],10);cursor=end+row.bytes+2;result.push({...row,sha256:sha(body),body});}assert.equal(cursor,raw.length);return result;
}
try{
 note({started:new Date().toISOString(),pid:process.pid,parent:process.ppid,phase,productExecutions:0});
 if(phase==='--inspect'){
  const base='tests/integration/agent-bash-coherent-author-20260829/v2/';
  const refs=['SOURCE.json','EXECUTABLE-PRESEAL.json','workflows.mjs','TOOLS.json','ADMISSION-CONTROLS.json'].map(name=>'cf23ba11:'+base+name);
  const records=objects(refs);for(let index=0;index<records.length;index++)read(path.join(prior,refs[index].split('/').at(-1)),1048576,records[index]);
  assert.equal(records[0].sha256,'ef0b79dbd30cebec3f8b939a98928b9441947ff4be724e5031b2ee03925f26ae');
  put('PRIOR-BINDINGS.json',records.map(({body,...row})=>row));
  const old=records[2].body.toString(), before="const expectedDiff = replacement => 'diff --git a/README.md b/README.md\\n--- a/README.md\\n+++ b/README.md\\n@@ -1 +1 @@\\n-hello staged\\n+' + replacement + '\\n';";
  assert.equal(old.split(before).length,2);
  const after="const gitBlob = value => { const body = Buffer.from(value); return createHash('sha1').update('blob ' + body.length + '\\0').update(body).digest('hex'); };\nconst expectedDiff = replacement => 'diff --git a/README.md b/README.md\\nindex ' + gitBlob('hello staged\\n').slice(0, 7) + '..' + gitBlob(replacement + '\\n').slice(0, 7) + ' 100644\\n--- a/README.md\\n+++ b/README.md\\n@@ -1 +1 @@\\n-hello staged\\n+' + replacement + '\\n';";
  const corrected=old.replace("import assert from 'node:assert/strict';","import assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';").replace(before,after);
  assert.equal(corrected.replace("import { createHash } from 'node:crypto';\n",'').replace(after,before),old);
  const target=path.relative(repo,path.join(own,'workflows.mjs'));
  fs.writeFileSync(path.join(own,'WORKFLOW.patch'),'*** Begin Patch\n*** Add File: '+target+'\n'+corrected.split('\n').map(line=>'+'+line).join('\n')+'\n*** End Patch\n',{flag:'wx'});
  put('EXPECTATION-DELTA.json',{prior:records[2].sha256,successor:sha(Buffer.from(corrected)),ids:['C11','C14'],inputChanges:0,otherAssertionChanges:0,role:'UNRUN_SOURCE_DEFINED_EXPECTATION_CORRECTION_NOT_FAILURE_RESCORE',headers:['hello changed','hello patched'].map(value=>({id:value,header:'index '+gitHash('blob',Buffer.from('hello staged\n')).slice(0,7)+'..'+gitHash('blob',Buffer.from(value+'\n')).slice(0,7)+' 100644'}))});
  const author='tests/integration/node-public-author-20260829';const names=fs.readdirSync(path.join(repo,author));assert.ok(names.length<=128);
  console.log('NODE_AUTHOR_NAMES',JSON.stringify(names));
  for(const name of names.filter(name=>/^(HANDOFF|PRESEAL|SOURCE|EXECUTOR).*\.(md|json)$/.test(name))){const filename=path.join(repo,author,name),stat=fs.lstatSync(filename);if(!stat.isFile()||stat.size>1048576)continue;const bytes=read(filename);console.log('LOCATOR',name,bytes.length,sha(bytes));if(name.endsWith('.md'))console.log(bytes.toString().slice(0,14000));else {const data=JSON.parse(bytes);console.log(JSON.stringify({keys:Object.keys(data),engine:data.engine,publicEngine:data.publicEngine,provider:data.provider,fixtures:data.fixtures,toolBindings:data.toolBindings},null,2).slice(0,12000));}}
 }else{
  const bindings=JSON.parse(read(path.join(own,'PRIOR-BINDINGS.json'))),bound=name=>bindings.find(row=>row.reference.endsWith('/'+name));
  const sourceBytes=read(path.join(prior,'SOURCE.json'),1048576,bound('SOURCE.json')),source=JSON.parse(sourceBytes);
  const oldSealBytes=read(path.join(prior,'EXECUTABLE-PRESEAL.json'),1048576,bound('EXECUTABLE-PRESEAL.json')),oldSeal=JSON.parse(oldSealBytes);
  const delta=JSON.parse(read(path.join(own,'EXPECTATION-DELTA.json'))),corrected=read(path.join(own,'workflows.mjs'));
  assert.equal(sha(corrected),delta.successor);assert.equal(source.computedTree,'3adc676a0ab638c9788ef007e465931d65d2c6fe');assert.equal(source.inputs.length,309);
  const publicRoot=path.join(repo,'tests/integration/node-public-author-20260829');
  const authorReceipt=read(path.join(publicRoot,'EXECUTOR-v4.json'),1048576,{bytes:21699,sha256:'807a4faa6b7f5c9c2ea4a52970e31d6838b7d4c3cb93ed527bf4385da13b2708'});
  const handoff=read(path.join(publicRoot,'HANDOFF.md'),1048576,{bytes:8924,sha256:'6327070f8e4cdf5eef11d584bef93f09eab551ef2026c18b5abe2eec5b1739fb'});
  const stored=objects([gitHash('blob',authorReceipt),gitHash('blob',handoff)]);assert.equal(stored[0].sha256,sha(authorReceipt));assert.equal(stored[1].sha256,sha(handoff));
  const executor=JSON.parse(authorReceipt),compiled=executor.files.filter(row=>/\/compiled\//.test(row.path));
  put('PUBLIC-ENGINE-RECEIPT.json',{authorSource:'bb4dd0571a0335b20e29448bf88126ca02c1a32d',sourceAcceptedBy:'6f449bf49d33e7e35b3882bb3396143efa346747',receipt:{blob:stored[0].blob,bytes:authorReceipt.length,sha256:sha(authorReceipt)},handoff:{blob:stored[1].blob,bytes:handoff.length,sha256:sha(handoff)},compiledEntries:compiled,allExecutorFiles:executor.files,qualification:'Authenticated stored author receipts, not fresh engine materialization or execution. PUBLIC95 exact selection/adapter closure must be separately confirmed before engine grant; never infer it from a substring count.'});
  const prefix=path.join(own,'capture','workflow-syntax'),out=fs.openSync(prefix+'.stdout','wx'),err=fs.openSync(prefix+'.stderr','wx');let checked;
  try{checked=spawnSync(process.execPath,['--check',path.join(own,'workflows.mjs')],{stdio:['ignore',out,err],timeout:15000});}finally{fs.closeSync(out);fs.closeSync(err);}
  children++;note({role:'SYNTAX_ONLY',pid:checked.pid,status:checked.status,signal:checked.signal});assert.equal(checked.error,undefined);assert.equal(checked.signal,null);assert.equal(checked.status,0);
  const files=oldSeal.files.map(row=>{const filename=row.path==='workflows.mjs'?path.join(own,row.path):path.join(prior,row.path);const body=read(filename,1048576,row.path==='workflows.mjs'?undefined:row);return{path:path.relative(repo,filename),bytes:body.length,sha256:sha(body)};});
  for(const name of ['HANDOFF.md','PUBLIC-ENGINE-RECEIPT.json','EXPECTATION-DELTA.json','finish.mjs','finish.sh']){const filename=path.join(own,name),body=read(filename);files.push({path:path.relative(repo,filename),bytes:body.length,sha256:sha(body)});}
  read(path.join(prior,'ADMISSION-CONTROLS.json'),1048576,bound('ADMISSION-CONTROLS.json'));
  const packet={role:'PROVISIONAL_PREEXEC_REVIEW_PACKET_NOT_LAUNCH_READY',sourceTree:source.computedTree,sourceManifestSha256:sha(sourceBytes),sourceInputCount:309,predictedPackageMembers:1014,actualPackageSha256:null,prior:'cf23ba11',fixtureDelta:delta,files,planned:oldSeal.planned,proposedActual:oldSeal.proposedActual,priorAdmissionControls:{pass:12,rerun:0,scope:'unchanged admission.mjs DATA-only source binding; no fresh package admission'},unfinished:['Integrated bounded build/install/move/type/mutation supervisor and its weakening controls are not implemented by this finishing grant.','PUBLIC95 exact engine/adapter selection remains separate from the authenticated complete author executor receipt.','Current workflow-entry case timer only sets exitCode; it is not independent teardown. Do not launch without an outer supervisor.'],actualExecutions:0};
  const packetBytes=Buffer.from(JSON.stringify(packet,null,2)+'\n');fs.writeFileSync(path.join(own,'PRESEAL.json'),packetBytes,{flag:'wx'});
  put('RESULT.json',{sourceTree:source.computedTree,presealSha256:sha(packetBytes),workflowSha256:sha(corrected),sourceManifestSha256:sha(sourceBytes),syntaxChecks:1,dataControlReruns:0,compiledReceiptEntries:compiled.length,executorEntries:executor.files.length,children,productExecutions:0});
  console.log(JSON.stringify({presealSha256:sha(packetBytes),workflowSha256:sha(corrected),compiledReceiptEntries:compiled.map(row=>row.path),executorEntries:executor.files.length,children,productExecutions:0}));
 }
 note({finished:new Date().toISOString(),children,productExecutions:0});
}catch(error){note({error:String(error?.stack??error),children});process.exitCode=1;}finally{fs.closeSync(log);}
