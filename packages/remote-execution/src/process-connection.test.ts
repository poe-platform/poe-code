import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {expect,it} from 'vitest';
import {createNativeLauncher} from './native-process.js';
import {createProcessConnection} from './process-connection.js';
import {executeRemoteProcess} from './process.js';
import {toByteSource} from '@poe-code/safe-fs/core';
import {vi} from 'vitest';
import {encodeFrame} from './binary.js';
import {connectHttpProcess,createProcessHttpHandler} from './process-http.js';
it.each([1,4,0,-1,2.5,NaN,Infinity,1025])('rejects unadmitted output retirement for channel %s before native work',async channel=>{
 let streams!:import('./native-process.js').ProcessStreams;
 const closeOutput=vi.fn();
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},{launch(_spec,output){
  streams=output;return{exit:Promise.resolve({kind:'exited',exitCode:42}),settled:Promise.resolve(),async write(){},async end(){},signal(){},closeOutput};
 }});
 const stderr=connection.outputs.get(3)!.getReader();
 try{
  await expect(connection.closeOutput(channel,new Error('unadmitted destination'))).rejects.toThrow('not admitted');
  expect(closeOutput).not.toHaveBeenCalled();
  const diagnostic=streams.output(3,Uint8Array.of(0,255));
  expect((await stderr.read()).done).toBe(false);
  await connection.ack(3,1n,2n);await diagnostic;
  expect(await connection.outcome).toEqual({kind:'exited',exitCode:42});
 }finally{await connection.close();stderr.releaseLock();}
});
it('rejects post-EOF output before reserving credit and leaves stderr usable',async()=>{
 let streams!:import('./native-process.js').ProcessStreams;
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},{launch(_spec,output){
  streams=output;return{exit:Promise.resolve({kind:'exited',exitCode:42}),settled:Promise.resolve(),async write(){},async end(){},signal(){}};
 }});
 const stdout=connection.outputs.get(2)!.getReader();const stderr=connection.outputs.get(3)!.getReader();
 try{
  const eof=streams.end(2);await stdout.read();await connection.ack(2,1n,0n);await eof;
  await expect(streams.output(2,Uint8Array.of(9))).rejects.toThrow('ended');
  await expect(streams.end(2)).rejects.toThrow('ended');
  // Rejected production must not leave a phantom credit that can be ACKed.
  await expect(connection.ack(2,2n,1n)).rejects.toThrow('credit mismatch');
  const diagnostic=streams.output(3,Uint8Array.of(7));await stderr.read();await connection.ack(3,1n,1n);await diagnostic;
  expect(await connection.outcome).toEqual({kind:'exited',exitCode:42});
 }finally{await connection.close();stdout.releaseLock();stderr.releaseLock();}
});
it.each(['data','end'] as const)('blocks a decoded %s effect when finalization overtakes input admission',async kind=>{
 const write=vi.fn(async()=>{});const end=vi.fn(async()=>{});
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},{launch(){return{
  exit:Promise.resolve({kind:'exited',exitCode:42}),settled:Promise.resolve(),write,end,signal(){},
 };}});
 const payload=kind==='data'?Uint8Array.of(0,255):new Uint8Array();
 const wire=encodeFrame({kind,channelId:1,sequence:1n,offset:0n,correlationId:0n,payload},{channels:[1],maxFrameBytes:8,maxControlBytes:8});
 // Decoding yields before the native operation. No rescue timer or live
 // process is needed to put finalization precisely between those admissions.
 const sent=connection.send(1,wire,BigInt(payload.length),new AbortController().signal)
  .then(value=>({value}),cause=>({cause}));
 const retirement=connection.close();
 const receipt=await sent;
 await retirement;
 expect(receipt).toHaveProperty('cause');
 expect(write).not.toHaveBeenCalled();expect(end).not.toHaveBeenCalled();
 expect(await connection.outcome).toEqual({kind:'exited',exitCode:42});
});
it.each(['data','end'] as const)('drains an already dispatched %s receipt when finalization begins',async kind=>{
 let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
 let release!:()=>void;const accepted=new Promise<void>(resolve=>{release=resolve;});
 const effect=vi.fn(async()=>{entered();await accepted;});
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},{launch(){return{
  exit:Promise.resolve({kind:'exited',exitCode:42}),settled:Promise.resolve(),write:effect,end:effect,signal(){},
 };}});
 const payload=kind==='data'?Uint8Array.of(0,255):new Uint8Array();
 const wire=encodeFrame({kind,channelId:1,sequence:1n,offset:0n,correlationId:0n,payload},{channels:[1],maxFrameBytes:8,maxControlBytes:8});
 const sent=connection.send(1,wire,BigInt(payload.length),new AbortController().signal);
 await ready;let closed=false;const retirement=connection.close().then(()=>{closed=true;});
 await new Promise<void>(resolve=>setImmediate(resolve));const premature=closed;
 release();await expect(sent).resolves.toBe(BigInt(payload.length));await retirement;
 expect(premature).toBe(false);expect(effect).toHaveBeenCalledOnce();
 expect(await connection.outcome).toEqual({kind:'exited',exitCode:42});
});
it.each([8,128])('admits the actual input frame span before copying or writing native bytes (credit=%s)',async maxFrameBytes=>{
 const write=vi.fn(async()=>{});const end=vi.fn(async()=>{});
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes},{launch(){return{
  exit:Promise.resolve({kind:'exited',exitCode:0}),settled:Promise.resolve(),write,end,signal(){},
 };}});
 const limits={channels:[1],maxFrameBytes:128,maxControlBytes:128};
 const first=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array([7])},limits);
 const last=encodeFrame({kind:'end',channelId:1,sequence:2n,offset:1n,correlationId:0n,payload:new Uint8Array()},limits);
 const batch=new Uint8Array(first.length+last.length);batch.set(first);batch.set(last,first.length);
 Object.defineProperties(batch,{length:{value:first.length},byteLength:{value:first.length}});
 try {
  const rejected=await connection.send(1,batch,1n,new AbortController().signal).catch(cause=>cause);
  expect(write).not.toHaveBeenCalled();expect(end).not.toHaveBeenCalled();
  expect(rejected).toBeInstanceOf(TypeError);
  expect(rejected.message).toContain(maxFrameBytes===8?'exceeds credit':'exactly one complete frame');
  // A rejected batch consumes no credit, so the next valid invocation of this
  // lane still starts at sequence one and offset zero.
  await expect(connection.send(1,first,1n,new AbortController().signal)).resolves.toBe(1n);
  expect(write).toHaveBeenCalledExactlyOnceWith(1,new Uint8Array([7]));
 } finally {await connection.close();}
});
it('does not consult shadowed typed-array properties while admitting a valid frame',async()=>{
 const write=vi.fn(async()=>{});
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},{launch(){return{
  exit:Promise.resolve({kind:'exited',exitCode:0}),settled:Promise.resolve(),write,async end(){},signal(){},
 };}});
 const encoded=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array([0,255])},{channels:[1],maxFrameBytes:8,maxControlBytes:8});
 const storage=new Uint8Array(encoded.length+6);storage.set(encoded,3);
 const frame=storage.subarray(3,3+encoded.length);
 const shadow=vi.fn(()=>{throw new Error('Shadowed span accessed');});
 for(const key of ['length','byteLength','buffer','byteOffset'])Object.defineProperty(frame,key,{get:shadow});
 try {
  await expect(connection.send(1,frame,2n,new AbortController().signal)).resolves.toBe(2n);
  expect(shadow).not.toHaveBeenCalled();expect(write).toHaveBeenCalledWith(1,new Uint8Array([0,255]));
 } finally {await connection.close();}
});
it('retains an acknowledged EOF when reader retirement races native pump resumption',async()=>{
 const child=Object.assign(new EventEmitter(),{pid:123,stdio:[new PassThrough(),new PassThrough(),new PassThrough()]});
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},createNativeLauncher({spawn:(()=>child)as never,killGroup(){},groupAlive:()=>false}));
 const stdout=connection.outputs.get(2)!.getReader();
 const stderr=connection.outputs.get(3)!.getReader();
 try {
  child.stdio[1].end();await stdout.read();
  // ack resolves the admitted receipt synchronously. Retire the reader before
  // the native EOF pump resumes; that retirement cannot undo the receipt.
  const receipt=connection.ack(2,1n,0n);
  const retirement=connection.closeOutput(2,Object.assign(new Error('reader closed after EOF receipt'),{code:'EPIPE'}));
  await Promise.all([receipt,retirement]);
  child.stdio[2].end(new Uint8Array([9]));await stderr.read();await connection.ack(3,1n,1n);
  await stderr.read();await connection.ack(3,2n,1n);
  child.emit('exit',42,null);child.emit('close',42,null);
  await expect(connection.close()).resolves.toBeUndefined();
  await expect(connection.outcome).resolves.toEqual({kind:'exited',exitCode:42});
 } finally {
  await connection.close().catch(()=>{});stdout.releaseLock();stderr.releaseLock();
 }
});
it('settles reader retirement racing an unacknowledged END without closing stderr',async()=>{
 const child=Object.assign(new EventEmitter(),{pid:123,stdio:[new PassThrough(),new PassThrough(),new PassThrough()]});
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},createNativeLauncher({spawn:(()=>child)as never,killGroup(){},groupAlive:()=>false}));
 const stdout=connection.outputs.get(2)!.getReader();
 child.stdio[1].end();await stdout.read();
 await stdout.cancel(Object.assign(new Error('reader closed at EOF'),{code:'EPIPE'}));stdout.releaseLock();
 const stderr=connection.outputs.get(3)!.getReader();
 child.stdio[2].end();await stderr.read();await connection.ack(3,1n,0n);
 child.emit('exit',42,null);child.emit('close',42,null);
 await expect(connection.close()).resolves.toBeUndefined();stderr.releaseLock();
});
it('snapshots lane entries before stdin admission without rereading accessor authority',async()=>{
 let reads=0;
 const inputChannels=[1];
 Object.defineProperty(inputChannels,0,{get(){return ++reads===1?1:4;}});
 const launch=vi.fn((_spec:import('./native-process.js').NativeProcessSpec)=>({exit:Promise.resolve({kind:'exited' as const,exitCode:0}),settled:Promise.resolve(),async write(){},async end(){},signal(){}}));
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels,outputChannels:[2,3],maxFrameBytes:8},{launch});
 try {
  expect(connection.stdinKind).toBe('pipe');
  expect(connection.inputChannels).toEqual([1]);
  expect(launch.mock.calls[0]?.[0]).toMatchObject({inputChannels:[1]});
  expect(reads).toBe(1);
 } finally {await connection.close();}
});
it('blocks replay after a failed native write with unknown partial acceptance while sibling input keeps its credit',async()=>{
 const cause=new Error('native input receipt lost after partial write');
 const accepted=new Map<number,number[]>();
 const write=vi.fn(async(channel:number,payload:Uint8Array)=>{
  accepted.set(channel,[...(accepted.get(channel)??[]),payload[0]!]);
  if(channel===1)throw cause;
 });
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1,4],outputChannels:[2,3],maxFrameBytes:8},{launch(){return{
  exit:Promise.resolve({kind:'exited',exitCode:0}),settled:Promise.resolve(),write,async end(){},signal(){},
 };}});
 const frame=(channelId:number)=>encodeFrame({kind:'data',channelId,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array([0,255])},{channels:[channelId],maxFrameBytes:8,maxControlBytes:8});
 try {
  await expect(connection.send(1,frame(1),2n,new AbortController().signal)).rejects.toBe(cause);
  await expect(connection.send(1,frame(1),2n,new AbortController().signal)).rejects.toBe(cause);
  await expect(connection.send(4,frame(4),2n,new AbortController().signal)).resolves.toBe(2n);
  expect(accepted).toEqual(new Map([[1,[0]],[4,[0]]]));
  expect(write).toHaveBeenCalledTimes(2);
 } finally {await connection.close();}
});
it('rejects invalid lane authority and frame bounds before acquiring a native process',()=>{
 const launch=vi.fn();
 const spec={executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8};
 for(const invalid of [
  {maxFrameBytes:0},{maxFrameBytes:1048577},{maxFrameBytes:1.5},
  {inputChannels:[1,1]},{inputChannels:[1,2]},{inputChannels:[1,1025]},
  {inputChannels:[1,undefined]},{outputChannels:[2,3,3]},
  {outputChannels:[1,2,3]},{outputChannels:[2,3,1025]},
  {outputChannels:[2,3,undefined]},
 ]) {
  expect(()=>createProcessConnection({...spec,...invalid} as typeof spec,{launch})).toThrow(TypeError);
 }
 expect(launch).not.toHaveBeenCalled();
});
it('bounds cancellation when signals are denied and the native leader never exits',async()=>{
 vi.useFakeTimers();
 const child=Object.assign(new EventEmitter(),{pid:123,stdio:[new PassThrough(),new PassThrough(),new PassThrough()]});
 const denied=Object.assign(new Error('signal denied'),{code:'EPERM'});
 const launcher=createNativeLauncher({spawn:(()=>child)as never,killGroup(){throw denied;},groupAlive:()=>true,terminationTimeoutMs:10});
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},launcher);
 let failure:unknown;let finished=false;
 const closing=connection.close().catch(cause=>{failure=cause;finished=true;});
 try {
  await vi.advanceTimersByTimeAsync(120);
  const bounded=finished;
  // Release the fake process even on the broken implementation; no timeout test.
  child.emit('exit',7,null);child.emit('close',7,null);
  await vi.advanceTimersByTimeAsync(20);await closing;
  expect(bounded).toBe(true);
  expect(failure).toMatchObject({category:'transport',code:'termination-unconfirmed',cause:denied});
  expect(child.stdio.every(stream=>stream.destroyed)).toBe(true);
  const nextChild=Object.assign(new EventEmitter(),{pid:124,stdio:[new PassThrough(),new PassThrough(),new PassThrough()]});
  const next=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},createNativeLauncher({spawn:(()=>nextChild)as never,killGroup(){},groupAlive:()=>false}));
  const execution=executeRemoteProcess({stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}},signal:new AbortController().signal},async()=>next);
  nextChild.stdio[1].end();nextChild.stdio[2].end();nextChild.emit('exit',42,null);nextChild.emit('close',42,null);
  await expect(execution).resolves.toEqual({exitCode:42});
 } finally {vi.useRealTimers();}
});
it('owns a bounded input frame before asynchronous decode and native acceptance',async()=>{
 const write=vi.fn(async()=>{});
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},{launch(){return{
  exit:Promise.resolve({kind:'exited',exitCode:0}),settled:Promise.resolve(),write,async end(){},signal(){},
 };}});
 const wire=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array([0,255])},{channels:[1],maxFrameBytes:8,maxControlBytes:8});
 try {
  const sent=connection.send(1,wire,2n,new AbortController().signal);
  wire.fill(0);
  await expect(sent).resolves.toBe(2n);
  expect(write).toHaveBeenCalledWith(1,new Uint8Array([0,255]));
 } finally {await connection.close();}
});
it('retains the admitted channel lists and frame bounds independently of caller and launcher mutation',async()=>{
 const write=vi.fn(async()=>{});let streams!:import('./native-process.js').ProcessStreams;
 const spec={executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8};
 const connection=createProcessConnection(spec,{launch(installed,output){
  streams=output;installed.inputChannels=[];installed.outputChannels=[];installed.maxFrameBytes=1024;
  return{exit:Promise.resolve({kind:'exited',exitCode:0}),settled:Promise.resolve(),write,async end(){},signal(){}};
 }});
 spec.inputChannels.length=0;spec.outputChannels.length=0;spec.maxFrameBytes=1024;
 const frame=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array([0,255])},{channels:[1],maxFrameBytes:8,maxControlBytes:8});
 try {
  expect(connection.maxFrameBytes).toBe(8);
  expect(connection.inputChannels).toEqual([1]);
  await expect(connection.send(1,frame,2n,new AbortController().signal)).resolves.toBe(2n);
  expect(write).toHaveBeenCalledWith(1,new Uint8Array([0,255]));
  await expect(streams.output(2,new Uint8Array(9))).rejects.toThrow();
 } finally {await connection.close();}
});
it('closing a binary output reader releases its native credit and preserves sibling lanes',async()=>{
 let streams!:import('./native-process.js').ProcessStreams;
 const closeOutput=vi.fn();
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},{launch(_spec,output){streams=output;return{
  exit:Promise.resolve({kind:'exited',exitCode:0}),settled:Promise.resolve(),async write(){},async end(){},signal(){},closeOutput,
 };}});
 const cause=Object.assign(new Error('reader closed'),{code:'EPIPE'});
 const reader=connection.outputs.get(2)!.getReader();
 const emission=streams.output(2,new Uint8Array([0,255]));
 const rejected=expect(emission).rejects.toMatchObject({cause});
 await reader.read();await reader.cancel(cause);reader.releaseLock();
 const closedBeforeRescue=closeOutput.mock.calls.map(call=>call[0]);
 if(!closedBeforeRescue.length)await connection.closeOutput(2,cause);
 await rejected;
 expect(closedBeforeRescue).toEqual([2]);
 const stderr=connection.outputs.get(3)!.getReader();
 const diagnostic=streams.output(3,new Uint8Array([9]));
 await stderr.read();await connection.ack(3,1n,1n);await diagnostic;
 await connection.close();stderr.releaseLock();
});

