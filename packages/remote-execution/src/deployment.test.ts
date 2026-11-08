import {expect,it,vi} from 'vitest';
import {createRemoteExecutionRoute,createContainerExecutionDriver} from './deployment.js';

it.each([
 {},
 {maxBytes:8,maxWallClockMs:1000},
 {maxChunkBytes:4,maxWallClockMs:1000},
 {maxChunkBytes:4,maxBytes:8},
])('rejects incomplete transfer ceilings before authorization: %j',transferLimits=>{
 const authenticate=vi.fn();const acquire=vi.fn();
 expect(()=>createRemoteExecutionRoute({authenticate,driver:{acquire},
  transferLimits:transferLimits as Parameters<typeof createRemoteExecutionRoute>[0]['transferLimits'],
 })).toThrow(RangeError);
 expect(authenticate).not.toHaveBeenCalled();expect(acquire).not.toHaveBeenCalled();
});

it.each([
 {transport:undefined},
 {transport:'preview'},
 {lifecycle:{sleepAfter:'5m'}},
 {lifecycle:{sleepAfter:'5m',keepAlive:'false'}},
 {lifecycle:{sleepAfter:'5m',keepAlive:false,containerTimeouts:{instanceGetTimeoutMS:0,portReadyTimeoutMS:90000}}},
 {lifecycle:{sleepAfter:'5m',keepAlive:false,containerTimeouts:{instanceGetTimeoutMS:30000,portReadyTimeoutMS:Infinity}}},
 {lifecycle:{sleepAfter:'5m',keepAlive:false,containerTimeouts:{instanceGetTimeoutMS:30000}}},
])('rejects implicit or invalid container transport/lifecycle settings: %j', overrides=>{
 const resolve=vi.fn();
 const config={port:8080,lifecycle:{sleepAfter:'5m',keepAlive:false},transport:'rpc',...overrides};
 expect(()=>createContainerExecutionDriver(config as unknown as Parameters<typeof createContainerExecutionDriver>[0],resolve)).toThrow(TypeError);
 expect(resolve).not.toHaveBeenCalled();
});

it('retains the authenticated route owner and transfer ceilings across operator mutation',async()=>{
 const bytes=new Uint8Array(5);const cancel=vi.fn();
 const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes);},cancel},{highWaterMark:0});
 const authenticate=vi.fn(async()=>({namespaceId:'tenant',expiresAt:Date.now()+60000}));
 const acquire=vi.fn(async()=>({async fetch(){return new Response(body);}}));
 const options={authenticate,driver:{acquire},transferLimits:{maxChunkBytes:4,maxBytes:8,maxWallClockMs:1000}};
 const route=createRemoteExecutionRoute(options);
 const replacementAuth=vi.fn(async()=>({namespaceId:'other',expiresAt:Date.now()+60000}));
 const replacementAcquire=vi.fn(async()=>({async fetch(){return new Response();}}));
 options.authenticate=replacementAuth;options.driver.acquire=replacementAcquire;options.transferLimits.maxChunkBytes=8;
 const response=await route.fetch(new Request('https://media.test/v1/files/file/bytes'));
 expect(authenticate).toHaveBeenCalledOnce();expect(acquire).toHaveBeenCalledWith('tenant');
 expect(replacementAuth).not.toHaveBeenCalled();expect(replacementAcquire).not.toHaveBeenCalled();
 await expect(response.body!.getReader().read()).rejects.toThrow('Transfer byte limit');
 expect(cancel).toHaveBeenCalledOnce();
});

it.each(['request','response'] as const)('admits the actual %s byte span rather than shadowed transfer metadata',async direction=>{
 const bytes=new Uint8Array(5);const length=vi.fn(()=>1);
 Object.defineProperty(bytes,'byteLength',{get:length});
 const cancel=vi.fn();const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes);},cancel},{highWaterMark:0});
 const route=createRemoteExecutionRoute({
  authenticate:async()=>({namespaceId:'tenant',expiresAt:Date.now()+60000}),
  transferLimits:{maxChunkBytes:4,maxBytes:8,maxWallClockMs:1000},
  driver:{async acquire(){return{async fetch(request){
   if(direction==='request'){await request.body!.getReader().read();return new Response();}
   return new Response(body);
  }};}},
 });
 if(direction==='request'){
  await expect(route.fetch(new Request('https://media.test/v1/upload',{
   method:'POST',body,duplex:'half',
  } as RequestInit))).rejects.toThrow('Transfer byte limit');
 }else{
  const response=await route.fetch(new Request('https://media.test/v1/files/file/bytes'));
  await expect(response.body!.getReader().read()).rejects.toThrow('Transfer byte limit');
 }
 expect(length).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalledOnce();
});

