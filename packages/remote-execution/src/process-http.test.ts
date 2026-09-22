import {expect,it,vi} from 'vitest';
import {toByteSource} from '@poe-code/safe-fs/core';
import {encodeFrame} from './binary.js';
import {executeRemoteProcess,type ProcessConnection} from './process.js';
import {connectHttpProcess,createProcessHttpHandler} from './process-http.js';
import {createProcessConnection} from './process-connection.js';

const identity={sessionId:'session',epoch:'epoch',jobId:'job'};
it.each([
 ['consumer',false],['consumer',true],['invocation',false],['invocation',true],
] as const)('releases the borrowed HTTP body lock when %s retirement rejects (read pending=%s)',async(retirement,pendingRead)=>{
 const f=fixture();const cause=new Error('HTTP body retirement failed');
 const cancel=vi.fn(async()=>{throw cause;});
 let reading!:()=>void;const blocked=new Promise<void>(resolve=>{reading=resolve;});
 const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(Uint8Array.of(0,255));},pull(){reading();},cancel},{highWaterMark:0});
 const transport:typeof fetch=async(input,init)=>{
  const request=new Request(input,init);
  if(request.url.endsWith('/2/frames'))return new Response(body,{headers:{'Execution-Epoch':'epoch','Content-Type':'application/vnd.poe.remote-execution.v1+octet-stream'}});
  return f.fetch(input,init);
 };
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch:transport},new AbortController().signal);
 const reader=connection.outputs.get(2)!.getReader();
 try{
  expect((await reader.read()).value).toEqual(Uint8Array.of(0,255));expect(body.locked).toBe(true);
  let read:Promise<ReadableStreamReadResult<Uint8Array>>|undefined;
  if(pendingRead){read=reader.read();void read.catch(()=>{});await blocked;}
  if(retirement==='consumer')await expect(reader.cancel()).rejects.toBe(cause);
  else await expect(connection.close()).rejects.toMatchObject({cause:{errors:[cause]}});
  await read?.catch(()=>{});
  expect(cancel).toHaveBeenCalledOnce();expect(body.locked).toBe(false);
 }finally{reader.releaseLock();await connection.close().catch(()=>{});}
 const next=fixture();await expect(executeRemoteProcess({stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}},signal:new AbortController().signal},async(_context,signal)=>connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch:next.fetch},signal))).resolves.toEqual({exitCode:42});
});
it('cannot widen native input authority by mutating the advertised channel list',async()=>{
 const f=fixture();const token=vi.fn(async()=> 'secret');const signal=new AbortController().signal;
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token,fetch:f.fetch},signal);
 const credentials=token.mock.calls.length;
 Reflect.set(connection.inputChannels!,1,4);
 const frame=encodeFrame({kind:'data',channelId:4,sequence:1n,offset:0n,correlationId:0n,payload:Uint8Array.of(7)},
  {channels:[4],maxFrameBytes:8,maxControlBytes:8});
 try{
  await expect(connection.send(4,frame,1n,signal)).rejects.toThrow('Invalid process input credit');
  expect(token.mock.calls).toHaveLength(credentials);expect(f.native.send).not.toHaveBeenCalled();
 }finally{await connection.close();}
});
it('bounds pending acknowledgement work per output without blocking sibling credit or closure',async()=>{
 const f=fixture();const token=vi.fn(async()=> 'secret');
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token,fetch:f.fetch},new AbortController().signal);
 let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
 let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});
 f.native.ack.mockImplementation(async channel=>{if(channel===2){entered();await blocked;}});
 const admitted=connection.ack(2,1n,1n);
 let duplicate:Promise<unknown>|undefined;
 try{
  await ready;const credentials=token.mock.calls.length;
  duplicate=connection.ack(2,1n,1n).then(()=>undefined,cause=>cause);
  await expect(connection.ack(3,1n,1n)).resolves.toBeUndefined();
  expect(token.mock.calls).toHaveLength(credentials+1);
  await expect(connection.closeOutput(2,new Error('closed'))).resolves.toBeUndefined();
 }finally{
  release();await admitted;
  try{await expect(connection.ack(2,2n,1n)).resolves.toBeUndefined();}finally{await connection.close();}
 }
 expect(await duplicate).toMatchObject({message:'Process control admission limit'});
});
it('refuses unadmitted output controls and invalid counters before credential acquisition',async()=>{
 const f=fixture();const token=vi.fn(async()=> 'secret');
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token,fetch:f.fetch},new AbortController().signal);
 const credentials=token.mock.calls.length;
 (connection.outputs as Map<number,ReadableStream<Uint8Array>>).set(4,lane(4,7));
 try{
  for(const channel of [1,4,NaN]){
   await expect(connection.ack(channel,1n,0n)).rejects.toThrow('Invalid process output credit');
   await expect(connection.closeOutput(channel,new Error('closed'))).rejects.toThrow('Invalid process output channel');
  }
  for(const [sequence,position] of [[0n,0n],[1n,-1n],[18446744073709551616n,0n],[1n,18446744073709551616n]])
   await expect(connection.ack(2,sequence!,position!)).rejects.toThrow('Invalid process output credit');
  expect(token.mock.calls).toHaveLength(credentials);
  expect(f.native.ack).not.toHaveBeenCalled();expect(f.native.closeOutput).not.toHaveBeenCalled();
 }finally{await connection.close();}
});
it('reserves retirement capacity while signal credentials are blocked and bounds repeated signals',async()=>{
 const f=fixture();let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});
 let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});let block=false;
 const token=vi.fn(async()=>{if(block){block=false;entered();await blocked;}return 'secret';});
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token,fetch:f.fetch},new AbortController().signal);
 block=true;const admitted=connection.signal!('SIGTERM');
 try{
  await ready;const credentials=token.mock.calls.length;
  await expect(connection.signal!('SIGINT')).rejects.toThrow('Process control admission limit');
  await expect(connection.signal!('SIGTERM',0)).rejects.toThrow('Invalid admitted signal');
  expect(token.mock.calls).toHaveLength(credentials);
  const retirement=connection.close();
  expect(f.native.signal).not.toHaveBeenCalled();
  release();await admitted;await retirement;
  expect(f.native.signal).toHaveBeenCalledOnce();expect(f.native.close).toHaveBeenCalledOnce();
 }finally{release();await admitted;await connection.close();}
});
it('pins admitted HTTP lane identities and frame credit across connection mutation',async()=>{
 const f=fixture();
 const headers={Authorization:'Bearer secret','Execution-Epoch':'epoch','Execution-Protocol':'1'};
 const url='https://process.test/v1/sessions/session/jobs/job/process/';
 const original=f.native.outputs.get(2)!;
 (f.native.outputs as Map<number,ReadableStream<Uint8Array>>).set(2,lane(2,7));
 (f.native.outputs as Map<number,ReadableStream<Uint8Array>>).set(4,lane(4,8));
 Object.defineProperties(f.native,{
  maxFrameBytes:{value:16},inputChannels:{value:[1,4]},stdinKind:{value:'descriptor'},
 });
 const metadata=await f.fetch(new Request(url+'metadata',{headers}));
 expect(await metadata.json()).toEqual({stdinKind:'pipe',maxFrameBytes:8,inputChannels:[1],outputChannels:[2,3]});
 const response=await f.fetch(new Request(url+'2/frames',{headers}));
 try{
  expect(original.locked).toBe(true);
  const reader=response.body!.getReader();
  try{expect((await reader.read()).value?.at(40)).toBe(255);}
  finally{await reader.cancel();reader.releaseLock();}
 }finally{await response.body?.cancel();}
 const wire=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array(9)},{channels:[1],maxFrameBytes:16,maxControlBytes:16});
 const upload=await f.fetch(new Request(url+'1/frames',{
  method:'POST',headers:{...headers,'Content-Type':'application/vnd.poe.remote-execution.v1+octet-stream','Execution-Offset':'9'},body:wire,
 }));
 expect(upload.status).toBe(503);expect(f.native.send).not.toHaveBeenCalled();
});
it.each([
 ['4/frames',new Uint8Array(40),'send'],
 ['4/ack',JSON.stringify({sequence:'1',offset:'0'}),'ack'],
 ['4/close-output',JSON.stringify({code:'EPIPE'}),'closeOutput'],
 ['2/frames',new Uint8Array(40),'send'],
 ['1/ack',JSON.stringify({sequence:'1',offset:'0'}),'ack'],
] as const)('refuses unadmitted descriptor route %s before invoking its operation',async(route,body,operation)=>{
 const f=fixture();const response=await f.fetch(new Request('https://process.test/v1/sessions/session/jobs/job/process/'+route,{
  method:'POST',headers:{Authorization:'Bearer secret','Execution-Epoch':'epoch','Execution-Protocol':'1','Content-Type':body instanceof Uint8Array?'application/vnd.poe.remote-execution.v1+octet-stream':'application/json','Execution-Offset':'0'},body,
 }));
 expect(response.status).toBe(404);expect(f.native[operation]).not.toHaveBeenCalled();
});
it('admits HTTP input by its actual span before copying or acquiring credentials',async()=>{
 const f=fixture();const token=vi.fn(async()=> 'secret');const signal=new AbortController().signal;
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token,fetch:f.fetch},signal);
 const frame=new Uint8Array(49);Object.defineProperty(frame,'length',{value:40});
 new DataView(frame.buffer).setUint32(12,0);
 const copy=vi.fn(()=>{throw new Error('Oversized input was copied');});
 Object.defineProperty(frame,Symbol.iterator,{value:copy});
 const calls=token.mock.calls.length;
 try {
  await expect(connection.send(1,frame,0n,signal)).rejects.toThrow('Invalid process input credit');
  expect(copy).not.toHaveBeenCalled();expect(token.mock.calls).toHaveLength(calls);
  expect(f.native.send).not.toHaveBeenCalled();
 }finally{await connection.close();}
});
it('sends the actual HTTP input span without consulting shadowed properties or iterators',async()=>{
 const f=fixture();const signal=new AbortController().signal;
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch:f.fetch},signal);
 const frame=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:Uint8Array.of(0,255)},{channels:[1],maxFrameBytes:8,maxControlBytes:8});
 const admitted=frame.slice();const shadow=vi.fn(()=>{throw new Error('Shadowed input authority');});
 for(const key of ['length','byteLength','byteOffset','buffer',Symbol.iterator])Object.defineProperty(frame,key,{get:shadow});
 try{
  await expect(connection.send(1,frame,2n,signal)).resolves.toBe(2n);
  expect(shadow).not.toHaveBeenCalled();expect(f.native.send.mock.calls[0]?.[1]).toEqual(admitted);
 }finally{await connection.close();}
});
it('retains the configured process authorization authority across requests',async()=>{
 const f=fixture();const authorize=vi.fn(async()=>false);
 const options={identity,connection:f.native,authorize,maxRequests:1};
 const handler=createProcessHttpHandler(options);
 const replacement=vi.fn(async()=>true);options.authorize=replacement;
 const response=await handler(new Request('https://process.test/v1/sessions/session/jobs/job/process/close',{
  method:'POST',headers:{'Execution-Epoch':'epoch','Execution-Protocol':'1'},
 }));
 expect(response.status).toBe(403);expect(authorize).toHaveBeenCalledOnce();
 expect(replacement).not.toHaveBeenCalled();expect(f.native.close).not.toHaveBeenCalled();
});
it('retains the SDK credential source for the admitted process lifetime',async()=>{
 const f=fixture();const token=vi.fn(async()=> 'secret');
 const options={baseUrl:'https://process.test',identity,token,fetch:f.fetch};
 const connection=await connectHttpProcess(options,new AbortController().signal);
 const replacement=vi.fn(async()=> 'wrong');options.token=replacement;
 try {
  await connection.signal!('SIGTERM');
  expect(f.native.signal).toHaveBeenCalledWith('SIGTERM',undefined,undefined);
  expect(replacement).not.toHaveBeenCalled();
 } finally {options.token=token;await connection.close();}
});
it('rejects an oversized process body span before reading its next chunk',async()=>{
 const f=fixture();const bytes=new Uint8Array(4097);Object.defineProperty(bytes,'length',{value:1});
 const pull=vi.fn((controller:ReadableStreamDefaultController<Uint8Array>)=>{
  if(pull.mock.calls.length===1)controller.enqueue(bytes);else controller.close();
 });
 const cancel=vi.fn();
 const response=await f.fetch(new Request('https://process.test/v1/sessions/session/jobs/job/process/signal',{
  method:'POST',headers:{Authorization:'Bearer secret','Execution-Epoch':'epoch','Execution-Protocol':'1'},
  body:new ReadableStream<Uint8Array>({pull,cancel},{highWaterMark:0}),duplex:'half',
 } as RequestInit));
 expect(response.status).toBe(503);expect(pull).toHaveBeenCalledOnce();
 expect(cancel).toHaveBeenCalledOnce();expect(f.native.signal).not.toHaveBeenCalled();
});
it('keeps stderr credit and stdout closure available while stdout credit acceptance stalls',async()=>{
 const f=fixture();let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 f.native.ack.mockImplementation(async channel=>{if(channel===2){entered();await pending;}});
 const handler=createProcessHttpHandler({identity,connection:f.native,authorize:async()=>true,maxRequests:1});
 const headers={'Execution-Epoch':'epoch','Execution-Protocol':'1'};
 const url='https://process.test/v1/sessions/session/jobs/job/process/';
 function acknowledgment(channel:number){return handler(new Request(url+channel+'/ack',{method:'POST',headers,body:JSON.stringify({sequence:'1',offset:'0'})}));}
 const stdout=acknowledgment(2);await ready;
 try {
  expect((await acknowledgment(2)).status).toBe(429);
  expect((await acknowledgment(3)).status).toBe(200);
  expect((await handler(new Request(url+'2/close-output',{method:'POST',headers,body:JSON.stringify({code:'EPIPE'})}))).status).toBe(200);
 } finally {release();await stdout;}
});
it('reserves bounded outcome wait capacity without consuming native input capacity',async()=>{
 const f=fixture();let finish!:()=>void;
 f.native.outcome=new Promise(resolve=>{finish=()=>resolve({kind:'exited',exitCode:42});});
 let entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});
 const handler=createProcessHttpHandler({identity,connection:f.native,authorize:async request=>{
  if(new URL(request.url).pathname.endsWith('/outcome'))entered();return true;
 },maxRequests:1});
 const headers={'Execution-Epoch':'epoch','Execution-Protocol':'1'};
 const url='https://process.test/v1/sessions/session/jobs/job/process/';
 const observation=handler(new Request(url+'outcome',{headers}));await waiting;
 try {
  expect((await handler(new Request(url+'outcome',{headers}))).status).toBe(429);
  expect((await handler(new Request(url+'metadata',{headers}))).status).toBe(200);
  const frame=encodeFrame({kind:'end',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array()},{channels:[1],maxFrameBytes:8,maxControlBytes:8});
  const response=await handler(new Request(url+'1/frames',{method:'POST',headers:{...headers,'Content-Type':'application/vnd.poe.remote-execution.v1+octet-stream','Execution-Offset':'0'},body:frame}));
  expect(response.status).toBe(200);expect(f.native.send).toHaveBeenCalledOnce();
 } finally {finish();expect((await observation).status).toBe(200);}
 expect((await handler(new Request(url+'outcome',{headers}))).status).toBe(200);
});
it('bounds reserved control capacity and releases it after a failed signal',async()=>{
 const f=fixture();let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 f.native.signal.mockImplementationOnce(async()=>{entered();await pending;throw new Error('signal rejected');});
 const handler=createProcessHttpHandler({identity,connection:f.native,authorize:async()=>true,maxRequests:1});
 const headers={'Execution-Epoch':'epoch','Execution-Protocol':'1'};
 const url='https://process.test/v1/sessions/session/jobs/job/process/';
 const signaling=handler(new Request(url+'signal',{method:'POST',headers,body:JSON.stringify({name:'SIGTERM'})}));
 await ready;
 try {
  expect((await handler(new Request(url+'close',{method:'POST',headers}))).status).toBe(429);
  expect(f.native.close).not.toHaveBeenCalled();
  expect((await handler(new Request(url+'metadata',{headers}))).status).toBe(200);
 } finally {release();expect((await signaling).status).toBe(503);}
 expect((await handler(new Request(url+'close',{method:'POST',headers}))).status).toBe(200);
 expect(f.native.close).toHaveBeenCalledOnce();
});
it.each([
 ['2/ack',{sequence:'1',offset:'2'},'ack'],
 ['2/close-output',{code:'EPIPE'},'closeOutput'],
 ['signal',{name:'SIGTERM',number:15,target:'process-group'},'signal'],
 ['close',undefined,'close'],
] as const)('keeps %s available while native input exhausts request capacity',async(route,value,method)=>{
 const f=fixture();let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 f.native.send.mockImplementation(async(_channel,_frame,position)=>{entered();await pending;return position;});
 const handler=createProcessHttpHandler({identity,connection:f.native,authorize:async()=>true,maxRequests:1});
 const headers={'Execution-Epoch':'epoch','Execution-Protocol':'1'};
 const url='https://process.test/v1/sessions/session/jobs/job/process/';
 const frame=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:Uint8Array.of(0,255)},{channels:[1],maxFrameBytes:8,maxControlBytes:8});
 const sending=handler(new Request(url+'1/frames',{method:'POST',headers:{...headers,'Content-Type':'application/vnd.poe.remote-execution.v1+octet-stream','Execution-Offset':'2'},body:frame}));
 await ready;
 try {
  expect((await handler(new Request(url+'1/frames',{method:'POST',headers:{...headers,'Content-Type':'application/vnd.poe.remote-execution.v1+octet-stream','Execution-Offset':'2'},body:frame}))).status).toBe(429);
  const response=await handler(new Request(url+route,{method:'POST',headers,body:value===undefined?undefined:JSON.stringify(value)}));
  expect(response.status).toBe(200);expect(f.native[method]).toHaveBeenCalledOnce();
 } finally {release();await sending;}
});
it('keeps descriptor input and output requests independent when stdin acceptance stalls',async()=>{
 const f=fixture();f.native.inputChannels=[1,4];let entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;});let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;});
 f.native.send.mockImplementation(async(channel,_frame,position)=>{if(channel===1){entered();await pending;}return position;});
 const handler=createProcessHttpHandler({identity,connection:f.native,authorize:async()=>true,maxRequests:1});
 const headers={'Execution-Epoch':'epoch','Execution-Protocol':'1'};
 const url='https://process.test/v1/sessions/session/jobs/job/process/';
 function upload(channelId:number){
  const frame=encodeFrame({kind:'end',channelId,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array()},{channels:[channelId],maxFrameBytes:8,maxControlBytes:8});
  return handler(new Request(url+channelId+'/frames',{method:'POST',headers:{...headers,'Content-Type':'application/vnd.poe.remote-execution.v1+octet-stream','Execution-Offset':'0'},body:frame}));
 }
 const stdin=upload(1);await ready;
 try {
  expect((await upload(4)).status).toBe(200);
  for(const channel of [2,3]){
   const response=await handler(new Request(url+channel+'/frames',{headers}));
   expect(response.status).toBe(200);await response.body?.cancel();
  }
 } finally {release();await stdin;}
});
it.each([
 ['signal', {name:'SIGTERM',number:15,target:'process-group'}, 'signal'],
 ['2/ack', {sequence:'1',offset:'2'}, 'ack'],
 ['2/close-output', {code:'EPIPE'}, 'closeOutput'],
] as const)('reauthorizes %s after a blocked control body before applying it',async(route,value,method)=>{
 const f=fixture();let authorized=true;
 let entered!:()=>void;const reading=new Promise<void>(resolve=>{entered=resolve;});
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 const authorize=vi.fn(async()=>authorized);
 const handler=createProcessHttpHandler({identity,connection:f.native,authorize,maxRequests:32});
 const body=new ReadableStream<Uint8Array>({async pull(target){
  entered();await pending;target.enqueue(new TextEncoder().encode(JSON.stringify(value)));target.close();
 }},{highWaterMark:0});
 const request=new Request(`https://process.test/v1/sessions/session/jobs/job/process/${route}`,{
  method:'POST',body,duplex:'half',headers:{'Execution-Epoch':'epoch','Execution-Protocol':'1','Content-Type':'application/json'},
 } as RequestInit);
 const response=handler(request);await reading;authorized=false;release();
 expect((await response).status).toBe(403);
 expect(f.native[method]).not.toHaveBeenCalled();
 expect(authorize).toHaveBeenCalledTimes(2);
});
it('retires a late metadata acquisition before cancellation settles',async()=>{
 const f=fixture();const controller=new AbortController();const cause=new Error('cancel metadata');
 let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 let closing!:()=>void;const retiring=new Promise<void>(resolve=>{closing=resolve;});
 let finishCleanup!:()=>void;const cleanup=new Promise<void>(resolve=>{finishCleanup=resolve;});
 f.native.close.mockImplementation(async()=>{closing();await cleanup;});
 const fetch:typeof globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init);
  const response=await f.fetch(request);
  if(request.url.endsWith('/metadata')){entered();await pending;}
  return response;
 };
 const execution=executeRemoteProcess({stdin:toByteSource(''),stdout:{async write(){throw new Error('late output');}},stderr:{async write(){throw new Error('late output');}},signal:controller.signal},async(_context,signal)=>connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch},signal));
 const rejected=expect(execution).rejects.toBe(cause);
 await ready;controller.abort(cause);
 let settled=false;void execution.catch(()=>{settled=true;});
 await new Promise<void>(resolve=>setImmediate(resolve));expect(settled).toBe(false);
 release();await retiring;
 await new Promise<void>(resolve=>setImmediate(resolve));expect(settled).toBe(false);
 finishCleanup();await rejected;expect(f.native.close).toHaveBeenCalledOnce();
 const next=fixture();const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch:next.fetch},new AbortController().signal);
 await expect(connection.outcome).resolves.toEqual({kind:'exited',exitCode:42});await connection.close();
});

