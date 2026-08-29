import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readDescriptor } from './descriptor.mjs';
const scope='/Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/stage-a-loader/v2';
const sha=body=>crypto.createHash('sha256').update(body).digest('hex');
const read=(filename,maximum,expected)=>{const before=fs.lstatSync(filename);assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.size<=maximum);if(expected)assert.equal(before.size,expected.bytes);const descriptor=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const opened=fs.fstatSync(descriptor);assert.equal(opened.ino,before.ino);assert.equal(opened.dev,before.dev);const body=Buffer.alloc(before.size);let position=0;while(position<body.length){const count=fs.readSync(descriptor,body,position,body.length-position,position);assert.ok(count>0);position+=count;}assert.equal(fs.fstatSync(descriptor).mtimeMs,before.mtimeMs);if(expected)assert.equal(sha(body),expected.sha256);return body;}finally{fs.closeSync(descriptor);}};
const put=(name,value)=>fs.writeFileSync(path.join(scope,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const started=new Date().toISOString(),start=performance.now();let captureBytes=0,spawnCount=0;const results=[];
const events=fs.openSync(path.join(scope,'capture','probe.events.jsonl'),'wx');const note=value=>fs.writeSync(events,JSON.stringify({time:new Date().toISOString(),...value})+'\n');
function remaining(){assert.ok(performance.now()-start<300000,'inclusive probe deadline');}
async function childRun(test,node,args,cwd,env){
 remaining();assert.ok(spawnCount<2);spawnCount++;
 const prefix=path.join(scope,'capture',test.id),out=fs.openSync(prefix+'.stdout','wx'),err=fs.openSync(prefix+'.stderr','wx');
 let child,closed=false,exited=false,primary,timer,killTimer,retirementTimer,exitStatus,exitSignal,closeStatus,closeSignal;const signals=[];
 try{
  await new Promise((resolve,reject)=>{
   const fail=error=>{primary??=error;if(child?.pid&&!closed){try{process.kill(-child.pid,'SIGTERM');signals.push('SIGTERM');}catch(killError){if(killError.code!=='ESRCH')note({id:test.id,killError:String(killError)});}killTimer??=setTimeout(()=>{if(!closed){try{process.kill(-child.pid,'SIGKILL');signals.push('SIGKILL');}catch(killError){note({id:test.id,killError:String(killError)});}}},2000);retirementTimer??=setTimeout(()=>{note({id:test.id,retirement:'UNKNOWN'});child.stdout.destroy();child.stderr.destroy();child.unref();reject(new Error('unknown retirement'));},5000);}};
   try{child=spawn(node,args,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});}catch(error){reject(error);return;}
   note({id:test.id,event:'spawn',pid:child.pid,node,args,cwd,env});
   for(const [stream,descriptor]of [[child.stdout,out],[child.stderr,err]]){stream.on('data',chunk=>{try{captureBytes+=chunk.length;assert.ok(captureBytes<=1048576,'capture cap');fs.writeSync(descriptor,chunk);}catch(error){fail(error);}});stream.on('error',fail);}
   child.on('error',fail);child.on('exit',(status,signal)=>{exited=true;exitStatus=status;exitSignal=signal;note({id:test.id,event:'exit',status,signal});});
   child.on('close',(status,signal)=>{closed=true;closeStatus=status;closeSignal=signal;clearTimeout(timer);clearTimeout(killTimer);clearTimeout(retirementTimer);note({id:test.id,event:'close',status,signal});resolve();});
   timer=setTimeout(()=>fail(new Error('fixture deadline')),Math.min(20000,300000-(performance.now()-start)));
  });
  assert.ok(exited&&closed);let absent=false;try{process.kill(-child.pid,0);}catch(error){if(error.code==='ESRCH')absent=true;else throw error;}note({id:test.id,groupAbsent:absent,signals});assert.ok(absent,'group remains');remaining();if(primary)throw primary;
  return{pid:child.pid,exitStatus,exitSignal,closeStatus,closeSignal,groupAbsent:absent,signals,stdout:prefix+'.stdout',stderr:prefix+'.stderr'};
 }finally{clearTimeout(timer);if(closed){clearTimeout(killTimer);clearTimeout(retirementTimer);}fs.closeSync(out);fs.closeSync(err);}
}
try{
 const activation=JSON.parse(read(path.join(scope,'ACTIVATION.json'),65536));
 const presealBytes=read(path.join(scope,'PRESEAL.json'),1048576,{bytes:activation.presealBytes,sha256:activation.presealSha256}),preseal=JSON.parse(presealBytes);
 assert.equal(activation.scope,'TWO_HARMLESS_LOADER_FIXTURES');
 for(const item of preseal.inputs)read(path.join(scope,item.path),1048576,item);
 const nodeStat=fs.lstatSync(preseal.node.path);assert.ok(nodeStat.isFile()&&!nodeStat.isSymbolicLink());assert.equal(nodeStat.size,preseal.node.bytes);const hash=crypto.createHash('sha256');let nodeBytes=0;for await(const chunk of fs.createReadStream(preseal.node.path)){nodeBytes+=chunk.length;assert.ok(nodeBytes<=preseal.node.bytes);hash.update(chunk);}assert.equal(hash.digest('hex'),preseal.node.sha256);assert.equal(nodeBytes,preseal.node.bytes);assert.equal(process.execPath,preseal.node.path);
 assert.ok(!fs.existsSync(preseal.capsule));fs.mkdirSync(preseal.capsule,{mode:448});const physical=fs.realpathSync(preseal.capsule);assert.ok(physical.startsWith('/private/tmp/'));const rootStat=fs.statSync(preseal.capsule),physicalStat=fs.statSync(physical);assert.equal(rootStat.dev,physicalStat.dev);assert.equal(rootStat.ino,physicalStat.ino);
 for(const directory of ['source','tools/typescript/lib','home','tmp','empty-bin'])fs.mkdirSync(path.join(physical,directory),{recursive:true,mode:448});
 const fixture=read(path.join(scope,'fixture/entry.js.fixture'),16384,preseal.inputs.find(row=>row.path==='fixture/entry.js.fixture'));
 const payload=read(path.join(scope,'fixture/payload.js.fixture'),16384,preseal.inputs.find(row=>row.path==='fixture/payload.js.fixture'));
 const pkg=readDescriptor(preseal.typescriptPackage,65536);
 const entries=[['tools/typescript/package.json',pkg],['tools/typescript/lib/tsc.js',fixture],['tools/typescript/lib/_fixture.js',payload]];
 const copied=[];for(const [name,bytes]of entries){const filename=path.join(physical,name);fs.writeFileSync(filename,bytes,{flag:'wx',mode:420});read(filename,65536,{bytes:bytes.length,sha256:sha(bytes)});const stat=fs.lstatSync(filename);copied.push({path:name,bytes:bytes.length,sha256:sha(bytes),device:String(stat.dev),inode:String(stat.ino)});}
 put('CAPSULE.json',{alias:preseal.capsule,physical,rootDevice:String(rootStat.dev),rootInode:String(rootStat.ino),copied,noSyntheticPackageBoundary:true});
 for(const test of preseal.cases){remaining();const root=test.route==='alias'?preseal.capsule:physical;const entry=path.join(root,'tools/typescript/lib/tsc.js');const cwd=path.join(root,'source');const nonce='sealed-'+test.id+'-'+sha(presealBytes).slice(0,16);const env={PATH:path.join(root,'empty-bin'),HOME:path.join(root,'home'),TMPDIR:path.join(root,'tmp'),LANG:'C',LC_ALL:'C',TZ:'UTC',LOADER_FIXTURE_NONCE:nonce};
  const args=['--experimental-permission',`--allow-fs-read=${root}`,`--allow-fs-read=${preseal.node.path}`,`--allow-fs-write=${root}`,entry];
  for(const row of copied)read(path.join(physical,row.path),65536,row);
  put(test.id+'-DISPATCH.json',{id:test.id,presealSha256:sha(presealBytes),node:preseal.node,args,cwd,env,sourceAdmissionComplete:true,files:copied,createdBeforeSpawn:new Date().toISOString()});
  const observed=await childRun(test,preseal.node.path,args,cwd,env);assert.equal(observed.exitStatus,test.expectedStatus);assert.equal(observed.closeStatus,test.expectedStatus);assert.equal(observed.exitSignal,null);assert.equal(observed.closeSignal,null);
  const stdout=read(observed.stdout,65536),stderr=read(observed.stderr,65536);let receipt=null;
  if(test.expectedEntry){receipt=JSON.parse(stdout);assert.equal(receipt.role,'HARMLESS_ENTRY_RECEIPT');assert.equal(receipt.nonce,nonce);assert.equal(receipt.main,path.join(physical,'tools/typescript/lib/tsc.js'));assert.equal(receipt.payload,path.join(physical,'tools/typescript/lib/_fixture.js'));assert.equal(receipt.mainSha256,sha(fixture));assert.equal(receipt.cwd,path.join(physical,'source'));assert.equal(receipt.node,'v22.22.2');assert.ok(!stderr.toString().includes('ERR_ACCESS_DENIED'));}
  else{assert.equal(stdout.length,0);assert.ok(stderr.toString().includes("code: 'ERR_ACCESS_DENIED'"));assert.ok(stderr.toString().includes("permission: 'FileSystemRead'"));assert.ok(stderr.toString().includes("resource: '/tmp'"));assert.ok(stderr.toString().includes('realpathSync'));}
  for(const row of copied)read(path.join(physical,row.path),65536,row);
  results.push({id:test.id,...observed,stdoutBytes:stdout.length,stdoutSha256:sha(stdout),stderrBytes:stderr.length,stderrSha256:sha(stderr),receipt,postguard:true});
 }
 const result={role:'HARMLESS_LOADER_ONLY_NOT_PRODUCER_RETRY',started,finished:new Date().toISOString(),presealSha256:sha(presealBytes),spawnCount,captureBytes,results,retainedCapsule:physical,productImports:0,compilerImports:0,builds:0,pack:0,stageB:'UNRUN',limits:'No compiler/npm/dependency/complete producer acceptance'};put('RESULT.json',result);console.log(JSON.stringify(result));
}catch(error){put('STOP.json',{started,finished:new Date().toISOString(),error:String(error?.stack??error),spawnCount,captureBytes,completed:results,automaticRetry:false});process.exitCode=78;throw error;}finally{fs.closeSync(events);}