it('retires an active binary response even when SDK streaming ignores destruction', async () => {
 const cancel=vi.fn();
 const driver=createContainerExecutionDriver({port:8080,lifecycle:{sleepAfter:'5m',keepAlive:false},transport:'http'},()=>({
  containerFetch:async()=>new Response(new ReadableStream<Uint8Array>({cancel},{highWaterMark:0}),{status:206,headers:{ETag:'"version"','Content-Range':'bytes 0-2/3'}}),
  destroy:async()=>{},
 }));
 const endpoint=await driver.acquire('tenant');
 const response=await endpoint.fetch(new Request('https://media.example/v1/files/file'));
 expect(response.status).toBe(206);expect(response.headers.get('ETag')).toBe('"version"');
 expect(response.headers.get('Content-Range')).toBe('bytes 0-2/3');
 const reader=response.body!.getReader();
 const read=reader.read().catch(error=>error);
 await driver.destroy('tenant');
 // Inspect cancellation before awaiting the blocked read so the broken path
 // fails immediately rather than leaving a test waiting for its timeout.
 expect(cancel).toHaveBeenCalledOnce();
 expect(await read).toEqual(new Error('Container endpoint retired'));
});

it('disconnects one binary consumer without retiring its tenant or sibling streams', async () => {
 const cancels=[vi.fn(),vi.fn()];let calls=0;
 const destroy=vi.fn(async()=>{});
 const driver=createContainerExecutionDriver({port:8080,lifecycle:{sleepAfter:'5m',keepAlive:false},transport:'http'},()=>({
  containerFetch:async()=>new Response(new ReadableStream<Uint8Array>({
   start(controller){controller.enqueue(new Uint8Array([0,128,255]));},cancel:cancels[calls++],
  },{highWaterMark:0})),destroy,
 }));
 const endpoint=await driver.acquire('tenant');
 const request=new Request('https://media.example/v1/jobs/job/stdout');
 const first=await endpoint.fetch(request);const second=await endpoint.fetch(request);
 await first.body!.cancel('consumer disconnected');
 expect(cancels[0]).toHaveBeenCalledOnce();expect(cancels[1]).not.toHaveBeenCalled();
 expect(destroy).not.toHaveBeenCalled();
 const reader=second.body!.getReader();
 expect((await reader.read()).value).toEqual(new Uint8Array([0,128,255]));
 await driver.destroy('tenant');
 expect(cancels[1]).toHaveBeenCalledOnce();
 await expect(reader.read()).rejects.toThrow('Container endpoint retired');
});

it('binds container endpoints to the selected provider configuration', async () => {
 const config={port:8080,lifecycle:{sleepAfter:'5m',keepAlive:false,containerTimeouts:{instanceGetTimeoutMS:30000,portReadyTimeoutMS:90000}},transport:'http' as const};
 const containerFetch=vi.fn(async(_request:Request,_port:number)=>new Response(null,{status:204}));
 const selected:unknown[]=[];
 const driver=createContainerExecutionDriver(config,(_id,options)=>{
  selected.push(structuredClone(options));
  // An SDK adapter must not be able to rewrite the shared provider contract.
  options.port=9090;options.lifecycle.sleepAfter='1s';
  return {containerFetch,destroy:vi.fn(async()=>{})};
 });
 const endpoint=await driver.acquire('first');
 config.port=7070;config.lifecycle.keepAlive=true;
 config.lifecycle.containerTimeouts.portReadyTimeoutMS=1;
 await endpoint.fetch(new Request('https://media.example/v1/capabilities'));
 await driver.acquire('second');
 expect(containerFetch.mock.calls[0]?.[1]).toBe(8080);
 expect(selected).toEqual([0,1].map(()=>({port:8080,lifecycle:{sleepAfter:'5m',keepAlive:false,containerTimeouts:{instanceGetTimeoutMS:30000,portReadyTimeoutMS:90000}},transport:'http'})));
});

