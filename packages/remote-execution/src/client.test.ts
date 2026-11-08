import { afterEach, expect, it, vi } from 'vitest';
import { createClient, RemoteExecutionError } from './client.js';
import { binaryContentType, encodeFrame } from './binary.js';
import { validateWire } from './wire-validation.js';
const session = {sessionId:'s',epoch:'e'};
it.each([422, 500, 503])('rejects HTTP %i failure metadata masquerading as a native tool error', async status => {
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'secret',
    fetch: async () => Response.json({ category: 'native', code: 'exit', message: 'Tool failed', phase: 'accepted' },
      { status, headers: { 'Execution-Epoch': session.epoch } }) });
  await expect(client.inspectJob(session, 'job')).rejects.toMatchObject({
    name: 'RemoteExecutionError', category: 'transport', phase: 'unknown', status: 502,
    recovery: { ...session, jobId: 'job' },
  });
});
it('preserves admitted filesystem failure metadata and local recovery authority',async()=>{
 const failure={category:'filesystem',code:'EIO',message:'malformed listing',phase:'notAccepted',path:'/work',syscall:'readdir',acknowledgedBytes:'0',recovery:{sessionId:'untrusted',epoch:'other'}};
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async()=>Response.json(failure,{status:503,headers:{'Execution-Epoch':'e'}})});
 await expect(client.listFiles(session,{namespaceId:'n',grantId:'g',path:'/work',maxEntries:1},'listing')).rejects.toMatchObject({name:'RemoteServiceError',category:'filesystem',code:'EIO',phase:'notAccepted',status:503,path:'/work',syscall:'readdir',acknowledgedBytes:'0',recovery:{...session,operationKey:'listing'}});
});
it('bounds malformed remote failure documents and keeps transport uncertainty',async()=>{
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',maxResponseBytes:64,fetch:async()=>Response.json({category:'filesystem',code:'EIO',message:'x'.repeat(1024),phase:'notAccepted'},{status:503,headers:{'Execution-Epoch':'e'}})});
 await expect(client.inspectSession(session)).rejects.toMatchObject({name:'RemoteExecutionError',category:'transport',phase:'unknown',status:503});
});
it('returns credit for accepted destination effects before reporting cancellation',async()=>{
 const limits={maxFrameBytes:64,maxControlBytes:64,channels:[2]};
 const wire=encodeFrame({kind:'data',channelId:2,sequence:1n,offset:0n,correlationId:0n,payload:Uint8Array.of(0,255)},limits);
 const acknowledgements:unknown[]=[];const events:string[]=[];const controller=new AbortController();const cause=new Error('cancel accepted write');
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async(input,init)=>{
  if(String(input).endsWith('/ack')) {
   init?.signal?.throwIfAborted();const receipt=JSON.parse(String(init?.body));
   acknowledgements.push(receipt);events.push('ack');
   return Response.json(receipt,{headers:{'Execution-Epoch':'e'}});
  }
  return new Response(wire,{headers:{'Execution-Epoch':'e','Content-Type':binaryContentType}});
 }});
 const cursor={...session,jobId:'job',laneId:'out',nextSequence:1n,offsets:new Map([[2,0n]]),endedChannels:new Set<number>()};
 await expect(client.resumeStream(cursor,limits,async()=>{events.push('accepted');controller.abort(cause);},controller.signal)).rejects.toBe(cause);
 expect(events).toEqual(['accepted','ack']);
 expect(acknowledgements).toEqual([{type:'Ack',laneId:'out',sequence:'1',offsets:[{channelId:2,offset:'2'}]}]);
 expect(cursor.nextSequence).toBe(2n);expect(cursor.offsets.get(2)).toBe(2n);
 expect(cursor).not.toHaveProperty('deliveryUnknown',true);
});
it('reports an explicitly expired retained output range as unrecoverable transport', async () => {
  const cause=Object.assign(new Error('output retention expired'),{status:410});
  const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async()=>new Response(new ReadableStream<Uint8Array>({pull(c){c.error(cause);}}, {highWaterMark:0}),{status:206,headers:{'Execution-Epoch':'e','Content-Type':'application/octet-stream','Content-Range':'bytes 0-1/2'}})});
  const response=await client.readOutputRange(session,'job','retained',0n);
  const reader=response.body!.getReader();
  await expect(reader.read()).rejects.toMatchObject({name:'UnrecoverableTransportError',category:'transport',status:410,cause,recovery:{...session,jobId:'job'}});
  reader.releaseLock();
});
it.each([410,401] as const)('preserves status %i when an attached stream expires during delivery', async status => {
  const cause=Object.assign(new Error('retained stream authority expired'),{status});
  const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async()=>new Response(new ReadableStream<Uint8Array>({pull(c){c.error(cause);}}, {highWaterMark:0}),{headers:{'Execution-Epoch':'e','Content-Type':binaryContentType}})});
  const cursor={...session,jobId:'job',laneId:'out',nextSequence:1n,offsets:new Map([[2,0n]]),endedChannels:new Set<number>()};
  const consume=vi.fn();
  await expect(client.resumeStream(cursor,{maxFrameBytes:64,maxControlBytes:64,channels:[2]},consume)).rejects.toMatchObject({
    name:status===410?'UnrecoverableTransportError':'RemoteExecutionError',category:status===410?'transport':'authorization',status,cause,recovery:{...session,jobId:'job',laneId:'out',sequence:'1'},
  });
  expect(consume).not.toHaveBeenCalled();expect(cursor.nextSequence).toBe(1n);
});
it.each([
  {status:410,category:'transport',name:'UnrecoverableTransportError',phase:'unknown'},
  {status:401,category:'authorization',name:'RemoteExecutionError',phase:'notAccepted'},
  {status:503,category:'transport',name:'RemoteExecutionError',phase:'unknown'},
  {status:200,category:'transport',name:'UnrecoverableTransportError',phase:'unknown'},
])('preserves reconnect failure classification when response cleanup fails ($status)', async expected => {
  const cause = new Error('response disposal failed');
  const client = createClient({baseUrl:'https://media.test',token:async () => 'secret',fetch:async () =>
    new Response(new ReadableStream<Uint8Array>({cancel() {throw cause;}}, {highWaterMark:0}),
      {status:expected.status,headers:{'Execution-Epoch':'lost-epoch'}})});
  await expect(client.inspectJob(session,'job')).rejects.toMatchObject({
    name:expected.name,category:expected.category,phase:expected.phase,cause,
    recovery:{...session,jobId:'job'},
  });
});