it('drains native settlement before reporting a failed cleanup signal',async()=>{
 const cause=Object.assign(new Error('signal denied'),{code:'EPERM'});
 let release!:()=>void;const settled=new Promise<void>(resolve=>{release=resolve;});
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},{launch(){return{
  exit:Promise.resolve({kind:'exited',exitCode:7}),settled,async write(){},async end(){},signal(){throw cause;},closeInput(){},closeOutput(){},async terminateGroup(){},
 };}});
 let finished=false;const closing=connection.close();void closing.catch(()=>{finished=true;});
 const rejected=expect(closing).rejects.toBe(cause);
 await new Promise<void>(resolve=>setImmediate(resolve));const settledBeforeRelease=finished;
 release();await rejected;expect(settledBeforeRelease).toBe(false);
});
it('retires delegates on leader exit before waiting for inherited output EOF',async()=>{
 const child=Object.assign(new EventEmitter(),{pid:123,stdio:[new PassThrough(),new PassThrough(),new PassThrough()]});
 let alive=true;
 const killGroup=vi.fn(()=>{
  alive=false;
  child.stdio[1].end(new Uint8Array([0,255]));
  child.stdio[2].end(new Uint8Array([9]));
  child.emit('close',42,null);
 });
 const launcher=createNativeLauncher({spawn:(()=>child)as never,killGroup,groupAlive:()=>alive});
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},launcher);
 const stdout:Uint8Array[]=[];const stderr:Uint8Array[]=[];
 const execution=executeRemoteProcess({stdin:toByteSource(new Uint8Array()),stdout:{async write(b){stdout.push(b.slice());}},stderr:{async write(b){stderr.push(b.slice());}},signal:new AbortController().signal},async()=>connection,()=>143);
 child.emit('exit',42,null);
 await new Promise<void>(resolve=>setImmediate(resolve));
 // Release the fixture even on the failing implementation; no timeout oracle.
 const retired=killGroup.mock.calls.length;
 if(!retired)killGroup();
 await expect(execution).resolves.toEqual({exitCode:42});
 expect(retired).toBe(1);
 expect(killGroup).toHaveBeenCalledWith(123,'SIGKILL');
 expect(stdout).toEqual([new Uint8Array([0,255])]);
 expect(stderr).toEqual([new Uint8Array([9])]);
});
it('releases local native output readers when process-group retirement cannot be confirmed',async()=>{
 const cause=new Error('termination unconfirmed');let release!:()=>void;
 const settled=new Promise<void>(resolve=>{release=resolve;});const closeOutput=vi.fn();
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},{launch(){return{
  exit:Promise.resolve({kind:'exited',exitCode:7}),settled,async write(){},async end(){},signal(){},closeOutput,async terminateGroup(){throw cause;},
 };}});
 const rejected=expect(connection.close()).rejects.toBe(cause);
 await new Promise<void>(resolve=>setImmediate(resolve));
 const retired=closeOutput.mock.calls.map(call=>call[0]);
 release();await rejected;
 expect(retired).toEqual([2,3]);
});
it('refuses correlated input frames before accepting native bytes or advancing credit',async()=>{
 const write=vi.fn(async()=>{});
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},{launch(){return{
  exit:Promise.resolve({kind:'exited',exitCode:0}),settled:Promise.resolve(),write,async end(){},signal(){},
 };}});
 const frame=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:9n,payload:new Uint8Array([7])},{channels:[1],maxFrameBytes:8,maxControlBytes:8});
 await expect(connection.send(1,frame,1n,new AbortController().signal)).rejects.toThrow('credit mismatch');
 expect(write).not.toHaveBeenCalled();
 const valid=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array([8])},{channels:[1],maxFrameBytes:8,maxControlBytes:8});
 await expect(connection.send(1,valid,1n,new AbortController().signal)).resolves.toBe(1n);
 expect(write).toHaveBeenCalledWith(1,new Uint8Array([8]));await connection.close();
});
it('rejects a multi-frame input batch before any native write',async()=>{
 const write=vi.fn(async()=>{});const end=vi.fn(async()=>{});
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:128},{launch(){return{
  exit:Promise.resolve({kind:'exited',exitCode:0}),settled:Promise.resolve(),write,end,signal(){},
 };}});
 const limits={channels:[1],maxFrameBytes:128,maxControlBytes:128};
 const first=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array([7])},limits);
 const second=encodeFrame({kind:'end',channelId:1,sequence:2n,offset:1n,correlationId:0n,payload:new Uint8Array()},limits);
 const batch=new Uint8Array(first.length+second.length);batch.set(first);batch.set(second,first.length);
 await expect(connection.send(1,batch,1n,new AbortController().signal)).rejects.toThrow();
 expect(write).not.toHaveBeenCalled();expect(end).not.toHaveBeenCalled();await connection.close();
});
it('awaits process-group retirement even after the leader and output pipes close',async()=>{
 let release!:()=>void;const retirement=new Promise<void>(resolve=>{release=resolve;});
 const terminateGroup=vi.fn(async()=>{await retirement;});
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},{launch(){return{
  exit:Promise.resolve({kind:'exited',exitCode:42}),settled:Promise.resolve(),async write(){},async end(){},signal(){},terminateGroup,
 };}});
 let finished=false;const closing=connection.close().then(()=>{finished=true;});
 await Promise.resolve();await Promise.resolve();expect(terminateGroup).toHaveBeenCalledTimes(1);expect(finished).toBe(false);
 release();await closing;expect(finished).toBe(true);
});
it('uses independent framed output credits while native stdin and stderr continue',async()=>{
 const child=Object.assign(new EventEmitter(),{pid:123,stdio:[new PassThrough(),new PassThrough(),new PassThrough()]});
 const launcher=createNativeLauncher({spawn:(()=>child)as never,killGroup(){}});
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},launcher);
 let release!:()=>void;const slow=new Promise<void>(r=>{release=r;});const stderr:Uint8Array[]=[];
 const execution=executeRemoteProcess({stdin:toByteSource(new Uint8Array()),stdout:{async write(){await slow;}},stderr:{async write(bytes){stderr.push(bytes);}},signal:new AbortController().signal},async()=>connection);
 child.stdio[1].end(new Uint8Array([0,255]));child.stdio[2].end(new Uint8Array([9]));child.emit('exit',0,null);child.emit('close',0,null);
 await new Promise<void>(r=>setImmediate(r));expect(stderr).toEqual([new Uint8Array([9])]);release();expect(await execution).toEqual({exitCode:0});
});
it.each([false,true])('settles intentional stdout EPIPE with stderr and native status preserved (HTTP=%s)',async http=>{
 const child=Object.assign(new EventEmitter(),{pid:123,stdio:[new PassThrough(),new PassThrough(),new PassThrough()]});
 const launcher=createNativeLauncher({spawn:(()=>child)as never,killGroup(){}});
 const connection=createProcessConnection({executable:'/tool',cwd:'/',env:{},args:[],inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8},launcher);
 const cause=Object.assign(new Error('consumer gone'),{code:'EPIPE'});const stderr:Uint8Array[]=[];
 const identity={sessionId:'session',epoch:'epoch',jobId:'job'};
 const handler=createProcessHttpHandler({identity,connection,authorize:async()=>true,maxRequests:8});
 const execution=executeRemoteProcess({stdin:toByteSource(new Uint8Array()),stdout:{async write(){throw cause;}},stderr:{async write(bytes){stderr.push(bytes);}},signal:new AbortController().signal},async()=>http?connectHttpProcess({identity,baseUrl:'https://oracle.test',token:async()=> 'test',fetch:async(input,init)=>handler(new Request(input,init))},new AbortController().signal):connection);
 child.stdio[1].end(new Uint8Array([1]));child.stdio[2].end(new Uint8Array([9]));child.emit('exit',42,null);child.emit('close',42,null);
 await expect(execution).resolves.toEqual({exitCode:42});
 await expect(connection.outcome).resolves.toEqual({kind:'exited',exitCode:42});
 expect(stderr).toEqual([new Uint8Array([9])]);
});