function mockDeadlineTimers() {
 vi.useFakeTimers();
 // Node's native AbortSignal.timeout uses internal timers outside fake clocks.
 vi.spyOn(AbortSignal,'timeout').mockImplementation(milliseconds => {
  const abort = new AbortController();
  setTimeout(() => abort.abort(new DOMException('Deadline expired','TimeoutError')),milliseconds);
  return abort.signal;
 });
}

it('cancels blocked authorization without waiting for or acquiring from a late principal', async () => {
 const caller = new AbortController();
 const reason = new Error('Disconnected during authorization');
 let resolve!: (principal: {namespaceId:string;expiresAt:number}) => void;
 const acquire = vi.fn();
 const route = createRemoteExecutionRoute({
  authenticate: () => new Promise(done => {resolve=done;}), driver:{acquire},
 });
 let settled = false;
 const outcome = route.fetch(new Request('https://media.example/v1/jobs',{signal:caller.signal})).catch(error => error).then(value => {settled=true;return value;});
 caller.abort(reason);
 for(let turn=0;turn<10;turn++)await Promise.resolve();
 const cancelledBeforePrincipal = settled;
 resolve({namespaceId:'tenant',expiresAt:Date.now()+60000});
 expect(await outcome).toBe(reason);
 expect(cancelledBeforePrincipal).toBe(true);
 expect(acquire).not.toHaveBeenCalled();
});

it('includes authorization in the request budget without renewing it for acquisition', async () => {
 mockDeadlineTimers();
 try {
  const cancel=vi.fn();
  const route=createRemoteExecutionRoute({
   authenticate: () => new Promise(resolve => setTimeout(() => resolve({namespaceId:'tenant',expiresAt:Date.now()+60000}),40)),
   driver:{acquire:async()=>({fetch:async()=>new Response(new ReadableStream({cancel},{highWaterMark:0}))})},
   transferLimits:{maxChunkBytes:4,maxBytes:8,maxWallClockMs:50},
  });
  const pending=route.fetch(new Request('https://media.example/v1/jobs/job/stdout'));
  await vi.advanceTimersByTimeAsync(40);
  const response=await pending;
  let settled=false;
  const outcome=response.body!.getReader().read().catch(error=>error).then(value=>{settled=true;return value;});
  await vi.advanceTimersByTimeAsync(11);
  const expiredWithinRequestBudget=settled;
  await vi.advanceTimersByTimeAsync(40);
  expect(await outcome).toMatchObject({name:'TimeoutError'});
  expect(expiredWithinRequestBudget).toBe(true);
  expect(cancel).toHaveBeenCalledOnce();
 } finally {vi.restoreAllMocks();vi.useRealTimers();}
});

it('bounds blocked acquisition by credential expiry and never forwards a late mutation', async () => {
 mockDeadlineTimers();
 try {
  let resolve!: (endpoint: {fetch: ReturnType<typeof vi.fn>}) => void;
  const fetch = vi.fn(async () => new Response(null, {status:201}));
  const route = createRemoteExecutionRoute({
   authenticate: async () => ({namespaceId:'tenant', expiresAt:Date.now()+50}),
   driver: {acquire: () => new Promise(done => {resolve=done;})},
  });
  let settled = false;
  const outcome = route.fetch(new Request('https://media.example/v1/jobs', {method:'POST'})).then(() => 'forwarded', error => error).then(result => {settled=true;return result;});
  await vi.advanceTimersByTimeAsync(51);
  const settledBeforeResolution = settled;
  // Resolving later must not turn an expired request into a mutation.
  resolve({fetch});
  expect(await outcome).toMatchObject({name:'TimeoutError'});
  expect(settledBeforeResolution).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
 } finally {vi.restoreAllMocks();vi.useRealTimers();}
});

it('includes blocked acquisition in the declarative wall-clock budget', async () => {
 mockDeadlineTimers();
 try {
  let resolve!: (endpoint: {fetch: ReturnType<typeof vi.fn>}) => void;
  const fetch = vi.fn(async () => new Response());
  const route = createRemoteExecutionRoute({
   authenticate: async () => ({namespaceId:'tenant', expiresAt:Date.now()+60000}),
   driver: {acquire: () => new Promise(done => {resolve=done;})},
   transferLimits: {maxChunkBytes:4,maxBytes:8,maxWallClockMs:50},
  });
  const outcome = route.fetch(new Request('https://media.example/v1/jobs', {method:'POST'})).then(() => 'forwarded', error => error);
  await vi.advanceTimersByTimeAsync(51);
  resolve({fetch});
  expect(await outcome).toMatchObject({name:'TimeoutError'});
  expect(fetch).not.toHaveBeenCalled();
 } finally {vi.restoreAllMocks();vi.useRealTimers();}
});

