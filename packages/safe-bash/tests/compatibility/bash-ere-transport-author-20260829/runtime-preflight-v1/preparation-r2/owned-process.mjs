import {spawn} from 'node:child_process';
import {openSync,closeSync,writeSync} from 'node:fs';
import {fullWrite} from './data-support.mjs';
export async function captureScope(paths,body,io={open:openSync,close:closeSync}){const descriptors=[];let primary={present:false};const secondary=[];let value;try{for(const path of paths)descriptors.push(io.open(path,'wx',0o600));value=await body(descriptors);}catch(reason){primary={present:true,value:reason};}finally{for(const fd of descriptors){try{io.close(fd);}catch(reason){secondary.push({present:true,value:reason});}}}return{primary,secondary,value};}
export async function ownChild(config,hooks={}){
 const clock=hooks.clock??Date.now;const start=clock();if(!Number.isFinite(start)||start>=config.deadline-config.reserveMilliseconds-config.timeoutMilliseconds-2000)throw Error('child preadmission');
 const record={pid:null,spawned:false,closed:false,code:null,signal:null,stdoutBytes:0,stderrBytes:0,stdoutClosed:false,stderrClosed:false,termRequested:false,killRequested:false,primary:{present:false},secondary:[]};
 let child,closedPromise,timer,killTimer;let finish;const fault=reason=>{if(!record.primary.present)record.primary={present:true,value:reason};};
 const stop=()=>{if(!child||record.closed)return;try{record.termRequested=true;child.kill('SIGTERM');}catch(reason){record.secondary.push({present:true,value:reason});}if(!killTimer)killTimer=setTimeout(()=>{if(!record.closed){try{record.killRequested=true;child.kill('SIGKILL');}catch(reason){record.secondary.push({present:true,value:reason});}}},2000);};
 const captured=await captureScope([config.stdout,config.stderr],async descriptors=>{
  try{
   timer=setTimeout(()=>{fault(Error('child deadline'));stop();},config.timeoutMilliseconds);
   closedPromise=new Promise(resolve=>{finish=resolve;});
   child=spawn(config.node,config.args,{cwd:config.cwd,env:config.env,stdio:['ignore','pipe','pipe']});
   child.once('error',reason=>{fault(reason);stop();});child.once('close',(code,signal)=>{record.closed=true;record.code=code;record.signal=signal;finish();});
   record.spawned=true;record.pid=child.pid??null;
   try{
    for(const [index,name]of [[0,'stdout'],[1,'stderr']]){const stream=child[name];stream.once('close',()=>{record[name+'Closed']=true;});stream.once('end',()=>{record[name+'Closed']=true;});stream.on('error',reason=>{fault(reason);stop();});stream.on('data',chunk=>{try{if(chunk.length>config.channelBytes-record[name+'Bytes'])throw Error('child capture cap');fullWrite(descriptors[index],chunk,hooks.write??writeSync);record[name+'Bytes']+=chunk.length;}catch(reason){fault(reason);stop();}});}
    hooks.afterSpawn?.(record);const now=clock();if(!Number.isFinite(now)||now>=config.deadline-config.reserveMilliseconds)throw Error('postspawn clock/deadline');hooks.publish?.(record);
   }catch(reason){fault(reason);stop();}
   await closedPromise;
  }catch(reason){fault(reason);if(child&&!record.closed){stop();await closedPromise;}}
  finally{if(child&&!record.closed){stop();await closedPromise;}clearTimeout(timer);clearTimeout(killTimer);}
 });
 if(captured.primary.present)fault(captured.primary.value);record.secondary.push(...captured.secondary);
 return record;
}