it.each(['truncated','disconnected'] as const)('classifies %s retained output as transport uncertainty while preserving delivered bytes', async failure => {
  const cause = new Error('connection lost');
  let reads = 0;
  const client = createClient({baseUrl:'https://media.test',token:async () => 'secret',fetch:async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (reads++ === 0) controller.enqueue(Uint8Array.of(0,255));
      else if (failure === 'truncated') controller.close();
      else controller.error(cause);
    },
  }, {highWaterMark:0}), {status:206,headers:{'Execution-Epoch':'e','Content-Type':'application/octet-stream','Content-Range':'bytes 0-3/4'}})});
  const response = await client.readOutputRange(session,'job','retained',0n);
  const reader = response.body!.getReader();
  expect((await reader.read()).value).toEqual(Uint8Array.of(0,255));
  const error = await reader.read().catch(error => error);
  expect(error).toBeInstanceOf(RemoteExecutionError);
  expect(error).toMatchObject({category:'transport',phase:'unknown',recovery:{...session,jobId:'job'}});
  if (failure === 'disconnected') expect(error.cause).toBe(cause);
  reader.releaseLock();
});
it('preserves the delivered prefix when final acknowledgement expires and disposal fails', async () => {
  const limits = {maxFrameBytes:64,maxControlBytes:64,channels:[2]};
  const cause = new Error('expired response disposal failed');
  const wire = encodeFrame({kind:'data',channelId:2,sequence:1n,offset:0n,correlationId:0n,payload:Uint8Array.of(0,255)},limits);
  let expired = false;
  const client = createClient({baseUrl:'https://media.test',token:async () => 'secret',fetch:async (_url,init) => {
    if (init?.method === 'POST') expired = true;
    if (expired) return new Response(new ReadableStream<Uint8Array>({cancel() {throw cause;}}, {highWaterMark:0}), {status:410});
    return new Response(wire,{headers:{'Execution-Epoch':'e','Content-Type':binaryContentType}});
  }});
  const cursor = {...session,jobId:'job',laneId:'out',nextSequence:1n,offsets:new Map([[2,0n]]),endedChannels:new Set<number>()};
  const delivered:number[] = [];
  const sink = vi.fn(async (frame:import('./binary.js').BinaryFrame) => {delivered.push(...frame.payload);});
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(client.resumeStream(cursor,limits,sink)).rejects.toMatchObject({
      name:'UnrecoverableTransportError',category:'transport',code:'unrecoverable',cause,
      recovery:{jobId:'job',laneId:'out'},
      recoveryActions:['inspect','recover-partial-outputs','reauthorize','start-new-invocation'],
    });
  }
  expect(delivered).toEqual([0,255]);
  expect(sink).toHaveBeenCalledOnce();
  expect(cursor.nextSequence).toBe(2n);
  expect(cursor.offsets.get(2)).toBe(2n);
});
it('preserves invalid output range receipts when transport cancellation also fails', async () => {
  const cleanup = new Error('transport cancellation failed');
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'secret', fetch: async () =>
    new Response(new ReadableStream<Uint8Array>({ cancel() { throw cleanup; } }, { highWaterMark: 0 }), {
      status: 206, headers: { 'Execution-Epoch': 'e', 'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 0-1/4' },
    }) });
  const error = await client.readOutputRange(session, 'job', 'retained', 2n, 3n).catch(cause => cause);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors).toEqual([expect.objectContaining({ message: 'Invalid output range response' }), cleanup]);
});
it.each([1, 3])('rejects %i delivered bytes for a two-byte retained range', async length => {
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'secret', fetch: async () => new Response(new Uint8Array(length), { status: 206, headers: { 'Execution-Epoch': 'e', 'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 2-3/4' } }) });
  const response = await client.readOutputRange(session, 'job', 'retained', 2n, 3n);
  await expect(response.arrayBuffer()).rejects.toThrow('Output range');
});