it('returns caller cancellation while a resolver remains blocked', async () => {
 const caller = new AbortController();
 const reason = new Error('Disconnected during acquisition');
 let resolve!: (endpoint: {fetch: ReturnType<typeof vi.fn>}) => void;
 let started!: () => void;
 const acquisition = new Promise<void>(done => {started=done;});
 const fetch = vi.fn(async () => new Response());
 const route = createRemoteExecutionRoute({
  authenticate: async () => ({namespaceId:'tenant', expiresAt:Date.now()+60000}),
  driver: {acquire: () => new Promise(done => {resolve=done;started();})},
 });
 const outcome = route.fetch(new Request('https://media.example/v1/jobs', {signal:caller.signal})).catch(error => error);
 await acquisition;
 caller.abort(reason);
 expect(await outcome).toBe(reason);
 resolve({fetch});
 expect(fetch).not.toHaveBeenCalled();
});

it('does not renew the stream budget after slow acquisition', async () => {
 mockDeadlineTimers();
 try {
  const cancel = vi.fn();
  const route = createRemoteExecutionRoute({
   authenticate: async () => ({namespaceId:'tenant',expiresAt:Date.now()+60000}),
   driver: {acquire: () => new Promise(resolve => setTimeout(() => resolve({
    fetch: async () => new Response(new ReadableStream({cancel},{highWaterMark:0})),
   }),40))},
   transferLimits: {maxChunkBytes:4,maxBytes:8,maxWallClockMs:50},
  });
  const pending = route.fetch(new Request('https://media.example/v1/jobs/job/stdout'));
  await vi.advanceTimersByTimeAsync(40);
  const response = await pending;
  const outcome = response.body!.getReader().read().catch(error => error);
  await vi.advanceTimersByTimeAsync(11);
  expect(await outcome).toMatchObject({name:'TimeoutError'});
  expect(cancel).toHaveBeenCalledOnce();
 } finally {vi.restoreAllMocks();vi.useRealTimers();}
});

it.each([undefined,{maxChunkBytes:4,maxBytes:8,maxWallClockMs:50}])('retires late responses when a service ignores the request deadline (%j)', async transferLimits => {
 mockDeadlineTimers();
 try {
  let resolve!: (response: Response) => void;
  const cancel = vi.fn();
  const route = createRemoteExecutionRoute({
   authenticate: async () => ({namespaceId:'tenant',expiresAt:Date.now()+50}),
   driver: {acquire: async () => ({fetch: () => new Promise(done => {resolve=done;})})},
   transferLimits,
  });
  let settled = false;
  const outcome = route.fetch(new Request('https://media.example/v1/jobs')).catch(error => error).then(result => {settled=true;return result;});
  await vi.advanceTimersByTimeAsync(51);
  const settledBeforeResolution = settled;
  resolve(new Response(new ReadableStream({cancel},{highWaterMark:0})));
  await vi.advanceTimersByTimeAsync(0);
  expect(await outcome).toMatchObject({name:'TimeoutError'});
  expect(settledBeforeResolution).toBe(true);
  expect(cancel).toHaveBeenCalledOnce();
 } finally {vi.restoreAllMocks();vi.useRealTimers();}
});

it('aborts in-flight container startup before destruction without aborting the caller', async () => {
 const caller = new AbortController();
 let startupSignal!: AbortSignal;
 const containerFetch = vi.fn((request: Request) => {
  startupSignal = request.signal;
  return new Promise<Response>((_resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), {once:true}));
 });
 const destroy = vi.fn(async () => { expect(startupSignal.aborted).toBe(true); });
 const driver = createContainerExecutionDriver({port:8080,lifecycle:{sleepAfter:'5m',keepAlive:false},transport:'http'}, () => ({containerFetch,destroy}));
 const endpoint = await driver.acquire('tenant');
 const pending = endpoint.fetch(new Request('https://media.example/v1/jobs', {signal:caller.signal}));
 const rejected = pending.catch(error => error);
 await driver.destroy('tenant');
 expect(await rejected).toEqual(new Error('Container endpoint retired'));
 expect(caller.signal.aborted).toBe(false);
 expect(destroy).toHaveBeenCalledOnce();
});