it('retires an admitted process when its metadata document is interrupted',async()=>{
 const f=fixture();const cause=new Error('metadata body interrupted');
 const fetch:typeof globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init);const response=await f.fetch(request);
  if(request.url.endsWith('/metadata'))return new Response(new ReadableStream<Uint8Array>({start(target){target.error(cause);}}),{headers:{'Execution-Epoch':'epoch'}});
  return response;
 };
 await expect(connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch},new AbortController().signal)).rejects.toMatchObject({cause});
 expect(f.native.close).toHaveBeenCalledOnce();
});

it('reports cleanup uncertainty when a dispatched metadata request loses its response',async()=>{
 const f=fixture();const cause=new Error('metadata response lost');const cleanup=new Error('retirement response lost');
 const fetch:typeof globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init);
  await f.fetch(request);
  throw request.url.endsWith('/metadata')?cause:cleanup;
 };
 await expect(connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch},new AbortController().signal)).rejects.toSatisfy(error=>
  error instanceof AggregateError&&error.errors.length===2&&error.errors[0].cause===cause&&error.errors[1].cause===cleanup);
 expect(f.native.close).toHaveBeenCalledOnce();
});

it('classifies interrupted native input receipts as transport uncertainty and refuses replay', async () => {
 const f=fixture(); const cause=new Error('receipt body interrupted');
 const fetch:typeof globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init);const response=await f.fetch(request);
  if(request.method==='POST'&&request.url.endsWith('/1/frames'))return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},pull(controller){controller.error(cause);}}),{headers:{'Execution-Epoch':'epoch'}});
  return response;
 };
 const signal=new AbortController().signal;
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch},signal);
 const frame=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:Uint8Array.of(0,255)},{channels:[1],maxFrameBytes:8,maxControlBytes:8});
 try {
  await expect(connection.send(1,frame,2n,signal)).rejects.toMatchObject({category:'transport',phase:'unknown',recovery:identity,cause});
  await expect(connection.send(1,frame,2n,signal)).rejects.toMatchObject({category:'transport',phase:'unknown',recovery:identity,cause});
  expect(f.native.send).toHaveBeenCalledOnce();
 } finally {await connection.close();}
});

