import { expect, it, vi } from 'vitest';
import { toByteSource } from '@poe-code/safe-fs/core';
import { encodeFrame } from './binary.js';
import { executeRemoteProcess } from './process.js';

const limits = { maxFrameBytes: 8, maxControlBytes: 8, channels: [1,2,3] };
it.each([
 {kind:'exited',exitCode:256},
 {kind:'exited',exitCode:-1},
 {kind:'exited',exitCode:1.5},
 {kind:'signaled',signal:'SIGINT',signalNumber:undefined},
 {kind:'signaled',signal:'',signalNumber:2},
 {kind:'signaled',signal:'SIGINT',signalNumber:0},
])('retires idle lanes immediately for invalid native status %j',async supplied=>{
 const {connection,request}=fixture();const controller=new AbortController();
 const outputs=new Map([[2,new ReadableStream<Uint8Array>()],[3,new ReadableStream<Uint8Array>()]]);
 let settled=false;
 const execution=executeRemoteProcess({...request,signal:controller.signal},async()=>({...connection,outputs,
  outcome:Promise.resolve(supplied as import('./wire.generated.js').Outcome),
 })).then(value=>({value}),cause=>({cause}));
 void execution.then(()=>{settled=true;});
 await new Promise<void>(resolve=>setImmediate(resolve));
 const retired=connection.close.mock.calls.length;
 if(!settled)controller.abort(new Error('test teardown'));
 const observation=await execution;
 expect(retired).toBe(1);
 expect(observation).toMatchObject({cause:{message:supplied.kind==='exited'?'Invalid native exit status':'Invalid native signal observation'}});
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it('retains the native exit observation before asynchronous output can replace its status',async()=>{
 const {connection,request}=fixture();let reads=0;
 const outcome={kind:'exited' as const,get exitCode(){return ++reads===1?42:99;}};
 const projection=vi.fn(()=>130);
 await expect(executeRemoteProcess(request,async()=>({...connection,outcome:Promise.resolve(outcome)}),projection)).resolves.toEqual({exitCode:42});
 expect(reads).toBe(1);expect(projection).not.toHaveBeenCalled();
});
it('drains an admitted owned write and its canonical credit before retiring an invalid native status',async()=>{
 const {connection,request}=fixture();const events:string[]=[];
 let observe!:(outcome:import('./wire.generated.js').Outcome)=>void;
 const outcome=new Promise<import('./wire.generated.js').Outcome>(resolve=>{observe=resolve;});
 let admitted!:()=>void;const started=new Promise<void>(resolve=>{admitted=resolve;});
 let release!:()=>void;const receipt=new Promise<void>(resolve=>{release=resolve;});
 const ownedOutput={consumerClosed:new AbortController().signal,async write(){admitted();await receipt;events.push('canonical');}};
 connection.ack.mockImplementation(async()=>{events.push('ack');});
 connection.close.mockImplementation(async()=>{events.push('close');});
 const execution=executeRemoteProcess({...request,stdout:{...request.stdout,ownedOutput}},async()=>({...connection,outcome}))
  .then(value=>({value}),cause=>({cause}));
 await started;observe({kind:'exited',exitCode:256});
 await new Promise<void>(resolve=>setImmediate(resolve));
 const closedBeforeReceipt=connection.close.mock.calls.length;
 release();const observation=await execution;
 expect(closedBeforeReceipt).toBe(0);
 expect(events.indexOf('canonical')).toBeLessThan(events.lastIndexOf('ack'));
 expect(events.lastIndexOf('ack')).toBeLessThan(events.indexOf('close'));
 expect(observation).toMatchObject({cause:{message:'Invalid native exit status'}});
 expect(connection.close).toHaveBeenCalledOnce();
});
it('drains admitted canonical delivery and its credit before retiring an unknown outcome',async()=>{
 const {connection,request}=fixture();const events:string[]=[];
 let finish!:(outcome:import('./wire.generated.js').Outcome)=>void;
 const outcome=new Promise<import('./wire.generated.js').Outcome>(resolve=>{finish=resolve;});
 let admitted!:()=>void;const started=new Promise<void>(resolve=>{admitted=resolve;});
 let release!:()=>void;const receipt=new Promise<void>(resolve=>{release=resolve;});
 const ownedOutput={consumerClosed:new AbortController().signal,async write(){admitted();await receipt;events.push('canonical');}};
 connection.ack.mockImplementation(async()=>{events.push('ack');});
 connection.close.mockImplementation(async()=>{events.push('close');});
 const execution=executeRemoteProcess({...request,stdout:{...request.stdout,ownedOutput}},async()=>({...connection,outcome}))
  .then(value=>({value}),cause=>({cause}));
 await started;
 const unknown={kind:'unknown' as const,reason:'Native status lost after delivery admission'};
 finish(unknown);
 await new Promise<void>(resolve=>setImmediate(resolve));
 const closedBeforeReceipt=connection.close.mock.calls.length;
 release();const observation=await execution;
 expect(closedBeforeReceipt).toBe(0);
 expect(events.indexOf('canonical')).toBeLessThan(events.lastIndexOf('ack'));
 expect(events.lastIndexOf('ack')).toBeLessThan(events.indexOf('close'));
 expect(observation).toMatchObject({cause:{outcome:unknown}});
 expect(connection.close).toHaveBeenCalledOnce();
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it.each([
 {kind:'unknown' as const,reason:'Remote process observation unavailable'},
 {kind:'spawnError' as const,code:'ENOENT',stage:'spawn' as const,message:'Missing executable'},
])('retires idle output lanes for an unqualified $kind outcome',async outcome=>{
 const {connection,request}=fixture();const controller=new AbortController();
 const outputs=new Map([[2,new ReadableStream<Uint8Array>()],[3,new ReadableStream<Uint8Array>()]]);
 let settled=false;
 const execution=executeRemoteProcess({...request,signal:controller.signal},async()=>({...connection,outputs,outcome:Promise.resolve(outcome)}))
  .then(value=>({value}),cause=>({cause}));
 void execution.then(()=>{settled=true;});
 await new Promise<void>(resolve=>setImmediate(resolve));
 const retired=connection.close.mock.calls.length;
 if(!settled)controller.abort(new Error('test teardown'));
 const observation=await execution;
 expect(retired).toBe(1);
 expect(observation).toMatchObject({cause:{outcome,message:'Remote process did not produce a qualified shell exit status'}});
 expect(request.stdout.write).not.toHaveBeenCalled();expect(request.stderr.write).not.toHaveBeenCalled();
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it.each([new Error('remote outcome lost during descriptor admission'), 0, undefined])('retires blocked descriptor acquisition when remote outcome fails (%s)',async cause=>{
 const {connection,request}=fixture();const controller=new AbortController();
 connection.outputs.set(4,new ReadableStream<Uint8Array>());
 let rejectOutcome!:(cause:unknown)=>void;
 const outcome=new Promise<never>((_resolve,reject)=>{rejectOutcome=reject;});
 // Keep a faulty implementation's unobserved rejection inside this regression.
 void outcome.catch(()=>{});
 let acquiring!:()=>void;const admitted=new Promise<void>(resolve=>{acquiring=resolve;});
 let settled=false;
 const execution=executeRemoteProcess({...request,signal:controller.signal,
  admittedHandles:{async acquire(_fd,_rights,signal){
   acquiring();
   await new Promise<never>((_resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    if(signal.aborted)reject(signal.reason);
   });
   throw new Error('Unreachable descriptor acquisition');
  }},
 },async()=>({...connection,outcome})).then(value=>({value}),cause=>({cause}));
 void execution.then(()=>{settled=true;});
 await admitted;rejectOutcome(cause);
 await new Promise<void>(resolve=>setImmediate(resolve));
 const retired=connection.close.mock.calls.length;
 // Retire the broken implementation before assertions, without a timeout.
 if(!settled)controller.abort(new Error('test teardown'));
 const observation=await execution;
 expect(retired).toBe(1);
 expect(observation).toEqual({cause});
 expect(request.stdout.write).not.toHaveBeenCalled();expect(request.stderr.write).not.toHaveBeenCalled();
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it('attempts every descriptor release and drains siblings when one release throws synchronously',async()=>{
 const {connection,request}=fixture();
 connection.outputs.set(4,output(4,Uint8Array.of(1)));
 connection.outputs.set(5,output(5,Uint8Array.of(2)));
 const failure=new Error('descriptor release failed');
 let release!:()=>void;const drain=new Promise<void>(resolve=>{release=resolve;});
 const first=vi.fn(():Promise<void>=>{throw failure;});
 const second=vi.fn(async()=>{await drain;});
 let cleanup!:()=>Promise<void>;let settled=false;
 const execution=executeRemoteProcess({...request,registerCleanup(close){cleanup=close;},
  admittedHandles:{async acquire(fd){return{async write(bytes:Uint8Array){return bytes.length;},close:fd===3?first:second};}},
 },async()=>connection).then(value=>({value}),cause=>({cause}));
 void execution.then(()=>{settled=true;});
 await new Promise<void>(resolve=>setImmediate(resolve));
 const attempts=second.mock.calls.length;const settledBeforeDrain=settled;
 release();const observation=await execution;
 expect(attempts).toBe(1);expect(settledBeforeDrain).toBe(false);
 expect(observation).toEqual({cause:failure});
 await expect(cleanup()).rejects.toBe(failure);
 expect(first).toHaveBeenCalledOnce();expect(second).toHaveBeenCalledOnce();
 expect(connection.close).toHaveBeenCalledOnce();
 expect(request.stderr.write).toHaveBeenCalledWith(Uint8Array.of(9));
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it('preserves a transport EPIPE when destination closure races a failed lane read', async () => {
 const {connection,request}=fixture();const consumer=new AbortController();
 const transport=Object.assign(new Error('output transport interrupted'),{code:'EPIPE'});
 const pipe=Object.assign(new Error('consumer closed'),{code:'EPIPE'});
 connection.outputs.set(2,new ReadableStream<Uint8Array>({pull(controller){
  controller.error(transport);queueMicrotask(()=>consumer.abort(pipe));
 }},{highWaterMark:0}));
 const write=vi.fn(async()=>{});
 const observation=await executeRemoteProcess({...request,stdout:{write,ownedOutput:{consumerClosed:consumer.signal,write}}},async()=>connection)
  .then(value=>({value}),cause=>({cause}));
 expect(observation).toEqual({cause:transport});
 expect(write).not.toHaveBeenCalled();expect(connection.close).toHaveBeenCalledOnce();
 expect(request.stderr.write).toHaveBeenCalledWith(Uint8Array.of(9));
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it.each(['ownedOutput','write','consumerClosed'] as const)('retires idle sibling lanes when output %s admission throws',async field=>{
 const {connection,request}=fixture();
 const controller=new AbortController();const cause=new Error('output capability admission failed');
 connection.outputs.set(3,new ReadableStream<Uint8Array>());
 connection.outcome=new Promise(()=>{});
 const capability={consumerClosed:new AbortController().signal,async write(){}};
 const stdout={async write(){},ownedOutput:capability};
 Object.defineProperty(field==='ownedOutput'?stdout:capability,field,{get(){throw cause;}});
 const execution=executeRemoteProcess({...request,stdout,signal:controller.signal},async()=>connection)
  .then(value=>({value}),error=>({error}));
 await new Promise<void>(resolve=>setImmediate(resolve));
 const retired=connection.close.mock.calls.length;
 // Release even the broken implementation so the regression leaves no idle work.
 controller.abort(new Error('test teardown'));await execution;
 expect(retired).toBe(1);expect(request.stderr.write).not.toHaveBeenCalled();
 expect(await execution).toEqual({error:cause});
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it('retains a borrowed signal capability once and rechecks cancellation before subscription',async()=>{
 const {connection,request}=fixture();const controller=new AbortController();
 const cause=new Error('cancel during signal capability inspection');
 const subscribe=vi.fn(()=>vi.fn(async()=>{}));let reads=0;
 const context={...request,signal:controller.signal,get processSignals(){
  reads++;controller.abort(cause);return {subscribe};
 }};
 await expect(executeRemoteProcess(context,async()=>connection)).rejects.toBe(cause);
 expect(reads).toBe(1);expect(subscribe).not.toHaveBeenCalled();
 expect(connection.close).toHaveBeenCalledOnce();
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it('drains a signal subscription acquired during synchronous cancellation before settlement',async()=>{
 const {connection,request}=fixture();const controller=new AbortController();
 const cause=new Error('cancel during signal subscription');
 let release!:()=>void;const drain=new Promise<void>(resolve=>{release=resolve;});
 let unsubscribing!:()=>void;const started=new Promise<void>(resolve=>{unsubscribing=resolve;});
 const unsubscribe=vi.fn(async()=>{unsubscribing();await drain;});
 let cleanup:(()=>Promise<void>)|undefined;
 let settled=false;
 const execution=executeRemoteProcess({...request,signal:controller.signal,
  registerCleanup(close){cleanup=close;},
  processSignals:{subscribe(){controller.abort(cause);return unsubscribe;}},
 },async()=>connection).then(value=>({value}),error=>({error}));
 void execution.then(()=>{settled=true;});
 // Observe the race without a timer or leaving a failed test's resource idle.
 await new Promise<void>(resolve=>setImmediate(resolve));
 const calls=unsubscribe.mock.calls.length;
 const settledBeforeDrain=settled;
 release();await execution;await cleanup!();
 expect(calls).toBe(1);expect(settledBeforeDrain).toBe(false);
 await started;expect(await execution).toEqual({error:cause});
 expect(unsubscribe).toHaveBeenCalledOnce();expect(connection.close).toHaveBeenCalledOnce();
 expect(request.stdout.write).not.toHaveBeenCalled();expect(request.stderr.write).not.toHaveBeenCalled();
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it.each([false,true])('retains the admitted output writer and receiver across frames (owned=%s)',async owned=>{
 const {connection,request}=fixture();
 connection.outputs.set(2,new ReadableStream<Uint8Array>({start(controller){
  for(const [index,payload] of [Uint8Array.of(0,255),Uint8Array.of(113,10),new Uint8Array()].entries()) {
   controller.enqueue(encodeFrame({kind:index===2?'end':'data',channelId:2,sequence:BigInt(index+1),offset:BigInt(index*2),correlationId:0n,payload},limits));
  }
  controller.close();
 }}));
 const replacement=vi.fn(async()=>{throw new Error('Replacement output writer');});
 const writer={consumerClosed:new AbortController().signal,async write(bytes:Uint8Array){
  expect(this).toBe(writer);received.push(bytes.slice());writer.write=replacement;
 }};
 const received:Uint8Array[]=[];
 const stdout=owned?{write:replacement,ownedOutput:writer}:writer;
 await expect(executeRemoteProcess({...request,stdout},async()=>connection)).resolves.toEqual({exitCode:42});
 expect(received).toEqual([Uint8Array.of(0,255),Uint8Array.of(113,10)]);
 expect(replacement).not.toHaveBeenCalled();
 expect(connection.ack.mock.calls.filter(call=>(call as unknown[])[0]===2)).toHaveLength(3);
});
it.each((['stdin', 'descriptor'] as const).flatMap(route=>
 [0,1,'false',null].map(done=>({route,done})),
))('rejects malformed $route EOF ($done) without acknowledging native EOF', async ({route,done}) => {
 const {connection,request}=fixture();
 const read=vi.fn(async()=>({done,value:Uint8Array.of(113,10)}));
 const close=vi.fn(async()=>{});
 const channel=route==='stdin'?1:4;
 let exited!:(value:{kind:'exited';exitCode:number})=>void;
 const outcome=new Promise<{kind:'exited';exitCode:number}>(resolve=>{exited=resolve;});
 connection.send.mockImplementation(async(id,_wire,offset)=>{
  if(id===channel)exited({kind:'exited',exitCode:42});
  return offset;
 });
 const context=route==='stdin'
  ? {...request,stdinInput:{position:0,read:read as never}}
  : {...request,admittedHandles:{async acquire(){return{read:read as never,close};}}};
 await expect(executeRemoteProcess(context,async()=>({...connection,
  inputChannels:route==='stdin'?[1]:[1,4],outcome,
 }))).rejects.toThrow('Invalid process input read result');
 expect(connection.send.mock.calls.filter(call=>call[0]===channel)).toHaveLength(0);
 expect(connection.close).toHaveBeenCalledOnce();
 if(route==='descriptor')expect(close).toHaveBeenCalledOnce();
 const next=fixture();
 await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it.each(['data','EOF'] as const)('drains an accepted %s receipt after exit without canceling transport authority',async kind=>{
 const {connection,request}=fixture();
 let finish!:(outcome:{kind:'exited';exitCode:number})=>void;
 connection.outcome=new Promise(resolve=>{finish=resolve;});
 let receiptAborted:boolean|undefined;
 connection.send.mockImplementation(async(_channel,_frame,offset,signal)=>{
  finish({kind:'exited',exitCode:42});
  await new Promise<void>(resolve=>setImmediate(resolve));
  receiptAborted=signal.aborted;
  signal.throwIfAborted();
  return offset;
 });
 const observation=await executeRemoteProcess({...request,stdin:toByteSource(kind==='data'?Uint8Array.of(1):new Uint8Array())},async()=>connection)
  .then(value=>({value}),cause=>({cause}));
 expect(receiptAborted).toBe(false);
 expect(observation).toEqual({value:{exitCode:42}});
 expect(connection.send).toHaveBeenCalledOnce();
 expect(connection.close).toHaveBeenCalledOnce();
});
it.each([new Error('native input receipt lost'), 0, undefined])('preserves a failed input receipt after explicit native exit (%s)', async cause => {
 const {connection,request}=fixture();
 let finish!:(outcome:{kind:'exited';exitCode:number})=>void;
 connection.outcome=new Promise(resolve=>{finish=resolve;});
 connection.send.mockImplementation(async()=>{
  finish({kind:'exited',exitCode:42});
  // Native termination and the acceptance receipt are separate observations.
  // Deliver the failed receipt after the exit observer retires input reads.
  await new Promise<void>(resolve=>setImmediate(resolve));
  throw cause;
 });
 const observation=await executeRemoteProcess({...request,stdin:toByteSource(Uint8Array.of(1))},async()=>connection)
  .then(value=>({value}),cause=>({cause}));
 expect(observation).toEqual({cause});
 expect(connection.send).toHaveBeenCalledOnce();
 expect(connection.close).toHaveBeenCalledOnce();
 expect(request.stderr.write).toHaveBeenCalledWith(Uint8Array.of(9));
 const next=fixture();
 await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it.each(['stdin', 'descriptor'] as const)('admits the actual %s read span before sending any native input', async route => {
 const {connection,request}=fixture();
 const fragment=new Uint8Array(9).fill(7);
 Object.defineProperty(fragment,'length',{value:1});
 const read=vi.fn(async()=>({done:false as const,value:fragment}));
 const close=vi.fn(async()=>{});
 const context=route==='stdin'
  ? {...request,stdinInput:{position:0,read}}
  : {...request,admittedHandles:{async acquire(){return{read,close};}}};
 const remote={...connection,inputChannels:route==='stdin'?[1]:[1,4],outcome:new Promise<never>(()=>{})};
 const execution=executeRemoteProcess(context,async()=>remote);
 // Stop a faulty adapter after its first upload, instead of leaving an
 // infinitely yielding source alive when this regression fails.
 connection.send.mockImplementation(async(channel,_wire,offset)=>{
  if(channel===(route==='stdin'?1:4))throw new Error('Oversized read reached native input');
  return offset;
 });
 await expect(execution).rejects.toThrow(route==='stdin'?'Invalid stdinInput read size':'Invalid descriptor read size');
 expect(connection.send.mock.calls.filter(call=>call[0]===(route==='stdin'?1:4))).toHaveLength(0);
 if(route==='descriptor')expect(close).toHaveBeenCalledOnce();
});
it.each(['source', 'stdin', 'descriptor'] as const)('preserves actual %s bytes without consulting shadowed fragment properties', async route => {
 const {connection,request}=fixture();
 const fragment=Uint8Array.of(0,255,113,10);
 const shadow=vi.fn(()=>{throw new Error('Shadowed fragment authority');});
 for(const key of ['length','byteLength','subarray'])Object.defineProperty(fragment,key,{get:shadow});
 let reads=0;
 const read=async()=>++reads===1?{done:false as const,value:fragment}:{done:true as const,value:undefined};
 const context=route==='source'
  ? {...request,stdin:{async *[Symbol.asyncIterator](){yield fragment;}}}
  : route==='stdin'?{...request,stdinInput:{position:0,read}}
  : {...request,admittedHandles:{async acquire(){return{read,async close(){}};}}};
 let exited!:(value:{kind:'exited';exitCode:number})=>void;
 const outcome=new Promise<{kind:'exited';exitCode:number}>(resolve=>{exited=resolve;});
 const channel=route==='descriptor'?4:1;
 connection.send.mockImplementation(async(id,frame,offset)=>{
  if(id===channel&&frame[5]===2)exited({kind:'exited',exitCode:42});
  return offset;
 });
 await expect(executeRemoteProcess(context,async()=>({...connection,inputChannels:route==='descriptor'?[1,4]:[1],outcome}))).resolves.toEqual({exitCode:42});
 expect(shadow).not.toHaveBeenCalled();
 const frames=connection.send.mock.calls.filter(call=>call[0]===channel);
 expect(frames.map(call=>[call[1][5],call[2]])).toEqual([[1,4n],[2,4n]]);
 expect(frames[0]![1].subarray(40)).toEqual(Uint8Array.of(0,255,113,10));
});
it.each(['resolve','reject'])('cancels an unenrolled opaque sink without waiting for its late %s',async disposition=>{
 const {connection,request}=fixture();const controller=new AbortController();
 const cause=new Error('cancel opaque destination');
 let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
 let release!:()=>void;let reject!:(cause:unknown)=>void;
 const pending=new Promise<void>((resolve,fail)=>{release=resolve;reject=fail;});
 request.stdout.write.mockImplementation(async()=>{entered();await pending;});
 let settled=false;
 const observation=executeRemoteProcess({...request,signal:controller.signal},async()=>connection)
  .then(value=>({value}),cause=>({cause})).then(result=>{settled=true;return result;});
 await ready;controller.abort(cause);
 await new Promise<void>(resolve=>setImmediate(resolve));
 const settledBeforeOpaqueCompletion=settled;
 if(disposition==='resolve')release();else reject(new Error('late opaque failure'));
 expect(await observation).toEqual({cause});
 expect(settledBeforeOpaqueCompletion).toBe(true);
 await new Promise<void>(resolve=>setImmediate(resolve));
 expect(connection.ack).not.toHaveBeenCalledWith(2,1n,2n);
 expect(connection.close).toHaveBeenCalledOnce();
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it.each([
 {stage:'write',failure:new Error('admitted write failed')},
 {stage:'write',failure:0},
 {stage:'write',failure:undefined},
 {stage:'ack',failure:new Error('admitted ack failed')},
 {stage:'ack',failure:Object.assign(new Error('credit transport closed'),{code:'EPIPE'})},
 {stage:'ack',failure:0},
 {stage:'ack',failure:undefined},
])('preserves an admitted $stage failure when the consumer closes during its receipt ($failure)', async ({stage,failure}) => {
 const {connection,request}=fixture();const consumer=new AbortController();
 const pipe=Object.assign(new Error('consumer closed'),{code:'EPIPE'});
 let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
 let rejectReceipt!:(cause:unknown)=>void;const receipt=new Promise<void>((_resolve,reject)=>{rejectReceipt=reject;});
 const write=vi.fn(async()=>{if(stage==='write'){entered();await receipt;}});
 connection.ack.mockImplementation(async(channel?:number)=>{if(stage==='ack'&&channel===2){entered();await receipt;}});
 const execution=executeRemoteProcess({...request,stdout:{write,ownedOutput:{consumerClosed:consumer.signal,write}}},async()=>connection);
 // Observe the invocation immediately; rejection is checked after releasing
 // the admitted receipt, so no pending operation survives an assertion.
 const observation=execution.then(value=>({value}),cause=>({cause}));
 await ready;consumer.abort(pipe);rejectReceipt(failure);
 expect(await observation).toEqual({cause:failure});
 expect(request.stderr.write).toHaveBeenCalledWith(new Uint8Array([9]));
 expect(connection.close).toHaveBeenCalledOnce();
 if(stage==='write')expect(connection.ack).not.toHaveBeenCalledWith(2,1n,2n);
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it('cancels a pending native outcome after all streams end and awaits owned cleanup',async()=>{
 const {connection,request}=fixture();const controller=new AbortController();
 connection.outcome=new Promise(()=>{});
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 connection.close.mockImplementation(async()=>{await pending;});
 let settled=false;const cause=new Error('cancel native outcome read');
 const execution=executeRemoteProcess({...request,signal:controller.signal},async()=>connection);
 const rejected=expect(execution).rejects.toBe(cause).then(()=>{settled=true;});
 await vi.waitFor(()=>expect(connection.ack).toHaveBeenCalledTimes(4),{interval:1});
 await new Promise<void>(resolve=>setImmediate(resolve));controller.abort(cause);
 await vi.waitFor(()=>expect(connection.close).toHaveBeenCalledOnce(),{interval:1});
 expect(settled).toBe(false);release();await rejected;
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
},500);
it('acknowledges a successful admitted write after consumer closure without admitting later writes', async () => {
 const {connection,request}=fixture();const consumer=new AbortController();
 let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
 let release!:()=>void;const receipt=new Promise<void>(resolve=>{release=resolve;});
 const accepted:Uint8Array[]=[];
 const write=vi.fn(async(bytes:Uint8Array)=>{entered();await receipt;accepted.push(bytes.slice());});
 const execution=executeRemoteProcess({...request,stdout:{write,ownedOutput:{consumerClosed:consumer.signal,write}}},async()=>connection);
 await ready;consumer.abort(Object.assign(new Error('consumer closed'),{code:'EPIPE'}));
 const retiredBeforeReceipt=connection.close.mock.calls.length;
 release();await expect(execution).resolves.toEqual({exitCode:42});
 expect(retiredBeforeReceipt).toBe(0);
 expect(accepted).toEqual([new Uint8Array([0,255])]);
 expect(write).toHaveBeenCalledOnce();
 expect(connection.ack).toHaveBeenCalledWith(2,1n,2n);
 expect(connection.ack).not.toHaveBeenCalledWith(2,2n,2n);
 expect(request.stderr.write).toHaveBeenCalledWith(new Uint8Array([9]));
});
it('does not classify failed credit by an EPIPE reason already used by another destination', async () => {
 const {connection,request}=fixture();const consumer=new AbortController();
 const cause=Object.assign(new Error('shared pipe error'),{code:'EPIPE'});
 let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
 let rejectReceipt!:(cause:unknown)=>void;const receipt=new Promise<void>((_resolve,reject)=>{rejectReceipt=reject;});
 connection.ack.mockImplementation(async(channel?:number)=>{if(channel===2){entered();await receipt;}});
 request.stderr.write.mockRejectedValue(cause);
 const execution=executeRemoteProcess({...request,stdout:{...request.stdout,ownedOutput:{consumerClosed:consumer.signal,write:request.stdout.write}}},async()=>connection);
 const observation=execution.then(value=>({value}),cause=>({cause}));
 await ready;
 await vi.waitFor(()=>expect(connection.closeOutput).toHaveBeenCalledWith(3,cause),{interval:1});
 consumer.abort(cause);rejectReceipt(cause);
 expect(await observation).toEqual({cause});
});
it.each([
 {kind:'signaled',signal:'',signalNumber:15},
 {kind:'signaled',signal:'SIGTERM\0',signalNumber:15},
 {kind:'signaled',signal:'SIGTERM',signalNumber:0},
 {kind:'signaled',signal:'SIGTERM',signalNumber:256},
 {kind:'signaled',signal:'SIGTERM',signalNumber:1.5},
 {kind:'signaled',signal:'SIGTERM'},
])('rejects an unqualified native signal observation before shell status projection ($signal, $signalNumber)',async outcome=>{
 const {connection,request}=fixture();
 let observe!:(outcome:import('./wire.generated.js').Outcome)=>void;
 connection.outcome=new Promise(resolve=>{observe=resolve;});
 const delivered=Promise.all([request.stdout,request.stderr].map(sink=>new Promise<void>(resolve=>{
  sink.write.mockImplementation(async()=>{resolve();});
 })));
 const signalStatus=vi.fn(()=>130);
 const execution=executeRemoteProcess(request,async()=>connection,signalStatus);
 const rejected=expect(execution).rejects.toThrow('native signal');
 // Already delivered bytes survive an invalid later observation. An invalid
 // observation available at admission instead retires idle lanes immediately.
 await delivered;observe(outcome as import('./wire.generated.js').Outcome);
 await rejected;
 expect(signalStatus).not.toHaveBeenCalled();
 expect(request.stdout.write).toHaveBeenCalledWith(new Uint8Array([0,255]));
 expect(request.stderr.write).toHaveBeenCalledWith(new Uint8Array([9]));
 expect(connection.close).toHaveBeenCalledOnce();
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
for (const reason of [new Error('cancel remote process'), 0, undefined]) {
it(`reports unconfirmed cleanup while preserving cancellation (${String(reason)})`,async()=>{
 const {connection,request}=fixture();const controller=new AbortController();
 const uncertainty=Object.assign(new Error('Remote group termination unconfirmed'),{code:'termination-unconfirmed'});
 connection.outcome=new Promise(()=>{});
 const targets:ReadableStreamDefaultController<Uint8Array>[]=[];
 connection.outputs=new Map([2,3].map(channel=>[channel,new ReadableStream<Uint8Array>({start(target){targets.push(target);}})]));
 connection.close.mockImplementation(async()=>{for(const target of targets)target.error(uncertainty);throw uncertainty;});
 let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
 const onInternalError=vi.fn(async()=>{});
 const execution=executeRemoteProcess({...request,signal:controller.signal,onInternalError},async()=>{entered();return connection;});
 const rejected=expect(execution).rejects.toSatisfy(cause=>cause===controller.signal.reason);
 await ready;controller.abort(reason);await rejected;
 expect(onInternalError).toHaveBeenCalledExactlyOnceWith(uncertainty);
 expect(connection.close).toHaveBeenCalledOnce();
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
}
it('awaits the cleanup diagnostic and preserves cancellation if the host hook rejects',async()=>{
 const {connection,request}=fixture();const controller=new AbortController();
 const reason=new Error('cancel remote process');const uncertainty=new Error('remote cleanup unknown');
 connection.close.mockRejectedValue(uncertainty);
 let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 let settled=false;
 const execution=executeRemoteProcess({...request,signal:controller.signal,async onInternalError(cause){
  expect(cause).toBe(uncertainty);entered();await pending;throw new Error('diagnostic failed');
 }},async()=>{controller.abort(reason);return connection;});
 const rejected=expect(execution).rejects.toBe(reason).then(()=>{settled=true;});
 await ready;await new Promise<void>(resolve=>setImmediate(resolve));
 const settledBeforeDiagnostic=settled;release();await rejected;
 expect(settledBeforeDiagnostic).toBe(false);expect(connection.close).toHaveBeenCalledOnce();
});
for (const primary of [new Error('canonical sink failed'), 0, undefined]) {
it(`preserves the shell's primary sink failure when cleanup also fails (${String(primary)})`,async()=>{
 const {connection,request}=fixture();const uncertainty=new Error('remote cleanup unknown');
 connection.close.mockRejectedValue(uncertainty);
 const onInternalError=vi.fn(async()=>{throw new Error('diagnostic hook failed');});
 await expect(executeRemoteProcess({...request,onInternalError,stdout:{async write(){throw primary;}}},async()=>connection)).rejects.toSatisfy(cause=>cause===primary);
 expect(onInternalError).toHaveBeenCalledExactlyOnceWith(uncertainty);
 expect(connection.close).toHaveBeenCalledOnce();
});
}
it('rejects a native explicit exit when owned cleanup fails rather than reporting success',async()=>{
 const {connection,request}=fixture();const uncertainty=new Error('remote cleanup unknown');
 connection.close.mockRejectedValue(uncertainty);const onInternalError=vi.fn(async()=>{});
 await expect(executeRemoteProcess({...request,onInternalError},async()=>connection)).rejects.toBe(uncertainty);
 expect(onInternalError).not.toHaveBeenCalled();
});
it('retains both sink and cleanup observations when no shell diagnostic hook is supplied',async()=>{
 const {connection,request}=fixture();const primary=new Error('canonical sink failed');const uncertainty=new Error('remote cleanup unknown');
 connection.close.mockRejectedValue(uncertainty);
 await expect(executeRemoteProcess({...request,stdout:{async write(){throw primary;}}},async()=>connection)).rejects.toSatisfy(cause=>cause instanceof AggregateError&&cause.cause===primary&&cause.errors[0]===primary&&cause.errors[1]===uncertainty);
});
for (const cause of [Object.assign(new Error('Native group signal denied'), { code: 'EPERM' }), 0, undefined]) {
it(`preserves a rejected process-group signal (${String(cause)}) through blocked-lane retirement`,async()=>{
 const {connection,request}=fixture();
 connection.outcome=new Promise(()=>{});
 const targets:ReadableStreamDefaultController<Uint8Array>[]=[];
 connection.outputs=new Map([2,3].map(channel=>[channel,new ReadableStream<Uint8Array>({start(target){targets.push(target);}})]));
 connection.close.mockImplementation(async()=>{for(const target of targets)target.error(new Error('lane retired'));});
 const signal=vi.fn(async()=>{throw cause;});
 let accept!:(event:{name:string;number:number;target:'process-group';sequence:bigint})=>Promise<{sequence:bigint}>;
 let subscribed!:()=>void;const ready=new Promise<void>(resolve=>{subscribed=resolve;});
 const unsubscribe=vi.fn(async()=>{});
 const execution=executeRemoteProcess({...request,processSignals:{subscribe(handler){accept=handler;subscribed();return unsubscribe;}}},async()=>({...connection,signal}));
 const rejected=expect(execution).rejects.toBe(cause);
 await ready;
 await expect(accept({name:'SIGTERM',number:15,target:'process-group',sequence:1n})).rejects.toBe(cause);
 await rejected;
 expect(signal).toHaveBeenCalledWith('SIGTERM',15,'process-group');
 expect(unsubscribe).toHaveBeenCalledOnce();expect(connection.close).toHaveBeenCalledOnce();
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
}
it('drains an admitted EOF acknowledgement before retiring the transport on cancellation',async()=>{
 const {connection,request}=fixture();const controller=new AbortController();
 const events:string[]=[];let entered!:()=>void;let release!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;});
 const pending=new Promise<void>(resolve=>{release=resolve;});
 connection.outputs.set(2,new ReadableStream<Uint8Array>({start(target){
  target.enqueue(encodeFrame({kind:'end',channelId:2,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array()},limits));target.close();
 }}));
 connection.ack.mockImplementation(async(channel)=>{if(channel===2){entered();await pending;events.push('eof-ack');}});
 connection.close.mockImplementation(async()=>{events.push('transport-close');});
 const cause=new Error('cancel during EOF acknowledgement');let cleanup!:()=>Promise<void>;
 const execution=executeRemoteProcess({...request,signal:controller.signal,registerCleanup(fn){cleanup=fn;}},async()=>connection);
 const rejected=expect(execution).rejects.toBe(cause);
 await ready;controller.abort(cause);const barrier=cleanup();
 await new Promise<void>(resolve=>setImmediate(resolve));
 const retiredBeforeReceipt=events.includes('transport-close');
 release();await rejected;await barrier;
 expect(retiredBeforeReceipt).toBe(false);
 expect(events).toEqual(['eof-ack','transport-close']);
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it('registered cleanup drains an admitted stdin read and iterator finalization before returning',async()=>{
 const {connection,request}=fixture();const controller=new AbortController();
 connection.outcome=new Promise(()=>{});
 let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 const finalized=vi.fn();let cleanup!:()=>Promise<void>;
 const cause=new Error('cancel remote read');
 const stdin={async *[Symbol.asyncIterator](){try{entered();await pending;yield new Uint8Array([1]);}finally{finalized();}}};
 const execution=executeRemoteProcess({...request,stdin,signal:controller.signal,registerCleanup(fn){cleanup=fn;}},async()=>connection);
 const rejected=expect(execution).rejects.toBe(cause);
 await ready;controller.abort(cause);
 let cleaned=false;const barrier=cleanup().then(()=>{cleaned=true;});
 await new Promise<void>(resolve=>setImmediate(resolve));const returnedBeforeRead=cleaned;
 release();await rejected;await barrier;
 expect(returnedBeforeRead).toBe(false);expect(finalized).toHaveBeenCalledOnce();expect(connection.send).not.toHaveBeenCalled();
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it('refuses stdinInput bytes exceeding a borrowed read request before transport admission',async()=>{
 const {connection,request}=fixture();
 let finish!:(outcome:{kind:'exited';exitCode:number})=>void;
 connection.outcome=new Promise(resolve=>{finish=resolve;});
 connection.send.mockImplementation(async(_channel,_wire,offset)=>{finish({kind:'exited',exitCode:0});return offset;});
 const read=vi.fn().mockResolvedValueOnce({done:false,value:new Uint8Array(9)}).mockResolvedValue({done:true,value:undefined});
 await expect(executeRemoteProcess({...request,stdinInput:{position:0,read}},async()=>connection)).rejects.toThrow('stdinInput read');
 expect(read).toHaveBeenCalledWith(8,expect.any(AbortSignal));
 expect(connection.send).not.toHaveBeenCalled();
 expect(connection.close).toHaveBeenCalledOnce();
});
it('refuses a descriptor read exceeding its requested credit before sending bytes',async()=>{
 const {connection,request}=fixture();
 let finish!:(outcome:{kind:'exited';exitCode:number})=>void;
 connection.outcome=new Promise(resolve=>{finish=resolve;});
 connection.send.mockImplementation(async(channel,_wire,offset)=>{if(channel===4)finish({kind:'exited',exitCode:0});return offset;});
 const read=vi.fn().mockResolvedValueOnce({done:false,value:new Uint8Array(9)}).mockResolvedValue({done:true,value:undefined});
 const close=vi.fn(async()=>{});
 const execution=executeRemoteProcess({...request,admittedHandles:{async acquire(){return{read,close};}}},async()=>({...connection,inputChannels:[1,4]}));
 await expect(execution).rejects.toThrow('descriptor read');
 expect(read).toHaveBeenCalledWith(8,expect.any(AbortSignal));
 expect(connection.send.mock.calls.some(call=>call[0]===4)).toBe(false);
 expect(close).toHaveBeenCalledOnce();
});
it.each(['stdin', 'descriptor'] as const)('retains the single admitted %s read value before advancing its producer',async route=>{
 const {connection,request}=fixture();
 const channel=route==='stdin'?1:4;
 let finish!:(outcome:{kind:'exited';exitCode:number})=>void;
 connection.outcome=new Promise(resolve=>{finish=resolve;});
 const accepted:Uint8Array[]=[];
 connection.send.mockImplementation(async(id,wire,offset)=>{
  if(id===channel){
   if(wire[5]===2)finish({kind:'exited',exitCode:0});
   else accepted.push(wire.slice(40));
  }
  return offset;
 });
 const value=vi.fn().mockReturnValueOnce(new Uint8Array([0,255])).mockReturnValueOnce(new Uint8Array([0,255])).mockReturnValue(new Uint8Array(9).fill(7));
 const read=vi.fn().mockResolvedValueOnce({done:false,get value(){return value();}}).mockResolvedValue({done:true,value:undefined});
 const close=vi.fn(async()=>{});
 const context=route==='stdin'?{...request,stdinInput:{position:0,read}}:{...request,admittedHandles:{async acquire(){return{read,close};}}};
 await expect(executeRemoteProcess(context,async()=>({...connection,inputChannels:route==='stdin'?[1]:[1,4]}))).resolves.toEqual({exitCode:0});
 expect(value).toHaveBeenCalledOnce();
 expect(accepted).toEqual([new Uint8Array([0,255])]);
 if(route==='descriptor')expect(close).toHaveBeenCalledOnce();
});
it('keeps an empty descriptor fragment distinct from EOF and returns contiguous input credit',async()=>{
 const {connection,request}=fixture();
 let finish!:(outcome:{kind:'exited';exitCode:number})=>void;
 connection.outcome=new Promise(resolve=>{finish=resolve;});
 connection.send.mockImplementation(async(channel,wire,offset)=>{if(channel===4&&wire[5]===2)finish({kind:'exited',exitCode:0});return offset;});
 const read=vi.fn().mockResolvedValueOnce({done:false,value:new Uint8Array()}).mockResolvedValueOnce({done:false,value:new Uint8Array([0,255])}).mockResolvedValue({done:true,value:undefined});
 const close=vi.fn(async()=>{});
 await expect(executeRemoteProcess({...request,admittedHandles:{async acquire(){return{read,close};}}},async()=>({...connection,inputChannels:[1,4]}))).resolves.toEqual({exitCode:0});
 expect(connection.send.mock.calls.filter(call=>call[0]===4).map(call=>[call[1][5],call[2]])).toEqual([[1,2n],[2,2n]]);
 expect(read).toHaveBeenCalledTimes(3);
 expect(close).toHaveBeenCalledOnce();
});
function output(channelId: number, payload: Uint8Array) {
  const laneLimits={...limits,channels:[channelId]};
  return new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(encodeFrame({kind:'data',channelId,sequence:1n,offset:0n,correlationId:0n,payload},laneLimits));
    controller.enqueue(encodeFrame({kind:'end',channelId,sequence:2n,offset:BigInt(payload.length),correlationId:0n,payload:new Uint8Array()},laneLimits));
    controller.close();
  } });
}
it('retains acquired descriptor operations and their receiver through partial writes and cleanup',async()=>{
 const {connection,request}=fixture();
 connection.outputs.set(4,output(4,new Uint8Array([7,8])));
 const replacement=vi.fn(async()=>{throw new Error('Unadmitted replacement operation');});
 const close=vi.fn(async function(this:unknown){expect(this).toBe(lease);});
 const write=vi.fn(async function(this:unknown,bytes:Uint8Array){
  expect(this).toBe(lease);
  lease.write=replacement;lease.close=replacement;
  return Math.min(1,bytes.length);
 });
 const lease={write,close};
 await expect(executeRemoteProcess({...request,admittedHandles:{async acquire(){return lease;}}},async()=>connection)).resolves.toEqual({exitCode:42});
 expect(write).toHaveBeenCalledTimes(2);expect(close).toHaveBeenCalledOnce();expect(replacement).not.toHaveBeenCalled();
});
it('retains acquired descriptor reads until native EOF without substituting the source',async()=>{
 const {connection,request}=fixture();
 let finish!:(outcome:{kind:'exited';exitCode:number})=>void;
 connection.outcome=new Promise(resolve=>{finish=resolve;});
 connection.send.mockImplementation(async(channel,wire,offset)=>{
  if(channel===4&&wire[5]===2)finish({kind:'exited',exitCode:42});
  return offset;
 });
 const replacement=vi.fn(async()=>{throw new Error('Unadmitted replacement read');});
 let reads=0;
 const read=vi.fn(async function(this:unknown){
  expect(this).toBe(lease);lease.read=replacement;
  return ++reads===1?{done:false as const,value:new Uint8Array([0,255])}:{done:true as const,value:undefined};
 });
 const close=vi.fn(async()=>{});const lease={read,close};
 await expect(executeRemoteProcess({...request,admittedHandles:{async acquire(){return lease;}}},async()=>({...connection,inputChannels:[1,4]}))).resolves.toEqual({exitCode:42});
 expect(read).toHaveBeenCalledTimes(2);expect(replacement).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();
 expect(connection.send.mock.calls.filter(call=>call[0]===4).map(call=>[call[1][5],call[2]])).toEqual([[1,2n],[2,2n]]);
});
it('releases an acquired descriptor if inspection of its admitted write fails',async()=>{
 const {connection,request}=fixture();connection.outputs.set(4,output(4,new Uint8Array([7])));
 const cause=new Error('Descriptor write acquisition failed');
 const close=vi.fn(async()=>{});
 const lease={close,get write():((bytes:Uint8Array,signal:AbortSignal)=>Promise<number>){throw cause;}};
 await expect(executeRemoteProcess({...request,admittedHandles:{async acquire(){return lease;}}},async()=>connection)).rejects.toBe(cause);
 expect(close).toHaveBeenCalledOnce();expect(connection.close).toHaveBeenCalledOnce();
});
it('retains the borrowed stdinInput read operation and receiver until EOF',async()=>{
 const {connection,request}=fixture();
 let finish!:(outcome:{kind:'exited';exitCode:number})=>void;
 connection.outcome=new Promise(resolve=>{finish=resolve;});
 connection.send.mockImplementation(async(_channel,wire,offset)=>{
  if(wire[5]===2)finish({kind:'exited',exitCode:42});return offset;
 });
 const replacement=vi.fn(async()=>{throw new Error('Competing stdin cursor');});let reads=0;
 const read=vi.fn(async function(this:unknown){
  expect(this).toBe(stdinInput);stdinInput.read=replacement;
  return ++reads===1?{done:false as const,value:new Uint8Array([0,255])}:{done:true as const,value:undefined};
 });
 const stdinInput={position:0,read};
 await expect(executeRemoteProcess({...request,stdinInput},async()=>connection)).resolves.toEqual({exitCode:42});
 expect(read).toHaveBeenCalledTimes(2);expect(replacement).not.toHaveBeenCalled();
 expect(connection.send.mock.calls.map(call=>[call[1][5],call[2]])).toEqual([[1,2n],[2,2n]]);
});
function fixture() {
  const connection = {
    stdinKind: 'pipe' as const, maxFrameBytes:8,
    outputs: new Map([[2,output(2,new Uint8Array([0,255]))],[3,output(3,new Uint8Array([9]))]]),
    send:vi.fn(async (_channel: number, _wire: Uint8Array, offset: bigint, _signal:AbortSignal) => offset),
    ack:vi.fn(async()=>{}), closeOutput:vi.fn(async()=>{}),
    outcome:Promise.resolve({kind:'exited' as const,exitCode:42}),
    close:vi.fn(async()=>{}),
  };
  const request={stdin:toByteSource(new Uint8Array()),stdout:{write:vi.fn(async()=>{})},stderr:{write:vi.fn(async()=>{})},signal:new AbortController().signal};
  return {connection,request};
}
it.each(['source', 'cursor', 'descriptor'] as const)('preserves EPIPE from a borrowed %s read rather than treating it as native stdin closure', async route => {
  const { connection, request } = fixture();
  const cause = Object.assign(new Error('borrowed input failed'), { code: 'EPIPE' });
  let finish!: (outcome: {kind: 'exited'; exitCode: number}) => void;
  connection.outcome = new Promise(resolve => { finish = resolve; });
  const read = vi.fn(async (): Promise<IteratorResult<Uint8Array>> => {
    setImmediate(() => finish({ kind: 'exited', exitCode: 42 }));
    throw cause;
  });
  const close = vi.fn(async () => {});
  const context = {
    ...request,
    ...(route === 'source' ? { stdin: { [Symbol.asyncIterator]() { return { next: read }; } } } : {}),
    ...(route === 'cursor' ? { stdinInput: { position: 0, read } } : {}),
    ...(route === 'descriptor' ? { admittedHandles: { async acquire() { return { read, close }; } } } : {}),
  };
  const observed = await executeRemoteProcess(context, async () => ({ ...connection,
    ...(route === 'descriptor' ? { inputChannels: [1, 4] } : {}),
  })).then(value => ({ value }), cause => ({ cause }));
  expect(observed).toEqual({ cause });
  expect(read).toHaveBeenCalledOnce();
  expect(connection.close).toHaveBeenCalledOnce();
  if (route === 'descriptor') expect(close).toHaveBeenCalledOnce();
  const next = fixture();
  await expect(executeRemoteProcess(next.request, async () => next.connection)).resolves.toEqual({ exitCode: 42 });
});
it.each([false, true])('native input EPIPE retires its writer while preserving iterator cleanup failure=%s', async cleanupFails => {
  const { connection, request } = fixture();
  const nativePipe = Object.assign(new Error('native reader closed'), { code: 'EPIPE' });
  const cleanupPipe = Object.assign(new Error('input finalizer failed'), { code: 'EPIPE' });
  let finish!: (outcome: {kind: 'exited'; exitCode: number}) => void;
  connection.outcome = new Promise(resolve => { finish = resolve; });
  connection.send.mockImplementation(async () => {
    setImmediate(() => finish({ kind: 'exited', exitCode: 42 }));
    throw nativePipe;
  });
  const finalize = vi.fn(async () => {
    if (cleanupFails) throw cleanupPipe;
    return { done: true as const, value: undefined };
  });
  const stdin = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false as const, value: new Uint8Array([9]) }; },
    return: finalize,
  }; } };
  const observation = await executeRemoteProcess({ ...request, stdin }, async () => connection)
    .then(value => ({ value }), cause => ({ cause }));
  if (cleanupFails) {
    expect(observation).toHaveProperty('cause');
    const cause = (observation as {cause: unknown}).cause;
    if (cause instanceof AggregateError) expect(cause.errors).toContain(cleanupPipe);
    else expect(cause).toBe(cleanupPipe);
  } else expect(observation).toEqual({ value: { exitCode: 42 } });
  expect(connection.send).toHaveBeenCalledOnce();
  expect(finalize).toHaveBeenCalledOnce();
  expect(request.stderr.write).toHaveBeenCalledWith(new Uint8Array([9]));
  expect(connection.close).toHaveBeenCalledOnce();
});
it('rejects sparse input lane admission before acquiring any descriptor',async()=>{
 const {connection,request}=fixture();const acquire=vi.fn(async()=>({async close(){}}));
 const channels=[1];channels.length=2;
 await expect(executeRemoteProcess({...request,admittedHandles:{acquire}},async()=>({...connection,inputChannels:channels}))).rejects.toThrow('native input channels');
 expect(acquire).not.toHaveBeenCalled();expect(connection.send).not.toHaveBeenCalled();
 expect(connection.close).toHaveBeenCalledOnce();
});
it('retains admitted output lanes across asynchronous descriptor acquisition',async()=>{
 const {connection,request}=fixture();const admitted=output(4,new Uint8Array([7]));
 connection.outputs.set(4,admitted);const write=vi.fn(async(bytes:Uint8Array)=>bytes.length);
 const close=vi.fn(async()=>{});
 const result=await executeRemoteProcess({...request,admittedHandles:{async acquire(){
  connection.outputs.set(4,output(4,new Uint8Array([99])));
  connection.outputs.delete(3);
  return{write,close};
 }}},async()=>connection);
 expect(result).toEqual({exitCode:42});expect(write).toHaveBeenCalledWith(new Uint8Array([7]),expect.any(AbortSignal));
 expect(request.stderr.write).toHaveBeenCalledWith(new Uint8Array([9]));expect(close).toHaveBeenCalledOnce();
});
it('reads input lane entries once before deciding descriptor rights',async()=>{
 const {connection,request}=fixture();const channels=[1,4];let reads=0;
 Object.defineProperty(channels,1,{get(){return ++reads===1?4:5;}});
 let finished!:(outcome:{kind:'exited';exitCode:number})=>void;
 connection.outcome=new Promise(resolve=>{finished=resolve;});
 const ended=new Set<number>();
 connection.send.mockImplementation(async(channel,frame,offset)=>{
  if(frame[5]===2)ended.add(channel);
  if(ended.size===2)finished({kind:'exited',exitCode:0});
  return offset;
 });
 const acquire=vi.fn(async()=>({async read(){return{done:true as const,value:undefined};},async close(){}}));
 await expect(executeRemoteProcess({...request,admittedHandles:{acquire}},async()=>({...connection,inputChannels:channels}))).resolves.toEqual({exitCode:0});
 expect(reads).toBe(1);expect(acquire).toHaveBeenCalledWith(3,['read'],expect.any(AbortSignal));
 expect([...ended].sort()).toEqual([1,4]);
});
it('refuses an unknown native stdin kind before silently omitting supplied input',async()=>{
 const {connection,request}=fixture();
 const invalid={...connection,stdinKind:'unknown'} as unknown as import('./process.js').ProcessConnection;
 await expect(executeRemoteProcess({...request,stdin:toByteSource('y\n')},async()=>invalid)).rejects.toThrow('process lane admission');
 expect(connection.send).not.toHaveBeenCalled();
 expect(request.stdout.write).not.toHaveBeenCalled();
 expect(connection.close).toHaveBeenCalledOnce();
});
it('drains binary stdout/stderr separately and preserves explicit native exit status',async()=>{
 const {connection,request}=fixture();
 expect(await executeRemoteProcess(request,async()=>connection)).toEqual({exitCode:42});
 expect(request.stdout.write).toHaveBeenCalledWith(new Uint8Array([0,255]));
 expect(request.stderr.write).toHaveBeenCalledWith(new Uint8Array([9]));
 expect(connection.close).toHaveBeenCalledTimes(1);
});
it('preserves an outcome failure while retiring blocked reads and input',async()=>{
 const {connection,request}=fixture();const cause=new Error('delegate retirement unconfirmed');
 let rejectOutcome!:(cause:unknown)=>void;
 connection.outcome=new Promise((_resolve,reject)=>{rejectOutcome=reject;});
 const targets:ReadableStreamDefaultController<Uint8Array>[]=[];
 connection.outputs=new Map([2,3].map(channel=>[channel,new ReadableStream<Uint8Array>({start(target){targets.push(target);}})]));
 connection.close.mockImplementation(async()=>{for(const target of targets)target.error(new Error('lane retired'));});
 const stdin={async *[Symbol.asyncIterator](){yield new Uint8Array([1]);}};
 connection.send.mockImplementation(async(_channel,_wire,_offset,signal)=>new Promise<bigint>((_resolve,reject)=>{
  signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
 }));
 const execution=executeRemoteProcess({...request,stdin},async()=>connection);
 await vi.waitFor(()=>expect(connection.send).toHaveBeenCalledOnce(),{interval:1});
 rejectOutcome(cause);
 await expect(execution).rejects.toBe(cause);
 expect(connection.close).toHaveBeenCalledOnce();
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it('preserves an outcome failure after native stdin EOF rather than its cleanup read error',async()=>{
 const {connection,request}=fixture();const cause=new Error('delegate retirement unconfirmed');
 let rejectOutcome!:(cause:unknown)=>void;
 connection.outcome=new Promise((_resolve,reject)=>{rejectOutcome=reject;});
 const targets:ReadableStreamDefaultController<Uint8Array>[]=[];
 connection.outputs=new Map([2,3].map(channel=>[channel,new ReadableStream<Uint8Array>({start(target){targets.push(target);}})]));
 connection.close.mockImplementation(async()=>{for(const target of targets)target.error(new Error('lane retired'));});
 const execution=executeRemoteProcess(request,async()=>connection);
 await vi.waitFor(()=>expect(connection.send).toHaveBeenCalledOnce(),{interval:1});
 rejectOutcome(cause);
 await expect(execution).rejects.toBe(cause);
});
it('preserves an explicit native status after destination EPIPE instead of projecting a signal',async()=>{
 const {connection,request}=fixture();request.stdout.write.mockRejectedValue(Object.assign(new Error('closed'),{code:'EPIPE'}));const project=vi.fn(()=>141);
 await expect(executeRemoteProcess(request,async()=>connection,project)).resolves.toEqual({exitCode:42});expect(request.stderr.write).toHaveBeenCalledWith(new Uint8Array([9]));expect(project).not.toHaveBeenCalled();
});
it('keeps stderr flowing after stdout reports broken pipe and preserves native status',async()=>{
 const {connection,request}=fixture();const cause=Object.assign(new Error('closed'),{code:'EPIPE'});
 request.stdout.write.mockRejectedValue(cause);
 await expect(executeRemoteProcess(request,async()=>connection)).resolves.toEqual({exitCode:42});
 expect(connection.closeOutput).toHaveBeenCalledWith(2,cause);
 expect(request.stderr.write).toHaveBeenCalledWith(new Uint8Array([9]));
});
it('registers cleanup before acquisition and awaits acknowledged owned writes',async()=>{
 const {connection,request}=fixture();let release!:()=>void;const pending=new Promise<void>(r=>{release=r;});
 let cleanup:(()=>Promise<void>)|undefined;let acquired=false;
 const owned={consumerClosed:new AbortController().signal,write:vi.fn(async()=>{await pending;})};
 const execution=executeRemoteProcess({...request,stdout:{...request.stdout,ownedOutput:owned},registerCleanup(fn){expect(acquired).toBe(false);cleanup=fn;}},async()=>{acquired=true;return connection;});
 await vi.waitFor(()=>expect(owned.write).toHaveBeenCalled(),{interval:1});
 let finished=false;void execution.then(()=>{finished=true;});await Promise.resolve();expect(finished).toBe(false);
 release();await execution;await cleanup!();expect(connection.ack).toHaveBeenCalledWith(2,1n,2n);
});
it('refuses converting seekable redirected stdin into a native pipe',async()=>{
 const {connection,request}=fixture();
 await expect(executeRemoteProcess({...request,stdinInput:{position:0,async read(){return{done:true as const,value:undefined};},async seek(){}}},async()=>connection)).rejects.toThrow('seekable');
 expect(connection.close).toHaveBeenCalledTimes(1);
});
it('cancels blocked remote reads, preserves reason identity and permits the next invocation',async()=>{
 const {connection,request}=fixture();const controller=new AbortController();const cause=new Error('stop');
 const targets:ReadableStreamDefaultController<Uint8Array>[]=[];
 connection.outputs=new Map([2,3].map(channel=>[channel,new ReadableStream<Uint8Array>({start(target){targets.push(target);}})]));
 connection.outcome=new Promise(()=>{});
 connection.close.mockImplementation(async()=>{for(const target of targets)target.error(cause);});
 const execution=executeRemoteProcess({...request,signal:controller.signal},async()=>connection);
 await vi.waitFor(()=>expect([...connection.outputs.values()].every(stream=>stream.locked)).toBe(true),{interval:1});controller.abort(cause);
 await expect(execution).rejects.toBe(cause);
 const next=fixture();expect(await executeRemoteProcess(next.request,async()=>next.connection)).toEqual({exitCode:42});
});
it('sends bounded frames and explicit EOF only after the native input acknowledges each offset',async()=>{
 const {connection,request}=fixture();let finish!:(value:{kind:'exited';exitCode:number})=>void;
 connection.outcome=new Promise(resolve=>{finish=resolve;});
 connection.send.mockImplementation(async(_channel,wire,offset)=>{if(wire[5]===2)finish({kind:'exited',exitCode:0});return offset;});
 const result=await executeRemoteProcess({...request,stdin:toByteSource(new Uint8Array(19).fill(255))},async()=>connection);
 expect(result).toEqual({exitCode:0});expect(connection.send.mock.calls.map(call=>call[2])).toEqual([8n,16n,19n,19n]);
 expect(connection.send.mock.calls.map(call=>call[1][5])).toEqual([1,1,1,2]);
});
it('retains the admitted frame credit when the connector changes its bound during upload',async()=>{
 const {connection,request}=fixture();let finish!:(value:{kind:'exited';exitCode:number})=>void;
 connection.outcome=new Promise(resolve=>{finish=resolve;});
 connection.send.mockImplementation(async(_channel,wire,offset)=>{
  connection.maxFrameBytes=16;
  if(wire[5]===2)finish({kind:'exited',exitCode:0});
  return offset;
 });
 await expect(executeRemoteProcess({...request,stdin:toByteSource(new Uint8Array(27).fill(255))},async()=>connection)).resolves.toEqual({exitCode:0});
 expect(connection.send.mock.calls.map(call=>call[2])).toEqual([8n,16n,24n,27n,27n]);
 expect(connection.send.mock.calls.map(call=>call[1].length)).toEqual([48,48,48,43,40]);
 expect(connection.close).toHaveBeenCalledOnce();
});
it('closes a late dependency acquisition before cancellation settles and suppresses late output',async()=>{
 const {connection,request}=fixture();const controller=new AbortController();let release!:()=>void;let entered!:()=>void;
 const ready=new Promise<void>(r=>{entered=r;});const late=new Promise<void>(r=>{release=r;});const cause=new Error('cancel dependency');
 const execution=executeRemoteProcess({...request,signal:controller.signal},async()=>{entered();await late;return connection;});
 await ready;controller.abort(cause);let settled=false;void execution.catch(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
 release();await expect(execution).rejects.toBe(cause);expect(connection.close).toHaveBeenCalledTimes(1);expect(request.stdout.write).not.toHaveBeenCalled();
});
it('cancels an upload blocked on input credit and permits a subsequent invocation',async()=>{
 const {connection,request}=fixture();const controller=new AbortController();const cause=new Error('cancel upload');let entered!:()=>void;
 const ready=new Promise<void>(r=>{entered=r;});
 connection.outcome=new Promise(()=>{});
 connection.send.mockImplementation(async(_channel,_wire,_offset,signal:AbortSignal)=>{entered();return new Promise<bigint>((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});});
 const execution=executeRemoteProcess({...request,stdin:toByteSource(new Uint8Array([1])),signal:controller.signal},async()=>connection);
 await ready;controller.abort(cause);await expect(execution).rejects.toBe(cause);
 const next=fixture();expect(await executeRemoteProcess(next.request,async()=>next.connection)).toEqual({exitCode:42});
});
it('communicates owned stdout closure before any data arrives and keeps stderr available',async()=>{
 const {connection,request}=fixture();const consumer=new AbortController();const cause=Object.assign(new Error('early close'),{code:'EPIPE'});consumer.abort(cause);
 let target!:ReadableStreamDefaultController<Uint8Array>;
 connection.outputs.set(2,new ReadableStream<Uint8Array>({start(controller){target=controller;}}));
 let closed=false;connection.closeOutput.mockImplementation(async(channel)=>{if(channel===2&&!closed){closed=true;target.error(cause);}});
 await expect(executeRemoteProcess({...request,stdout:{...request.stdout,ownedOutput:{consumerClosed:consumer.signal,async write(){throw new Error('No late writes');}}}},async()=>connection)).resolves.toEqual({exitCode:42});
 expect(request.stderr.write).toHaveBeenCalledWith(new Uint8Array([9]));expect(connection.closeOutput).toHaveBeenCalledWith(2,cause);
});
it('consumes the borrowed stdinInput cursor without starting a competing source reader',async()=>{
 const {connection,request}=fixture();let finish!:(value:{kind:'exited';exitCode:number})=>void;
 connection.outcome=new Promise(resolve=>{finish=resolve;});
 connection.send.mockImplementation(async(_channel,wire,offset)=>{if(wire[5]===2)finish({kind:'exited',exitCode:0});return offset;});
 const read=vi.fn().mockResolvedValueOnce({done:false,value:new Uint8Array()}).mockResolvedValueOnce({done:false,value:new Uint8Array([7])}).mockResolvedValueOnce({done:true,value:undefined});
 const iterate=vi.fn(()=>{throw new Error('competing stdin reader');});
 await expect(executeRemoteProcess({...request,stdin:{[Symbol.asyncIterator]:iterate},stdinInput:{position:3,read}},async()=>connection)).resolves.toEqual({exitCode:0});
 expect(iterate).not.toHaveBeenCalled();expect(read).toHaveBeenCalledTimes(3);
 expect(connection.send.mock.calls.map(call=>call[2])).toEqual([1n,1n]);
});
it('finishes canonical owned delivery and its credit before retiring the transport on cancellation',async()=>{
 const {connection,request}=fixture();const controller=new AbortController();const events:string[]=[];let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;});const cause=new Error('cancel during delivery');
 const owned={consumerClosed:new AbortController().signal,write:vi.fn(async()=>{await pending;events.push('write');})};
 connection.ack.mockImplementation(async(channel)=>{if(channel===2)events.push('ack');});
 connection.close.mockImplementation(async()=>{events.push('close');});
 const execution=executeRemoteProcess({...request,signal:controller.signal,stdout:{...request.stdout,ownedOutput:owned}},async()=>connection);
 await vi.waitFor(()=>expect(owned.write).toHaveBeenCalled(),{interval:1});controller.abort(cause);
 await Promise.resolve();await Promise.resolve();expect(events).not.toContain('close');
 release();await expect(execution).rejects.toBe(cause);
 expect(events.indexOf('write')).toBeLessThan(events.indexOf('ack'));expect(events.indexOf('ack')).toBeLessThan(events.indexOf('close'));
});
it('drains a late descriptor acquisition and releases its borrowed lease before cancellation settles',async()=>{
 const {connection,request}=fixture();const controller=new AbortController();const cause=new Error('cancel descriptor acquisition');
 connection.outputs.set(4,output(4,new Uint8Array([1])));
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 const lease={write:vi.fn(async(bytes:Uint8Array)=>bytes.length),close:vi.fn(async()=>{})};
 const acquire=vi.fn(async()=>{await pending;return lease;});
 let cleanup!:()=>Promise<void>;
 const execution=executeRemoteProcess({...request,signal:controller.signal,registerCleanup(fn){cleanup=fn;},admittedHandles:{acquire}},async()=>connection);
 await vi.waitFor(()=>expect(acquire).toHaveBeenCalled(),{interval:1});controller.abort(cause);
 let cleaned=false;const barrier=cleanup().then(()=>{cleaned=true;});
 await new Promise<void>(resolve=>setImmediate(resolve));expect(cleaned).toBe(false);
 release();await expect(execution).rejects.toBe(cause);await barrier;
 expect(lease.close).toHaveBeenCalledTimes(1);expect(lease.write).not.toHaveBeenCalled();
});
it.each(['cancellation','consumer closure'] as const)('stops descriptor short-write retries after %s and retains the accepted prefix',async mode=>{
 const {connection,request}=fixture();const controller=new AbortController();const consumer=new AbortController();
 connection.outputs.set(4,output(4,new Uint8Array([1,2])));
 const accepted:number[]=[];const cause=Object.assign(new Error(mode),{code:'EPIPE'});
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 const lease={consumerClosed:consumer.signal,write:vi.fn(async(bytes:Uint8Array)=>{
  await pending;accepted.push(bytes[0]!);return 1;
 }),close:vi.fn(async()=>{})};
 const execution=executeRemoteProcess({...request,signal:controller.signal,admittedHandles:{async acquire(){return lease;}}},async()=>connection);
 const completion=mode==='cancellation'?expect(execution).rejects.toBe(cause):expect(execution).resolves.toEqual({exitCode:42});
 await vi.waitFor(()=>expect(lease.write).toHaveBeenCalledOnce(),{interval:1});
 if(mode==='cancellation')controller.abort(cause);else consumer.abort(cause);
 release();await completion;
 expect(accepted).toEqual([1]);expect(lease.write).toHaveBeenCalledOnce();
 expect(connection.ack).not.toHaveBeenCalledWith(4,1n,2n);
 expect(lease.close).toHaveBeenCalledOnce();
 if(mode==='consumer closure')expect(request.stderr.write).toHaveBeenCalledWith(new Uint8Array([9]));
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});
it('drains an owned descriptor write and its credit without requiring a consumer-close signal',async()=>{
 const {connection,request}=fixture();const controller=new AbortController();const events:string[]=[];
 connection.outputs.set(4,output(4,new Uint8Array([1,2])));
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 const lease={write:vi.fn(async(bytes:Uint8Array)=>{await pending;events.push('write');return bytes.length;}),close:vi.fn(async()=>{events.push('lease-close');})};
 connection.ack.mockImplementation(async(channel)=>{if(channel===4)events.push('ack');});
 connection.close.mockImplementation(async()=>{events.push('transport-close');});
 let cleanup!:()=>Promise<void>;
 const cause=new Error('cancel descriptor delivery');
 const execution=executeRemoteProcess({...request,signal:controller.signal,registerCleanup(fn){cleanup=fn;},admittedHandles:{async acquire(){return lease;}}},async()=>connection);
 await vi.waitFor(()=>expect(lease.write).toHaveBeenCalledOnce(),{interval:1});
 controller.abort(cause);const barrier=cleanup();
 await new Promise<void>(resolve=>setImmediate(resolve));
 const retiredBeforeDelivery=events.includes('transport-close');
 release();await expect(execution).rejects.toBe(cause);await barrier;
 expect(retiredBeforeDelivery).toBe(false);
 expect(events).toEqual(['write','ack','transport-close','lease-close']);
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});

it('keeps delayed stderr available after a non-pipe destination failure and preserves that failure',async()=>{
 const {connection,request}=fixture();const cause=new Error('canonical destination rejected');
 let target!:ReadableStreamDefaultController<Uint8Array>;
 connection.outputs.set(3,new ReadableStream<Uint8Array>({start(controller){target=controller;}}));
 request.stdout.write.mockRejectedValue(cause);
 const execution=executeRemoteProcess(request,async()=>connection);
 const rejected=expect(execution).rejects.toBe(cause);
 await vi.waitFor(()=>expect(request.stdout.write).toHaveBeenCalledOnce(),{interval:1});
 await new Promise<void>(resolve=>setImmediate(resolve));
 const closedBeforeStderr=connection.close.mock.calls.length;
 const diagnostic=output(3,new Uint8Array([9])).getReader();
 for(;;){const frame=await diagnostic.read();if(frame.done)break;target.enqueue(frame.value);}
 diagnostic.releaseLock();target.close();
 await rejected;
 expect(closedBeforeStderr).toBe(0);
 expect(connection.closeOutput).toHaveBeenCalledWith(2,cause);
 expect(request.stderr.write).toHaveBeenCalledWith(new Uint8Array([9]));
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
});

it('retires blocked siblings when remote broken-pipe notification fails',async()=>{
 const {connection,request}=fixture();const cause=new Error('closure notification lost');
 const pipe=Object.assign(new Error('closed'),{code:'EPIPE'});
 let target!:ReadableStreamDefaultController<Uint8Array>;
 connection.outputs.set(3,new ReadableStream<Uint8Array>({start(controller){target=controller;}}));
 connection.outcome=new Promise(()=>{});
 request.stdout.write.mockRejectedValue(pipe);
 connection.closeOutput.mockRejectedValue(cause);
 connection.close.mockImplementation(async()=>{target.error(new Error('retired'));});
 const execution=executeRemoteProcess(request,async()=>connection);
 // Cleanup must report the unconfirmed closure too; retain the original cause.
 const rejected=expect(execution).rejects.toSatisfy(error=>error===cause||error instanceof AggregateError&&error.errors.includes(cause));
 await vi.waitFor(()=>expect(connection.closeOutput).toHaveBeenCalledOnce(),{interval:1});
 await new Promise<void>(resolve=>setImmediate(resolve));
 const closedBeforeRescue=connection.close.mock.calls.length;
 if(!closedBeforeRescue)target.error(new Error('rescue'));
 await rejected;expect(closedBeforeRescue).toBe(1);
});

it('cancels an idle output read without relying on transport retirement to close the source',async()=>{
 const {connection,request}=fixture();const controller=new AbortController();const cause=new Error('cancel idle output');
 let reading!:()=>void;const ready=new Promise<void>(resolve=>{reading=resolve;});const cancel=vi.fn();
 connection.outputs.set(2,new ReadableStream<Uint8Array>({pull(){reading();},cancel},{highWaterMark:0}));
 const execution=executeRemoteProcess({...request,signal:controller.signal},async()=>connection);
 const rejected=expect(execution).rejects.toBe(cause);
 await ready;controller.abort(cause);await rejected;
 expect(cancel).toHaveBeenCalledOnce();expect(connection.close).toHaveBeenCalledOnce();
 const next=fixture();await expect(executeRemoteProcess(next.request,async()=>next.connection)).resolves.toEqual({exitCode:42});
},500);

it('closes an idle stdout decoder when its consumer closes while retaining stderr',async()=>{
 const {connection,request}=fixture();const consumer=new AbortController();const cause=Object.assign(new Error('consumer closed'),{code:'EPIPE'});
 let reading!:()=>void;const ready=new Promise<void>(resolve=>{reading=resolve;});const cancel=vi.fn();
 connection.outputs.set(2,new ReadableStream<Uint8Array>({pull(){reading();},cancel},{highWaterMark:0}));
 const execution=executeRemoteProcess({...request,stdout:{...request.stdout,ownedOutput:{consumerClosed:consumer.signal,write:request.stdout.write}}},async()=>connection);
 await ready;consumer.abort(cause);
 await expect(execution).resolves.toEqual({exitCode:42});
 expect(cancel).toHaveBeenCalledOnce();expect(connection.closeOutput).toHaveBeenCalledWith(2,cause);
 expect(request.stderr.write).toHaveBeenCalledWith(new Uint8Array([9]));expect(request.stdout.write).not.toHaveBeenCalled();
},500);
