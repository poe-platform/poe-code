import {expect,it,vi} from 'vitest';
import {exactByteBody} from './http-byte-body.js';

it.each(['advance','eof','failure','cancel'] as const)('owns delivered canonical bytes before upstream %s',async stage=>{
 const shared=Uint8Array.of(0,255);let reads=0;
 const failure=new Error('canonical read failed');
 const body=new ReadableStream<Uint8Array>({
  pull(c){
   if(reads++===0){c.enqueue(shared);return;}
   shared.fill(128);
   if(stage==='failure')c.error(failure);
   else if(stage==='advance')c.enqueue(shared);
   else c.close();
  },
  cancel(){shared.fill(128);},
 },{highWaterMark:0});
 const reader=exactByteBody(body,stage==='advance'?4n:2n).getReader();
 const first=(await reader.read()).value;
 if(stage==='cancel')await reader.cancel();
 else if(stage==='failure')await expect(reader.read()).rejects.toBe(failure);
 else if(stage==='advance')expect((await reader.read()).value).toEqual(Uint8Array.of(128,128));
 else expect((await reader.read()).done).toBe(true);
 expect(first).toEqual(Uint8Array.of(0,255));
 await reader.cancel().catch(()=>{});
});

it('preserves delivered prefixes and rejects EOF before the advertised HTTP range',async()=>{
 const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(Uint8Array.of(7));c.close();}});
 const reader=exactByteBody(body,8n).getReader();
 expect((await reader.read()).value).toEqual(Uint8Array.of(7));
 await expect(reader.read()).rejects.toThrow('Incomplete HTTP byte body');
});
it('streams bounded short reads to their exact range end',async()=>{
 const source=[Uint8Array.of(0,255),Uint8Array.of(128)];
 const pull=vi.fn((c:ReadableStreamDefaultController<Uint8Array>)=>{const next=source.shift();if(next)c.enqueue(next);else c.close();});
 const reader=exactByteBody(new ReadableStream({pull},{highWaterMark:0}),3n).getReader();
 expect(pull).not.toHaveBeenCalled();
 expect((await reader.read()).value).toEqual(Uint8Array.of(0,255));
 expect((await reader.read()).value).toEqual(Uint8Array.of(128));
 expect((await reader.read()).done).toBe(true);
});
it('rejects excess bytes using the actual typed-array span',async()=>{
 const bytes=Uint8Array.of(1,2);Object.defineProperty(bytes,'byteLength',{value:1});
 const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes);c.close();}});
 await expect(exactByteBody(body,1n).getReader().read()).rejects.toThrow('HTTP byte body exceeds');
});
it('propagates source errors and awaited cancellation without treating them as EOF',async()=>{
 const failure=new Error('canonical read failed');
 await expect(exactByteBody(new ReadableStream({start(c){c.error(failure);}}),1n).getReader().read()).rejects.toBe(failure);
 let release!:()=>void;const retirement=new Promise<void>(resolve=>{release=resolve;});
 const cancel=vi.fn(()=>retirement);const reader=exactByteBody(new ReadableStream<Uint8Array>({cancel},{highWaterMark:0}),1n).getReader();
 let settled=false;const closing=reader.cancel(failure).then(()=>{settled=true;});
 await new Promise<void>(resolve=>setImmediate(resolve));expect(settled).toBe(false);
 release();await closing;expect(cancel).toHaveBeenCalledWith(failure);
});
it('admits empty bodies and refuses invalid lengths before acquiring a reader',async()=>{
 expect((await exactByteBody(new ReadableStream({start(c){c.close();}}),0n).getReader().read()).done).toBe(true);
 for(const length of [-1n,9223372036854775808n,1 as never]){
  const body=new ReadableStream<Uint8Array>();expect(()=>exactByteBody(body,length)).toThrow('Invalid HTTP byte length');expect(body.locked).toBe(false);
 }
});