it('limits transport retirement to the destroyed tenant and gives reacquisition a fresh signal', async () => {
 const signals = new Map<string, AbortSignal[]>();
 const driver = createContainerExecutionDriver({port:8080,lifecycle:{sleepAfter:'5m',keepAlive:false},transport:'http'}, id => ({
  async containerFetch(request: Request) {
   signals.set(id, [...(signals.get(id) ?? []), request.signal]);
   return new Response(new Uint8Array([0,128,255]));
  },
  async destroy() {},
 }));
 for (const id of ['tenant-a','tenant-b']) await (await driver.acquire(id)).fetch(new Request('https://media.example/v1/jobs'));
 await driver.destroy('tenant-a');
 expect(signals.get('tenant-a')![0].aborted).toBe(true);
 expect(signals.get('tenant-b')![0].aborted).toBe(false);
 const response = await (await driver.acquire('tenant-a')).fetch(new Request('https://media.example/v1/jobs'));
 expect(signals.get('tenant-a')![1].aborted).toBe(false);
 expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0,128,255]));
});

it('bounds protocol upload chunks before delivering them to the container', async () => {
 const cancel = vi.fn();
 const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); }, cancel });
 const fetch = vi.fn(async (request: Request) => {
  await expect(request.body!.getReader().read()).rejects.toThrow('Transfer byte limit');
  return new Response();
 });
 const route = createRemoteExecutionRoute({ authenticate: async () => ({ namespaceId: 'caller', expiresAt: Date.now() + 60000 }), driver: { acquire: async () => ({ fetch }) }, transferLimits: { maxChunkBytes: 4, maxBytes: 8, maxWallClockMs: 1000 } });
 await expect(route.fetch(new Request('https://worker/v1/uploads', { method: 'POST', body, duplex: 'half' } as RequestInit))).rejects.toThrow('Transfer byte limit');
 expect(cancel).toHaveBeenCalledOnce();
});

it('bounds streamed response totals and propagates cancellation to container transport', async () => {
 let signal!: AbortSignal;
 const cancel = vi.fn();
 const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0, 255, 128, 1])); controller.enqueue(new Uint8Array(4)); controller.enqueue(new Uint8Array(1)); }, cancel });
 const route = createRemoteExecutionRoute({ authenticate: async () => ({ namespaceId: 'caller', expiresAt: Date.now() + 60000 }), driver: { acquire: async () => ({ fetch: async request => { signal = request.signal; return new Response(body); } }) }, transferLimits: { maxChunkBytes: 4, maxBytes: 8, maxWallClockMs: 1000 } });
 const response = await route.fetch(new Request('https://worker/v1/jobs/job/stdout'));
 const reader = response.body!.getReader();
 expect((await reader.read()).value).toEqual(new Uint8Array([0, 255, 128, 1]));
 expect((await reader.read()).value).toHaveLength(4);
 await expect(reader.read()).rejects.toThrow('Transfer byte limit');
 expect(cancel).toHaveBeenCalledOnce();
 expect(signal.aborted).toBe(true);
});

it('expires a blocked transfer and cancels its upstream reader', async () => {
 const cancel = vi.fn();
 const route = createRemoteExecutionRoute({ authenticate: async () => ({ namespaceId: 'caller', expiresAt: Date.now() + 60000 }), driver: { acquire: async () => ({ fetch: async () => new Response(new ReadableStream({ cancel }, { highWaterMark: 0 })) }) }, transferLimits: { maxChunkBytes: 4, maxBytes: 8, maxWallClockMs: 10 } });
 const response = await route.fetch(new Request('https://worker/v1/jobs/job/stdout'));
 await expect(response.body!.getReader().read()).rejects.toThrow();
 expect(cancel).toHaveBeenCalledOnce();
});

it('rejects invalid transfer budgets before admission', () => {
 expect(() => createRemoteExecutionRoute({ authenticate: vi.fn(), driver: { acquire: vi.fn() }, transferLimits: { maxChunkBytes: 0, maxBytes: 8, maxWallClockMs: 1000 } })).toThrow('Positive transfer limits');
});