it('propagates retained range consumer closure to its transport', async () => {
  const cancel = vi.fn();
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'secret', fetch: async () => new Response(new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 }), { status: 206, headers: { 'Execution-Epoch': 'e', 'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 2-3/4' } }) });
  const response = await client.readOutputRange(session, 'job', 'retained', 2n, 3n);
  await response.body!.cancel('consumer closed');
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('consumer closed'), { interval: 1 });
});

it('aborts a pending output range read and releases its transport', async () => {
  const abort = new AbortController(); const cancel = vi.fn();
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'secret', fetch: async () => new Response(new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 }), { status: 206, headers: { 'Execution-Epoch': 'e', 'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 2-3/4' } }) });
  const response = await client.readOutputRange(session, 'job', 'retained', 2n, 3n, abort.signal);
  const reader = response.body!.getReader();
  const reason = new Error('consumer interrupted');
  const pending = expect(reader.read()).rejects.toBe(reason);
  abort.abort(reason);
  await pending;
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(reason), { interval: 1 });
  reader.releaseLock();
});
it('preserves dynamic channel admission when a consumer reuses delivered control bytes', async () => {
 const limits={maxFrameBytes:256,maxControlBytes:256,channels:[2,4],maxChannels:2,validateControl:(value:unknown)=>validateWire('Control',value)};
 const frames=[
  {kind:'control' as const,channelId:0,sequence:1n,offset:0n,payload:new TextEncoder().encode(JSON.stringify({type:'ChannelOpen',channelId:4,correlationId:'0',resourceId:'output',direction:'write',seekable:false}))},
  {kind:'data' as const,channelId:4,sequence:2n,offset:0n,payload:Uint8Array.of(255)},
  {kind:'end' as const,channelId:2,sequence:3n,offset:0n,payload:new Uint8Array()},
  {kind:'end' as const,channelId:4,sequence:4n,offset:1n,payload:new Uint8Array()},
 ];
 const wire=new Uint8Array(frames.flatMap(frame=>[...encodeFrame({...frame,correlationId:0n},limits)]));
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async(_url,init)=>{
  if(init?.method==='POST'){
   const ack=JSON.parse(init.body as string);
   expect(ack.offsets).toEqual([{channelId:2,offset:'0'},{channelId:4,offset:ack.sequence==='1'?'0':'1'}]);
   return Response.json(ack,{headers:{'Execution-Epoch':'e'}});
  }
  return new Response(wire,{headers:{'Execution-Epoch':'e','Content-Type':binaryContentType}});
 }});
 const cursor={...session,jobId:'job',laneId:'out',nextSequence:1n,offsets:new Map([[2,0n]]),endedChannels:new Set<number>()};
 const delivered:number[]=[];
 await client.resumeStream(cursor,limits,async frame=>{
  if(frame.kind==='control')frame.payload.fill(0);
  else delivered.push(...frame.payload);
 });
 expect(delivered).toEqual([255]);expect(cursor.offsets).toEqual(new Map([[2,0n],[4,1n]]));expect(cursor.endedChannels).toEqual(new Set([2,4]));
});
it('retains delivered frame identity across consumer mutation and a lost acknowledgement', async () => {
 const limits={maxFrameBytes:64,maxControlBytes:64,channels:[2]}; let reads=0; let lost=false;
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async(_url,init)=>{
  if(init?.method==='POST'){
   const ack=JSON.parse(init.body as string);
   expect(ack.sequence).toBe(reads===1?'1':'2');
   expect(ack.offsets).toEqual([{channelId:2,offset:'2'}]);
   if(!lost){lost=true;throw new Error('lost acknowledgement');}
   return Response.json(ack,{headers:{'Execution-Epoch':'e'}});
  }
  reads++;expect(new Headers(init?.headers).get('Execution-Cursor')).toBe(reads===1?'1':'2');
  const frame=reads===1?{kind:'data' as const,sequence:1n,offset:0n,payload:Uint8Array.of(0,255)}:{kind:'end' as const,sequence:2n,offset:2n,payload:new Uint8Array()};
  return new Response(encodeFrame({...frame,channelId:2,correlationId:0n},limits),{headers:{'Execution-Epoch':'e','Content-Type':binaryContentType}});
 }});
 const cursor={...session,jobId:'job',laneId:'out',nextSequence:1n,offsets:new Map([[2,0n]]),endedChannels:new Set<number>()};
 const delivered:number[]=[];
 const sink=async(frame:import('./binary.js').BinaryFrame)=>{
  delivered.push(...frame.payload);
  frame.sequence=99n;frame.offset=99n;frame.channelId=3;frame.kind='control';frame.payload=new Uint8Array();
 };
 await expect(client.resumeStream(cursor,limits,sink)).rejects.toMatchObject({category:'transport'});
 expect(cursor.nextSequence).toBe(2n);expect(cursor.offsets).toEqual(new Map([[2,2n]]));
 await client.resumeStream(cursor,limits,sink);
 expect(delivered).toEqual([0,255]);expect(cursor.nextSequence).toBe(3n);expect(cursor.endedChannels).toEqual(new Set([2]));
});
it.each([0, 41])('interrupts a blocked stream after %i frame bytes without delivering or advancing its cursor', async length => {
 const limits={maxFrameBytes:64,maxControlBytes:64,channels:[2]};
 const wire=encodeFrame({kind:'data',channelId:2,sequence:1n,offset:0n,correlationId:0n,payload:Uint8Array.of(0,255)},limits);
 let waiting!:()=>void; const blocked=new Promise<void>(resolve=>{waiting=resolve;});
 let source!:ReadableStreamDefaultController<Uint8Array>; const cancel=vi.fn();
 const body=new ReadableStream<Uint8Array>({start(controller){source=controller;if(length)controller.enqueue(wire.slice(0,length));},pull(){waiting();},cancel},{highWaterMark:0});
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async()=>new Response(body,{headers:{'Execution-Epoch':'e','Content-Type':binaryContentType}})});
 const cursor={...session,jobId:'job',laneId:'out',nextSequence:1n,offsets:new Map([[2,0n]]),endedChannels:new Set<number>()};
 const controller=new AbortController(); const cause=new Error('stop waiting'); const consume=vi.fn();
 const completion=client.resumeStream(cursor,limits,consume,controller.signal).then(()=>undefined,error=>error);
 await blocked; controller.abort(cause);
 // Abort must cancel the owned reader synchronously, releasing its pending read.
 const canceled=cancel.mock.calls.length>0;if(!canceled)source.close();
 const observed=await completion;
 expect(canceled).toBe(true);expect(observed).toBe(cause);expect(cancel).toHaveBeenCalledWith(cause);
 expect(consume).not.toHaveBeenCalled();expect(cursor.nextSequence).toBe(1n);expect(cursor.offsets.get(2)).toBe(0n);
});
it('refuses duplicate server receipt keys instead of selecting the final value',async()=>{
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async()=>new Response('{"sessionId":"s","epoch":"e","epoch":"e","state":"open","leaseExpiresAt":"2026-09-15T00:00:00Z","retainedUntil":"2026-09-15T01:00:00Z","buildDigest":"'+ 'a'.repeat(64)+'","namespaceIds":["work"],"grants":[]}',{headers:{'Execution-Epoch':'e'}})});
 await expect(client.inspectSession(session)).rejects.toMatchObject({category:'transport',phase:'unknown',status:502,cause:{message:expect.stringContaining('Duplicate')}});
});
it.each(['bytes 2-8/9', 'bytes 2-1/4', 'bytes 2-3/3', 'bytes 2-garbage/4', 'bytes 2-3/*'])('rejects an invalid retained output range receipt %s and closes its body', async contentRange => {
  const cancel = vi.fn();
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'secret', fetch: async () => new Response(new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 }), { status: 206, headers: { 'Execution-Epoch': 'e', 'Content-Type': 'application/octet-stream', 'Content-Range': contentRange } }) });
  await expect(client.readOutputRange(session, 'job', 'retained', 2n, 3n)).rejects.toThrow('Invalid output range response');
  expect(cancel).toHaveBeenCalledOnce();
});
it.each([undefined, 9007199254740999n])('accepts an exact bigint suffix range with requested end %s', async end => {
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'secret', fetch: async () => new Response(Uint8Array.of(255, 0), { status: 206, headers: { 'Execution-Epoch': 'e', 'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 9007199254740993-9007199254740994/9007199254740995', 'Content-Length': '2' } }) });
  const response = await client.readOutputRange(session, 'job', 'retained', 9007199254740993n, end);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.of(255, 0));
});
it('recovers intact output before an interrupted next frame without duplicating the delivered prefix', async () => {
 const limits={maxFrameBytes:64,maxControlBytes:64,channels:[2]}; let reads=0;
 const first=encodeFrame({kind:'data',channelId:2,sequence:1n,offset:0n,correlationId:0n,payload:Uint8Array.of(0,255)},limits);
 const second=encodeFrame({kind:'data',channelId:2,sequence:2n,offset:2n,correlationId:0n,payload:Uint8Array.of(128,7)},limits);
 const end=encodeFrame({kind:'end',channelId:2,sequence:3n,offset:4n,correlationId:0n,payload:new Uint8Array()},limits);
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async(_url,init)=>{
  if(init?.method==='POST')return Response.json(JSON.parse(init.body as string),{headers:{'Execution-Epoch':'e'}});
  reads++; const body=reads===1?new Uint8Array([...first,...second.slice(0,41)]):new Uint8Array([...second,...end]);
  expect(new Headers(init?.headers).get('Execution-Cursor')).toBe(reads===1?'1':'2');
  return new Response(body,{headers:{'Execution-Epoch':'e','Content-Type':binaryContentType}});
 }});
 const cursor={...session,jobId:'job',laneId:'out',nextSequence:1n,offsets:new Map([[2,0n]]),endedChannels:new Set<number>()};
 const bytes:number[]=[];const sink=async(frame:import('./binary.js').BinaryFrame)=>{bytes.push(...frame.payload);};
 await expect(client.resumeStream(cursor,limits,sink)).rejects.toMatchObject({category:'transport',phase:'unknown'});
 expect(bytes).toEqual([0,255]); expect(cursor.nextSequence).toBe(2n);
 await client.resumeStream(cursor,limits,sink);expect(bytes).toEqual([0,255,128,7]);
});

