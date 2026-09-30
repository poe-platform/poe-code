import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createLlmCommand } from './command.js';

async function run(chunks: AsyncIterable<Uint8Array>, args: string[], consume: (source: AsyncIterable<Uint8Array>)=>Promise<void>) {
 const backing = new MemoryFileSystem();
 let stages=0,largestWrite=0,largestRead=0,calls=0;
 const fs=new Proxy(backing,{get(target,key){
  if(key==='createStagedFile')return async (...args:Parameters<typeof target.createStagedFile>)=>{
   stages++; const staged=await target.createStagedFile(...args); const writer=staged.writer!;
   return {...staged,writer:{...writer,async write(bytes:Uint8Array,options:Parameters<typeof writer.write>[1]){largestWrite=Math.max(largestWrite,bytes.byteLength);await writer.write(bytes,options);},finish:writer.finish.bind(writer)}};
  };
  if(key==='openReadFile')return async (...args:Parameters<typeof target.openReadFile>)=>{
   const reader=await target.openReadFile(...args);return {stat:reader.stat.bind(reader),close:reader.close.bind(reader),async read(position:number,length:number,options:Parameters<typeof reader.read>[2]){largestRead=Math.max(largestRead,length);return reader.read(position,length,options);}};
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const command=createLlmCommand({defaultModel:'model',providers:[{name:'test',models:[{id:'model'}],complete(){throw new Error('buffered path prohibited');},async *completeSources(request){calls++;await consume(request.prompt.bytes);yield 'ok';}}]});
 const errors:Uint8Array[]=[];
 const result=await command.execute({command:'llm',args,fs,cwd:'/',env:{},signal:new AbortController().signal,stdin:chunks,stdout:{async write(){}},stderr:{async write(bytes){errors.push(bytes.slice());}}});
 assert.deepEqual(await backing.readdir('/'),[],'all caller-owned staging cleaned up');
 return {...result,stages,largestRead,largestWrite,calls,error:Buffer.concat(errors).toString()};
}

test('16MiB plus tail stdin uses retained staging and bounded writes and reads',async()=>{
 const size=16*1024*1024+7;let received=0;
 const chunks={async *[Symbol.asyncIterator](){for(let position=0;position<size;position+=16384)yield new Uint8Array(Math.min(16384,size-position)).fill(97);}};
 const result=await run(chunks,[],async source=>{for await(const bytes of source){assert.equal(bytes[0],97);assert.equal(bytes.at(-1),97);received+=bytes.byteLength;}});
 assert.equal(result.exitCode,0,result.error);assert.equal(received,size);assert.equal(result.stages,1);assert.equal(result.largestRead,16384);assert.equal(result.largestWrite,16384);
});

test('split UTF8 stdin preserves bytes and reference prompt separator',async()=>{
 const encoded=new TextEncoder().encode('before 🙂');let text='';
 const chunks={async *[Symbol.asyncIterator](){for(const byte of encoded)yield Uint8Array.of(byte);}};
 const result=await run(chunks,['after'],async source=>{const decoder=new TextDecoder('utf8',{fatal:true});for await(const bytes of source)text+=decoder.decode(bytes,{stream:true});text+=decoder.decode();});
 assert.equal(result.exitCode,0,result.error);assert.equal(text,'before 🙂 after');
});

test('invalid UTF8 is rejected before model transport and staging is released',async()=>{
 const chunks={async *[Symbol.asyncIterator](){yield Uint8Array.of(97);yield Uint8Array.of(0xff);}};
 const result=await run(chunks,[],async()=>{throw new Error('must not call');});
 assert.equal(result.exitCode,1);assert.equal(result.calls,0);assert.ok(result.error);
});

test('provider error releases retained prompt staging',async()=>{
 const chunks={async *[Symbol.asyncIterator](){yield Uint8Array.of(97);}};
 const result=await run(chunks,[],async source=>{for await(const bytes of source){assert.equal(bytes[0],97);throw new Error('provider failed');}});
 assert.equal(result.exitCode,1);assert.match(result.error,/provider failed/);
});
