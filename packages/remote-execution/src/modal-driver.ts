import {createRestExecutionDriver} from './rest-driver.js';
import type {RemoteExecutionDriver} from './deployment.js';

export interface ModalProviderConfig {
 transport:'https';
 executionClass:'standard-sandbox'|'vm-sandbox';
 port:number;
 readinessTimeoutMs:number;
}
/** SDK adapter owns sandbox lookup/creation authorization, image pinning and
 * trusted tenant binding. This handle deliberately exposes no job exec/FileIO. */
export interface ModalService {
 waitUntilReady(timeoutMs:number):Promise<void>;
 poll():Promise<number|null>;
 tunnels(timeoutMs:number):Promise<Record<number,{url:string}>>;
 terminate(options:{wait:true}):Promise<number|void>;
 /** Release the request-owned SDK connection without stopping the service. */
 detach?():void;
 expiresAt:number;
 executionClass:ModalProviderConfig['executionClass'];
}
export function createModalExecutionDriver(
 config:ModalProviderConfig,
 resolve:(namespaceId:string,options?:{purpose:'terminate'})=>Promise<ModalService>,
 fetch:(request:Request)=>Promise<Response>=globalThis.fetch,
 now:()=>number=Date.now,
):RemoteExecutionDriver {
 // Retain the validated selection across asynchronous attachments and requests.
 config={...config};
 if(!['standard-sandbox','vm-sandbox'].includes(config.executionClass))throw new TypeError('Explicit supported Sandbox execution class required');
 if(!Number.isSafeInteger(config.port)||config.port<1||config.port>65535||!Number.isSafeInteger(config.readinessTimeoutMs)||config.readinessTimeoutMs<=0)throw new TypeError('Explicit port and readiness deadline required');
 async function service(namespaceId:string,options?:{purpose:'terminate'}){
  const sandbox=await resolve(namespaceId,options);
  if(sandbox.executionClass!==config.executionClass){sandbox.detach?.();throw new Error('Sandbox execution class mismatch');}
  return sandbox;
 }
 return createRestExecutionDriver(config,async (namespaceId,signal)=>{
  let sandbox:ModalService|undefined;
  let expiresAt:number|undefined;
  let retired=false;
  try {
  const deadline=now()+config.readinessTimeoutMs;
  function remaining(){
   signal.throwIfAborted();
   const time=now();
   if(sandbox&&(!Number.isFinite(expiresAt)||expiresAt!<=time))throw new Error('Sandbox lease expired');
   if(deadline<=time)throw new Error('Sandbox readiness deadline exceeded');
   return Math.min(deadline,expiresAt??deadline)-time;
  }
  // SDK calls cannot be interrupted by detach(). Reject the caller promptly,
  // handle late completion, and release listeners/timers on every outcome.
  async function wait<T>(operation:(timeoutMs:number)=>Promise<T>):Promise<T>{
   const timeoutMs=remaining();
   let timer:ReturnType<typeof setTimeout>|undefined;
   let abort:()=>void=()=>{};
   const cancelled=new Promise<never>((_,reject)=>{
    abort=()=>reject(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>reject(new Error('Sandbox readiness deadline or lease expired')),timeoutMs);
   });
   try {
    const result=await Promise.race([operation(timeoutMs),cancelled]);
    remaining();
    return result;
   } finally {clearTimeout(timer);signal.removeEventListener('abort',abort);}
  }
  const attached=await wait(async()=>{
   const value=await service(namespaceId);
   if(retired){value.detach?.();throw new Error('Sandbox preparation already cancelled');}
   sandbox=value;
   // Keep this request's lifetime tied to the selected binding even if the
   // borrowed SDK handle is reused or its metadata rotates during readiness.
   expiresAt=value.expiresAt;
   return value;
  });
  if(await wait(()=>attached.poll())!==null)throw new Error('Sandbox finished; explicit restart required');
  await wait(timeoutMs=>attached.waitUntilReady(timeoutMs));
  if(await wait(()=>attached.poll())!==null)throw new Error('Sandbox finished; explicit restart required');
  const tunnel=(await wait(timeoutMs=>attached.tunnels(timeoutMs)))[config.port];
  if(!tunnel)throw new Error('Service tunnel unavailable');
  if(await wait(()=>attached.poll())!==null)throw new Error('Sandbox finished; explicit restart required');
  return {origin:tunnel.url,expiresAt:expiresAt!};
  } finally {retired=true;sandbox?.detach?.();}
 },fetch,now,async namespaceId=>{
  const sandbox=await service(namespaceId,{purpose:'terminate'});
  try {await sandbox.terminate({wait:true});}finally{sandbox.detach?.();}
 });
}
