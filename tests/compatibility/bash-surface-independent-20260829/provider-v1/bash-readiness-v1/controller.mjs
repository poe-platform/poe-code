import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import nodeProcess from 'node:process';
import {observeOwnedGroup,signalOwnedGroup,binding} from './group-observer.mjs';
import {errorFields} from './observer-state.mjs';
const base=path.dirname(fileURLToPath(import.meta.url));
const root='/private/tmp/safe-bash-reference-readiness-v1-abpaov';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
function writeAll(fd,bytes){let offset=0;while(offset<bytes.length){const written=fs.writeSync(fd,bytes,offset,bytes.length-offset);need(written>0,'SHORT_WRITE');offset+=written;}}
function identity(stat){return {dev:String(stat.dev),ino:String(stat.ino),mode:Number(stat.mode&4095n),nlink:Number(stat.nlink),size:Number(stat.size)};}
async function main(){
 let eventFd;const outputs=[];let primary=null,plan,proc,activeTimer,termTimer,killTimer,hardTimer,sampleTimer;let eventBytes=0;
 const result={schema:'one-bash32-readiness-result-v1',targetStarts:0,primary:null,secondary:[],controller:{pid:nodeProcess.pid,execPath:nodeProcess.execPath,version:nodeProcess.version,execArgv:nodeProcess.execArgv},observerBinding:binding,child:{exit:false,close:false,stdinFinish:false,observerPipeEOF:false},group:{state:'unknown',reason:'NOT_CHECKED'},outputs:[],captureClosed:false};
 result.cleanupSignals=[];
 const sendOwned=signal=>{const previous=result.cleanupSignals.find(item=>item.signal===signal);if(previous)return previous.observation;const observation=signalOwnedGroup(result.child.pid??proc?.pid,signal);result.cleanupSignals.push({signal,observation});return observation;};
 const note=(code,reason)=>{result.secondary.push({code,...(reason===undefined?{}:{error:errorFields(reason)})});};
 const event=value=>{const bytes=Buffer.from(JSON.stringify({...value,at:Date.now()})+'\n');need(eventBytes+bytes.length<=1048576,'OWNER_CAPTURE_LIMIT');writeAll(eventFd,bytes);eventBytes+=bytes.length;};
 const setPrimary=code=>{primary??=code;};
 try{
  eventFd=fs.openSync(root+'/OWNER-EVENTS.jsonl',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);event({event:'OWNER_CAPTURE_OPEN'});
  for(const name of ['stdout','stderr']){const filename=root+'/'+name;const fd=fs.openSync(filename,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);const initial=identity(fs.fstatSync(fd,{bigint:true}));need(initial.nlink===1&&initial.mode===384&&initial.size===0,'CAPTURE_IDENTITY');outputs.push({name,path:filename,fd,initial,closed:false});}event({event:'REGULAR_FDS_PREOPENED',outputs:outputs.map(({name,path,initial,fd})=>({name,path,initial,fd}))});
  need(nodeProcess.argv.length===4&&nodeProcess.argv[2]==='--seal-sha256','EXACT_ARGUMENTS');need(nodeProcess.execArgv.length===0,'NO_CONTROLLER_EXECARG_HOOKS');need(nodeProcess.execPath==='/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node'&&nodeProcess.version==='v22.22.2','CONTROLLER_IDENTITY');
  const sealBytes=fs.readFileSync(base+'/PRESEAL.json');need(hash(sealBytes)===nodeProcess.argv[3],'SEAL_HASH');const seal=JSON.parse(sealBytes);for(const item of seal.files){const bytes=fs.readFileSync(base+'/'+item.path);need(bytes.length===item.bytes&&hash(bytes)===item.sha256,'SOURCE_HASH');}
  plan=JSON.parse(fs.readFileSync(base+'/PLAN.json'));need(plan.runRoot===root&&Date.now()+10000<plan.phaseDeadline,'PLAN_AND_DEADLINE');need(hash(fs.readFileSync(root+'/profile.sb'))===plan.profile.sha256,'STAGED_PROFILE_HASH');
  const authenticated=[];for(const tool of plan.toolBindings){const before=fs.lstatSync(tool.path,{bigint:true});need(before.isFile()&&!before.isSymbolicLink()&&Number(before.size)===tool.bytes&&Number(before.mode&4095n)===tool.mode,'TOOL_METADATA');const fd=fs.openSync(tool.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const digest=createHash('sha256'),buffer=Buffer.alloc(262144);let bytes=0;for(;;){need(Date.now()<plan.phaseDeadline,'AUTH_DEADLINE');const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;digest.update(buffer.subarray(0,count));bytes+=count;need(bytes<=tool.bytes,'TOOL_OVERSIZE');}const after=fs.fstatSync(fd,{bigint:true});need(bytes===tool.bytes&&digest.digest('hex')===tool.sha256&&after.ino===before.ino&&after.mtimeNs===before.mtimeNs,'TOOL_HASH');authenticated.push({path:tool.path,bytes,sha256:tool.sha256});}finally{fs.closeSync(fd);}}event({event:'TOOLS_SOURCE_AUTHENTICATED',count:authenticated.length});result.authenticatedTools=authenticated;
  fs.writeFileSync(root+'/ONE-TARGET-CONSUMED',nodeProcess.argv[3]+'\n',{flag:'wx',mode:0o600});
  let settle;const completion=new Promise(resolve=>{settle=resolve;});
  const send=signal=>{const observation=sendOwned(signal);event({event:'CLEANUP_SIGNAL',signal,observation});return observation;};
  const terminate=code=>{setPrimary(code);if(!termTimer){try{send('SIGTERM');}catch(reason){note('TERM_OBSERVER_ERROR',reason);}termTimer=setTimeout(()=>{try{send('SIGKILL');}catch(reason){note('KILL_OBSERVER_ERROR',reason);}},plan.limits.termMs);}};
  result.child.started=Date.now();event({event:'TARGET_ENROLLED',request:plan.request,expectedStarts:1});
  proc=spawn(plan.request.executable,plan.request.args,{cwd:plan.request.cwd,env:plan.request.env,shell:false,detached:true,stdio:['pipe',outputs[0].fd,outputs[1].fd,'pipe']});
  proc.on('error',reason=>{setPrimary('SPAWN_ERROR');note('SPAWN_ERROR',reason);});proc.on('exit',(code,signal)=>{result.child.exit=true;result.child.code=code;result.child.signal=signal;if(signal)setPrimary('TARGET_SIGNAL');else if(code!==0)setPrimary('TARGET_NONZERO');});proc.on('close',(code,signal)=>{result.child.close=true;result.child.code=code;result.child.signal=signal;settle(true);});
  proc.stdin.on('finish',()=>{result.child.stdinFinish=true;});proc.stdin.on('error',reason=>{setPrimary('STDIN_ERROR');note('STDIN_ERROR',reason);});proc.stdio[3].on('data',bytes=>{if(bytes.length)terminate('UNEXPECTED_OBSERVER_BYTES');});proc.stdio[3].on('end',()=>{result.child.observerPipeEOF=true;});proc.stdio[3].on('error',reason=>{setPrimary('OBSERVER_PIPE_ERROR');note('OBSERVER_PIPE_ERROR',reason);});
  result.targetStarts=1;result.child.pid=proc.pid;event({event:'TARGET_STARTED',pid:proc.pid});proc.stdin.end();
  activeTimer=setTimeout(()=>terminate('TARGET_DEADLINE'),plan.limits.activeMs);hardTimer=setTimeout(()=>{setPrimary('UNKNOWN_TARGET_RETIREMENT');settle(false);},plan.limits.targetClosureMs);
  sampleTimer=setInterval(()=>{try{for(const output of outputs)if(fs.fstatSync(output.fd).size>plan.limits.regularFileBytes)terminate('REGULAR_CAPTURE_LIMIT');}catch(reason){note('CAPTURE_SAMPLE_ERROR',reason);terminate('CAPTURE_FAILURE');}},plan.limits.sampleMs);
  result.child.closedWithinBound=await completion;clearTimeout(activeTimer);clearTimeout(termTimer);clearTimeout(killTimer);clearTimeout(hardTimer);clearInterval(sampleTimer);result.child.finished=Date.now();
  if(result.child.close){result.group=observeOwnedGroup(result.child.pid);event({event:'GROUP_OBSERVATION',pid:result.child.pid,observation:result.group});}if(result.group.state!=='absent')setPrimary('UNKNOWN_OR_PRESENT_GROUP');
  if(!result.child.exit||!result.child.close||!result.child.stdinFinish||!result.child.observerPipeEOF)setPrimary('UNKNOWN_TARGET_RETIREMENT');
 }catch(reason){setPrimary(reason?.code&&/^[A-Z_]+$/.test(reason.code)?reason.code:'CONTROLLER_FAILURE');note('CONTROLLER_FAILURE',reason);}
 finally{
  clearTimeout(activeTimer);clearTimeout(termTimer);clearTimeout(killTimer);clearTimeout(hardTimer);clearInterval(sampleTimer);
  if(proc&&!result.child.close){
   const awaitClose=milliseconds=>new Promise(resolve=>{if(result.child.close){resolve();return;}const timer=setTimeout(()=>{proc.removeListener('close',closed);resolve();},milliseconds);const closed=()=>{clearTimeout(timer);resolve();};proc.once('close',closed);});
   try{sendOwned('SIGTERM');await awaitClose(2000);if(!result.child.close){sendOwned('SIGKILL');await awaitClose(1000);}}catch(reason){note('INDEPENDENT_CLEANUP_FAILURE',reason);}
   if(result.child.close&&result.group.reason==='NOT_CHECKED')result.group=observeOwnedGroup(result.child.pid??proc.pid);
   if(!result.child.close||result.group.state!=='absent')setPrimary('UNKNOWN_TARGET_RETIREMENT');
  }
  for(const output of outputs){const item={name:output.name,path:output.path,initial:output.initial,regularFile:true,streamEOF:null,closed:false};try{const final=identity(fs.fstatSync(output.fd,{bigint:true})),pathStat=identity(fs.lstatSync(output.path,{bigint:true}));need(final.dev===output.initial.dev&&final.ino===output.initial.ino&&final.mode===384&&final.nlink===1&&pathStat.dev===final.dev&&pathStat.ino===final.ino,'CAPTURE_IDENTITY_DRIFT');need(final.size<=65536,'REGULAR_CAPTURE_LIMIT');fs.fsyncSync(output.fd);const bytes=Buffer.alloc(final.size);let offset=0;while(offset<bytes.length){const count=fs.readSync(output.fd,bytes,offset,bytes.length-offset,offset);need(count>0,'CAPTURE_SHORT_READ');offset+=count;}item.final=final;item.bytes=bytes.length;item.sha256=hash(bytes);item.base64=bytes.toString('base64');}catch(reason){setPrimary('CAPTURE_FINALIZATION_FAILURE');item.error=errorFields(reason);note('CAPTURE_FINALIZATION_FAILURE',reason);}finally{try{fs.closeSync(output.fd);item.closed=true;output.closed=true;}catch(reason){setPrimary('CAPTURE_CLOSE_FAILURE');note('CAPTURE_CLOSE_FAILURE',reason);}}result.outputs.push(item);}
  if(plan&&result.child.close){const stdout=result.outputs.find(item=>item.name==='stdout'),stderr=result.outputs.find(item=>item.name==='stderr');if(stdout?.base64!==plan.request.expected.stdoutBase64||stderr?.base64!==plan.request.expected.stderrBase64)setPrimary('READINESS_MISMATCH');}
  result.primary=primary??'READINESS_OBSERVED';result.status=primary?'STOP':'READINESS_ONLY';result.regularCaptureCompletion=result.child.exit&&result.child.close&&result.outputs.length===2&&result.outputs.every(item=>item.closed&&item.sha256);result.eventBytes=eventBytes;
  if(eventFd!==undefined){try{event({event:'FINAL_DISPOSITION',primary:result.primary,child:result.child,group:result.group,regularCaptureCompletion:result.regularCaptureCompletion});}catch(reason){result.secondary.push({code:'FINAL_EVENT_CAPTURE_FAILURE',error:errorFields(reason)});result.status='STOP';}finally{try{fs.closeSync(eventFd);result.captureClosed=true;}catch(reason){note('EVENT_CLOSE_FAILURE',reason);result.status='STOP';}}}
  fs.writeFileSync(root+'/RESULT.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});nodeProcess.stdout.write(JSON.stringify({status:result.status,primary:result.primary,targetStarts:result.targetStarts})+'\n');nodeProcess.exitCode=result.status==='READINESS_ONLY'?0:1;
 }
}
await main();
