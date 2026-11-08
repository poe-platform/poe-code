import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {hash,errorRecord,Primary,pinExecutable} from './auth.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
export const qualifyDirect = row => !row.primaryPresent && !row.forced && row.exit && row.close && row.stdoutEOF && row.stderrEOF && row.capturesQualified && row.knownOutstanding === 0;
export function openCapturePair(spec,ledger,row,primary,operations=fs) {
  let stdoutFd,stderrFd;
  try {
    stdoutFd=operations.openSync(spec.capture+'.stdout','wx+',384);
    stderrFd=operations.openSync(spec.capture+'.stderr','wx+',384);
    return {stdoutFd,stderrFd};
  } catch(reason) {
    primary.fail(reason);
    const cleanup={acquired:stdoutFd!==undefined,closeAttempted:false,closed:false,failurePresent:false};
    let cleanupReason;
    if(cleanup.acquired){cleanup.closeAttempted=true;try{operations.closeSync(stdoutFd);cleanup.closed=true;}catch(closeReason){cleanup.failurePresent=true;cleanupReason=closeReason;}}
    row.childStarted=false;row.captureOpenFailure=true;row.captureCleanup=cleanup;
    row.knownOutstanding=cleanup.acquired&&!cleanup.closed?1:0;row.qualified=false;row.primaryPresent=true;
    ledger.stopped=true;
    try {
      if(cleanup.failurePresent){primary.fail(cleanupReason);cleanup.failure=errorRecord(cleanupReason);}
      row.primary=errorRecord(reason);row.secondaryPresent=primary.secondary.length>0;row.secondary=primary.secondary;row.finished=Date.now();ledger.rows.push(row);
    } finally {throw reason;}
  }
}
export async function runDirect(spec,ledger) {
  if (ledger.stopped || ledger.active || ledger.starts >= ledger.maximum || Date.now() >= spec.bodyDeadline) throw Error('CHILD_ADMISSION');
  pinExecutable(spec.node);
  const primary = new Primary();
  const row = {id:spec.id,events:[],exit:false,close:false,stdoutEOF:false,stderrEOF:false,captures:[],signals:[],forced:false,capturesQualified:false,knownOutstanding:1};
  const event = name => row.events.push({name,at:Date.now()});
  const {stdoutFd,stderrFd}=openCapturePair(spec,ledger,row,primary);
  event('capture-open');
  ledger.starts++;ledger.active++;
  let child,settle;
  const wake = new Promise(resolve => {settle = resolve;});
  const fail = reason => {primary.fail(reason);settle();};
  let stdoutBytes=0,stderrBytes=0;
  try {
    child=spawn(spec.node.path,spec.args,{cwd:spec.cwd,env:spec.env,shell:false,detached:false,stdio:['ignore','pipe','pipe']});
    row.pid=child.pid;
    child.on('spawn',()=>event('spawn'));
    child.on('error',reason=>{event('error');fail(reason);});
    child.on('exit',(status,signal)=>{row.exit=true;row.status=status;row.signal=signal;event('exit');});
    child.on('close',()=>{row.close=true;event('close');settle();});
    const consume = (descriptor,kind) => bytes => {
      if (primary.present) return;
      if ((kind==='stdout'?stdoutBytes:stderrBytes)+bytes.length>65536 || ledger.captureBytes+bytes.length>ledger.captureMaximum) {fail(Error('CAPTURE_LIMIT'));return;}
      try {fs.writeFileSync(descriptor,bytes);ledger.captureBytes+=bytes.length;if(kind==='stdout')stdoutBytes+=bytes.length;else stderrBytes+=bytes.length;} catch(reason){fail(reason);}
    };
    child.stdout.on('data',consume(stdoutFd,'stdout'));child.stderr.on('data',consume(stderrFd,'stderr'));
    child.stdout.on('end',()=>{row.stdoutEOF=true;event('stdout-end');});child.stderr.on('end',()=>{row.stderrEOF=true;event('stderr-end');});
    child.stdout.on('error',fail);child.stderr.on('error',fail);event('listeners-enrolled');
    const timer=setTimeout(()=>fail(Error('CHILD_DEADLINE')),Math.max(1,Math.min(spec.timeoutMs ?? 3000,spec.bodyDeadline-Date.now())));
    await wake;clearTimeout(timer);
    if(!row.close){
      row.forced=true;
      for(const [signal,grace] of [['SIGTERM',2000],['SIGKILL',1000]]){
        if(row.close)break;
        try{row.signals.push({signal,at:Date.now(),returned:child.kill(signal)});}catch(reason){primary.fail(reason);}
        const until=Date.now()+grace;while(!row.close&&Date.now()<until)await pause(10);
      }
    }
    if(!row.close||!row.exit||!row.stdoutEOF||!row.stderrEOF)primary.fail(Error('DIRECT_RETIREMENT_UNKNOWN'));
  }catch(reason){primary.fail(reason);}
  finally {
    for(const [kind,descriptor,expected]of [['stdout',stdoutFd,stdoutBytes],['stderr',stderrFd,stderrBytes]]){
      let capture,closed=false;
      try {fs.fsyncSync(descriptor);const stat=fs.fstatSync(descriptor);if(stat.size!==expected)throw Error('CAPTURE_SIZE');const bytes=Buffer.alloc(expected);let offset=0;while(offset<bytes.length){const count=fs.readSync(descriptor,bytes,offset,bytes.length-offset,offset);if(!count)throw Error('CAPTURE_SHORT');offset+=count;}capture={kind,bytes:expected,sha256:hash(bytes),base64:bytes.toString('base64'),flushed:true};}catch(reason){primary.fail(reason);}
      finally{try{fs.closeSync(descriptor);closed=true;}catch(reason){primary.fail(reason);}}
      if(capture)row.captures.push({...capture,closed});
    }
    row.capturesQualified=row.captures.length===2&&row.captures.every(capture=>capture.closed&&capture.flushed);
    if(Date.now()>=spec.finalDeadline)primary.fail(Error('FINAL_DEADLINE'));
    row.primaryPresent=primary.present;row.primary=primary.present?errorRecord(primary.reason):undefined;row.secondary=primary.secondary;
    row.knownOutstanding=row.close&&row.exit?0:1;
    row.qualified=qualifyDirect(row);
    row.finished=Date.now();ledger.rows.push(row);ledger.active--;if(!row.qualified)ledger.stopped=true;
  }
  return {row,primary};
}