it('classifies interrupted output bodies as transport failures while retaining their delivered prefix', async () => {
 const f=fixture();const cause=new Error('output transport interrupted');
 const fetch:typeof globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init);
  if(request.url.endsWith('/2/frames'))return new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(Uint8Array.of(0,255));},pull(controller){controller.error(cause);}}),{headers:{'Execution-Epoch':'epoch','Content-Type':'application/vnd.poe.remote-execution.v1+octet-stream'}});
  return f.fetch(request);
 };
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch},new AbortController().signal);
 const reader=connection.outputs.get(2)!.getReader();
 try {
  expect((await reader.read()).value).toEqual(Uint8Array.of(0,255));
  await expect(reader.read()).rejects.toMatchObject({category:'transport',phase:'unknown',recovery:identity,cause});
  await expect(connection.outcome).resolves.toEqual({kind:'exited',exitCode:42});
 } finally {reader.releaseLock();await connection.close();}
});
it('owns an admitted input frame before asynchronous credential acquisition', async () => {
 const f=fixture();let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 let block=false;
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=>{if(block)await pending;return 'secret';},fetch:f.fetch},new AbortController().signal);
 const frame=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:Uint8Array.of(0,255)},{channels:[1],maxFrameBytes:8,maxControlBytes:8});
 const admitted=frame.slice();block=true;
 const sending=connection.send(1,frame,2n,new AbortController().signal);
 frame.fill(7);release();
 try {await expect(sending).resolves.toBe(2n);expect(f.native.send.mock.calls[0]?.[1]).toEqual(admitted);}
 finally {await connection.close();}
});