it('retains the cause of a partial canonical write and prohibits automatic replay', async () => {
 const limits={maxFrameBytes:64,maxControlBytes:64,channels:[2]};const cause=new Error('partial write');
 const wire=encodeFrame({kind:'data',channelId:2,sequence:1n,offset:0n,correlationId:0n,payload:Uint8Array.of(0,255)},limits);
 const fetch=vi.fn(async()=>new Response(wire,{headers:{'Execution-Epoch':'e','Content-Type':binaryContentType}}));
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch});
 const cursor={...session,jobId:'job',laneId:'out',nextSequence:1n,offsets:new Map([[2,0n]]),endedChannels:new Set<number>()};
 const bytes:number[]=[]; const sink=async(frame:import('./binary.js').BinaryFrame)=>{bytes.push(frame.payload[0]);throw cause;};
 await expect(client.resumeStream(cursor,limits,sink)).rejects.toMatchObject({name:'UnrecoverableTransportError',category:'transport',cause,recovery:{sequence:'1'}});
 await expect(client.resumeStream(cursor,limits,sink)).rejects.toMatchObject({name:'UnrecoverableTransportError',category:'transport',cause});
 expect(bytes).toEqual([0]);expect(fetch).toHaveBeenCalledOnce();expect(cursor.nextSequence).toBe(1n);
});
it('reports the unsettled frame after a delivered prefix without replaying partial destination writes', async () => {
 const limits={maxFrameBytes:64,maxControlBytes:64,channels:[2]};
 const frames=[Uint8Array.of(0,255),Uint8Array.of(128,7)].map((payload,index)=>encodeFrame({kind:'data',channelId:2,sequence:BigInt(index+1),offset:BigInt(index*2),correlationId:0n,payload},limits));
 const wire=new Uint8Array(frames.reduce((size,frame)=>size+frame.length,0));wire.set(frames[0]);wire.set(frames[1],frames[0].length);
 const fetch=vi.fn(async(_url,init)=>init?.method==='POST'?Response.json(JSON.parse(init.body as string),{headers:{'Execution-Epoch':'e'}}):new Response(wire,{headers:{'Execution-Epoch':'e','Content-Type':binaryContentType}}));
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch});
 const cursor={...session,jobId:'job',laneId:'out',nextSequence:1n,offsets:new Map([[2,0n]]),endedChannels:new Set<number>()};
 const bytes:number[]=[];const cause=new Error('destination lost after one byte');
 const sink=vi.fn(async(frame:import('./binary.js').BinaryFrame)=>{if(frame.sequence===2n){bytes.push(frame.payload[0]);throw cause;}bytes.push(...frame.payload);});
 for(let attempt=0;attempt<2;attempt++)await expect(client.resumeStream(cursor,limits,sink)).rejects.toMatchObject({name:'UnrecoverableTransportError',category:'transport',phase:'unknown',cause,recovery:{sequence:'2'},recoveryActions:['inspect','recover-partial-outputs','reauthorize','start-new-invocation']});
 expect(bytes).toEqual([0,255,128]);expect(cursor.nextSequence).toBe(2n);expect(cursor.offsets.get(2)).toBe(2n);expect(sink).toHaveBeenCalledTimes(2);expect(fetch).toHaveBeenCalledTimes(2);
});
it.each(Array.from({length:44},(_,index)=>index))('reconnects an interrupted binary chunk at octet %i without delivering incomplete bytes', async cut => {
 const limits={maxFrameBytes:64,maxControlBytes:64,channels:[2]};
 const payload=Uint8Array.of(0,255,128,7);
 const data=encodeFrame({kind:'data',channelId:2,sequence:1n,offset:0n,correlationId:0n,payload},limits);
 const end=encodeFrame({kind:'end',channelId:2,sequence:2n,offset:4n,correlationId:0n,payload:new Uint8Array()},limits);
 let interrupted=true;
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async(_url,init)=>{
  if(init?.method==='POST')return Response.json(JSON.parse(init.body as string),{headers:{'Execution-Epoch':'e'}});
  expect(new Headers(init?.headers).get('Execution-Cursor')).toBe('1');
  const wire=interrupted?data.slice(0,cut):new Uint8Array([...data,...end]);interrupted=false;
  return new Response(wire,{headers:{'Execution-Epoch':'e','Content-Type':binaryContentType}});
 }});
 const cursor={...session,jobId:'job',laneId:'out',nextSequence:1n,offsets:new Map([[2,0n]]),endedChannels:new Set<number>()};
 const delivered:number[]=[];const sink=async(frame:import('./binary.js').BinaryFrame)=>{delivered.push(...frame.payload);};
 await expect(client.resumeStream(cursor,limits,sink)).rejects.toMatchObject({category:'transport',phase:'unknown',recovery:{sequence:'1'}});
 expect(delivered).toEqual([]);expect(cursor.nextSequence).toBe(1n);expect(cursor.offsets.get(2)).toBe(0n);
 await client.resumeStream(cursor,limits,sink);
 expect(delivered).toEqual([...payload]);expect(cursor.nextSequence).toBe(3n);
});
afterEach(()=>vi.unstubAllGlobals());
it.each(['upload', 'manifest'])('owns %s Buffer bytes before delayed credential acquisition', async kind => {
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  const bytes = Buffer.from(kind === 'manifest' ? '{"version":1,"capture":"observed-traversal","entries":[]}' : 'binary');
  const original = Array.from(bytes); let transferred: number[] | undefined;
  const client = createClient({ baseUrl: 'https://media.test', token: async () => { await barrier; return 'secret'; }, fetch: async (_url, init) => { transferred = Array.from(init!.body as Uint8Array); throw new Error('cut after receipt'); } });
  const pending = kind === 'manifest' ? client.putManifest(session, bytes, 'key') : client.uploadChunk(session, 'u', 0n, bytes, 'digest', 'key');
  const failure = expect(pending).rejects.toBeInstanceOf(RemoteExecutionError);
  bytes.fill(120); release(); await failure;
  expect(transferred).toEqual(original);
});
it('owns Buffer control-response fragments before requesting the next fragment', async () => {
  const bytes = Buffer.from('{"type":"Ack","laneId":"out","sequence":"1","offsets":[]}');
  const producer = Buffer.from(bytes.subarray(0, 12)); let part = 0;
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'secret', fetch: async () => new Response(new ReadableStream<Uint8Array>({ pull(controller) { if (part++ === 0) controller.enqueue(producer); else { producer.fill(120); controller.enqueue(bytes.subarray(12)); controller.close(); } } }, { highWaterMark: 0 }), { headers: { 'Execution-Epoch': 'e' } }) });
  expect(await client.ackFrames(session, 'job', 'out', { type: 'Ack', laneId: 'out', sequence: '1', offsets: [] }, 'key')).toMatchObject({ sequence: '1' });
});
it('is inert without Node globals, refuses unsafe origins and never forwards credentials through redirects',async()=>{
  // Node's undici Headers internally depends on Buffer. Supply the portable
  // platform primitive so this test measures SDK dependencies, not undici's.
  class PortableHeaders {
    values = new Map<string,string>();
    constructor(init?: PortableHeaders) { if(init) this.values = new Map(init.values); }
    set(k:string,v:string) { this.values.set(k.toLowerCase(),v); }
    get(k:string) { return this.values.get(k.toLowerCase()) ?? null; }
  }
  vi.stubGlobal('Headers',PortableHeaders);
  vi.stubGlobal('Buffer',undefined);vi.stubGlobal('process',undefined);
  for(const baseUrl of ['http://media.test','https://u:p@media.test','https://media.test/?secret=1']) expect(()=>createClient({baseUrl,token:async()=> 'secret'})).toThrow();
  const fetch=vi.fn(async (url:URL,init:RequestInit)=>{expect(url.origin).toBe('https://media.test');expect(init.redirect).toBe('error');expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret');return {ok:false,status:400,body:null} as Response;});
  const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch});await expect(client.inspectJob(session,'job')).rejects.toBeInstanceOf(RemoteExecutionError);expect(fetch).toHaveBeenCalledTimes(1);
});
it('reports dropped mutation responses with recovery identity and never auto-resubmits',async()=>{
  const cause=new Error('disconnected');const fetch=vi.fn(async()=>{throw cause;});
  const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch});
  try{await client.cancelJob(session,'job',{reason:'stop'},'cancel-key');throw new Error('Expected rejection');}
  catch(error){expect(error).toBeInstanceOf(RemoteExecutionError);expect((error as RemoteExecutionError).cause).toBe(cause);expect((error as RemoteExecutionError).recovery).toEqual({sessionId:'s',epoch:'e',jobId:'job',operationKey:'cancel-key'});expect((error as RemoteExecutionError).phase).toBe('unknown');}
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('streams arbitrary binary stdout bytes and sends bounded input DATA/END without text conversion',async()=>{
  const limits={maxFrameBytes:64,maxControlBytes:64,channels:[2]};const payload=new Uint8Array([0,255,128]);const wire=encodeFrame({kind:'data',channelId:2,sequence:1n,offset:0n,correlationId:0n,payload},limits);
  const fetch=vi.fn(async(url:URL,init:RequestInit)=>{
    if(init.method==='GET')return new Response(new ReadableStream({start(c){c.enqueue(wire.slice(0,17));c.enqueue(wire.slice(17));c.enqueue(encodeFrame({kind:'end',channelId:2,sequence:2n,offset:3n,correlationId:0n,payload:new Uint8Array()},limits));c.close();}}),{headers:{'Execution-Epoch':'e','Content-Type':binaryContentType}});
    expect(new Headers(init.headers).get('Content-Type')).toBe(binaryContentType);expect((init.body as Uint8Array)[5]).toBe(2);
    return Response.json({type:'Ack',laneId:'in',sequence:'1',offsets:[{channelId:1,offset:'0'}]},{headers:{'Execution-Epoch':'e'}});
  });
  const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch});const frames=[];
  for await(const frame of client.readFrames(session,'job','out',1n,limits))frames.push(frame);expect(frames[0].payload).toEqual(payload);
  await client.sendFrames(session,'job','in',[{kind:'end',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array()}],{...limits,channels:[1]},'input-key');
});
it('bounds control responses and refuses unexpected response fields',async()=>{
  const fetch=vi.fn(async()=>Response.json({type:'Ack',laneId:'out',sequence:'1',offsets:[],credential:'should not be accepted'},{headers:{'Execution-Epoch':'e'}}));
  const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch,maxResponseBytes:512});
  await expect(client.ackFrames(session,'job','out',{type:'Ack',laneId:'out',sequence:'1',offsets:[]},'key')).rejects.toThrow();
  const bounded=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch,maxResponseBytes:8});await expect(bounded.inspectJob(session,'job')).rejects.toThrow('bound');
});
it('reports transport EOF without channel END as unknown delivery',async()=>{
 const limits={maxFrameBytes:64,maxControlBytes:64,channels:[2]};const wire=encodeFrame({kind:'data',channelId:2,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array([1])},limits);
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async()=>new Response(wire,{headers:{'Execution-Epoch':'e','Content-Type':binaryContentType}})});
 await expect((async()=>{for await(const ignoredFrame of client.readFrames(session,'job','out',1n,limits)){void ignoredFrame;}})()).rejects.toBeInstanceOf(RemoteExecutionError);
});

