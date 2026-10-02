import assert from 'node:assert/strict';
import test from 'node:test';
import type { FileSystem } from 'safe-bash-contracts';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { transactSqlite } from './sqlite-transaction.js';
import { sqliteRecord } from './sqlite-record.js';
import { withSqliteStatement } from './sqlite-statement.js';
import { readSqliteBlob } from './sqlite-blob-read.js';

const signal=new AbortController().signal;
const repeat=(size:number,byte:number)=>({async *[Symbol.asyncIterator](){for(let offset=0;offset<size;offset+=16384)yield new Uint8Array(Math.min(16384,size-offset)).fill(byte);}});

test('cancellation interrupts a stalled batch producer and rolls back publication',async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),reason=new Error('cancelled');
 let admitted!:()=>void,closed=false;
 const ready=new Promise<void>(resolve=>{admitted=resolve;});
 await assert.rejects(transactSqlite({fs,path:'/data.db',signal:controller.signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:16,async finalize(editor){
  const writing=editor.rewriteRecords({[Symbol.asyncIterator](){return {
   next(){admitted();return new Promise<IteratorResult<never>>(()=>{});},
   async return(){closed=true;return {done:true as const,value:undefined};},
  };}});
  await ready;controller.abort(reason);await writing;
 }},async session=>session.execute('CREATE TABLE sample(value)')),error=>error===reason);
 assert.equal(closed,true);
 assert.deepEqual(await fs.readdir('/'),[]);
});

test('batch rewrites copy the private database once instead of once per row',async()=>{
 const memory=new MemoryFileSystem();let written=0,root=0;
 const fs=new Proxy(memory,{get(target,key){
  if(key==='open')return async(...args:Parameters<NonNullable<FileSystem['open']>>)=>{
   const file=await target.open(...args);return new Proxy(file,{get(descriptor,member){
    if(member==='write')return async(bytes:Uint8Array,position:number,controls?:{signal?:AbortSignal})=>{written+=bytes.length;return descriptor.write(bytes,position,controls);};
    const value=Reflect.get(descriptor,member,descriptor);return typeof value==='function'?value.bind(descriptor):value;
   }});
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }}) as FileSystem;
 await transactSqlite({fs,path:'/data.db',signal,maxFileBytes:2097152,maxIndexBytes:1048576,maxOpenFiles:16,async finalize(editor){
  written=0;
  await editor.rewriteRecords({async *[Symbol.asyncIterator](){
   for(let rowid=1n;rowid<=32n;rowid++)yield {rootPage:root,rowid,record:sqliteRecord([{type:'text',size:20000,bytes:repeat(20000,65)}])};
  }});
  assert.ok(written<2000000,`batch wrote ${written} bytes`);
  await editor.withSession(async session=>withSqliteStatement(session.module,{...session,signal,sql:'SELECT count(*) FROM sample WHERE typeof(value)=\'text\''},async query=>{
   for await(const [count]of query.rows([],['integer']))assert.equal(count,32n);
  }));
 }},async session=>{
  await session.execute('CREATE TABLE sample(value TEXT)');
  for(let index=0;index<32;index++)await session.execute('INSERT INTO sample VALUES(zeroblob(20000))');
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT rootpage FROM sqlite_schema WHERE name='sample'"},async query=>{
   for await(const [page]of query.rows([],['integer']))root=Number(page);
  });
 });
});

test('private record rewrites persist native TEXT without allocating complete field values',async()=>{
 const memory=new MemoryFileSystem();await memory.mkdir('/out');let transfers=0;
 const fs=new Proxy(memory,{get(target,key){
  if(key==='open')return async(...args:Parameters<NonNullable<FileSystem['open']>>)=>{
   const file=await target.open(...args);
   return new Proxy(file,{get(descriptor,member){
    if(member==='read'||member==='write')return async(bytes:Uint8Array,position:number,controls?:{signal?:AbortSignal})=>{
     assert.ok(bytes.length<=16384);transfers++;return descriptor[member](bytes,position,controls);
    };
    const value=Reflect.get(descriptor,member,descriptor);return typeof value==='function'?value.bind(descriptor):value;
   }});
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }}) as FileSystem;
 // Cross the four-byte serial boundary without making the unit suite a stress run.
 const size=1024*1024;
 const record=sqliteRecord([{type:'text',size,bytes:repeat(size,65)},{type:'text',size,bytes:repeat(size,66)}]);
 const options={fs,path:'/out/embeddings.db',signal,maxFileBytes:64*1024*1024,maxIndexBytes:1024,maxOpenFiles:16};
 let root=0,heap=0;
 const result=await transactSqlite({...options,async finalize(snapshot){
  await snapshot.rewriteRecord({rootPage:root,rowid:1n,record});
  await snapshot.withSession(async session=>{
   heap=session.module.HEAPU8.length;
   await withSqliteStatement(session.module,{...session,signal,sql:'SELECT typeof(content),typeof(metadata) FROM sample WHERE rowid=1'},async statement=>{
    for await(const row of statement.rows([],['text','text']))assert.deepEqual(row,['text','text']);
   });
   for(const [column,byte]of [['content',65],['metadata',66]] as const){
    let count=0;
    for await(const bytes of readSqliteBlob(session.module,{...session,signal,table:'sample',column,rowid:1n})){
     assert.ok(bytes.length<=16384);assert.ok(bytes.every(value=>value===byte));count+=bytes.length;
    }
    assert.equal(count,size);
   }
   assert.equal(session.module.HEAPU8.length,heap);
   const neighbors:string[][]=[];
   await withSqliteStatement(session.module,{...session,signal,sql:'SELECT content,metadata FROM sample WHERE rowid!=1 ORDER BY rowid'},async statement=>{
    for await(const row of statement.rows([],['text','text']))neighbors.push(row as string[]);
   });
   assert.deepEqual(neighbors,[['before','original'],['after','original']]);
   await withSqliteStatement(session.module,{...session,signal,sql:'PRAGMA integrity_check'},async statement=>{
    for await(const row of statement.rows([],['text']))assert.deepEqual(row,['ok']);
   });
  });
 }},async session=>{
  // Two fields: NULL serial plus a four-byte BLOB serial and one header byte.
  const initialHeap=session.module.HEAPU8.length;
  await session.execute(`CREATE TABLE sample(content TEXT,metadata TEXT); INSERT INTO sample(rowid,content,metadata) VALUES(0,'before','original'),(1,NULL,zeroblob(${record.size-6})),(2,'after','original');`);
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT rootpage FROM sqlite_schema WHERE name='sample'"},async statement=>{
   for await(const row of statement.rows([],['integer']))root=Number(row[0]);
  });
  assert.equal(session.module.HEAPU8.length,initialHeap);
  return 'written';
 });
 assert.ok(transfers>0);
 assert.equal(result.value,'written');assert.deepEqual(result.cleanupErrors,[]);
 assert.deepEqual((await fs.readdir('/out')).map(entry=>entry.name),['embeddings.db']);
});

