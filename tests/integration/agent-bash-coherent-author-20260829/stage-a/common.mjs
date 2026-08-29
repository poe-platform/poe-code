import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
export { fs,path,assert };
export const repo='/Users/kjopek/Workspace/safe-bash';
export const scope=path.join(repo,'tests/integration/agent-bash-coherent-author-20260829/stage-a');
export const prior=path.join(scope,'../v2');
export const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export const oid=bytes=>crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export function safe(relative){assert.ok(typeof relative==='string'&&relative&&!relative.startsWith('/')&&!relative.includes('\\')&&!relative.includes('\0'));assert.ok(relative.split('/').every(part=>part&&part!=='.'&&part!=='..'&&part!=='AGENTS.md'));return relative;}
export function read(filename,maximum,expected){
 const before=fs.lstatSync(filename);assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.size<=maximum);
 if(expected)assert.equal(before.size,expected.bytes);
 const descriptor=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const initial=fs.fstatSync(descriptor);assert.equal(initial.ino,before.ino);assert.equal(initial.dev,before.dev);const bytes=Buffer.alloc(before.size);let offset=0;while(offset<bytes.length){const count=fs.readSync(descriptor,bytes,offset,Math.min(65536,bytes.length-offset),offset);assert.ok(count>0);offset+=count;}const after=fs.fstatSync(descriptor);assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);if(expected)assert.equal(sha(bytes),expected.sha256);return bytes;}finally{fs.closeSync(descriptor);}
}
export async function streamed(filename,expected){
 const before=fs.lstatSync(filename);assert.ok(before.isFile()&&!before.isSymbolicLink());if(expected)assert.equal(before.size,expected.bytes);assert.ok(before.size<=134217728);
 const hash=crypto.createHash('sha256');let size=0;for await(const chunk of fs.createReadStream(filename)){size+=chunk.length;assert.ok(size<=before.size);hash.update(chunk);}const after=fs.lstatSync(filename);assert.equal(after.ino,before.ino);assert.equal(after.dev,before.dev);assert.equal(after.mtimeMs,before.mtimeMs);assert.equal(size,before.size);const result={bytes:size,sha256:hash.digest('hex'),mode:before.mode&511};if(expected){assert.equal(result.sha256,expected.sha256);if(expected.mode!==undefined)assert.equal(result.mode,expected.mode);}return result;
}
export function json(filename,value){fs.writeFileSync(filename,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
export function inventory(root,links={}){const rows=[];function visit(prefix){for(const name of fs.readdirSync(path.join(root,prefix)).sort()){const relative=prefix?prefix+'/'+name:name;safe(relative);const filename=path.join(root,relative),stat=fs.lstatSync(filename);assert.ok(rows.length<20000);if(stat.isSymbolicLink()){assert.ok(Object.hasOwn(links,relative));assert.equal(fs.readlinkSync(filename),links[relative]);rows.push({path:relative,type:'symlink',target:links[relative],bytes:0});}else if(stat.isDirectory())visit(relative);else{assert.ok(stat.isFile());const body=read(filename,33554432);rows.push({path:relative,bytes:body.length,sha256:sha(body),mode:stat.mode&511});}}}visit('');return rows.sort((left,right)=>Buffer.compare(Buffer.from(left.path),Buffer.from(right.path)));}
export function supervisor(directory,seconds,totalMaximum=67108864){
 const started=performance.now(),end=started+seconds*1000;let children=0,captured=0;
 const events=fs.openSync(path.join(directory,'events.jsonl'),'wx');
 const note=value=>fs.writeSync(events,JSON.stringify({...value,elapsedMs:performance.now()-started})+'\n');
 function remaining(){const result=end-performance.now();assert.ok(result>0,'inclusive stage deadline');return result;}
 async function run(role,binary,args,{cwd,env,input,seconds:childSeconds=120}){
  remaining();assert.ok(children<16);const label=String(children++).padStart(2,'0')+'-'+role;
  const stdout=fs.openSync(path.join(directory,label+'.stdout'),'wx'),stderr=fs.openSync(path.join(directory,label+'.stderr'),'wx');
  let child,primary,exited=false,closed=false,killTimer,deadlineTimer,retirementTimer,rejectRetirement,stdoutBytes=0,stderrBytes=0;
  const fail=error=>{if(!primary)primary=error;if(child?.pid&&!closed){try{process.kill(-child.pid,'SIGTERM');note({role,pid:child.pid,signal:'SIGTERM'});}catch(signalError){if(signalError.code!=='ESRCH')note({role,signalError:String(signalError)});}if(!killTimer)killTimer=setTimeout(()=>{if(!closed){try{process.kill(-child.pid,'SIGKILL');note({role,pid:child.pid,signal:'SIGKILL'});}catch(signalError){note({role,signalError:String(signalError)});}}},2000);if(!retirementTimer)retirementTimer=setTimeout(()=>{note({role,pid:child.pid,retirement:'UNKNOWN',primary:String(primary)});rejectRetirement(new Error('STOP: owned child retirement remains unknown'));},5000);}};
  try{
   await new Promise((resolve,reject)=>{
    rejectRetirement=reject;
    try{child=spawn(binary,args,{cwd,env,detached:true,stdio:['pipe','pipe','pipe']});}catch(error){reject(error);return;}
    note({role,pid:child.pid,binary,args,cwd,env,spawned:true});
    const consume=(descriptor,channel)=>(chunk)=>{try{captured+=chunk.length;if(channel==='stdout')stdoutBytes+=chunk.length;else stderrBytes+=chunk.length;assert.ok(captured<=totalMaximum,'capture cap');fs.writeSync(descriptor,chunk);}catch(error){fail(error);}};
    child.stdout.on('data',consume(stdout,'stdout'));child.stderr.on('data',consume(stderr,'stderr'));
    child.stdout.on('error',fail);child.stderr.on('error',fail);child.stdin.on('error',error=>{if(error.code!=='EPIPE')fail(error);});child.on('error',fail);
    child.on('exit',(status,signal)=>{exited=true;note({role,pid:child.pid,event:'exit',status,signal});});
    child.on('close',(status,signal)=>{closed=true;clearTimeout(deadlineTimer);clearTimeout(killTimer);clearTimeout(retirementTimer);note({role,pid:child.pid,event:'close',status,signal,stdoutBytes,stderrBytes});if(status!==0||signal)primary??=new Error(`${role} status=${status} signal=${signal}`);resolve();});
    deadlineTimer=setTimeout(()=>fail(new Error(`${role} deadline`)),Math.min(remaining(),childSeconds*1000));
    child.stdin.end(input);
   });
   assert.ok(exited&&closed,'unknown retirement');
   let groupAbsent=false;try{process.kill(-child.pid,0);}catch(error){if(error.code==='ESRCH')groupAbsent=true;else throw error;}
   note({role,pid:child.pid,groupAbsent});assert.ok(groupAbsent,'owned group remains after close');remaining();if(primary)throw primary;
   return{stdout:path.join(directory,label+'.stdout'),stderr:path.join(directory,label+'.stderr'),pid:child.pid,stdoutBytes,stderrBytes};
  }finally{clearTimeout(deadlineTimer);if(closed)clearTimeout(killTimer);fs.closeSync(stdout);fs.closeSync(stderr);}
 }
 return{run,remaining,note,finish(){remaining();note({finished:true,children,captured});fs.closeSync(events);return{children,captured,elapsedMs:performance.now()-started};}};
}