it('resumes after a lost acknowledgment without delivering already written bytes again',async()=>{
 const limits={maxFrameBytes:64,maxControlBytes:64,channels:[2]};let reads=0;let ackFailed=false;
 const fetch=vi.fn(async(_url:URL,init:RequestInit)=>{
  if(init.method==='POST'){
   if(!ackFailed){ackFailed=true;throw new Error('lost ack reply');}
   return Response.json(JSON.parse(init.body as string),{headers:{'Execution-Epoch':'e'}});
  }
  reads++;const cursor=BigInt(new Headers(init.headers).get('Execution-Cursor')!);
  expect(cursor).toBe(reads===1?1n:2n);
  const data=reads===1?encodeFrame({kind:'data',channelId:2,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array([0,255])},limits):encodeFrame({kind:'end',channelId:2,sequence:2n,offset:2n,correlationId:0n,payload:new Uint8Array()},limits);
  return new Response(data,{headers:{'Execution-Epoch':'e','Content-Type':binaryContentType}});
 });
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch});
 const cursor={...session,jobId:'job',laneId:'out',nextSequence:1n,offsets:new Map([[2,0n]]),endedChannels:new Set<number>()};
 const delivered: number[]=[];const sink=async(frame:import('./binary.js').BinaryFrame)=>{delivered.push(...frame.payload);};
 await expect(client.resumeStream(cursor,limits,sink)).rejects.toBeInstanceOf(RemoteExecutionError);
 expect(cursor.nextSequence).toBe(2n);
 await client.resumeStream(cursor,limits,sink);expect(delivered).toEqual([0,255]);expect(cursor.nextSequence).toBe(3n);
});

