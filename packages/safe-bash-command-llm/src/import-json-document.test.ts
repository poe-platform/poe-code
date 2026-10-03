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

test('JSON staging retains distinct raw-surrogate and scalar object keys',async()=>{
 const fs=new MemoryFileSystem(),raw=[0xed,0xa0,0x80,0xed,0xb0,0x80],scalar=[0xf0,0x90,0x80,0x80];
 const input=Uint8Array.from([123,34,...raw,34,58,49,44,34,...scalar,34,58,50,44,34,...raw,34,58,51,125]);
 await withEmbeddingJsonDocument({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:8},{async *[Symbol.asyncIterator](){yield input;}},async document=>{
  const first=await document.child(document.root.id);assert.ok(first);assert.equal(first.node.token,'3');assert.deepEqual(first.keyPoints,[0xd800,0xdc00]);
  const second=await document.child(document.root.id,first.position);assert.ok(second);assert.equal(second.node.token,'2');assert.deepEqual(second.keyPoints,[0x10000]);
  assert.equal(await document.child(document.root.id,second.position),undefined);
 });
 assert.deepEqual(await fs.readdir('/'),[]);
});
