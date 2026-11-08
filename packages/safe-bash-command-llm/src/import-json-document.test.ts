import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {withEmbeddingJsonDocument,openJsonDocument} from './import-json-document.js';
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

test('paged JSON indexing preserves insertion order through spills, collisions and duplicate replacements',async()=>{
 const fs=new MemoryFileSystem();
 const keys=['key-31ot-3682751805','key-345l-404067065',...Array.from({length:320},(_,index)=>String(320-index))];
 const input='{'+keys.map((key,index)=>JSON.stringify(key)+':'+index).join(',')+','+keys.map((key,index)=>JSON.stringify(key)+':'+(-index)).join(',')+',"nested":{"key-31ot-3682751805":41,"key-345l-404067065":42},"payload":"'+'🙂'.repeat(20000)+'"}';
 await withEmbeddingJsonDocument({fs,directory:'/',signal,maxFileBytes:8*1024*1024,maxOpenFiles:1},{async *[Symbol.asyncIterator](){const bytes=new TextEncoder().encode(input);for(let offset=0;offset<bytes.length;offset+=997)yield bytes.subarray(offset,offset+997);}},async document=>{
  let position=-1;
  for(let index=0;index<keys.length;index++){
   const child=await document.child(document.root.id,position);assert.ok(child);
   assert.equal(child.key,keys[index]);assert.equal(child.node.token,String(-index));position=child.position;
  }
  const nested=await document.child(document.root.id,position);assert.ok(nested);
  const first=await document.child(nested.node.id);assert.ok(first);assert.equal(first.node.token,'41');
  const second=await document.child(nested.node.id,first.position);assert.ok(second);assert.equal(second.node.token,'42');
  const payload=await document.child(document.root.id,nested.position);assert.ok(payload);
  let count=0;for await(const points of document.points(payload.node)){assert.ok(points.length<=4096);assert.ok(points.every(point=>point===0x1f642));count+=points.length;}
  assert.equal(count,20000);assert.equal(await document.child(document.root.id,payload.position),undefined);
 });
 assert.deepEqual(await fs.readdir('/'),[]);
});

for(const outcome of ['abort','callback','malformed','limit'] as const)test('paged JSON staging retires storage after '+outcome,async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),failure=new Error(outcome);let entered=false,retired=false;
 const input={async *[Symbol.asyncIterator](){try{
  if(outcome==='limit'){yield new TextEncoder().encode('['+'null,'.repeat(1024)+'null]');return;}
  yield new TextEncoder().encode('["');
  for(let index=0;index<24;index++)yield new Uint8Array(2048).fill(120);
  if(outcome==='abort')controller.abort(failure);
  yield new TextEncoder().encode(outcome==='malformed'?'",]':'"]');
 }finally{retired=true;}}};
 await assert.rejects(withEmbeddingJsonDocument({fs,directory:'/',signal:controller.signal,maxFileBytes:outcome==='limit'?65536:1048576,maxOpenFiles:1},input,async()=>{entered=true;throw failure;}),error=>outcome==='abort'||outcome==='callback'?error===failure:error instanceof Error);
 assert.equal(entered,outcome==='callback');assert.equal(retired,true);assert.deepEqual(await fs.readdir('/'),[]);
});

test('owned JavaScript JSON documents preserve normalized duplicate keys and explicit lifetime',async()=>{
 const fs=new MemoryFileSystem(),encoder=new TextEncoder();
 const input='{"\\ud800\\udc00":1,"𐀀":2,"body":"\\ud800","version":1.0}';
 const document=await openJsonDocument({fs,directory:'/',signal,maxFileBytes:1048576,maxOpenFiles:1,profile:'javascript'}, {async *[Symbol.asyncIterator](){for(const byte of encoder.encode(input))yield Uint8Array.of(byte);}});
 try{
  const first=await document.child(document.root.id);assert.ok(first);assert.equal(first.key,'𐀀');assert.equal(first.node.token,'2');
  const body=await document.child(document.root.id,first.position);assert.ok(body);let text='';for await(const part of document.text(body.node))text+=part;assert.equal(text,'\ud800');
  const version=await document.child(document.root.id,body.position);assert.ok(version);assert.equal(version.node.token,'1');
  assert.equal(await document.child(document.root.id,version.position),undefined);
 }finally{await document.close();}
 await assert.rejects(document.child(document.root.id));
 await document.close();assert.deepEqual(await fs.readdir('/'),[]);
});