it('preserves delivered octets when a lost ACK is followed by retention expiry', async () => {
 const limits={maxFrameBytes:64,maxControlBytes:64,channels:[2]};
 const payload=Uint8Array.of(0,255,128);
 const wire=encodeFrame({kind:'data',channelId:2,sequence:1n,offset:0n,correlationId:0n,payload},limits);
 let reads=0;let acknowledgments=0;
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async(_url,init)=>{
  if(init?.method==='POST'){
   acknowledgments++;
   if(acknowledgments===1)throw new Error('ACK reply lost');
   return new Response(null,{status:410});
  }
  reads++;
  return new Response(wire,{headers:{'Execution-Epoch':'e','Content-Type':binaryContentType}});
 }});
 const cursor={...session,jobId:'job',laneId:'out',nextSequence:1n,offsets:new Map([[2,0n]]),endedChannels:new Set<number>()};
 const delivered:number[]=[];const sink=vi.fn(async(frame:import('./binary.js').BinaryFrame)=>{delivered.push(...frame.payload);});
 await expect(client.resumeStream(cursor,limits,sink)).rejects.toMatchObject({category:'transport',phase:'unknown'});
 await expect(client.resumeStream(cursor,limits,sink)).rejects.toMatchObject({name:'UnrecoverableTransportError',category:'transport',code:'unrecoverable',recovery:{jobId:'job',laneId:'out'}});
 expect(delivered).toEqual([...payload]);expect(sink).toHaveBeenCalledTimes(1);
 expect(cursor.nextSequence).toBe(2n);expect(cursor.offsets.get(2)).toBe(3n);
 expect(reads).toBe(1);expect(acknowledgments).toBe(2);
});

