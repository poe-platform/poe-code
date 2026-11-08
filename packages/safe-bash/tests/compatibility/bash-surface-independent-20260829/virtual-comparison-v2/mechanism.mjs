import fs from 'node:fs';
import process from 'node:process';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function reasonRecord(reason){return {kind:reason===null?'null':typeof reason,...(reason instanceof Error?{name:reason.name,message:reason.message.slice(0,4096),code:typeof reason.code==='string'?reason.code:undefined}:['string','number','boolean'].includes(typeof reason)?{value:reason}:{} )};}
export function observeGroup(pid,kill=process.kill.bind(process)){
 try{kill(-pid,0);return {state:'present'};}catch(error){const fields={name:typeof error?.name==='string'?error.name:undefined,code:typeof error?.code==='string'?error.code:undefined,errno:typeof error?.errno==='number'?error.errno:undefined,syscall:typeof error?.syscall==='string'?error.syscall:undefined};return {state:fields.code==='ESRCH'?'absent':'unknown',error:fields};}
}
export function retainPrimary(primary,secondary){return primary.present?primary:secondary;}
export class Storage{
 constructor(root,limits,clock=Date.now,operations=fs){this.root=root;this.limits=limits;this.clock=clock;this.fs=operations;this.bytes=0;this.completed=0;}
 check(final=false){if(this.clock()>=(final?this.limits.finalDeadline:this.limits.bodyDeadline))throw Error(final?'FINAL_DEADLINE':'BODY_DEADLINE');}
 file(name,bytes,{terminal=false}={}){this.check(terminal);if(!/^[a-zA-Z0-9_.-]+$/.test(name)||this.bytes+bytes.length>this.limits.maximum)throw Error('STORAGE_LIMIT_OR_NAME');let fd;let primary={present:false};let closed=false;this.bytes+=bytes.length;try{fd=this.fs.openSync(path.join(this.root,name),'wx',0o600);this.fs.writeFileSync(fd,bytes);this.fs.fsyncSync(fd);if(this.fs.fstatSync(fd).size!==bytes.length)throw Error('PUBLICATION_SIZE');this.check(terminal);}catch(reason){primary={present:true,reason};}finally{if(fd!==undefined){try{this.fs.closeSync(fd);closed=true;}catch(reason){primary=retainPrimary(primary,{present:true,reason});}}}if(primary.present)throw primary.reason;this.check(terminal);if(!closed)throw Error('PUBLICATION_CLOSE');this.completed++;return {bytes:bytes.length,sha256:digest(bytes),closed};}
 terminal(name,value){return this.file(name,Buffer.from(JSON.stringify(value,null,2)+'\n'),{terminal:true});}
}
export function authenticated(filename,pin,max=16777216){const before=fs.lstatSync(filename);if(!before.isFile()||before.isSymbolicLink()||before.size!==pin.bytes||before.size>max)throw Error('AUTH_TYPE_SIZE');const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let bytes;try{const opened=fs.fstatSync(fd);if(opened.ino!==before.ino||opened.dev!==before.dev)throw Error('AUTH_IDENTITY');bytes=Buffer.alloc(before.size);let count=0;while(count<bytes.length){const size=fs.readSync(fd,bytes,count,Math.min(65536,bytes.length-count),count);if(!size)throw Error('AUTH_SHORT');count+=size;}const probe=Buffer.alloc(1);if(fs.readSync(fd,probe,0,1,count))throw Error('AUTH_LONG');const after=fs.fstatSync(fd),current=fs.lstatSync(filename);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||current.ino!==before.ino||current.dev!==before.dev)throw Error('AUTH_MUTATION');if(digest(bytes)!==pin.sha256)throw Error('AUTH_HASH');}finally{fs.closeSync(fd);}return bytes;}
export function census(root,maximum){let bytes=0,entries=0;function visit(current){if(++entries>10000)throw Error('CENSUS_ENTRIES');const stat=fs.lstatSync(current);if(stat.isSymbolicLink())return;if(stat.isDirectory()){for(const name of fs.readdirSync(current))visit(path.join(current,name));}else if(stat.isFile()){bytes+=stat.size;if(bytes>maximum)throw Error('WORK_LIMIT');}else throw Error('CENSUS_TYPE');}visit(root);return {bytes,entries,qualification:'logical sampled bytes, not RSS or continuous OS disk quota'};}
export async function runChild(spec,ledger){
 if(ledger.stopped||ledger.active>=ledger.peak||ledger.starts>=ledger.maximum||Date.now()>=spec.bodyDeadline)throw Error('CHILD_ADMISSION');
 const stdoutPath=spec.capture+'.stdout',stderrPath=spec.capture+'.stderr';const output=fs.openSync(stdoutPath,'wx+',0o600);let errorOutput;try{errorOutput=fs.openSync(stderrPath,'wx+',0o600);}catch(error){fs.closeSync(output);throw error;}
 const row={label:spec.label,started:Date.now(),listeners:false,exit:false,close:false,stdoutEOF:false,stderrEOF:false,status:null,signal:null,signals:[],errors:[],events:['capture-opened'],captures:[],qualified:false};let primary={present:false},stdoutBytes=0,stderrBytes=0,escalating=false,finished=false;const event=kind=>row.events.push(kind);let wake;const changed=new Promise(resolve=>{wake=resolve;});
 const fail=reason=>{primary=retainPrimary(primary,{present:true,reason});wake();};
 ledger.starts++;ledger.active++;ledger.observedPeak=Math.max(ledger.observedPeak??0,ledger.active);let child;
 try{child=spawn(spec.executable,spec.args,{cwd:spec.cwd,env:spec.env,detached:true,shell:false,stdio:['ignore','pipe','pipe']});}catch(reason){ledger.active--;try{fs.closeSync(output);}finally{fs.closeSync(errorOutput);}throw reason;}
 child.on('error',reason=>{row.errors.push(reasonRecord(reason));fail(reason);});child.on('exit',(status,signal)=>{row.exit=true;row.status=status;row.signal=signal;event('exit');});child.on('close',()=>{row.close=true;event('close');wake();});
 const consume=(fd,isOut)=>bytes=>{if(finished)return;const prior=isOut?stdoutBytes:stderrBytes;if(prior+bytes.length>spec.streamLimit||ledger.captureBytes+bytes.length>ledger.captureMaximum){fail(Error('CAPTURE_LIMIT'));return;}try{fs.writeFileSync(fd,bytes);ledger.captureBytes+=bytes.length;if(isOut)stdoutBytes+=bytes.length;else stderrBytes+=bytes.length;}catch(reason){fail(reason);}};
 child.stdout.on('data',consume(output,true));child.stderr.on('data',consume(errorOutput,false));child.stdout.on('end',()=>{row.stdoutEOF=true;event('stdout-end');});child.stderr.on('end',()=>{row.stderrEOF=true;event('stderr-end');});child.stdout.on('error',fail);child.stderr.on('error',fail);row.pid=child.pid;row.listeners=true;event('listeners-enrolled');
 const timer=setTimeout(()=>fail(Error('CHILD_DEADLINE')),Math.max(1,Math.min(spec.timeoutMs,spec.bodyDeadline-Date.now())));await changed;clearTimeout(timer);
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 let observation=Number.isInteger(child.pid)?observeGroup(child.pid):{state:'unknown',error:{code:'NO_PID'}};
 if(observation.state==='unknown'){fail(Error('UNKNOWN_RETIREMENT'));}
 if(observation.state==='present'){
  escalating=true;for(const [signal,grace] of [['SIGTERM',2000],['SIGKILL',1000]]){
   try{process.kill(-child.pid,signal);row.signals.push({signal,at:Date.now()});}catch(reason){if(reason?.code!=='ESRCH'){row.errors.push(reasonRecord(reason));fail(reason);}}
   const until=Date.now()+grace;do{await sleep(20);observation=observeGroup(child.pid);if(observation.state!=='present')break;}while(Date.now()<until);
   if(observation.state!=='present')break;
  }
 }
 row.group=observation;row.escalationAttempted=escalating;if(observation.state!=='absent')fail(Error('UNKNOWN_RETIREMENT'));
 const closeUntil=Date.now()+1000;while(!row.close&&Date.now()<closeUntil)await sleep(10);
 finished=true;event('capture-finalization');for(const [name,fd,expected] of [['stdout',output,stdoutBytes],['stderr',errorOutput,stderrBytes]]){let closed=false;try{fs.fsyncSync(fd);const stat=fs.fstatSync(fd);if(stat.size!==expected)throw Error('CAPTURE_SIZE');const bytes=Buffer.alloc(expected);let offset=0;while(offset<expected){const count=fs.readSync(fd,bytes,offset,expected-offset,offset);if(!count)throw Error('CAPTURE_SHORT');offset+=count;}row.captures.push({name,bytes:expected,sha256:digest(bytes),base64:bytes.toString('base64'),flushed:true,closed:false});}catch(reason){fail(reason);}finally{try{fs.closeSync(fd);closed=true;}catch(reason){fail(reason);}}const capture=row.captures.find(value=>value.name===name);if(capture)capture.closed=closed;}
 if(!row.exit||!row.close||!row.stdoutEOF||!row.stderrEOF)fail(Error('INCOMPLETE_RETIREMENT_OR_EOF'));
 if(Date.now()>=spec.finalDeadline)fail(Error('FINAL_DEADLINE'));
 row.finished=Date.now();row.primaryPresent=primary.present;row.primary=primary.present?reasonRecord(primary.reason):undefined;row.qualified=!primary.present&&row.group.state==='absent'&&row.captures.length===2&&row.captures.every(value=>value.closed);ledger.active--;ledger.rows.push(row);
 const intentionalTimeout=spec.allowTimeout===true&&primary.present&&primary.reason instanceof Error&&primary.reason.message==='CHILD_DEADLINE'&&row.group.state==='absent'&&row.exit&&row.close&&row.stdoutEOF&&row.stderrEOF&&row.captures.length===2&&row.captures.every(value=>value.closed)&&row.errors.length===0&&Date.now()<spec.finalDeadline;
 row.fixtureTimeoutQualified=intentionalTimeout;if(!row.qualified&&!intentionalTimeout)ledger.stopped=true;
 return {row,primary};
}
