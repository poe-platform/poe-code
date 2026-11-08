import type {Sandbox} from '@cloudflare/sandbox';
import {createRemoteExecutionRoute} from '../src/deployment.js';
import {createSandboxDriver} from './driver.js';
import provider from '@poe-code/remote-execution/providers/cloudflare';
export {Sandbox} from '@cloudflare/sandbox';
interface Env {
 Sandbox:DurableObjectNamespace<Sandbox>;
 /** Operator-controlled authorization service. Must validate token, audience,
  * tenancy, permissions and expiry, never trust client namespace headers. */
 AUTHORIZATION:Fetcher;
}
export default {async fetch(request:Request,env:Env){
 const driver=createSandboxDriver(env.Sandbox);
 const route=createRemoteExecutionRoute({driver,transferLimits:provider.transferLimits,async authenticate(input){
  const authorization=input.headers.get('Authorization');if(!authorization)return null;
  const url=new URL(input.url);
  let response:Response;
  try{
   response=await env.AUTHORIZATION.fetch('https://authorization.internal/authorize',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({audience:url.origin,method:input.method,path:url.pathname}),signal:input.signal});
  }catch{
   input.signal.throwIfAborted();
   return null;
  }
  if(!response.ok){
   await response.body?.cancel().catch(()=>{});
   input.signal.throwIfAborted();
   return null;
  }
  let principal:unknown;
  const reader=response.body?.getReader();
  if(!reader)return null;
  const stop=()=>{void reader.cancel(input.signal.reason).catch(()=>{});};
  input.signal.addEventListener('abort',stop,{once:true});
  try{
   const bytes=new Uint8Array(4096);
   let length=0;
   for(;;){
    input.signal.throwIfAborted();
    const part=await reader.read();
    if(part.done)break;
    if(part.value.byteLength>bytes.byteLength-length)return null;
    bytes.set(part.value,length);length+=part.value.byteLength;
   }
   input.signal.throwIfAborted();
   principal=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length)));
  }catch{
   input.signal.throwIfAborted();
   return null;
  }finally{
   input.signal.removeEventListener('abort',stop);
   try{await reader.cancel();}catch{
    input.signal.throwIfAborted();
    principal=null;
   }finally{reader.releaseLock();}
  }
  if(!principal||typeof principal!=='object'||!('namespaceId' in principal)||typeof principal.namespaceId!=='string'||!('expiresAt' in principal)||typeof principal.expiresAt!=='number')return null;
  return {namespaceId:principal.namespaceId,expiresAt:principal.expiresAt};
 }});
 return route.fetch(request);
}};