it('returns an explicitly unrecoverable transport gap with recovery actions',async()=>{
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async()=>new Response(null,{status:410})});
 try{for await(const frame of client.readFrames(session,'j','l',8n,{maxFrameBytes:64,maxControlBytes:64,channels:[2]})){void frame;}throw new Error('expected gap');}
 catch(error){expect(error).toMatchObject({name:'UnrecoverableTransportError',category:'transport',code:'unrecoverable',recovery:{jobId:'j',laneId:'l',sequence:'8'},recoveryActions:['inspect','recover-partial-outputs','reauthorize','start-new-invocation']});}
});

it.each(['lane', 'sequence', 'offset'] as const)('refuses a mismatched %s acknowledgment without replaying completed delivery', async mismatch => {
 const limits={maxFrameBytes:64,maxControlBytes:64,channels:[2]};
 const wire=encodeFrame({kind:'data',channelId:2,sequence:1n,offset:0n,correlationId:0n,payload:Uint8Array.of(0,255)},limits);
 let invalid=true; let reads=0;
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async(_url,init)=>{
  if(init?.method==='POST'){
   const ack=JSON.parse(init.body as string);
   if(invalid){if(mismatch==='lane')ack.laneId='other';if(mismatch==='sequence')ack.sequence='0';if(mismatch==='offset')ack.offsets[0].offset='1';}
   return Response.json(ack,{headers:{'Execution-Epoch':'e'}});
  }
  reads++;
  return new Response(reads===1?wire:encodeFrame({kind:'end',channelId:2,sequence:2n,offset:2n,correlationId:0n,payload:new Uint8Array()},limits),{headers:{'Execution-Epoch':'e','Content-Type':binaryContentType}});
 }});
 const cursor={...session,jobId:'job',laneId:'out',nextSequence:1n,offsets:new Map([[2,0n]]),endedChannels:new Set<number>()};
 const delivered:number[]=[];const sink=async(frame:import('./binary.js').BinaryFrame)=>{delivered.push(...frame.payload);};
 await expect(client.resumeStream(cursor,limits,sink)).rejects.toMatchObject({name:'RemoteExecutionError',message:'Stream acknowledgement mismatch; inspect retained delivery before retrying',category:'transport',phase:'unknown',recovery:{jobId:'job',laneId:'out',sequence:'2'}});
 expect(cursor.nextSequence).toBe(2n);expect(delivered).toEqual([0,255]);
 invalid=false;
 await client.resumeStream(cursor,limits,sink);
 expect(delivered).toEqual([0,255]);expect(cursor.nextSequence).toBe(3n);
});

