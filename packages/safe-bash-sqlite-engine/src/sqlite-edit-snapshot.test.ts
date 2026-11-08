import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {transactSqlite} from './sqlite-transaction.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {readSqliteRecord} from './sqlite-record-read.js';
import type {SqliteEditSnapshot} from './sqlite-edit-snapshot.js';
import type {ByteSource} from 'safe-bash-contracts';

const signal=new AbortController().signal;
const options=(fs:MemoryFileSystem)=>({fs,path:'/data.db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:16});
test('edit snapshot preserves source records across native target mutations and expires streams',async()=>{
 const fs=new MemoryFileSystem();let root=0,escaped:SqliteEditSnapshot|undefined,bytes:ByteSource|undefined;
 await transactSqlite({...options(fs),async finalize(editor){
  await editor.withSnapshot(async(source,target)=>{
   escaped=source;
   await target.withSession(async session=>session.execute("UPDATE sample SET value='new'"));
   const stored=await source.findRecord(root,-1n,'at-or-after');assert.equal(stored?.rowid,1n);
   const values=await readSqliteRecord(stored!,{signal,maxColumns:1});
   const field=values[0];assert.ok(field&&typeof field==='object');bytes=field.bytes;
   let text='';for await(const part of field.bytes)text+=new TextDecoder().decode(part);
   assert.equal(text,'original');
   assert.equal(await source.findRecord(root,2n),undefined);
  });
  await assert.rejects(escaped!.findRecord(root,1n),{code:'EBADF'});
  await assert.rejects(bytes![Symbol.asyncIterator]().next(),{code:'EBADF'});
 }},async session=>{
  await session.execute("CREATE TABLE sample(value TEXT);INSERT INTO sample VALUES('original')");
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT rootpage FROM sqlite_schema WHERE name='sample'"},async query=>{
   for await(const [page]of query.rows([],['integer']))root=Number(page);
  });
 });
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['data.db']);
 await transactSqlite(options(fs),async session=>withSqliteStatement(session.module,{...session,signal,sql:'SELECT value FROM sample'},async query=>{
  for await(const [value]of query.rows([],['text']))assert.equal(value,'new');
 }));
});

test('caught snapshot read errors poison publication and remove scratch copies',async()=>{
 const fs=new MemoryFileSystem();
 await assert.rejects(transactSqlite({...options(fs),async finalize(editor){
  await editor.withSnapshot(async source=>{
   await assert.rejects(source.findRecord(0,1n),{code:'EIO'});
  });
 }},async session=>session.execute('CREATE TABLE sample(value)')),{code:'EIO'});
 assert.deepEqual(await fs.readdir('/'),[]);
});
