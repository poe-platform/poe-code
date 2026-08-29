import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
export {read,sha,streamed,inventory,safe} from '../stage-a-r2/common.mjs';

export function completeWrite(io,descriptor,body,progress=()=>{}) {
  let offset=0;
  while(offset<body.length){
    const count=io.writeSync(descriptor,body,offset,body.length-offset);
    if(!Number.isSafeInteger(count)||count<=0||count>body.length-offset)throw new Error('capture write made invalid progress');
    offset+=count;progress(count);
  }
  return offset;
}
export function reasonRecord(reason){
  if(reason===null)return{type:'null'};
  if(reason===undefined)return{type:'undefined'};
  if(typeof reason==='number')return{type:'number',value:Number.isFinite(reason)?reason:String(reason)};
  if(['boolean','string'].includes(typeof reason))return{type:typeof reason,value:reason};
  return{type:typeof reason};
}
export function durableJSON(io,filename,value,observe=()=>{}){
  let descriptor,opened=false,hasPrimary=false,primary;const secondary=[];
  const remember=error=>{observe(error);if(!hasPrimary){hasPrimary=true;primary=error;}else secondary.push(error);};
  try{descriptor=io.openSync(filename,'wx');opened=true;completeWrite(io,descriptor,Buffer.from(JSON.stringify(value,null,2)+'\n'));io.fsyncSync(descriptor);}
  catch(error){remember(error);}
  finally{if(opened)try{io.closeSync(descriptor);}catch(error){remember(error);}}
  if(hasPrimary)throw primary;
  return{secondary};
}
export function json(filename,value){return durableJSON(fs,filename,value);}
export function clock(started,now=()=>performance.now(),seconds=1800,reserve=180){
  assert.ok(Number.isFinite(started)&&seconds>reserve&&reserve>=5);
  const absolute=started+seconds*1000,active=absolute-reserve*1000;
  function remaining(){const value=active-now();assert.ok(value>0,'inclusive active deadline/publication reserve');return value;}
  function publication(){const value=absolute-now();assert.ok(value>0,'inclusive publication deadline');return value;}
  return{remaining,publication,started,absolute,active};
}

