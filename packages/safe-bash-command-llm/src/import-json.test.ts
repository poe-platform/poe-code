import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {withJsonEmbeddingEntries} from './import-json.js';
import {withJsonLinesEmbeddingEntries} from './import-json-lines.js';
import type {LlmInputSource} from './types.js';
const signal=new AbortController().signal;
test('JSON payload replay keeps large Unicode fields bounded',async()=>{
 const fs=new MemoryFileSystem();let count=0;
 await withJsonEmbeddingEntries({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:8},{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('[{"id":1,"body":"');for(let i=0;i<100;i++)yield new TextEncoder().encode('🙂'.repeat(1024));yield new TextEncoder().encode('"}]');}},async entries=>{
  for await(const entry of entries){assert.equal(entry.id,'1');const decoder=new TextDecoder('utf-8',{fatal:true});for await(const bytes of entry.input.bytes){assert.ok(bytes.length<=24576);count+=decoder.decode(bytes,{stream:true}).length;}count+=decoder.decode().length;await entry.input.dispose();}
 });
 assert.equal(count,204800);assert.deepEqual(await fs.readdir('/'),[]);
});
for(const [name,importer,text]of [['JSON',withJsonEmbeddingEntries,'[{"id":1,"body":"first"},{"id":2,"body":"second"}]'],['JSONL',withJsonLinesEmbeddingEntries,'{"id":1,"body":"first"}\n{"id":2,"body":"second"}\n']] as const){
 test(name+' early return expires its row and releases staging',async()=>{
  const fs=new MemoryFileSystem();let retained:LlmInputSource|undefined;
  await importer({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:8},{async *[Symbol.asyncIterator](){yield new TextEncoder().encode(text);}},async entries=>{for await(const entry of entries){retained=entry.input;break;}});
  assert.ok(retained);await assert.rejects(async()=>{for await(const bytes of retained!.bytes){void bytes;assert.fail('expired row yielded');}},{code:'EBADF'});assert.deepEqual(await fs.readdir('/'),[]);
 });
 test(name+' cancellation interrupts a stalled producer and releases staging',async()=>{
  const fs=new MemoryFileSystem(),controller=new AbortController();let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
  const input:AsyncIterable<Uint8Array>={[Symbol.asyncIterator](){let started=false;return {next(){if(!started){started=true;return Promise.resolve({done:false as const,value:new TextEncoder().encode('{"id":1,"body":"')});}entered();return new Promise(()=>{});},return(){return new Promise(()=>{});}};}};
  const work=importer({fs,directory:'/',signal:controller.signal,maxFileBytes:1048576,maxOpenFiles:8},input,async entries=>{for await(const entry of entries)await entry.input.dispose();});
  await ready;const reason=new Error('stop JSON input');controller.abort(reason);await assert.rejects(work,error=>error===reason);assert.deepEqual(await fs.readdir('/'),[]);
 });
}
test('JSON IDs retain lone surrogates until the collection storage encoder consumes them',async()=>{
 const fs=new MemoryFileSystem();
 await withJsonEmbeddingEntries({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:8},{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('{"id":"\\ud800","body":"x"}');}},async entries=>{for await(const entry of entries){assert.equal(entry.id,'\ud800');await entry.input.dispose();}});
 assert.deepEqual(await fs.readdir('/'),[]);
});
test('JSON content type errors retain integer versus float identity beyond Number range',async()=>{
 for(const [token,type]of [['1'+'0'.repeat(400),'int'],['1e400','float']]){
  const fs=new MemoryFileSystem();
  await assert.rejects(withJsonEmbeddingEntries({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:8},{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('{"id":1,"body":'+token+'}');}},async entries=>{for await(const entry of entries)for await(const bytes of entry.input.bytes)void bytes;}),error=>error instanceof Error&&error.message==='sequence item 0: expected str instance, '+type+' found');
  assert.deepEqual(await fs.readdir('/'),[]);
 }
});

for(const [name,text,expected]of [
 ['per-line BOM','\ufeff{"id":1,"body":"a"}\n\ufeff{"id":2,"body":"b"}\n',[['1','a'],['2','b']]],
 ['blank byte whitespace','\x0b\x0c\r\n{"id":1,"body":"a"}\n',[['1','a']]],
] as const){
 test('JSONL reference '+name+' survives single-byte chunks',async()=>{
  const fs=new MemoryFileSystem(),actual:string[][]=[];
  await withJsonLinesEmbeddingEntries({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:8},{async *[Symbol.asyncIterator](){for(const byte of new TextEncoder().encode(text))yield Uint8Array.of(byte);}},async entries=>{
   for await(const entry of entries){let body='';for await(const bytes of entry.input.bytes)body+=new TextDecoder().decode(bytes);actual.push([entry.id,body]);}
  });
  assert.deepEqual(actual,expected);assert.deepEqual(await fs.readdir('/'),[]);
 });
}
test('JSONL does not accept nonblank control whitespace or unwrap array rows',async()=>{
 for(const text of ['\x0b{"id":1,"body":"a"}\n','[{"id":1,"body":"a"}]\n']){
  const fs=new MemoryFileSystem();let count=0;
  await assert.rejects(withJsonLinesEmbeddingEntries({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:8},{async *[Symbol.asyncIterator](){yield new TextEncoder().encode(text);}},async entries=>{for await(const entry of entries){count++;await entry.input.dispose();}}));
  assert.equal(count,0);assert.deepEqual(await fs.readdir('/'),[]);
 }
});