it('retires an unread upload when the container response reaches EOF', async () => {
 const cancel = vi.fn();
 const route = createRemoteExecutionRoute({ authenticate: async () => ({ namespaceId: 'caller', expiresAt: Date.now() + 60000 }), driver: { acquire: async () => ({ fetch: async () => new Response(new Uint8Array([255])) }) }, transferLimits: { maxChunkBytes: 4, maxBytes: 8, maxWallClockMs: 1000 } });
 const response = await route.fetch(new Request('https://worker/v1/uploads', { method: 'POST', body: new ReadableStream({ cancel }, { highWaterMark: 0 }), duplex: 'half' } as RequestInit));
 const reader = response.body!.getReader();
 expect((await reader.read()).value).toEqual(new Uint8Array([255]));
 expect((await reader.read()).done).toBe(true);
 expect(cancel).toHaveBeenCalledOnce();
});

it('does not drain a protocol response without downstream credits and cancels on disconnect', async () => {
 const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => controller.enqueue(new Uint8Array([255])));
 const cancel = vi.fn();
 let signal!: AbortSignal;
 const route = createRemoteExecutionRoute({ authenticate: async () => ({ namespaceId: 'caller', expiresAt: Date.now() + 60000 }), driver: { acquire: async () => ({ fetch: async request => { signal = request.signal; return new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 })); } }) }, transferLimits: { maxChunkBytes: 4, maxBytes: 8, maxWallClockMs: 1000 } });
 const response = await route.fetch(new Request('https://worker/v1/jobs/job/stdout'));
 expect(pull).not.toHaveBeenCalled();
 await response.body!.cancel('disconnect');
 expect(cancel).toHaveBeenCalledOnce();
 expect(signal.aborted).toBe(true);
});

it('does not forward a mutation when credentials expire during cold acquisition',async()=>{
 let now=100;
 const fetch=vi.fn(async()=>new Response(null,{status:201}));
 const acquire=vi.fn(async()=>{now=200;return {fetch};});
 const route=createRemoteExecutionRoute({authenticate:async()=>({namespaceId:'tenant',expiresAt:200}),driver:{acquire},now:()=>now});
 const response=await route.fetch(new Request('https://media.example/v1/jobs',{method:'POST'}));
 expect(response.status).toBe(401);
 expect(response.headers.get('Cache-Control')).toBe('no-store');
 expect(fetch).not.toHaveBeenCalled();
});

