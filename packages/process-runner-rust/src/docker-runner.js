import *as childProcess from'node:child_process';import {randomBytes}from'node:crypto';
import {native}from'./native.js';import {buildDockerRunArgs}from'./docker-args.js';import {buildContextArgs,detectContext}from'./docker-context.js';import {detectEngine}from'./docker-engine.js';import {createDockerEnvFile}from'./docker-env-file.js';
export function createDockerRunner(options){
 const engine=options.engine??detectEngine(),context=options.context??detectContext();
 return{name:'docker',exec(spec){
  if(spec.signal?.aborted===true)return{pid:null,stdin:null,stdout:null,stderr:null,result:Promise.resolve({exitCode:1}),kill(){}};
  const stdin=spec.stdin??'ignore',stdout=spec.stdout??'pipe',stderr=spec.stderr??'pipe',plan=native.dockerRunPlan(stdin,stdout,stderr,spec.tty===true),name=native.dockerContainerName(options.containerName??spec.command,randomBytes(3).toString('hex').slice(0,6)),envFile=createDockerEnvFile(spec.env);
  let child;
  try{const[command,...args]=buildDockerRunArgs({engine,context,image:options.image,command:spec.command,args:spec.args??[],cwd:spec.cwd,env:spec.env,envFilePath:envFile?.path,mounts:options.mounts??[],ports:options.ports??[],network:options.network,containerName:name,detached:false,interactive:plan.interactive,tty:spec.tty??false,rm:true,extraArgs:options.extraArgs??[]});child=childProcess.spawn(command,args,{stdio:plan.inherit?'inherit':plan.modes});}catch(error){envFile?.cleanup();throw error;}
  const state=new native.DockerRun(name);let resolveResult;const result=new Promise(resolve=>{resolveResult=resolve;}),timers=new Set();let cleanupAbort=()=>{};
  const settle=code=>{const exitCode=state.finish(code);if(exitCode===null)return;cleanupAbort();for(const timer of timers)clearTimeout(timer);timers.clear();envFile?.cleanup();resolveResult({exitCode});};
  const control=signal=>{try{const run=childProcess.spawn(engine,[...buildContextArgs(engine,context),...state.control(signal)],{stdio:'ignore'});run.once('error',()=>{});run.unref();}catch{}};
  const terminate=signal=>{try{child.kill(signal);}catch{}};
  const schedule=(callback,delay)=>{const timer=setTimeout(()=>{timers.delete(timer);callback();},delay);timer?.unref?.();timers.add(timer);};
  const abort=()=>{if(!state.abort())return;control('SIGTERM');schedule(()=>{terminate('SIGTERM');schedule(()=>terminate('SIGKILL'),native.DOCKER_ABORT_FORCE_GRACE_MS);},native.DOCKER_ABORT_GRACE_MS);};
  const signal=spec.signal;if(signal!==undefined){if(signal.aborted)abort();else{signal.addEventListener('abort',abort,{once:true});cleanupAbort=()=>signal.removeEventListener('abort',abort);}}
  child.once('error',()=>settle(1));child.once('close',code=>settle(code));
  return{pid:null,stdin:plan.inherit?null:child.stdin,stdout:plan.inherit?null:child.stdout,stderr:plan.inherit?null:child.stderr,result,kill(signal){control(signal);}};
 }};
}
