import {describe,expect,it,vi} from 'vitest';
import {createContainerExecutionDriver,createRemoteExecutionRoute} from './deployment.js';
import {createRestExecutionDriver} from './rest-driver.js';
import {createModalExecutionDriver} from './modal-driver.js';

it('cancels a stalled REST binding lookup without forwarding a late endpoint',async()=>{
 let finish!:(endpoint:{origin:string;expiresAt:number})=>void;let started!:()=>void;
 const entered=new Promise<void>(resolve=>{started=resolve;});
 const resolve=vi.fn(()=>{started();return new Promise<{origin:string;expiresAt:number}>(done=>{finish=done;});});
 const fetch=vi.fn(async()=>new Response(null));const abort=new AbortController();let failure:unknown;
 const driver=createRestExecutionDriver({transport:'https'},resolve,fetch,()=>100);
 const pending=(await driver.acquire('tenant')).fetch(new Request('https://public.example/v1/jobs',{signal:abort.signal})).catch(error=>{failure=error;});
 await entered;const reason=new Error('lookup cancelled');abort.abort(reason);
 for(let turn=0;turn<20;turn++)await Promise.resolve();
 const observed=failure;finish({origin:'https://trusted.example',expiresAt:200});await pending;
 expect(observed).toBe(reason);expect(fetch).not.toHaveBeenCalled();expect(resolve).toHaveBeenCalledOnce();
});

