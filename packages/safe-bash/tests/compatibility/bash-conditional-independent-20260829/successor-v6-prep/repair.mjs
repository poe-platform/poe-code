import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const own=path.dirname(fileURLToPath(import.meta.url)),started=Date.now();
const action=process.argv[2];assert.ok(['--controls','--stage'].includes(action));
const output=path.join(own,action==='--controls'?'BYTE-CONTROLS':'BYTE-STAGING');fs.mkdirSync(output);
const events=fs.openSync(path.join(output,'events.jsonl'),'wx');
const emit=row=>fs.writeSync(events,JSON.stringify(row)+'\n');const children=[];let failure;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashFile=filename=>{const stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=268435456);const fd=fs.openSync(filename,'r'),digest=createHash('sha256'),buffer=Buffer.alloc(65536);let size=0;try{for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;size+=count;assert.ok(size<=stat.size);digest.update(buffer.subarray(0,count));}}finally{fs.closeSync(fd);}assert.equal(size,stat.size);return digest.digest('hex');};
function copyBytes(bytes,target,expected){assert.ok(Buffer.isBuffer(bytes));assert.equal(bytes.length,expected.bytes);assert.equal(sha(bytes),expected.sha256);assert.ok(target.startsWith(own+path.sep));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx',mode:expected.mode});fs.chmodSync(target,expected.mode);const stat=fs.lstatSync(target);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.mode&511,expected.mode);const copied=fs.readFileSync(target);assert.ok(copied.equals(bytes));assert.equal(sha(copied),expected.sha256);}
try{
 const seal=JSON.parse(fs.readFileSync(path.join(own,'REPAIR-SEAL.json')));assert.deepEqual(process.argv.slice(2),[action]);assert.equal(process.execPath,seal.node.path);assert.equal(process.version,seal.node.version);assert.equal(hashFile(process.execPath),seal.node.sha256);for(const row of seal.files)assert.equal(hashFile(path.join(own,row.path)),row.sha256);
 emit({started:true,action,pid:process.pid,execPath:process.execPath,version:process.version});
 if(action==='--controls'){
  for(const vector of seal.controls){const bytes=Buffer.from(vector.hex,'hex'),target=path.join(output,vector.id+'.bytes');copyBytes(bytes,target,vector);emit({id:vector.id,pass:true,bytes:bytes.length,sha256:sha(bytes)});}
  const denied=path.join(output,'wrong-hash.bytes');assert.throws(()=>copyBytes(Buffer.from([65]),denied,{bytes:1,sha256:'0'.repeat(64),mode:420}));assert.ok(!fs.existsSync(denied));emit({negativeWithinB06:'wrong digest refused before creation'});
 }else{
  const inputs=JSON.parse(fs.readFileSync(path.join(own,'INPUTS.json'))),seeds=JSON.parse(fs.readFileSync(path.join(own,'BYTE-SEEDS.json')));assert.equal(inputs.length,seal.inputCount);const requests=inputs.filter(row=>row.request);assert.ok(requests.length<=64);
  const outPath=path.join(output,'git.stdout.raw'),errPath=path.join(output,'git.stderr.raw'),out=fs.openSync(outPath,'wx'),err=fs.openSync(errPath,'wx');const row={role:'stored-byte-source',closed:false};children.push(row);let child,issue;const chunks=[];let count=0;
  try{
   assert.equal(hashFile('/usr/bin/git'),seal.git.sha256);
   child=spawn('/usr/bin/git',['-c','gc.auto=0','-c','maintenance.auto=false','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','cat-file','--batch'],{cwd:seal.repo,env:{PATH:'/usr/bin:/bin',GIT_OPTIONAL_LOCKS:'0'},stdio:['pipe','pipe','pipe']});row.pid=child.pid;
   const done=new Promise(resolve=>{child.once('error',error=>{issue=error;});child.once('close',(code,signal)=>{row.closed=true;row.code=code;row.signal=signal;resolve();});});
   for(const [stream,fd,keep] of [[child.stdout,out,true],[child.stderr,err,false]])stream.on('data',bytes=>{count+=bytes.length;if(count>8388608){issue=Error('capture cap');child.kill('SIGKILL');return;}try{assert.equal(fs.writeSync(fd,bytes),bytes.length);if(keep)chunks.push(Buffer.from(bytes));}catch(error){issue=error;child.kill('SIGKILL');}});
   let rescue;const timer=setTimeout(()=>{issue=Error('metadata deadline');child.kill('SIGTERM');rescue=setTimeout(()=>{if(!row.closed)child.kill('SIGKILL');},1000);},30000);
   child.stdin.on('error',error=>{issue??=error;});child.stdin.end(requests.map(item=>item.request).join('\n')+'\n');try{await done;}finally{clearTimeout(timer);clearTimeout(rescue);}assert.ok(!issue&&row.closed&&row.code===0&&row.signal===null);emit(row);
  }finally{fs.closeSync(out);fs.closeSync(err);}
  const raw=Buffer.concat(chunks);let cursor=0;const payloads=new Map();
  for(const entry of requests){const end=raw.indexOf(10,cursor);assert.ok(end>=cursor);const header=raw.subarray(cursor,end).toString().split(' ');assert.equal(header[1],'blob');assert.equal(Number(header[2]),entry.bytes);const data=raw.subarray(end+1,end+1+entry.bytes);assert.equal(data.length,entry.bytes);const oid=createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex');assert.equal(oid,header[0]);assert.equal(sha(data),entry.sha256);cursor=end+entry.bytes+2;assert.equal(raw[cursor-1],10);payloads.set(entry.destination,data);}
  assert.equal(cursor,raw.length);
  const staging=path.join(own,'../successor-v6');fs.mkdirSync(staging);
  for(const entry of inputs){assert.ok(!entry.destination.startsWith('/')&&!entry.destination.split('/').some(part=>!part||part==='..'||part==='AGENTS.md'));const bytes=entry.request?payloads.get(entry.destination):Buffer.from(seeds[entry.seed].data,'base64');const target=path.join(staging,entry.destination);assert.ok(target.startsWith(staging+path.sep));fs.mkdirSync(path.dirname(target),{recursive:true});assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);fs.writeFileSync(target,bytes,{flag:'wx',mode:entry.mode});fs.chmodSync(target,entry.mode);assert.ok(fs.readFileSync(target).equals(bytes));assert.equal(fs.lstatSync(target).mode&511,entry.mode);emit({destination:entry.destination,bytes:bytes.length,sha256:sha(bytes),pass:true});}
  emit({exactCopies:inputs.length,exactFixtureCopies:19,productRuns:0,compilerRuns:0,workers:0});
 }
}catch(error){failure=String(error.stack??error);emit({failure});}finally{emit({terminal:true,elapsedMs:Date.now()-started,children,failure});fs.closeSync(events);}if(failure)process.exitCode=78;