it('rejects input outside its bounded channel credit before transport or credential work', async () => {
 const f=fixture();const token=vi.fn(async()=> 'secret');const signal=new AbortController().signal;
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token,fetch:f.fetch},signal);
 const calls=token.mock.calls.length;
 try {
  await expect(connection.send(4,new Uint8Array(40),0n,signal)).rejects.toThrow();
  await expect(connection.send(1,new Uint8Array(49),0n,signal)).rejects.toThrow();
  expect(token.mock.calls).toHaveLength(calls);expect(f.native.send).not.toHaveBeenCalled();
 } finally {await connection.close();}
});

it('keeps input credit, offsets and EOF independent for each descriptor', async () => {
 const f=fixture([1,4]);let release!:()=>void;
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 f.native.send=vi.fn(async(channel,_frame,position)=>{if(channel===1)await blocked;return position;});
 const signal=new AbortController().signal;
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch:f.fetch},signal);
 function frame(channelId:number,kind:'data'|'end',sequence:bigint,position:bigint,payload=new Uint8Array()){
  return encodeFrame({channelId,kind,sequence,offset:position,correlationId:0n,payload},{channels:[1,4],maxFrameBytes:8,maxControlBytes:8});
 }
 const writing=connection.send(1,frame(1,'data',1n,0n,Uint8Array.of(113)),1n,signal);
 try {
  await expect(connection.send(1,frame(1,'data',1n,0n,Uint8Array.of(113)),1n,signal)).rejects.toThrow('credit');
  await expect(connection.send(4,frame(4,'data',1n,0n,Uint8Array.of(0,255)),2n,signal)).resolves.toBe(2n);
  await expect(connection.send(4,frame(4,'end',2n,2n),2n,signal)).resolves.toBe(2n);
  await expect(connection.send(4,frame(4,'data',3n,2n,Uint8Array.of(1)),3n,signal)).rejects.toThrow('credit');
  release();await expect(writing).resolves.toBe(1n);
  await expect(connection.send(1,frame(1,'end',2n,1n),1n,signal)).resolves.toBe(1n);
 } finally {release();await writing;await connection.close();}
});

