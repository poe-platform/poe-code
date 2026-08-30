import {spawn} from 'node:child_process';
import {types} from 'node:util';
import {acquireCapture,actualIO} from './capture-v1.mjs';
export function observeReason(value){const result={present:true,isUndefined:value===undefined,name:null,message:null,code:null};if(value!==null&&typeof value==='object'&&!types.isProxy(value))for(const key of ['name','message','code']){const item=Object.getOwnPropertyDescriptor(value,key);if(item&&Object.hasOwn(item,'value')&&typeof item.value==='string')result[key]=item.value.slice(0,2048);}return result;}
export async function runCapturedStartup({paths,authenticate,io=actualIO}){
 const record={spawned:false,pid:null,closed:false,code:null,signal:null,bytes:0,timedOut:false,primary:undefined,cleanup:[],events:[]};let capture;let child;let deadline;let killer;
 const fail=value=>{record.primary??={present:true,value};};
 const terminate=()=>{if(record.closed)return;try{if(child?.pid)process.kill(-child.pid,'SIGTERM');}catch(value){fail(value);}killer??=setTimeout(()=>{if(!record.closed)try{if(child?.pid)process.kill(-child.pid,'SIGKILL');}catch(value){fail(value);}},2000);};
 try{
  const opened=acquireCapture(paths,io);if(!opened.ok){record.primary=opened.primary;record.cleanup=opened.cleanup;return record;}capture=opened;record.events.push('captureOwned');
  const admission=await authenticate();record.events.push('authenticated');
  if(!Number.isSafeInteger(admission.timeoutMs)||admission.timeoutMs<=0||admission.timeoutMs>3600000||!Number.isSafeInteger(admission.captureBytes)||admission.captureBytes<1||admission.captureBytes>1048576)throw Error('startup finite admission');
  await new Promise((resolve,reject)=>{
   deadline=setTimeout(()=>{record.timedOut=true;fail(Error('startup deadline'));terminate();},admission.timeoutMs);
   try{child=spawn(admission.executable,admission.args,{cwd:admission.cwd,env:admission.env,stdio:['ignore','pipe','pipe'],detached:true});}catch(value){reject(value);return;}
   child.once('error',fail);
   child.once('close',(code,signal)=>{record.closed=true;record.code=code;record.signal=signal;clearTimeout(deadline);clearTimeout(killer);record.events.push('closed');resolve();});
   try{record.pid=child.pid??null;record.spawned=child.pid!==undefined;record.events.push('spawned');for(const [index,stream]of [child.stdout,child.stderr].entries()){stream.on('error',value=>{fail(value);terminate();});stream.on('data',bytes=>{try{record.bytes+=bytes.length;if(record.bytes>admission.captureBytes)throw Error('startup capture ceiling');capture.write(index,bytes);}catch(value){fail(value);terminate();}});}}catch(value){fail(value);terminate();}
  });
 }catch(value){fail(value);}
 finally{clearTimeout(deadline);clearTimeout(killer);if(capture)record.cleanup.push(...capture.close());}
 return record;
}
export function startupReceipt(record){return {spawned:record.spawned,pid:record.pid,closed:record.closed,code:record.code,signal:record.signal,bytes:record.bytes,timedOut:record.timedOut,primary:record.primary?observeReason(record.primary.value):null,cleanup:record.cleanup.map(item=>observeReason(item.value)),events:record.events,clean:record.closed&&!record.timedOut&&!record.primary&&!record.cleanup.length&&record.signal===null};}
