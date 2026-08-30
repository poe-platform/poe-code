import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {observeOwnedGroup,signalOwnedGroup} from './group-observer.mjs';
import {cleanupTimes} from './state.mjs';
import {finalizeCaptures} from './capture.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function runManaged(spec,{storage,ledger,signal,perCaseMs=3000,termMs=2000,killMs=1000}){
 const row={id:spec.id,started:Date.now(),exit:false,close:false,status:null,signal:null,stop:null,errors:[],signals:[],groupObservations:[],group:{state:'unknown'},capture:[],filesVerified:false,receiptPublished:false,regularCaptureCompletion:false,streamEOF:null};
 const handles=[];let child,firstStop=null,killSent=false,retired=false,enrolled=false;
 const fault=(reason,error)=>{row.stop??=reason;if(error)row.errors.push({phase:reason,name:error.name,code:error.code??null,message:String(error.message??error).slice(0,128)});if(firstStop===null)firstStop=Date.now();};
 const observe=()=>{const observed=child?.pid?observeOwnedGroup(child.pid):{state:'unknown',error:{kind:'NO_PID'}};row.group=observed;const previous=row.groupObservations.at(-1);if(!previous||previous.state!==observed.state||previous.afterKill!==killSent)row.groupObservations.push({...observed,at:Date.now(),afterKill:killSent});return observed;};
 const send=kind=>{const at=Date.now();if(kind==='SIGTERM')row.termAttemptAt=at;const result=signalOwnedGroup(child.pid,kind);row.signals.push({signal:kind,at,...result});if(!result.sent&&result.error?.fields?.code?.value!=='ESRCH')fault('SIGNAL_ERROR');};
 try{
  storage.checkTime();storage.scan();for(const name of ['stdout','stderr']){const filename=spec.captureRoot+'/'+name;const descriptor=fs.openSync(filename,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);const stat=fs.fstatSync(descriptor);handles.push({name,path:filename,fd:descriptor,ino:stat.ino});}
  ledger.enter(spec.role);enrolled=true;storage.record({event:'CHILD_ENROLLED',id:spec.id,executable:spec.executable,args:spec.args,at:Date.now()});
  child=spawn(spec.executable,spec.args,{env:spec.env,cwd:spec.cwd,detached:true,shell:false,stdio:['pipe',handles[0].fd,handles[1].fd]});
  child.on('spawn',()=>{row.spawnObserved=true;ledger.confirm(spec.role);});
  child.on('error',error=>fault('CHILD_ERROR',error));child.on('exit',(status,exitSignal)=>{row.exit=true;row.status=status;row.signal=exitSignal;if(exitSignal!==null)fault('SIGNALLED_EXIT');});child.on('close',()=>{row.close=true;});child.stdin.on('error',error=>{if(error.code==='EPIPE')row.stdinEpipe=true;else fault('STDIN_ERROR',error);});child.stdin.on('finish',()=>{row.stdinFinished=true;});row.pid=child.pid;child.stdin.end(spec.stdin??Buffer.alloc(0));
  while(true){
   const now=Date.now();if(signal?.aborted)fault('CALLER_ABORT');if(now>=row.started+perCaseMs)fault('CASE_DEADLINE');
   try{storage.checkTime();for(const handle of handles){if(fs.fstatSync(handle.fd).size>65536)throw Error('PER_STREAM_CAPTURE_CAP');}storage.scan();}catch(error){fault('CAPTURE_OR_STORAGE',error);}
   if(row.close){const group=observe();if(group.state==='absent'&&row.exit){retired=true;break;}fault(group.state==='unknown'?'UNKNOWN_GROUP':'RESIDUAL_GROUP');}
   if(firstStop!==null){if(row.signals.length===0&&child.pid)send('SIGTERM');const times=cleanupTimes(row.termAttemptAt??firstStop,termMs,killMs);row.cleanupClock=times;if(!killSent&&now>=times.killAt){killSent=true;if(child.pid)send('SIGKILL');observe();}if(now>=times.endAt){observe();retired=row.exit&&row.close&&row.group.state==='absent';if(!retired)fault('UNKNOWN_RETIREMENT');break;}}
   await pause(10);
  }
 }catch(error){fault('LAUNCH_OR_MONITOR',error);}
 finally{
  if(child&&!retired){if(firstStop===null)firstStop=Date.now();if(child.pid&&row.signals.length===0)send('SIGTERM');const times=cleanupTimes(row.termAttemptAt??firstStop,termMs,killMs);row.cleanupClock=times;
   if(child.pid&&row.signals.length===0)send('SIGTERM');
   while(Date.now()<times.endAt){if(row.close){const group=observe();if(row.exit&&group.state==='absent'){retired=true;break;}}if(!killSent&&Date.now()>=times.killAt){killSent=true;if(child.pid)send('SIGKILL');observe();}await pause(10);}
   observe();retired=row.exit&&row.close&&row.group.state==='absent';if(!retired)fault('UNKNOWN_RETIREMENT');
  }
  if(!child&&enrolled){row.noProcessCreated=true;retired=true;}
  if(child&&!row.close){child.stdin.destroy();child.unref();}
  const finalized=finalizeCaptures(handles);row.capture=finalized.captures;row.errors.push(...finalized.errors);row.regularCaptureCompletion=finalized.success&&retired&&row.exit&&row.close;if(!finalized.success)fault('CAPTURE_FINALIZATION');
  if(row.exit&&!row.spawnObserved)fault('MISSING_SPAWN_OBSERVER');if(enrolled&&retired)ledger.retire(row.spawnObserved===true);row.retired=retired;row.finished=Date.now();
  try{storage.record({event:'CHILD_TERMINAL',row});}catch(error){fault('TERMINAL_PUBLICATION',error);try{storage.terminal({event:'TERMINAL_PUBLICATION_FAILED',id:row.id,stop:row.stop,exit:row.exit,close:row.close,group:row.group,retired,errors:row.errors});}catch(secondary){row.errors.push({phase:'EMERGENCY_PUBLICATION',message:String(secondary.message).slice(0,128)});}}
 }
 return row;
}
