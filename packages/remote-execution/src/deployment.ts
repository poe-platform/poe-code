import {boundedTransfer} from './hosting-stream.js';
import {hostingRequest} from './hosting-request.js';
import {hostingOperation} from './hosting-operation.js';
/** Hosting transport is independent of the native MediaIsolationDriver. Hosting
 * a container does not qualify native namespace, mount or process capabilities. */
export interface RemoteExecutionDriver {
 acquire(namespaceId:string):Promise<{fetch(request:Request):Promise<Response>}>;
 destroy(namespaceId:string):Promise<void>;
}
export interface RemoteExecutionRouteOptions {
 authenticate(request:Request):Promise<{namespaceId:string;expiresAt:number}|null>;
 driver:Pick<RemoteExecutionDriver,'acquire'>;
 now?:()=>number;
 transferLimits?: { maxChunkBytes: number; maxBytes: number; maxWallClockMs: number };
}
export function createRemoteExecutionRoute(options:RemoteExecutionRouteOptions){
 options={...options,transferLimits:options.transferLimits?{...options.transferLimits}:undefined,
  driver:{acquire:options.driver.acquire.bind(options.driver)}};
 const limits = options.transferLimits;
 if (limits && [limits.maxChunkBytes,limits.maxBytes,limits.maxWallClockMs].some(value => !Number.isSafeInteger(value) || value <= 0)) throw new RangeError('Positive transfer limits required');
 return {async fetch(request:Request):Promise<Response>{
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/v1/'))return new Response(null,{status:404});
  const requestSignal=AbortSignal.any([request.signal,
   ...(limits ? [AbortSignal.timeout(Math.min(limits.maxWallClockMs,2147483647))] : []),
  ]);
  const authenticated=await hostingOperation(requestSignal,()=>options.authenticate(hostingRequest(request,request.url,{signal:requestSignal})));
  // Authentication may return a borrowed credential record. Bind acquisition
  // and transport expiry to its selected identity and lifetime.
  const principal=authenticated&&{namespaceId:authenticated.namespaceId,expiresAt:authenticated.expiresAt};
  if(!principal||!principal.namespaceId||!Number.isFinite(principal.expiresAt)||principal.expiresAt<=(options.now??Date.now)())return new Response(null,{status:401,headers:{'Cache-Control':'no-store'}});
  request.signal.throwIfAborted();
  // Acquisition consumes the same credential and request lifetime as streaming.
  // A resolver ignoring cancellation must never forward a late mutation.
  const remaining = principal.expiresAt - (options.now ?? Date.now)();
  const credentialSignal=AbortSignal.timeout(Math.min(Math.ceil(remaining),2147483647));
  const abort = new AbortController();
  const signal = AbortSignal.any([requestSignal, credentialSignal, abort.signal]);
  const endpoint=await hostingOperation(signal,()=>options.driver.acquire(principal.namespaceId));
  request.signal.throwIfAborted();
  if(principal.expiresAt<=(options.now??Date.now)())return new Response(null,{status:401,headers:{'Cache-Control':'no-store'}});
  // Do not buffer, transcode, retry mutations, rewrite range/epoch headers, or
  // interpret native tool names. The media server also authenticates requests.
  const body = request.body ? boundedTransfer(request.body, limits, signal, abort, false, !!limits) : null;
  try {
   const forwarded = hostingRequest(request,request.url,{body,signal});
   const response = await hostingOperation(signal,()=>endpoint.fetch(forwarded),response=>response.body?.cancel(signal.reason));
   if (signal.aborted) await response.body?.cancel(signal.reason).catch(() => {});
   signal.throwIfAborted();
   const output = response.body ? boundedTransfer(response.body, limits, signal, abort, !!limits) : null;
   if (!output && limits) abort.abort(new Error('Transfer complete'));
   return new Response(output, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) { abort.abort(error); throw error; }
 }};
}


export interface ContainerService {
 containerFetch(request:Request,port:number):Promise<Response>;
 destroy():Promise<void>;
}
export interface ContainerProviderConfig {
 port:number;
 transferLimits?:RemoteExecutionRouteOptions['transferLimits'];
 lifecycle:{sleepAfter:string;keepAlive:boolean;enableDefaultSession?:boolean;containerTimeouts?:{instanceGetTimeoutMS:number;portReadyTimeoutMS:number}};
 transport:'http'|'rpc';
}
/** A provider supplies only declarative options and its SDK's container handle.
 * Native media execution stays behind the common server protocol. */
export function createContainerExecutionDriver(config:ContainerProviderConfig,resolve:(namespaceId:string,config:ContainerProviderConfig)=>ContainerService):RemoteExecutionDriver{
 // Capture operator selection before adapters or callers can mutate borrowed
 // configuration. Give each SDK resolver its own lifecycle/transport options.
 config=structuredClone(config);
 if(!Number.isSafeInteger(config.port)||config.port<1||config.port>65535||typeof config.lifecycle?.sleepAfter!=='string'||!config.lifecycle.sleepAfter.trim()||typeof config.lifecycle.keepAlive!=='boolean')throw new TypeError('Explicit container port and lifecycle required');
 if(config.transport!=='http'&&config.transport!=='rpc')throw new TypeError('Explicit supported container transport required');
 const timeouts=config.lifecycle.containerTimeouts;
 if(timeouts&&[timeouts.instanceGetTimeoutMS,timeouts.portReadyTimeoutMS].some(value=>!Number.isSafeInteger(value)||value<=0))throw new TypeError('Positive container acquisition and readiness timeouts required');
 const services=new Map<string,{container:ContainerService;retired:boolean;abort:AbortController;pending:Set<Promise<Response>>}>();
 const cleanups=new Map<string,Promise<void>>();
 function service(namespaceId:string){
  if(!namespaceId)throw new TypeError('Trusted namespace identity required');
  let value=services.get(namespaceId);if(!value){value={container:resolve(namespaceId,structuredClone(config)),retired:false,abort:new AbortController(),pending:new Set()};services.set(namespaceId,value);}return value;
 }
 return {
  async acquire(namespaceId){
   await cleanups.get(namespaceId);
   const entry=service(namespaceId);
   if(entry.retired)throw new Error('Container endpoint retired');
   return {async fetch(request){
    if(entry.retired)throw new Error('Container endpoint retired');
    request.signal.throwIfAborted();
    const forwarded=hostingRequest(request,request.url,{signal:AbortSignal.any([request.signal,entry.abort.signal])});
    const response=await hostingOperation(forwarded.signal,()=>{
     const pending=entry.container.containerFetch(forwarded,config.port);
     entry.pending.add(pending);
     void pending.then(()=>entry.pending.delete(pending),()=>entry.pending.delete(pending));
     return pending;
    },response=>response.body?.cancel(forwarded.signal.reason));
    // SDK cancellation is not a guarantee that an already-returned stream
    // retires. Guard binary delivery locally without retiring sibling requests
    // when a single consumer disconnects.
    const body=response.body?boundedTransfer(response.body,undefined,forwarded.signal,entry.abort,false,false):null;
    return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
   }};
  },
  async destroy(namespaceId){
   const pending=cleanups.get(namespaceId);if(pending)return pending;
   const entry=service(namespaceId);entry.retired=true;
   // Cancel startup and active transports before SDK destruction can race a
   // still-pending request that would otherwise start the container again.
   entry.abort.abort(new Error('Container endpoint retired'));
   // Retained endpoints must not restart an SDK container during or after
   // cleanup. Failed cleanup stays quarantined for an explicit destroy retry.
   const cleanup=Promise.resolve().then(async()=>{
    // Aborting the caller cannot prove an SDK startup has stopped. Destroy
    // after every acquired call settles so a late startup cannot resurrect it.
    // A stuck SDK leaves cleanup pending and reacquisition quarantined.
    if(entry.pending.size)await Promise.allSettled([...entry.pending]);
    await entry.container.destroy();
   }).then(()=>{services.delete(namespaceId);});
   cleanups.set(namespaceId,cleanup);
   try{await cleanup;}finally{cleanups.delete(namespaceId);}
  },
 };
}