it('classifies control-body interruption as transport uncertainty with invocation identity',async()=>{
 const cause=new Error('body connection lost');
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));c.error(cause);}}),{headers:{'Execution-Epoch':'e'}})});
 await expect(client.cancelJob(session,'job',{reason:'stop'},'cancel-key')).rejects.toMatchObject({name:'RemoteExecutionError',category:'transport',phase:'unknown',cause,recovery:{jobId:'job',operationKey:'cancel-key'}});
});

it('classifies unavailable credentials before transport as authorization failure',async()=>{
 const cause=new Error('credentials expired');const fetch=vi.fn();
 const client=createClient({baseUrl:'https://media.test',token:async()=>{throw cause;},fetch});
 await expect(client.inspectJob(session,'job')).rejects.toMatchObject({name:'RemoteExecutionError',category:'authorization',phase:'notAccepted',cause,recovery:{jobId:'job'}});expect(fetch).not.toHaveBeenCalled();
});

it('preserves local cancellation reason if an interrupted polling transport returns a response',async()=>{
 const controller=new AbortController();const reason={canceled:'poll only'};
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'secret',fetch:async()=>{controller.abort(reason);return new Response(null,{status:503});}});
 await expect(client.waitJob(session,'job',controller.signal)).rejects.toBe(reason);
});

it('provides job-scoped effect inspection and retained binary range retrieval', async () => {
  const fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith('/effects')) return Response.json({ jobId: 'j', effects: [], outputs: ['a'], effectBarrier: '0', outputComplete: false, processOutcome: { kind: 'exited', exitCode: 1 } }, { headers: { 'Execution-Epoch': 'e' } });
    expect(new Headers(init?.headers).get('Range')).toBe('bytes=2-3');
    return new Response(Uint8Array.of(255, 0), { status: 206, headers: { 'Execution-Epoch': 'e', 'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 2-3/4' } });
  });
  const client = createClient({ baseUrl: 'https://example.test', token: () => 'token', fetch });
  const manifest = await client.inspectEffects({ sessionId: 's', epoch: 'e' }, 'j');
  expect(manifest.processOutcome).toEqual({ kind: 'exited', exitCode: 1 });
  const range = await client.readOutputRange({ sessionId: 's', epoch: 'e' }, 'j', 'a', 2n, 3n);
  expect(new Uint8Array(await range.arrayBuffer())).toEqual(Uint8Array.of(255, 0));
});

it('reconstructs an API-only job with no files while keeping native exit independent', async () => {
  const fetch = vi.fn(async () => Response.json({ jobId: 'j', effects: [], outputs: [], effectBarrier: '0', outputComplete: true, processOutcome: { kind: 'exited', exitCode: 1 } }, { headers: { 'Execution-Epoch': 'e' } }));
  const client = createClient({ baseUrl: 'https://example.test', token: () => 'token', fetch });
  const destination = { mkdir: vi.fn(async () => {}), open: vi.fn() };
  const result = await client.retrieveJobOutputs({ sessionId: 's', epoch: 'e' }, 'j', '/work', destination);
  expect(result.transfer.state).toBe('complete'); expect(result.processOutcome).toEqual({ kind: 'exited', exitCode: 1 });
  expect(destination.open).not.toHaveBeenCalled();
});
