import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {withCsvEmbeddingEntries} from './import-csv.js';
import type {LlmInputSource} from './types.js';

test('CSV entries preserve dictionary order, last duplicate headers and missing fields',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;
 const bytes=new TextEncoder().encode('key,title,key,body\nold,Hello,new,World\nfirst,Only\n\nlast,"a,b",actual,"two\nlines"\n');
 const rows:unknown[]=[];
 await withCsvEmbeddingEntries({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:8,prefix:'p:',prepend:'text:'}, {async *[Symbol.asyncIterator](){for(const byte of bytes)yield Uint8Array.of(byte);}},async entries=>{
  for await(const entry of entries){let text='';for await(const chunk of entry.input.bytes)text+=new TextDecoder().decode(chunk);rows.push([entry.id,text]);await entry.input.dispose();}
 });
 assert.deepEqual(rows,[['p:new','text:Hello World'],['p:None','text:Only '],['p:actual','text:a,b two\nlines']]);
 assert.deepEqual(await fs.readdir('/'),[]);
});

test('CSV payloads stay streamed, including large quoted Unicode fields',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;let size=0;
 await withCsvEmbeddingEntries({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:8}, {async *[Symbol.asyncIterator](){yield new TextEncoder().encode('id,text\n1,"');for(let i=0;i<100;i++)yield new TextEncoder().encode('🙂'.repeat(1024));yield new TextEncoder().encode('"\n');}},async entries=>{
  for await(const entry of entries){assert.equal(entry.id,'1');const decoder=new TextDecoder('utf-8',{fatal:true});for await(const bytes of entry.input.bytes){assert.ok(bytes.length<=16384);size+=decoder.decode(bytes,{stream:true}).length;}size+=decoder.decode().length;await entry.input.dispose();}
 });
 assert.equal(size,204800);assert.deepEqual(await fs.readdir('/'),[]);
});

test('CSV excess columns are rejected and clean up staging',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;
 await assert.rejects(withCsvEmbeddingEntries({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:8},{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('id,text\n1,hello,extra\n');}},async entries=>{for await(const entry of entries)await entry.input.dispose();}),/CSV row contains extra values/);
 assert.deepEqual(await fs.readdir('/'),[]);
});

test('CSV early return expires the row and removes retained payload and index files',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;let saved:LlmInputSource|undefined;
 await withCsvEmbeddingEntries({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:8},{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('id,text\n1,hello\n2,world\n');}},async entries=>{for await(const entry of entries){saved=entry.input;break;}});
 assert.ok(saved);
 const retained=saved;
 await assert.rejects(async()=>{for await(const ignored of retained.bytes){assert.fail('expired row yielded');}},{code:'EBADF'});
 assert.deepEqual(await fs.readdir('/'),[]);
});

test('CSV cancellation interrupts a stalled input pull and retires caller storage',async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController();let entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;});
 const input:AsyncIterable<Uint8Array>={[Symbol.asyncIterator](){return {next(){entered();return new Promise(()=>{});},return(){return new Promise(()=>{});}};}};
 const work=withCsvEmbeddingEntries({fs,directory:'/',signal:controller.signal,maxFileBytes:1048576,maxOpenFiles:8},input,async entries=>{for await(const entry of entries)await entry.input.dispose();});
 await ready;const reason=new Error('cancel import');controller.abort(reason);await assert.rejects(work,error=>error===reason);
 assert.deepEqual(await fs.readdir('/'),[]);
});
