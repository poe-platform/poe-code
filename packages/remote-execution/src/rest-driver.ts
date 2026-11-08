import {boundedTransfer} from './hosting-stream.js';
import type {RemoteExecutionDriver} from './deployment.js';
import {hostingRequest} from './hosting-request.js';
import {hostingOperation} from './hosting-operation.js';

export interface RestProviderConfig {
 transport:'https';
 /** Trusted operator bindings for existing servers. No provisioning or SDK. */
 endpoints?:Readonly<Record<string,RestEndpoint>>;
}
export interface RestEndpoint {
 origin:string;
 /** Operator-supplied lease deadline, not inferred from the hostname. */
 expiresAt:number;
}
/** The trusted resolver binds tenancy and readiness. Resolving on each request
 * permits token/tunnel rotation and restart without replaying a request body.
 * Existing servers are never provisioned or destroyed by this driver. */
export function createRestExecutionDriver(
 config:RestProviderConfig,
 resolve?: (namespaceId:string,signal:AbortSignal)=>Promise<RestEndpoint>,
 fetch:(request:Request)=>Promise<Response>=globalThis.fetch,
 now:()=>number=Date.now,
 retire?:(namespaceId:string)=>Promise<void>,
):RemoteExecutionDriver {
 if(config.transport!=='https')throw new TypeError('HTTPS transport required');
 if(!resolve&&!config.endpoints)throw new TypeError('Existing-server bindings or resolver required');
 const bindings=new Map(Object.entries(config.endpoints??{}).map(([namespaceId,endpoint])=>[namespaceId,{...endpoint}]));
 const endpoints=new Map<string,{retired:boolean;abort:AbortController}>();
 const cleanups=new Map<string,Promise<void>>();
 return {
  async acquire(namespaceId){
   if(!namespaceId)throw new TypeError('Trusted namespace identity required');
   await cleanups.get(namespaceId);
   let entry=endpoints.get(namespaceId);
   if(!entry){entry={retired:false,abort:new AbortController()};endpoints.set(namespaceId,entry);}
   const lease=entry;
   if(lease.retired)throw new Error('Endpoint retired');
   return {async fetch(request){
    if(lease.retired)throw new Error('Endpoint retired');
    request.signal.throwIfAborted();
    const signal=AbortSignal.any([request.signal,lease.abort.signal]);
    const endpoint=await hostingOperation(signal,async()=>{
     if(resolve)return resolve(namespaceId,signal);
     const binding=bindings.get(namespaceId);
     if(!binding)throw new Error('Existing-server tenant binding required');
     return binding;
    });
    signal.throwIfAborted();
    if(lease.retired)throw new Error('Endpoint retired');
    const remaining=endpoint.expiresAt-now();
    if(!Number.isFinite(endpoint.expiresAt)||remaining<=0)throw new Error('Endpoint lease expired');
    const origin=new URL(endpoint.origin);
    if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new TypeError('Credential-free HTTPS origin required');
    const incoming=new URL(request.url);
    const target=new URL(origin);
    target.pathname=incoming.pathname;target.search=incoming.search;
    // Retain the original stream and protocol headers without eager stdin pulls.
    // Keep the deadline attached to the transport after headers arrive, so
    // native fetch also cancels streaming request and response bodies at expiry.
    const abort=new AbortController();
    const transportSignal=AbortSignal.any([signal,abort.signal,AbortSignal.timeout(Math.min(Math.ceil(remaining),2147483647))]);
    const body=request.body?boundedTransfer(request.body,undefined,transportSignal,abort,false,false):null;
    try {
     const response=await hostingOperation(transportSignal,()=>fetch(hostingRequest(request,target,{body,signal:transportSignal,redirect:'manual'})),response=>response.body?.cancel(transportSignal.reason));
     const output=response.body?boundedTransfer(response.body,undefined,transportSignal,abort):null;
     return new Response(output,{status:response.status,statusText:response.statusText,headers:response.headers});
    } catch(error) {abort.abort(error);throw error;}
   }};
  },
  async destroy(namespaceId){
   if(!namespaceId)throw new TypeError('Trusted namespace identity required');
   const pending=cleanups.get(namespaceId);if(pending)return pending;
   // Old handles cannot attach to a replacement tenant binding. Failed
   // cleanup stays quarantined until the operator explicitly retries it.
   const entry=endpoints.get(namespaceId)??{retired:false,abort:new AbortController()};
   entry.retired=true;endpoints.set(namespaceId,entry);
   entry.abort.abort(new Error('Endpoint retired'));
   const cleanup=Promise.resolve().then(()=>retire?.(namespaceId)).then(()=>{endpoints.delete(namespaceId);});
   cleanups.set(namespaceId,cleanup);
   try{await cleanup;}finally{cleanups.delete(namespaceId);}
  },
 };
}
