import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {transactSqlite} from './sqlite-transaction.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {withSqliteReadSession} from './sqlite-read-session.js';

const withoutAccessTime=(stat:Awaited<ReturnType<MemoryFileSystem['stat']>>)=>({...stat,atimeMs:0});
const signal=new AbortController().signal;
const limits={maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:16};

test('read sessions query attached snapshots without publishing canonical changes',async()=>{
 const fs=new MemoryFileSystem();
 for(const path of ['/main','/other'])await transactSqlite({fs,path,signal,...limits},session=>session.execute("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('original')"));
 const before=await Promise.all(['/main','/other'].map(async path=>withoutAccessTime(await fs.stat(path))));
 const result=await withSqliteReadSession({fs,path:'/main',directory:'/',signal,...limits,attachments:[{alias:'other',path:'/other'}]},async session=>{
  return withSqliteStatement(session.module,{...session,signal,sql:'SELECT a.value,b.value FROM sample a JOIN other.sample b'},async query=>{
   const rows=[];for await(const row of query.rows([],['text','text']))rows.push(row);return rows;
  });
 });
 assert.deepEqual(result,[['original','original']]);
 assert.deepEqual(await Promise.all(['/main','/other'].map(async path=>withoutAccessTime(await fs.stat(path)))),before);
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['main','other']);
});

test('read snapshots preserve WAL files and committed rows',async()=>{
 const {default:fixture}=await import('./fixtures/sqlite-wal-records.json',{with:{type:'json'}});
 for(const variant of fixture.variants){
  const fs=new MemoryFileSystem();await fs.writeFile('/main',Buffer.from(fixture.database,'base64'));await fs.writeFile('/main-wal',Buffer.from(variant.wal,'base64'));
  const original=withoutAccessTime(await fs.stat('/main')),wal=withoutAccessTime(await fs.stat('/main-wal'));
  const result=await withSqliteReadSession({fs,path:'/main',directory:'/',signal,...limits},session=>withSqliteStatement(session.module,{...session,signal,sql:'SELECT id,content FROM schemas ORDER BY id'},async query=>{
   const rows=[];for await(const row of query.rows([],['text','text']))rows.push(row);return rows;
  }));
  assert.deepEqual(result,variant.rows);assert.deepEqual(withoutAccessTime(await fs.stat('/main')),original);assert.deepEqual(withoutAccessTime(await fs.stat('/main-wal')),wal);
  assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['main','main-wal']);
 }
});

test('failed attachment acquisition retires all private snapshots',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/main',signal,...limits},session=>session.execute('CREATE TABLE sample(value)'));
 await assert.rejects(withSqliteReadSession({fs,path:'/main',directory:'/',signal,...limits,attachments:[{alias:'missing',path:'/absent'}]},async()=>{}),{code:'ENOENT'});
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['main']);
});

test('snapshot queries cannot publish writes and retire after cancellation',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/main',signal,...limits},session=>session.execute("CREATE TABLE sample(value); INSERT INTO sample VALUES ('original')"));
 const original=await fs.readFile('/main');
 await assert.rejects(withSqliteReadSession({fs,path:'/main',directory:'/',signal,...limits},session=>session.execute("UPDATE sample SET value='changed'")));
 const controller=new AbortController();
 await assert.rejects(withSqliteReadSession({fs,path:'/main',directory:'/',signal:controller.signal,...limits},async()=>{controller.abort(new Error('cancel snapshot'));}),/cancel snapshot/);
 assert.deepEqual(await fs.readFile('/main'),original);
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['main']);
});

test('read sessions bound source reads and retain an immutable snapshot after acquisition',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/main',signal,...limits},session=>session.execute("CREATE TABLE sample(value); INSERT INTO sample VALUES ('original')"));
 let reads=0;
 const view=new Proxy(fs,{get(target,key){
  if(key==='readFile')return ()=>{throw new Error('whole-file acquisition forbidden');};
  if(key==='openReadFile')return async(...args:Parameters<typeof fs.openReadFile>)=>{
   const file=await target.openReadFile(...args);return {...file,async read(position:number,count:number,controls?:{signal?:AbortSignal}){assert.ok(count<=16384);reads++;return file.read(position,count,controls);}};
  };
  const value:unknown=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const rows=await withSqliteReadSession({fs:view,path:'/main',directory:'/',signal,...limits},async session=>{
  await fs.writeFile('/main',new Uint8Array([7]));
  return withSqliteStatement(session.module,{...session,signal,sql:'SELECT value FROM sample'},async query=>{const values=[];for await(const row of query.rows([],['text']))values.push(row);return values;});
 });
 assert.ok(reads>0);assert.deepEqual(rows,[['original']]);assert.deepEqual(await fs.readFile('/main'),new Uint8Array([7]));
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['main']);
});