export function supervisor(directory,seconds,totalMaximum=67108864,options={}){
  const io=options.io??fs,spawnChild=options.spawn??spawn,kill=options.kill??process.kill.bind(process),now=options.now??(()=>performance.now());
  const shared=clock(options.started??now(),now,1800,180);
  const roles=options.roles??['offline-install','workflow-source-built','workflow-installed','workflow-physically-moved'];
  const records=[];let eventDescriptor,eventOpen=false,children=0,attempted=0,stored=0,activeChild=false,finished=false,poisoned=false;
  function remember(error,phase){records.push({phase,reason:error});}
  function event(value){completeWrite(io,eventDescriptor,Buffer.from(JSON.stringify({...value,elapsedMs:now()-shared.started})+'\n'));}
  function closeEvents(){let present=false,primary;const keep=error=>{remember(error,'event-close');if(!present){present=true;primary=error;}};
    if(eventOpen){try{io.fsyncSync(eventDescriptor);}catch(error){keep(error);}try{io.closeSync(eventDescriptor);}catch(error){keep(error);}eventOpen=false;}
    if(present)throw primary;
  }
  eventDescriptor=io.openSync(path.join(directory,'events.jsonl'),'wx');eventOpen=true;
  async function run(role,binary,args,{cwd,env,input,seconds:childSeconds=120}){
    shared.remaining();assert.ok(!finished&&!poisoned&&!activeChild&&roles.includes(role)&&children<roles.length,'known role/owner admission');
    const label=String(children).padStart(2,'0')+'-'+role;const descriptors=[];
    let child,exited=false,closed=false,hasPrimary=false,primary,waitResolve,deadlineTimer,killTimer,drainTimer,teardownStarted=false,unknown=false;
    let stdoutBytes=0,stderrBytes=0,storedStdout=0,storedStderr=0;
    const retain=(error,phase)=>{remember(error,phase);if(!hasPrimary){hasPrimary=true;primary=error;}};
    const note=value=>{try{event(value);return true;}catch(error){retain(error,'observation');return false;}};
    const signal=name=>{if(!child?.pid)return;try{kill(-child.pid,name);note({role,pid:child.pid,signal:name});}catch(error){if(error?.code!=='ESRCH')retain(error,'signal');}};
    const teardown=()=>{if(teardownStarted||!child?.pid||closed)return;teardownStarted=true;signal('SIGTERM');killTimer=setTimeout(()=>{if(!closed)signal('SIGKILL');},2000);drainTimer=setTimeout(()=>{if(!closed){unknown=true;retain(new Error('known owned child retirement UNKNOWN'),'retirement');signal('SIGKILL');waitResolve?.();}},5000);};
    const fail=(error,phase)=>{retain(error,phase);teardown();};
    try{
      const output=io.openSync(path.join(directory,label+'.stdout'),'wx');descriptors.push(output);
      const errorOutput=io.openSync(path.join(directory,label+'.stderr'),'wx');descriptors.push(errorOutput);
      activeChild=true;
      await new Promise(resolve=>{
        waitResolve=resolve;
        try{child=spawnChild(binary,args,{cwd,env,detached:true,stdio:['pipe','pipe','pipe']});children++;}
        catch(error){retain(error,'spawn');resolve();return;}
        const consume=(descriptor,channel)=>body=>{try{attempted+=body.length;if(channel==='stdout')stdoutBytes+=body.length;else stderrBytes+=body.length;assert.ok(attempted<=totalMaximum,'capture attempted-byte cap');completeWrite(io,descriptor,body,count=>{stored+=count;if(channel==='stdout')storedStdout+=count;else storedStderr+=count;});}catch(error){fail(error,'capture');}};
        child.stdout.on('data',consume(output,'stdout'));child.stderr.on('data',consume(errorOutput,'stderr'));
        child.stdout.on('error',error=>fail(error,'stdout'));child.stderr.on('error',error=>fail(error,'stderr'));
        child.stdin.on('error',error=>{if(error?.code!=='EPIPE')fail(error,'stdin');});child.on('error',error=>fail(error,'child-error'));
        child.on('exit',(status,signalValue)=>{exited=true;if(!note({role,pid:child.pid,event:'exit',status,signal:signalValue}))teardown();});
        child.on('close',(status,signalValue)=>{closed=true;if(status!==0||signalValue!==null)retain(new Error(`${role} status=${status} signal=${signalValue}`),'child-outcome');note({role,pid:child.pid,event:'close',status,signal:signalValue,stdoutBytes,stderrBytes,storedStdout,storedStderr});resolve();});
        if(!note({role,pid:child.pid,binary,args,cwd,env,spawned:true}))teardown();
        try{deadlineTimer=setTimeout(()=>fail(new Error('inclusive child deadline'),'deadline'),Math.min(shared.remaining(),childSeconds*1000));child.stdin.end(input);}catch(error){fail(error,'activation');}
      });
      if(child?.pid){
        if(!exited||!closed){unknown=true;retain(new Error('exit/close not both observed'),'retirement');signal('SIGKILL');}
        let groupAbsent=false;try{kill(-child.pid,0);}catch(error){if(error?.code==='ESRCH')groupAbsent=true;else retain(error,'group-observation');}
        if(!groupAbsent){unknown=true;retain(new Error('owned group absence unproved'),'retirement');signal('SIGKILL');}
        note({role,pid:child.pid,groupAbsent,exited,closed,unknown});
      }
      try{shared.remaining();}catch(error){retain(error,'inclusive-clock');}
    }catch(error){retain(error,'acquisition');}
    finally{
      if(child?.pid&&!closed){teardown();signal('SIGKILL');unknown=true;}
      clearTimeout(deadlineTimer);clearTimeout(killTimer);clearTimeout(drainTimer);
      for(const descriptor of descriptors){try{io.fsyncSync(descriptor);}catch(error){retain(error,'capture-flush');}try{io.closeSync(descriptor);}catch(error){retain(error,'capture-close');unknown=true;}}
      activeChild=false;
    }
    if(unknown)remember(new Error('dependent work forbidden: unknown retirement/descriptor state'),'unknown');
    if(hasPrimary){poisoned=true;throw primary;}
    return{stdout:path.join(directory,label+'.stdout'),stderr:path.join(directory,label+'.stderr'),pid:child?.pid,stdoutBytes,stderrBytes,storedStdout,storedStderr};
  }
  function snapshot(){return{children,attemptedBytes:attempted,storedBytes:stored,elapsedMs:now()-shared.started,failures:records.map(row=>({phase:row.phase,reason:reasonRecord(row.reason)}))};}
  return{run,remaining:shared.remaining,note:event,records,
    finish(){assert.ok(!activeChild&&!finished);shared.remaining();let present=false,primary;try{event({finished:true,...snapshot()});}catch(error){present=true;primary=error;remember(error,'terminal-event');}try{closeEvents();}catch(error){if(!present){present=true;primary=error;}}finished=true;if(present)throw primary;return snapshot();},
    publish(filename,value){shared.publication();const result=durableJSON(io,filename,value,error=>remember(error,'publication'));shared.publication();return result;},
    abort(primary){remember(primary,'outer-failure');let secondaryPresent=false,secondary;try{closeEvents();}catch(error){secondaryPresent=true;secondary=error;}finished=true;return{...snapshot(),secondaryPresent,secondary:reasonRecord(secondary)};},
  };
}
