import {spawn}from'node:child_process';import {native}from'./native.js';
export function createHostRunner(options={}){
 const detached=Object.hasOwn(options,'detached')&&options.detached===true;
 return {name:'host',exec(input){
  const spec=Object.create(null);
  for(const field of ['command','args','cwd','env','stdin','stdout','stderr','tty','signal','killProcessGroup'])if(Object.hasOwn(input,field)){const value=input[field];if(value!==undefined||field==='command')spec[field]=value;}
  // The native planner receives primitive facts; stream/signal/env identities
  // remain in the originating Node isolate.
  if(spec.signal?.aborted===true)return {pid:null,stdin:null,stdout:null,stderr:null,result:Promise.resolve({exitCode:1}),kill(){}};
  const plan=native.hostPlan({stdin:spec.stdin,stdout:spec.stdout,stderr:spec.stderr,detached,group:spec.killProcessGroup===true,aborted:false});
  const spawnOptions=Object.assign(Object.create(null),{cwd:spec.cwd,env:spec.env,stdio:plan.stdio,...(plan.detached?{detached:true}:{})});
  const child=spawn(spec.command,spec.args??[],spawnOptions),state=new native.HostRun(plan.detached);
  if(plan.detached)child.unref();
  const kill=signal=>{const group=state.killTarget(child.pid,process.platform==='win32');if(group!==null){process.kill(group,signal);return;}child.kill(signal);};
  let resolveResult;const result=new Promise(resolve=>{resolveResult=resolve;});
  const abort=()=>{try{kill('SIGTERM');}catch{}};
  let bound=false;
  if(spec.signal!==undefined){if(spec.signal.aborted)abort();else{spec.signal.addEventListener('abort',abort,{once:true});bound=true;}}
  const complete=code=>{const exitCode=state.finish(code);if(exitCode===null)return;if(bound){spec.signal.removeEventListener('abort',abort);bound=false;}resolveResult({exitCode});};
  child.once('close',complete);child.once('error',()=>complete(null));
  return {pid:child.pid??null,stdin:child.stdin,stdout:child.stdout,stderr:child.stderr,result,kill};
 }};
}