it('rejects unauthenticated requests before acquiring a container',async()=>{
 const acquire=vi.fn();const route=createRemoteExecutionRoute({authenticate:async()=>null,driver:{acquire}});
 expect((await route.fetch(new Request('https://media.example/v1/capabilities'))).status).toBe(401);
 expect(acquire).not.toHaveBeenCalled();
});
it('uses a private service port and awaits destruction before retiring the handle',async()=>{
 const containerFetch=vi.fn(async()=>new Response(new Uint8Array([255])));const destroy=vi.fn(async()=>{});const resolve=vi.fn(()=>({containerFetch,destroy}));
 const config={port:8080,lifecycle:{sleepAfter:'5m',keepAlive:false},transport:'http' as const};
 const driver=createContainerExecutionDriver(config,resolve);const endpoint=await driver.acquire('namespace');const request=new Request('https://media.example/v1/capabilities');
 await endpoint.fetch(request);expect(containerFetch.mock.calls[0]![0].url).toBe(request.url);expect(containerFetch.mock.calls[0]![1]).toBe(8080);await driver.acquire('namespace');expect(resolve).toHaveBeenCalledTimes(1);
 await driver.destroy('namespace');expect(destroy).toHaveBeenCalledTimes(1);await driver.acquire('namespace');expect(resolve).toHaveBeenCalledTimes(2);
});
it('retains a failed cleanup handle for an explicit retry',async()=>{
 const destroy=vi.fn().mockRejectedValueOnce(new Error('cleanup failed')).mockResolvedValueOnce(undefined);const resolve=vi.fn(()=>({containerFetch:vi.fn(),destroy}));
 const driver=createContainerExecutionDriver({port:8080,lifecycle:{sleepAfter:'5m',keepAlive:false},transport:'http'},resolve);
 await expect(driver.destroy('namespace')).rejects.toThrow('cleanup failed');await driver.destroy('namespace');expect(resolve).toHaveBeenCalledTimes(1);
});
it('does not let a retained endpoint restart a destroyed container',async()=>{
 const containerFetch=vi.fn(async()=>new Response());
 const driver=createContainerExecutionDriver({port:8080,lifecycle:{sleepAfter:'5m',keepAlive:false},transport:'http'},()=>({containerFetch,destroy:vi.fn(async()=>{})}));
 const endpoint=await driver.acquire('tenant');
 await driver.destroy('tenant');
 await expect(endpoint.fetch(new Request('https://media.example/v1/jobs'))).rejects.toThrow('Container endpoint retired');
 expect(containerFetch).not.toHaveBeenCalled();
});
it('settles concurrent cleanup once and delays reacquisition until destruction completes',async()=>{
 let finish!:()=>void;
 const destroy=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const resolve=vi.fn(()=>({containerFetch:vi.fn(),destroy}));
 const driver=createContainerExecutionDriver({port:8080,lifecycle:{sleepAfter:'5m',keepAlive:false},transport:'http'},resolve);
 const endpoint=await driver.acquire('tenant');
 const first=driver.destroy('tenant');const second=driver.destroy('tenant');
 const acquired=vi.fn();const next=driver.acquire('tenant').then(acquired);
 await Promise.resolve();
 expect(acquired).not.toHaveBeenCalled();expect(destroy).toHaveBeenCalledTimes(1);
 await expect(endpoint.fetch(new Request('https://media.example/v1/jobs'))).rejects.toThrow('Container endpoint retired');
 finish();await Promise.all([first,second,next]);
 expect(resolve).toHaveBeenCalledTimes(2);expect(acquired).toHaveBeenCalledTimes(1);
});
it('quarantines a failed destruction until explicit cleanup succeeds',async()=>{
 const containerFetch=vi.fn(async()=>new Response());
 const destroy=vi.fn().mockRejectedValueOnce(new Error('cleanup failed')).mockResolvedValueOnce(undefined);
 const resolve=vi.fn(()=>({containerFetch,destroy}));
 const driver=createContainerExecutionDriver({port:8080,lifecycle:{sleepAfter:'5m',keepAlive:false},transport:'http'},resolve);
 const endpoint=await driver.acquire('tenant');
 await expect(driver.destroy('tenant')).rejects.toThrow('cleanup failed');
 await expect(driver.acquire('tenant')).rejects.toThrow('Container endpoint retired');
 await expect(endpoint.fetch(new Request('https://media.example/v1/jobs'))).rejects.toThrow('Container endpoint retired');
 expect(resolve).toHaveBeenCalledTimes(1);expect(containerFetch).not.toHaveBeenCalled();
 await driver.destroy('tenant');await driver.acquire('tenant');
 expect(resolve).toHaveBeenCalledTimes(2);
});
it('forwards binary request and response streams and canonical headers unchanged',async()=>{
 const input=new Uint8Array([0,255,128,10]);const output=new Uint8Array([254,0,129]);
 const fetch=vi.fn(async(request:Request)=>{expect(new Uint8Array(await request.arrayBuffer())).toEqual(input);expect(request.headers.get('Execution-Epoch')).toBe('epoch');return new Response(output,{headers:{'Execution-Epoch':'epoch','Content-Type':'application/octet-stream'}});});
 const acquire=vi.fn(async()=>({fetch}));const route=createRemoteExecutionRoute({authenticate:async()=>({namespaceId:'trusted',expiresAt:200}),driver:{acquire},now:()=>100});
 const response=await route.fetch(new Request('https://media.example/v1/jobs',{method:'POST',body:input,headers:{'Execution-Epoch':'epoch'}}));
 expect(new Uint8Array(await response.arrayBuffer())).toEqual(output);expect(response.headers.get('Execution-Epoch')).toBe('epoch');expect(acquire).toHaveBeenCalledWith('trusted');
});
it('refuses expired credentials and non-protocol routes without provisioning',async()=>{
 const acquire=vi.fn();const route=createRemoteExecutionRoute({authenticate:async()=>({namespaceId:'trusted',expiresAt:10}),driver:{acquire},now:()=>10});
 expect((await route.fetch(new Request('https://media.example/v1/jobs'))).status).toBe(401);
 expect((await route.fetch(new Request('https://media.example/admin/destroy'))).status).toBe(404);expect(acquire).not.toHaveBeenCalled();
});