it('rejects discontinuous offsets, sequences and correlations before native input', async () => {
 const f=fixture();const signal=new AbortController().signal;
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch:f.fetch},signal);
 try {
  for(const changes of [{sequence:2n},{offset:1n},{correlationId:1n}]) {
   const frame=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:Uint8Array.of(0),...changes},{channels:[1],maxFrameBytes:8,maxControlBytes:8});
   await expect(connection.send(1,frame,1n,signal)).rejects.toThrow();
  }
  expect(f.native.send).not.toHaveBeenCalled();
 } finally {await connection.close();}
});

it('does not replay native input after losing its acceptance receipt', async () => {
 const f=fixture();let lost=true;
 const fetch:typeof globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init);const response=await f.fetch(request);
  if(lost&&request.method==='POST'&&request.url.endsWith('/1/frames')){lost=false;throw new Error('accepted response lost');}
  return response;
 };
 const signal=new AbortController().signal;
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch},signal);
 const frame=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:Uint8Array.of(0,255)},{channels:[1],maxFrameBytes:8,maxControlBytes:8});
 try {
  await expect(connection.send(1,frame,2n,signal)).rejects.toMatchObject({phase:'unknown',recovery:identity});
  await expect(connection.send(1,frame,2n,signal)).rejects.toMatchObject({phase:'unknown',recovery:identity});
  expect(f.native.send).toHaveBeenCalledOnce();expect(f.native.close).not.toHaveBeenCalled();
 } finally {await connection.close();}
});
it('classifies unavailable process credentials as authorization and expired state as unrecoverable transport', async () => {
 const f=fixture(); const cause=new Error('expired credentials');
 await expect(connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=>{throw cause;},fetch:f.fetch},new AbortController().signal)).rejects.toMatchObject({category:'authorization',cause});
 expect(f.fetch).not.toHaveBeenCalled();
 await expect(connectHttpProcess({baseUrl:'https://process.test',identity:{...identity,epoch:'retired'},token:async()=> 'secret',fetch:f.fetch},new AbortController().signal)).rejects.toMatchObject({name:'UnrecoverableTransportError',category:'transport',code:'unrecoverable',recovery:{...identity,epoch:'retired'}});
});
it('preserves provider authorization failure when an error response has no epoch header', async () => {
 await expect(connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'expired',fetch:async()=>new Response(null,{status:401})},new AbortController().signal)).rejects.toMatchObject({category:'authorization',status:401});
});
function lane(channelId:number,value:number){
 return new ReadableStream<Uint8Array>({start(controller){
  const limits={channels:[channelId],maxFrameBytes:8,maxControlBytes:8};
  controller.enqueue(encodeFrame({kind:'data',channelId,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array([value])},limits));
  controller.enqueue(encodeFrame({kind:'end',channelId,sequence:2n,offset:1n,correlationId:0n,payload:new Uint8Array()},limits));controller.close();
 }});
}
function fixture(inputChannels:readonly number[]=[1]){
 const native:ProcessConnection={stdinKind:'pipe',inputChannels,maxFrameBytes:8,outputs:new Map([[2,lane(2,255)],[3,lane(3,9)]]),outcome:Promise.resolve({kind:'exited',exitCode:42}),send:vi.fn(async(_channel,_frame,offset)=>offset),ack:vi.fn(async()=>{}),closeOutput:vi.fn(async()=>{}),signal:vi.fn(),close:vi.fn(async()=>{})};
 const authorize=vi.fn(async(request:Request)=>request.headers.get('Authorization')==='Bearer secret');
 const handler=createProcessHttpHandler({identity,connection:native,authorize,maxRequests:16});
 const fetch=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>handler(new Request(input,init)));
 return{native,authorize,fetch};
}
it('uses authenticated independent binary lanes and returns credit after each canonical sink',async()=>{
 const f=fixture();let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});const stdout=vi.fn(async()=>{await blocked;});const stderr=vi.fn(async()=>{});
 const execution=executeRemoteProcess({stdin:toByteSource('q\n'),stdout:{write:stdout},stderr:{write:stderr},signal:new AbortController().signal},async(_context,signal)=>connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch:f.fetch},signal));
 await vi.waitFor(()=>expect(stderr).toHaveBeenCalledWith(new Uint8Array([9])),{interval:1});
 expect(f.native.ack).not.toHaveBeenCalledWith(2,1n,1n);expect(f.native.ack).toHaveBeenCalledWith(3,1n,1n);
 release();await expect(execution).resolves.toEqual({exitCode:42});expect(f.native.close).toHaveBeenCalledOnce();
 expect(f.authorize.mock.calls.every(([request])=>request.headers.get('Execution-Epoch')==='epoch')).toBe(true);
});
it('refuses authorization and epoch mismatch without exposing or closing the native invocation',async()=>{
 const f=fixture();
 await expect(connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'wrong',fetch:f.fetch},new AbortController().signal)).rejects.toMatchObject({status:403});
 await expect(connectHttpProcess({baseUrl:'https://process.test',identity:{...identity,epoch:'stale'},token:async()=> 'secret',fetch:f.fetch},new AbortController().signal)).rejects.toMatchObject({status:410});
 expect(f.native.close).not.toHaveBeenCalled();expect([...f.native.outputs.values()].every(stream=>!stream.locked)).toBe(true);
});
it('does not impose a control request timeout on the native process lifetime',async()=>{
 vi.useFakeTimers();try{
  const f=fixture();let finish!:(value:{kind:'exited';exitCode:number})=>void;f.native.outcome=new Promise(resolve=>{finish=resolve;});
  const abortableFetch:typeof globalThis.fetch=async(input,init)=>{
   const request=new Request(input,init);const response=f.fetch(request);
   if(!request.url.endsWith('/outcome'))return response;
   return Promise.race([response,new Promise<Response>((_,reject)=>{request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true});})]);
  };
  const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch:abortableFetch,requestTimeoutMs:5},new AbortController().signal);
  const outcome=connection.outcome;let failure:unknown;void outcome.catch(cause=>{failure=cause;});
  await vi.advanceTimersByTimeAsync(20);expect(failure).toBeUndefined();finish({kind:'exited',exitCode:42});await expect(outcome).resolves.toEqual({kind:'exited',exitCode:42});await connection.close();
 }finally{vi.useRealTimers();}
});
it('forwards a supported signal without inventing a required signal number',async()=>{
 const f=fixture();const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch:f.fetch},new AbortController().signal);
 await connection.signal!('SIGTERM');expect(f.native.signal).toHaveBeenCalledWith('SIGTERM',undefined,undefined);await connection.close();
});
it('cancels stalled credential acquisition and permits a successful subsequent invocation',async()=>{
 const f=fixture();const controller=new AbortController();const cause=new Error('cancel credentials');const token=vi.fn(async()=>new Promise<string>(()=>{}));
 const execution=executeRemoteProcess({stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}},signal:controller.signal},async(_context,signal)=>connectHttpProcess({baseUrl:'https://process.test',identity,token,fetch:f.fetch},signal));
 await vi.waitFor(()=>expect(token).toHaveBeenCalledOnce(),{interval:1});controller.abort(cause);await expect(execution).rejects.toBe(cause);expect(f.fetch).not.toHaveBeenCalled();
 const next=fixture();const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch:next.fetch},new AbortController().signal);await expect(connection.outcome).resolves.toEqual({kind:'exited',exitCode:42});await connection.close();
});
it('cancels an authenticated upload blocked on native acceptance and permits a subsequent invocation',async()=>{
 const f=fixture();const controller=new AbortController();const cause=new Error('cancel native upload');let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
 f.native.outcome=new Promise(()=>{});f.native.send=vi.fn(async(_channel,_frame,_offset,signal)=>{entered();return new Promise<bigint>((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});});
 const execution=executeRemoteProcess({stdin:toByteSource('media'),stdout:{async write(){}},stderr:{async write(){}},signal:controller.signal},async(_context,signal)=>connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch:f.fetch},signal));
 await ready;controller.abort(cause);await expect(execution).rejects.toBe(cause);expect(f.native.close).toHaveBeenCalledOnce();
 const next=fixture();await expect(executeRemoteProcess({stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}},signal:new AbortController().signal},async(_context,signal)=>connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch:next.fetch},signal))).resolves.toEqual({exitCode:42});
});
it('preserves canonical credit during cancellation of an owned HTTP destination write',async()=>{
 const f=fixture();const controller=new AbortController();const cause=new Error('cancel delivered bytes');let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});const events:string[]=[];
 f.native.ack=vi.fn(async(channel)=>{if(channel===2)events.push('ack');});f.native.close=vi.fn(async()=>{events.push('close');});
 const write=vi.fn(async()=>{await pending;events.push('write');});
 const execution=executeRemoteProcess({stdin:toByteSource(''),stdout:{write,ownedOutput:{consumerClosed:new AbortController().signal,write}},stderr:{async write(){}},signal:controller.signal},async(_context,signal)=>connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch:f.fetch},signal));
 await vi.waitFor(()=>expect(write).toHaveBeenCalledOnce(),{interval:1});controller.abort(cause);release();await expect(execution).rejects.toBe(cause);expect(events).toEqual(['write','ack','close']);
});
it('retains actual native frame credit when HTTP cancellation precedes canonical write completion',async()=>{
 let streams!:import('./native-process.js').ProcessStreams;
 const native=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},{launch(_spec,output){streams=output;return{
  exit:Promise.resolve({kind:'exited',exitCode:42}),settled:Promise.resolve(),async write(){},async end(){},signal(){},closeOutput(){},
 };}});
 const ack=vi.spyOn(native,'ack');const closed=vi.spyOn(native,'close');
 const handler=createProcessHttpHandler({identity,connection:native,authorize:async()=>true,maxRequests:16});
 const fetch:typeof globalThis.fetch=async(input,init)=>handler(new Request(input,init));
 const controller=new AbortController();const cause=new Error('cancel owned delivery');
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 const write=vi.fn(async()=>{await pending;});
 const emission=streams.output(2,new Uint8Array([0,255]));void emission.catch(()=>{});
 const execution=executeRemoteProcess({stdin:toByteSource(''),stdout:{write,ownedOutput:{consumerClosed:new AbortController().signal,write}},stderr:{async write(){}},signal:controller.signal},async(_context,signal)=>connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch},signal));
 await vi.waitFor(()=>expect(write).toHaveBeenCalledOnce(),{interval:1});
 controller.abort(cause);await new Promise<void>(resolve=>setImmediate(resolve));
 expect(closed).not.toHaveBeenCalled();release();await expect(execution).rejects.toBe(cause);
 expect(ack).toHaveBeenCalledWith(2,1n,2n);await expect(ack.mock.results[0]!.value).resolves.toBeUndefined();
});
it('preserves native input EPIPE across HTTP while leaving stderr available',async()=>{
 const f=fixture();f.native.send=vi.fn(async()=>{throw Object.assign(new Error('native stdin closed'),{code:'EPIPE'});});
 const signal=new AbortController().signal;const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch:f.fetch},signal);
 const wire=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array([1])},{channels:[1],maxFrameBytes:8,maxControlBytes:8});
 await expect(connection.send(1,wire,1n,signal)).rejects.toMatchObject({code:'EPIPE'});
 expect(f.native.close).not.toHaveBeenCalled();const stderr=connection.outputs.get(3)!.getReader();expect((await stderr.read()).done).toBe(false);await stderr.cancel();stderr.releaseLock();await connection.close();
});
it('drains a late output body acquisition and suppresses delivery after transport close',async()=>{
 const f=fixture();let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});let canceled=false;
 const fetch:typeof globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init);if(!request.url.endsWith('/2/frames'))return f.fetch(request);
  entered();await pending;return new Response(new ReadableStream<Uint8Array>({cancel(){canceled=true;}}),{headers:{'Execution-Epoch':'epoch','Content-Type':'application/vnd.poe.remote-execution.v1+octet-stream'}});
 };
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch},new AbortController().signal);
 const reader=connection.outputs.get(2)!.getReader();const read=reader.read();void read.catch(()=>{});await ready;
 let closed=false;const closing=connection.close().then(()=>{closed=true;});await new Promise<void>(resolve=>setImmediate(resolve));expect(closed).toBe(false);
 release();await closing;expect(canceled).toBe(true);await expect(read).rejects.toThrow('finalized');reader.releaseLock();
});
it('drains and cancels a late native-outcome body before transport cleanup settles',async()=>{
 const f=fixture();let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});const cancel=vi.fn();
 const fetch:typeof globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init);if(!request.url.endsWith('/outcome'))return f.fetch(request);
  entered();await pending;return new Response(new ReadableStream<Uint8Array>({cancel}),{headers:{'Execution-Epoch':'epoch'}});
 };
 const connection=await connectHttpProcess({baseUrl:'https://process.test',identity,token:async()=> 'secret',fetch},new AbortController().signal);
 await ready;let settled=false;const closing=connection.close().then(()=>{settled=true;});
 await new Promise<void>(resolve=>setImmediate(resolve));
 try {expect(settled).toBe(false);}
 finally {release();await closing;}
 expect(cancel).toHaveBeenCalledOnce();
});
it('releases an idle admitted server output reader when the request aborts',async()=>{
 const f=fixture();const cancel=vi.fn();f.native.outputs=new Map([[2,new ReadableStream<Uint8Array>({cancel})],[3,lane(3,9)]]);
 const handler=createProcessHttpHandler({identity,connection:f.native,authorize:f.authorize,maxRequests:16});
 const controller=new AbortController();const cause=new Error('abort idle HTTP read');
 const response=await handler(new Request('https://process.test/v1/sessions/session/jobs/job/process/2/frames',{headers:{Authorization:'Bearer secret','Execution-Epoch':'epoch','Execution-Protocol':'1'},signal:controller.signal}));
 const reader=response.body!.getReader();const read=reader.read();void read.catch(()=>{});await new Promise<void>(resolve=>setImmediate(resolve));controller.abort(cause);
 await vi.waitFor(()=>expect(cancel).toHaveBeenCalledWith(cause),{interval:1,timeout:50});await expect(read).rejects.toBe(cause);reader.releaseLock();
});