it.each(['REST','Modal'])('%s expires an active transport at the resolved lease deadline',async provider=>{
 const expiry=new AbortController();
 const timeout=vi.spyOn(AbortSignal,'timeout').mockReturnValue(expiry.signal);
 try {
  let active:AbortSignal|undefined;
  const fetch=vi.fn(async(request:Request)=>{active=request.signal;return new Response(null);});
  const driver=provider==='REST'
   ?createRestExecutionDriver({transport:'https'},async()=>({origin:'https://trusted.example',expiresAt:200}),fetch,()=>100)
   :createModalExecutionDriver({transport:'https',executionClass:'standard-sandbox',port:8080,readinessTimeoutMs:1000},async()=>({executionClass:'standard-sandbox',expiresAt:200,poll:async()=>null,waitUntilReady:async()=>{},tunnels:async()=>({8080:{url:'https://trusted.example'}}),terminate:async()=>{}}),fetch,()=>100);
  await (await driver.acquire('tenant')).fetch(new Request('https://public.example/v1/jobs'));
  expect(timeout).toHaveBeenCalledWith(100);
  expect(active?.aborted).toBe(false);
  expiry.abort(new Error('lease deadline'));
  expect(active?.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledOnce();
 } finally {timeout.mockRestore();}
});

it('bounds long REST leases to the supported timer range without immediate expiry',async()=>{
 const expiry=new AbortController();
 const timeout=vi.spyOn(AbortSignal,'timeout').mockReturnValue(expiry.signal);
 try {
  const fetch=vi.fn(async(request:Request)=>{expect(request.signal.aborted).toBe(false);return new Response(null);});
  const driver=createRestExecutionDriver({transport:'https'},async()=>({origin:'https://trusted.example',expiresAt:Number.MAX_SAFE_INTEGER}),fetch,()=>100);
  await (await driver.acquire('tenant')).fetch(new Request('https://public.example/v1/jobs'));
  expect(timeout).toHaveBeenCalledWith(2147483647);
 } finally {timeout.mockRestore();}
});

// The same assertions run over all hosting adapters. These receipts qualify
// local transport fixtures only, never a provider's cloud/runtime capabilities.
for(const provider of ['REST','REST configuration','Cloudflare','Modal'])describe(`${provider} hosting contract`,()=>{
 it('pins credential lifetime before asynchronous tenant acquisition',async()=>{
  const credential={namespaceId:'tenant-a',expiresAt:150};let time=100;
  const fetch=vi.fn(async()=>new Response(null));const {driver}=setup(fetch);
  const acquire=driver.acquire.bind(driver);
  vi.spyOn(driver,'acquire').mockImplementation(async namespaceId=>{
   credential.expiresAt=500;time=150;return acquire(namespaceId);
  });
  const route=createRemoteExecutionRoute({driver,authenticate:async()=>credential,now:()=>time});
  expect((await route.fetch(new Request('https://public.example/v1/jobs'))).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
 });
 function setup(fetch:(request:Request)=>Promise<Response>,retire:()=>Promise<void>=async()=>{}){
  const resolve=vi.fn(async(namespaceId:string)=>({origin:`https://${namespaceId}.example`,expiresAt:200}));
  const driver=provider==='Cloudflare'
   ?createContainerExecutionDriver({port:8080,lifecycle:{sleepAfter:'5m',keepAlive:false},transport:'http'},()=>({containerFetch:fetch,destroy:retire}))
   :provider==='Modal'
    ?createModalExecutionDriver({transport:'https',executionClass:'standard-sandbox',port:8080,readinessTimeoutMs:1000},async namespaceId=>({executionClass:'standard-sandbox',expiresAt:200,poll:async()=>null,waitUntilReady:async()=>{},tunnels:async()=>({8080:{url:(await resolve(namespaceId)).origin}}),terminate:retire}),fetch,()=>100)
    :provider==='REST configuration'
     ?createRestExecutionDriver({transport:'https',endpoints:{'tenant-a':{origin:'https://tenant-a.example',expiresAt:200},'tenant-b':{origin:'https://tenant-b.example',expiresAt:200}}},undefined,fetch,()=>100,retire)
     :createRestExecutionDriver({transport:'https'},resolve,async request=>fetch(request),()=>100,retire);
 return {resolve,driver,route:createRemoteExecutionRoute({driver,authenticate:async request=>request.headers.get('Authorization')==='Bearer valid'?{namespaceId:'tenant-a',expiresAt:200}:null,now:()=>100})};
 }
 it('exchanges every byte before stdin EOF and cancels both directions on output disconnect',async()=>{
  const bytes=Uint8Array.from({length:256},(_,index)=>index);
  const cancelInput=vi.fn();const cancelOutput=vi.fn();
  let input!:ReadableStreamDefaultController<Uint8Array>;
  let incoming!:ReadableStreamDefaultReader<Uint8Array>;
  let signal!:AbortSignal;
  const fetch=vi.fn(async(request:Request)=>{
   signal=request.signal;incoming=request.body!.getReader();
   return new Response(new ReadableStream<Uint8Array>({
    start(controller){controller.enqueue(bytes);},cancel:cancelOutput,
   },{highWaterMark:0}));
  });
  const {route}=setup(fetch);
  const body=new ReadableStream<Uint8Array>({start(controller){input=controller;},cancel:cancelInput},{highWaterMark:0});
  const response=await route.fetch(new Request('https://public.example/v1/jobs/job/stdin',{
   method:'POST',headers:{Authorization:'Bearer valid'},body,duplex:'half',
  } as RequestInit));
  const output=response.body!.getReader();
  expect((await output.read()).value).toEqual(bytes);
  input.enqueue(bytes.slice(0,73));input.enqueue(bytes.slice(73));
  expect((await incoming.read()).value).toEqual(bytes.slice(0,73));
  expect((await incoming.read()).value).toEqual(bytes.slice(73));
  await output.cancel('consumer disconnected');
  expect(signal.aborted).toBe(true);
  expect(cancelInput).toHaveBeenCalledOnce();expect(cancelOutput).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
 });
 it('retires response streams after headers even when the transport ignores cancellation',async()=>{
  const cancel=vi.fn();const abort=new AbortController();
  const {driver}=setup(async()=>new Response(new ReadableStream<Uint8Array>({cancel},{highWaterMark:0})));
  const response=await (await driver.acquire('tenant-a')).fetch(new Request('https://public.example/v1/jobs',{signal:abort.signal}));
  const reader=response.body!.getReader();const pending=reader.read();
  const reason=new Error('transport cancelled after headers');
  const rejected=expect(pending).rejects.toBe(reason);
  abort.abort(reason);await rejected;
  expect(cancel).toHaveBeenCalledOnce();
 });
 it('retires pending response reads during tenant destruction while other tenants continue',async()=>{
  const cancel=vi.fn();
  const {driver}=setup(async request=>request.headers.get('X-Test-Active')==='yes'
   ?new Response(new ReadableStream<Uint8Array>({cancel},{highWaterMark:0}))
   :new Response(null,{status:204}));
  const response=await (await driver.acquire('tenant-a')).fetch(new Request('https://public.example/v1/jobs',{headers:{'X-Test-Active':'yes'}}));
  const pending=response.body!.getReader().read();
  const rejected=expect(pending).rejects.toThrow('retired');
  await driver.destroy('tenant-a');await rejected;
  expect(cancel).toHaveBeenCalledOnce();
  expect((await (await driver.acquire('tenant-b')).fetch(new Request('https://public.example/v1/jobs'))).status).toBe(204);
 });
 it('cancels a stalled hosting transport promptly even if it ignores the signal',async()=>{
  let finish!:(response:Response)=>void;let started!:()=>void;
  const entered=new Promise<void>(resolve=>{started=resolve;});
  const fetch=vi.fn(()=>{started();return new Promise<Response>(resolve=>{finish=resolve;});});
  const {driver}=setup(fetch);const abort=new AbortController();let failure:unknown;
  const pending=(await driver.acquire('tenant-a')).fetch(new Request('https://public.example/v1/jobs',{signal:abort.signal})).catch(error=>{failure=error;});
  await entered;const reason=new Error('caller cancelled');abort.abort(reason);
  for(let turn=0;turn<20;turn++)await Promise.resolve();
  const observed=failure;const cancel=vi.fn();
  finish(new Response(new ReadableStream({cancel})));await pending;
  for(let turn=0;turn<20;turn++)await Promise.resolve();
  expect(observed).toBe(reason);expect(cancel).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();
 });
 it('rejects expired credentials before resolving any tenant service',async()=>{
  const fetch=vi.fn(async()=>new Response(null));
  const {driver}=setup(fetch);
  const acquire=vi.spyOn(driver,'acquire');
  const route=createRemoteExecutionRoute({driver,authenticate:async()=>({namespaceId:'tenant-a',expiresAt:100}),now:()=>100});
  expect((await route.fetch(new Request('https://public.example/v1/jobs',{headers:{Authorization:'Bearer expired'}}))).status).toBe(401);
  expect(acquire).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 });
 it('expires credentials on active streams without transfer limits',async()=>{
  const expired=new AbortController();
  const timeout=vi.spyOn(AbortSignal,'timeout').mockReturnValue(expired.signal);
  try {
   let active:AbortSignal|undefined;
   const fetch=vi.fn(async(request:Request)=>{active=request.signal;return new Response(null);});
   const {driver}=setup(fetch);
   const route=createRemoteExecutionRoute({driver,authenticate:async()=>({namespaceId:'tenant-a',expiresAt:150}),now:()=>100});
   await route.fetch(new Request('https://public.example/v1/jobs'));
   expect(active?.aborted).toBe(false);
   expect(timeout).toHaveBeenCalledWith(50);
   expired.abort(new Error('credentials expired'));
   expect(active?.aborted).toBe(true);
   expect(fetch).toHaveBeenCalledOnce();
  } finally {timeout.mockRestore();}
 });
 it('rechecks credential expiry after cold service acquisition',async()=>{
  const fetch=vi.fn(async()=>new Response(null));
  const {driver}=setup(fetch);let time=100;
  const acquire=driver.acquire.bind(driver);
  vi.spyOn(driver,'acquire').mockImplementation(async namespaceId=>{
   const endpoint=await acquire(namespaceId);time=200;return endpoint;
  });
  const route=createRemoteExecutionRoute({driver,authenticate:async()=>({namespaceId:'tenant-a',expiresAt:200}),now:()=>time});
  expect((await route.fetch(new Request('https://public.example/v1/jobs'))).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('preserves redirects without sending application credentials to their destination',async()=>{
  const fetch=vi.fn(async(request:Request)=>{
   expect(request.headers.get('Authorization')).toBe('Bearer valid');
   return new Response(null,{status:307,headers:{Location:'https://untrusted.example/v1/jobs'}});
  });
  const {route}=setup(fetch);
  const response=await route.fetch(new Request('https://public.example/v1/jobs',{method:'POST',headers:{Authorization:'Bearer valid'}}));
  expect(response.status).toBe(307);expect(response.headers.get('Location')).toBe('https://untrusted.example/v1/jobs');
  expect(fetch).toHaveBeenCalledOnce();
 });
 it('propagates cuts in streaming input and output without resubmitting the job',async()=>{
  const body=new ReadableStream<Uint8Array>({pull(controller){controller.error(new Error('input cut'));}});
  const fetch=vi.fn(async(request:Request)=>{
   await expect(request.arrayBuffer()).rejects.toThrow('input cut');
   return new Response(new ReadableStream<Uint8Array>({pull(controller){controller.error(new Error('output cut'));}}));
  });
  const {route}=setup(fetch);
  const response=await route.fetch(new Request('https://public.example/v1/jobs',{method:'POST',body,duplex:'half',headers:{Authorization:'Bearer valid'}} as RequestInit));
  await expect(response.arrayBuffer()).rejects.toThrow('output cut');expect(fetch).toHaveBeenCalledOnce();
 });
 it('preserves server restart epoch rejection without replaying a warm mutation',async()=>{
  let epoch='cold';
  const fetch=vi.fn(async(request:Request)=>new Response(null,{
   status:request.headers.get('Execution-Epoch')===epoch?204:409,
   headers:{'Execution-Epoch':epoch},
  }));
  const {route}=setup(fetch);
  const request=()=>new Request('https://public.example/v1/jobs',{method:'POST',headers:{Authorization:'Bearer valid','Execution-Epoch':'cold'}});
  expect((await route.fetch(request())).status).toBe(204);
  expect((await route.fetch(request())).status).toBe(204);
  epoch='restarted';
  const response=await route.fetch(request());
  expect(response.status).toBe(409);expect(response.headers.get('Execution-Epoch')).toBe('restarted');
  expect(fetch).toHaveBeenCalledTimes(3);
 });
 it('retires retained endpoints and isolates other tenants during cleanup',async()=>{
  let finish!:()=>void;let started!:()=>void;
  const entered=new Promise<void>(resolve=>{started=resolve;});
  const cleanup=new Promise<void>(resolve=>{finish=resolve;});
  const fetch=vi.fn(async()=>new Response(null));
  const {driver}=setup(fetch,async()=>{started();await cleanup;});
  const endpoint=await driver.acquire('tenant-a');
  const destroyed=driver.destroy('tenant-a');await entered;
  let replacementReady=false;
  const replacement=driver.acquire('tenant-a').then(value=>{replacementReady=true;return value;});
  await Promise.resolve();const readyDuringCleanup=replacementReady;
  // Finish even on a failed assertion so the fixture leaves no pending work.
  const oldResult=endpoint.fetch(new Request('https://public.example/v1/jobs')).then(()=>false,()=>true);
  await (await driver.acquire('tenant-b')).fetch(new Request('https://public.example/v1/jobs'));
  finish();await destroyed;
  expect(readyDuringCleanup).toBe(false);expect(await oldResult).toBe(true);
  await expect(endpoint.fetch(new Request('https://public.example/v1/jobs'))).rejects.toThrow('retired');
  await (await replacement).fetch(new Request('https://public.example/v1/jobs'));
  expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('quarantines failed cleanup until an explicit successful destroy retry',async()=>{
  const fetch=vi.fn(async()=>new Response(null));
  const retire=vi.fn().mockRejectedValueOnce(new Error('cleanup failed')).mockResolvedValue(undefined);
  const {driver}=setup(fetch,retire);const endpoint=await driver.acquire('tenant-a');
  await expect(driver.destroy('tenant-a')).rejects.toThrow('cleanup failed');
  await expect(endpoint.fetch(new Request('https://public.example/v1/jobs'))).rejects.toThrow('retired');
  await expect(driver.acquire('tenant-a')).rejects.toThrow('retired');expect(fetch).not.toHaveBeenCalled();
  await driver.destroy('tenant-a');
  await (await driver.acquire('tenant-a')).fetch(new Request('https://public.example/v1/jobs'));
  expect(retire).toHaveBeenCalledTimes(2);expect(fetch).toHaveBeenCalledOnce();
 });
 it('cancels active tenant transports before cleanup without affecting other tenants',async()=>{
  let active:AbortSignal|undefined;
  let started!:()=>void;
  const entered=new Promise<void>(resolve=>{started=resolve;});
  const {driver}=setup(async request=>{
   if(request.headers.get('X-Test-Active')==='yes'){
    active=request.signal;started();
    return new Promise<Response>((_,reject)=>{request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true});});
   }
   return new Response(null);
  },async()=>{expect(active?.aborted).toBe(true);});
  const endpoint=await driver.acquire('tenant-a');
  const pending=endpoint.fetch(new Request('https://public.example/v1/jobs',{headers:{'X-Test-Active':'yes'}}));
  const cancelled=expect(pending).rejects.toThrow('retired');
  await entered;
  const other=await driver.acquire('tenant-b');
  await driver.destroy('tenant-a');
  await cancelled;
  expect(active?.reason).toBeInstanceOf(Error);
  await expect(other.fetch(new Request('https://public.example/v1/jobs'))).resolves.toBeInstanceOf(Response);
 });
 it('authenticates before acquiring and preserves binary bodies, epoch and cancellation',async()=>{
  const bytes=new Uint8Array([0,255,128]);const controller=new AbortController();
  const fetch=vi.fn(async(request:Request)=>{
   expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes);
   expect(request.headers.get('Execution-Epoch')).toBe('epoch');
   expect(request.headers.get('Authorization')).toBe('Bearer valid');
   return new Response(bytes,{headers:{'Execution-Epoch':'epoch'}});
  });const {route}=setup(fetch);
  expect((await route.fetch(new Request('https://public.example/v1/jobs'))).status).toBe(401);expect(fetch).not.toHaveBeenCalled();
  const response=await route.fetch(new Request('https://public.example/v1/jobs',{method:'POST',body:bytes,signal:controller.signal,headers:{Authorization:'Bearer valid','Execution-Epoch':'epoch'}}));
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);expect(response.headers.get('Execution-Epoch')).toBe('epoch');
  controller.abort();await expect(route.fetch(new Request('https://public.example/v1/jobs',{signal:controller.signal,headers:{Authorization:'Bearer valid'}}))).rejects.toThrow();
 });
 it('propagates transport cuts once without replaying mutations',async()=>{
  const fetch=vi.fn(async()=>{throw new Error('transport cut');});const {route}=setup(fetch);
  await expect(route.fetch(new Request('https://public.example/v1/jobs',{method:'POST',headers:{Authorization:'Bearer valid'}}))).rejects.toThrow('transport cut');expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('returns an expired tunnel response once without implicitly restarting a service',async()=>{
  const fetch=vi.fn(async()=>new Response(null,{status:410}));
  const {route}=setup(fetch);
  expect((await route.fetch(new Request('https://public.example/v1/jobs',{method:'POST',headers:{Authorization:'Bearer valid'}}))).status).toBe(410);
  expect(fetch).toHaveBeenCalledOnce();
 });
 it('does not pull stdin while the service has not begun consuming it',async()=>{
  const pull=vi.fn((controller:ReadableStreamDefaultController<Uint8Array>)=>{controller.enqueue(new Uint8Array([0,255]));controller.close();});
  const body=new ReadableStream<Uint8Array>({pull},{highWaterMark:0});
  const {route}=setup(async request=>{
   for(let turn=0;turn<5;turn++)await Promise.resolve();
   expect(pull).not.toHaveBeenCalled();
   return new Response(request.body);
  });
  const response=await route.fetch(new Request('https://public.example/v1/jobs',{method:'POST',headers:{Authorization:'Bearer valid'},body,duplex:'half'} as RequestInit));
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0,255]));
  expect(pull).toHaveBeenCalledOnce();
 });
 it('allows binary output before streaming input closes',async()=>{
  let input!:ReadableStreamDefaultController<Uint8Array>;
  const body=new ReadableStream<Uint8Array>({start(controller){input=controller;}});
  let incoming:Request|undefined;
  const {route}=setup(async request=>{incoming=request;return new Response(new Uint8Array([255,0]));});
  const response=await route.fetch(new Request('https://public.example/v1/jobs',{method:'POST',headers:{Authorization:'Bearer valid','X-Namespace-Id':'attacker'},body,duplex:'half'} as RequestInit));
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([255,0]));
  input.enqueue(new Uint8Array([128,0]));input.close();
  expect(new Uint8Array(await incoming!.arrayBuffer())).toEqual(new Uint8Array([128,0]));
 });
 it('forwards a large binary stream without buffering it in the hosting adapter',async()=>{
  const bytes=new Uint8Array(4*1024*1024).fill(255);let pulled=false;
  const stream=new ReadableStream({pull(controller){pulled=true;controller.enqueue(bytes);controller.close();}});
  const {route}=setup(async request=>{
   expect(request.body).not.toBeNull();return new Response(request.body);
  });
  const request=new Request('https://public.example/v1/blobs',{method:'POST',headers:{Authorization:'Bearer valid'},body:stream,duplex:'half'} as RequestInit);
  const response=await route.fetch(request);
  const received=new Uint8Array(await response.arrayBuffer());
  expect(received.byteLength).toBe(bytes.byteLength);expect(received.every(byte=>byte===255)).toBe(true);expect(pulled).toBe(true);
 });
});

it('resolves fresh tenant endpoints and rejects expired tunnels before sending credentials',async()=>{
 const resolve=vi.fn().mockResolvedValueOnce({origin:'https://a.example',expiresAt:100}).mockResolvedValueOnce({origin:'https://b.example',expiresAt:200});
 const fetch=vi.fn(async(request:Request)=>new Response(request.url));
 const driver=createRestExecutionDriver({transport:'https'},resolve,fetch,()=>100);
 await expect((await driver.acquire('a')).fetch(new Request('https://public/v1/jobs'))).rejects.toThrow('expired');expect(fetch).not.toHaveBeenCalled();
 expect(await (await (await driver.acquire('b')).fetch(new Request('https://public/v1/jobs?q=1'))).text()).toBe('https://b.example/v1/jobs?q=1');
 expect(resolve.mock.calls.map(call=>call[0])).toEqual(['a','b']);
});

it('cannot redirect credentials by supplying a double-slash protocol path',async()=>{
 const fetch=vi.fn(async(request:Request)=>new Response(request.url));
 const driver=createRestExecutionDriver({transport:'https'},async()=>({origin:'https://trusted.example',expiresAt:200}),fetch,()=>100);
 const response=await (await driver.acquire('tenant')).fetch(new Request('https://public.example//attacker.example/v1/jobs',{headers:{Authorization:'Bearer secret'}}));
 expect(new URL(await response.text()).origin).toBe('https://trusted.example');
});