test('failed record rewrites and final validation never publish partial native commits',async()=>{
 for(const failure of ['length','source','cancel','validation']){
  const fs=new MemoryFileSystem();await fs.mkdir('/out');
  const abort=new AbortController();
  const options={fs,path:'/out/embeddings.db',signal:abort.signal,maxFileBytes:1048576,maxIndexBytes:1024,maxOpenFiles:16};
  await transactSqlite(options,async session=>{await session.execute('CREATE TABLE original(value); INSERT INTO original VALUES(42);');});
  const before=await fs.readFile('/out/embeddings.db');let root=0;
  const source={async *[Symbol.asyncIterator](){yield new Uint8Array(100).fill(65);if(failure==='cancel')abort.abort(new Error('cancel rewrite'));if(failure==='source')throw new Error('source failed');yield new Uint8Array(100).fill(65);}};
  const record=sqliteRecord([{type:'text',size:failure==='length'?201:200,bytes:source}]);
  await assert.rejects(transactSqlite({...options,async finalize(snapshot){
   await snapshot.rewriteRecord({rootPage:root,rowid:1n,record});
   if(failure==='validation')throw new Error('final validation failed');
  }},async session=>{
   await session.execute('CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES(zeroblob(200));');
   await withSqliteStatement(session.module,{...session,signal:abort.signal,sql:"SELECT rootpage FROM sqlite_schema WHERE name='sample'"},async statement=>{
    for await(const row of statement.rows([],['integer']))root=Number(row[0]);
   });
  }));
  assert.deepEqual(await fs.readFile('/out/embeddings.db'),before);
  assert.deepEqual((await fs.readdir('/out')).map(entry=>entry.name),['embeddings.db']);
 }
});

test('caught finalization failures still prevent canonical publication',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/out');
 await assert.rejects(transactSqlite({fs,path:'/out/embeddings.db',signal,maxFileBytes:1048576,maxIndexBytes:1024,maxOpenFiles:16,async finalize(editor){
  await assert.rejects(editor.rewriteRecord({rootPage:2,rowid:1n,record:sqliteRecord([null])}));
 }},async session=>{await session.execute('CREATE TABLE sample(value);');}));
 await assert.rejects(fs.stat('/out/embeddings.db'),{code:'ENOENT'});
 assert.deepEqual(await fs.readdir('/out'),[]);
});

test('overlapping finalization is rejected and pending work retires before rollback',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/out');
 let release!:()=>void,started!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const entered=new Promise<void>(resolve=>{started=resolve;});
 let finished=false;
 await assert.rejects(transactSqlite({fs,path:'/out/embeddings.db',signal,maxFileBytes:1048576,maxIndexBytes:1024,maxOpenFiles:16,async finalize(editor){
  const pending=editor.withSession(async session=>{started();await gate;await session.execute('INSERT INTO sample VALUES(1)');finished=true;});
  await entered;
  await assert.rejects(editor.withSession(async()=>{}),{code:'EBUSY'});
  assert.equal(finished,false);release();await pending;
 }},async session=>{await session.execute('CREATE TABLE sample(value);');}),{code:'EBUSY'});
 assert.equal(finished,true);
 assert.deepEqual(await fs.readdir('/out'),[]);
});

test('successful unawaited finalization is drained and escaped editors cannot reopen files',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/out');
 let editor: import('./sqlite-finalization.js').SqliteFinalizer|undefined;
 let finished=false;
 await transactSqlite({fs,path:'/out/embeddings.db',signal,maxFileBytes:1048576,maxIndexBytes:1024,maxOpenFiles:16,async finalize(value){
  editor=value;
  void value.withSession(async session=>{await session.execute('INSERT INTO sample VALUES(1)');finished=true;});
 }},async session=>{await session.execute('CREATE TABLE sample(value);');});
 assert.equal(finished,true);
 await assert.rejects(editor!.withSession(async()=>{}),{code:'EBADF'});
 assert.deepEqual((await fs.readdir('/out')).map(entry=>entry.name),['embeddings.db']);
});
