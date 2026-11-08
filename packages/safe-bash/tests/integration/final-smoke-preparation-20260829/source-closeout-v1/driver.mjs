import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const started=Date.now(),sha=body=>crypto.createHash('sha256').update(body).digest('hex');
function admit(row,maximum=4194304){const stat=fs.lstatSync(row.path);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maximum);assert.equal(stat.size,row.bytes);const body=fs.readFileSync(row.path);assert.equal(body.length,row.bytes);assert.equal(sha(body),row.sha256);return body;}
console.log(JSON.stringify({phase:'source-only-activation',pid:process.pid,epochMs:started,utc:new Date(started).toISOString()}));
let owner,seal,primaryPresent=false,primary,terminal,root;
try{
  const [filename,digest,size]=process.argv.slice(2);assert.match(size,/^[1-9][0-9]*$/);seal=JSON.parse(admit({path:filename,sha256:digest,bytes:Number(size)}));
  assert.equal(seal.action,'ROOT_SEPARATE_SOURCE_ONLY_8_CLOSEOUT');assert(started+120000+60000<=seal.phaseDeadline);assert(seal.phaseDeadline<=Date.parse('2026-08-29T18:20:00Z'));
  for(const row of seal.files)admit(row);const binding=JSON.parse(admit(seal.binding));admit(seal.producerReview);
  const {Owner,identity,tag}=await import(pathToFileURL(seal.owner.path).href);
  const {verifyRetiredTrace}=await import(pathToFileURL(seal.trace.path).href);
  assert.deepEqual(identity(seal.node.path,134217728),seal.node);
  admit(binding.archive,1048576);
  root=seal.workRoot;assert(!fs.existsSync(root));fs.mkdirSync(root,{mode:0o700});for(const folder of ['raw','stage','tmp','home'])fs.mkdirSync(path.join(root,folder),{mode:0o700});
  const env={PATH:path.dirname(seal.node.path),HOME:path.join(root,'home'),TMPDIR:path.join(root,'tmp'),TMP:path.join(root,'tmp'),TEMP:path.join(root,'tmp'),LANG:'C',LC_ALL:'C',TZ:'UTC',NODE_OPTIONS:'',NODE_PATH:''};
  owner=new Owner({raw:path.join(root,'raw'),cwd:root,env,tools:[seal.node],wallMs:seal.phaseDeadline-Date.now(),reserveMs:60000,cleanupMs:30000,maxStarts:24,peak:3,captureLimit:25165824,metadataLimit:4194304,tailBytes:1048576});
  function write(filename,body){const bytes=Buffer.isBuffer(body)?body:Buffer.from(body);assert(bytes.length<=4194304);fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});const fd=fs.openSync(filename,'wx',0o600);try{let offset=0;while(offset<bytes.length){const count=fs.writeSync(fd,bytes,offset,bytes.length-offset);assert(count>0);offset+=count;}}finally{fs.closeSync(fd);}return {path:filename,bytes:bytes.length,sha256:sha(bytes)};}
  const mapped=filename=>path.join(root,'stage',path.relative(seal.repoRoot,filename));
  for(const row of seal.consumerFiles)write(mapped(row.path),admit(row));
  for(const row of binding.members){const filename=path.join(binding.sourceRoot,row.path);admit({path:filename,bytes:row.bytes,sha256:row.sha256});assert.equal(fs.lstatSync(filename).mode&0o777,row.mode);}
  const members=binding.members.filter(row=>row.path.endsWith('.js')).map(row=>({...row,absolute:path.join(binding.sourceRoot,row.path)}));for(const row of seal.consumerFiles)members.push({path:row.path,absolute:mapped(row.path),bytes:row.bytes,sha256:row.sha256});
  const trace=path.join(root,'loader.jsonl'),workerTrace=path.join(root,'workers.jsonl');
  const manifest=write(path.join(root,'source-binding.json'),JSON.stringify({packageRoot:binding.sourceRoot,members,trace}));
  const fixture=write(path.join(root,'fixture.json'),admit(binding.fixture));const scalar=write(path.join(root,'scalar.json'),admit(binding.scalarRows));
  const config=write(path.join(root,'config.json'),JSON.stringify({binding:manifest,fixture,scalar,layout:'source-built',result:path.join(root,'SOURCE-RESULT.json'),activeEnd:Date.now()+90000}));
  owner.config.env={...env,PUBLIC_BINDING:manifest.path,PUBLIC_BINDING_BYTES:String(manifest.bytes),PUBLIC_BINDING_SHA256:manifest.sha256,RESOURCE_LOG:workerTrace,RESOURCE_ALLOWANCE:'0'};
  owner.persist(path.join(root,'ACTIVATION.json'),{epochMs:started,utc:new Date(started).toISOString(),phaseDeadline:seal.phaseDeadline,sourceOnly:true,installerInvocations:0,layoutCount:1,expectedRows:seal.ids});
  const args=['--experimental-permission',`--allow-fs-read=${root}`,`--allow-fs-read=${binding.sourceRoot}`,`--allow-fs-read=${seal.node.path}`,`--allow-fs-write=${root}`,'--allow-worker','--loader',pathToFileURL(mapped(seal.loader)).href,'--import',pathToFileURL(mapped(seal.workerGuard)).href,mapped(seal.entry),config.path,String(config.bytes),config.sha256];
  const child=await owner.run('source-only-eight',seal.node.path,args,90000);
  terminal={sourceOnly:true,child,primaryPresent:false,rows:'UNKNOWN_UNTIL_RESULT_AUTHENTICATION',ShellRetirement:'UNKNOWN',installerInvocations:0,installedMovedProof:false};
  assert.equal(child.faults.primaryPresent,false);assert.equal(child.row.exitCode,0);assert(child.row.exitObserved&&child.row.closeObserved&&child.row.stdoutEnd&&child.row.stderrEnd);
  const retired={exited:child.row.exitObserved,closed:child.row.closeObserved};const loads=verifyRetiredTrace(trace,retired),workers=verifyRetiredTrace(workerTrace,retired);
  assert(workers.records.some(row=>row.kind==='before-exit'&&row.attempts===0&&row.created===0));
  const resultPath=path.join(root,'SOURCE-RESULT.json'),stat=fs.lstatSync(resultPath);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1048576);const bytes=fs.readFileSync(resultPath);owner.persist(path.join(root,'SOURCE-RESULT-IDENTITY.json'),{path:resultPath,bytes:bytes.length,sha256:sha(bytes)});const result=JSON.parse(bytes);assert.equal(result.primaryPresent,false);assert.equal(result.registeredShellDisposalCompleted,true);assert.deepEqual(result.rows.map(row=>row.id),seal.ids);
  for(const row of binding.members)admit({path:path.join(binding.sourceRoot,row.path),bytes:row.bytes,sha256:row.sha256});for(const row of seal.files)admit(row);admit(binding.archive,1048576);
  terminal={...terminal,rows:result.rows,ShellRetirement:'EXPLICIT_RESULT_COMPLETED',observations:result.observations,loader:loads,workers,postguards:true};
  owner.terminal=true;owner.persist(path.join(root,'TERMINAL.json'),{...terminal,known:owner.snapshot(),ownerExit:'PENDING_EXTERNAL_OBSERVATION'});
}catch(reason){primaryPresent=true;primary=reason;process.exitCode=78;}
finally{
  const tag=value=>({type:value===null?'null':typeof value,...(value instanceof Error?{message:value.message.slice(0,2048)}:['number','boolean','string'].includes(typeof value)?{value}:{})});
  const value={phase:'source-only-terminal',primaryPresent,...(primaryPresent?{primary:tag(primary)}:{}),terminal,known:owner?.snapshot(),epochMs:Date.now(),utc:new Date().toISOString(),ownerExit:'PENDING_EXTERNAL_OBSERVATION',noRetry:true};
  if(owner&&primaryPresent){owner.terminal=true;try{owner.persist(path.join(root,'STOP.json'),value);}catch(error){console.error(JSON.stringify({persistenceFailure:tag(error),original:value}));}}
  console.log(JSON.stringify(value));
}
