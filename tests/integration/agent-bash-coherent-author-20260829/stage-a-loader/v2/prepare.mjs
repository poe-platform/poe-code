import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import { descriptor,readDescriptor } from './descriptor.mjs';
const repo='/Users/kjopek/Workspace/safe-bash',scope=path.join(repo,'tests/integration/agent-bash-coherent-author-20260829/stage-a-loader/v2'),prior=path.dirname(scope),mode=process.argv[2];assert.ok(['plan','seal'].includes(mode));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=(filename,maximum,expected)=>{const stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maximum);if(expected)assert.equal(stat.size,expected.bytes);const body=fs.readFileSync(filename);assert.equal(body.length,stat.size);if(expected)assert.equal(sha(body),expected.sha256);return body;};
const put=(name,value)=>fs.writeFileSync(path.join(scope,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
async function tool(identity){const stat=fs.lstatSync(identity.path);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,identity.bytes);const hash=crypto.createHash('sha256');let count=0;for await(const chunk of fs.createReadStream(identity.path)){count+=chunk.length;assert.ok(count<=identity.bytes);hash.update(chunk);}assert.equal(count,identity.bytes);assert.equal(hash.digest('hex'),identity.sha256);assert.equal(fs.lstatSync(identity.path).mtimeMs,stat.mtimeMs);}
const started=new Date().toISOString();
try{
 const oldBytes=read(path.join(prior,'PRESEAL.json'),65536,{bytes:2670,sha256:'cf07bed631f05f83db4a06b7058a0e6fb8a6a67672d0c0007ef0308291e8dc66'}),old=JSON.parse(oldBytes);await tool(old.node);
 const retained='/tmp/safe-bash-coherent-stage-a-20260829-r1';
 const packageIdentity=descriptor(path.join(retained,'tools/typescript/package.json'),old.typescriptPackage,'package.json');
 const entryIdentity=descriptor(path.join(retained,'tools/typescript/lib/tsc.js'),old.typescriptEntry,'lib/tsc.js');
 const packageBytes=readDescriptor(packageIdentity,65536);readDescriptor(entryIdentity,65536);assert.ok(!Object.hasOwn(JSON.parse(packageBytes),'type'));
 const priorProbeRow=old.inputs.find(row=>row.path==='probe.mjs');let source=read(path.join(prior,'probe.mjs'),65536,priorProbeRow).toString();
 function replace(before,after){assert.equal(source.split(before).length,2);source=source.replace(before,after);}
 replace("const scope='/Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/stage-a-loader';","const scope='/Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/stage-a-loader/v2';");
 replace("import { spawn } from 'node:child_process';","import { spawn } from 'node:child_process';\nimport { readDescriptor } from './descriptor.mjs';");
 replace('const pkg=read(preseal.typescriptPackage.path,65536,preseal.typescriptPackage);','const pkg=readDescriptor(preseal.typescriptPackage,65536);');
 const successors=[{path:'probe.mjs',body:Buffer.from(source)},...['fixture/entry.js.fixture','fixture/payload.js.fixture'].map(name=>({path:name,body:read(path.join(prior,name),16384,old.inputs.find(row=>row.path===name))}))];
 if(mode==='plan'){
  const patch=['*** Begin Patch'];for(const row of successors){const text=row.body.toString();assert.ok(Buffer.from(text).equals(row.body));assert.ok(text.endsWith('\n'));const lines=text.split('\n');assert.equal(lines.pop(),'');patch.push('*** Add File: '+path.relative(repo,path.join(scope,row.path)),...lines.map(line=>'+'+line));}patch.push('*** End Patch');fs.writeFileSync(path.join(scope,'MATERIALIZE.patch'),patch.join('\n')+'\n',{flag:'wx'});
  put('PLAN.json',{started,finished:new Date().toISOString(),oldPresealSha256:sha(oldBytes),packageIdentity,entryIdentity,successors:successors.map(row=>({path:row.path,bytes:row.body.length,sha256:sha(row.body)})),fixtureExecutions:0});console.log(JSON.stringify({mode,packageIdentity,entryIdentity,successors:successors.map(row=>({path:row.path,bytes:row.body.length,sha256:sha(row.body)}))}));
 }else{
  const plan=JSON.parse(read(path.join(scope,'PLAN.json'),65536));assert.deepEqual(plan.packageIdentity,packageIdentity);assert.deepEqual(plan.entryIdentity,entryIdentity);
  for(const row of successors){const actual=read(path.join(scope,row.path),65536,{bytes:row.body.length,sha256:sha(row.body)});assert.ok(actual.equals(row.body));}
  fs.mkdirSync(path.join(scope,'data-controls'));const literal=path.join(scope,'data-controls/literal.json'),body=Buffer.from('{"ok":true}\n');fs.writeFileSync(literal,body,{flag:'wx'});const row={path:'literal.json',type:'file',bytes:body.length,sha256:sha(body)},identity=descriptor(literal,row,'literal.json');let opens=0;
  assert.ok(readDescriptor(identity,64,()=>opens++).equals(body));assert.equal(opens,1);
  assert.throws(()=>descriptor(literal,{...row,path:'foreign/package.json'},'literal.json'));
  assert.throws(()=>descriptor(literal,{...row,sourcePath:'/tmp/foreign'},'literal.json'));
  assert.throws(()=>descriptor('literal.json',row,'literal.json'));
  let wrongSizeOpens=0;assert.throws(()=>readDescriptor({...identity,bytes:body.length+1},64,()=>wrongSizeOpens++));assert.equal(wrongSizeOpens,0);
  put('DATA-CONTROLS.json',{role:'DESCRIPTOR_DATA_ONLY',positiveSameBuffer:true,foreignRelativeRejected:true,identityFieldInjectionRejected:true,relativeIdentityRejected:true,wrongSizeRejectedBeforeOpen:true,positiveOpens:opens,wrongSizeOpens,fixtureExecutions:0});
  const inputs=['outer.sh','probe.mjs','descriptor.mjs','PROFILE.md','fixture/entry.js.fixture','fixture/payload.js.fixture'].map(name=>{const bytes=read(path.join(scope,name),65536);return{path:name,bytes:bytes.length,sha256:sha(bytes)};});
  const capsule='/tmp/safe-bash-stage-a-loader-20260829-r2';assert.ok(!fs.existsSync(capsule));
  const preseal={role:'VERSIONED_TWO_HARMLESS_LOADER_FIXTURES',started,finished:new Date().toISOString(),node:old.node,inputs,sourceTree:old.sourceTree,stageAPresealSha256:old.stageAPresealSha256,typescriptPackage:packageIdentity,typescriptEntry:entryIdentity,capsule,fixtureEntrySha256:old.fixtureEntrySha256,fixturePayloadSha256:old.fixturePayloadSha256,cases:old.cases,bounds:old.bounds,noTypeScriptImport:true,noProductOrPack:true,oldLocatorStop:'24971010/b8e4e24b immutable zero fixtures',previousPresealSha256:sha(oldBytes)};
  put('PRESEAL.json',preseal);const sealed=read(path.join(scope,'PRESEAL.json'),65536);put('SEAL-RESULT.json',{presealBytes:sealed.length,presealSha256:sha(sealed),dataControls:5,fixtureExecutions:0});console.log(JSON.stringify({presealBytes:sealed.length,presealSha256:sha(sealed),dataControls:5,fixtureExecutions:0}));
 }
}catch(error){put('STOP-'+mode+'.json',{started,finished:new Date().toISOString(),error:String(error?.stack??error),fixtureExecutions:0});throw error;}
