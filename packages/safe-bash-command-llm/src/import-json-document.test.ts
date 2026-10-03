import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {withEmbeddingJsonDocument} from './import-json-document.js';
const signal=new AbortController().signal;
test('JSON import staging preserves duplicate-key order, nested types and lone surrogates',async()=>{
 const fs=new MemoryFileSystem();const input='{"id":"old","body":"\\ud800","id":1e0,"empty":[]}';
 await withEmbeddingJsonDocument({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:8},{async *[Symbol.asyncIterator](){yield new TextEncoder().encode(input);}},async document=>{
  assert.equal(document.root.type,'object');
  const first=await document.child(document.root.id);assert.ok(first);assert.equal(first.node.token,'1e0');
  const second=await document.child(document.root.id,first.position);assert.ok(second);let text='';for await(const chunk of document.text(second.node))text+=chunk;assert.equal(text,'\ud800');
  const third=await document.child(document.root.id,second.position);assert.ok(third);assert.equal(third.node.type,'array');assert.equal(await document.child(third.node.id),undefined);
 });
 assert.deepEqual(await fs.readdir('/'),[]);
});
test('malformed JSON is rejected before exposing staged records and releases caller storage',async()=>{
 const fs=new MemoryFileSystem();let entered=false,retired=false;
 await assert.rejects(withEmbeddingJsonDocument({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:8},{async *[Symbol.asyncIterator](){try{yield new TextEncoder().encode('[{"id":1,"body":"good"},');}finally{retired=true;}}},async()=>{entered=true;}));
 assert.equal(entered,false);assert.equal(retired,true);assert.deepEqual(await fs.readdir('/'),[]);
});
