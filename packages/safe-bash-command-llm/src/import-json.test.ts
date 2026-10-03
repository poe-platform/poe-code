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
  const input:AsyncIterable<Uint8Array>={[Symbol.asyncIterator](){return {next(){entered();return new Promise(()=>{});},return(){return new Promise(()=>{});}};}};
  const work=importer({fs,directory:'/',signal:controller.signal,maxFileBytes:1048576,maxOpenFiles:8},input,async entries=>{for await(const entry of entries)await entry.input.dispose();});
  await ready;const reason=new Error('stop JSON input');controller.abort(reason);await assert.rejects(work,error=>error===reason);assert.deepEqual(await fs.readdir('/'),[]);
 });
}
test('JSON IDs never silently replace invalid Unicode while nested repr escapes it',async()=>{
 const fs=new MemoryFileSystem();
 await assert.rejects(withJsonEmbeddingEntries({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:8},{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('{"id":"\\ud800","body":"x"}');}},async entries=>{for await(const entry of entries)await entry.input.dispose();}),/surrogates not allowed/);
 assert.deepEqual(await fs.readdir('/'),[]);
});
test('JSON content type errors retain integer versus float identity beyond Number range',async()=>{
 for(const [token,type]of [['1'+'0'.repeat(400),'int'],['1e400','float']]){
  const fs=new MemoryFileSystem();
  await assert.rejects(withJsonEmbeddingEntries({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:8},{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('{"id":1,"body":'+token+'}');}},async entries=>{for await(const entry of entries)for await(const bytes of entry.input.bytes)void bytes;}),error=>error instanceof Error&&error.message==='sequence item 0: expected str instance, '+type+' found');
  assert.deepEqual(await fs.readdir('/'),[]);
 }
});
