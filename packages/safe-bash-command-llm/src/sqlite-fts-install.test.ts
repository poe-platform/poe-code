import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {withPrivateSqliteSession} from './sqlite-session.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {installSqliteFtsDocuments} from './sqlite-fts-install.js';
const signal=new AbortController().signal;
test('installed postings preserve native segments, phrase positions, empty documents and subsequent native merges',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/private');
 const options={fs,directory:'/private',path:'/private/db',signal,maxFileBytes:8*1048576,maxOpenFiles:16};
 await withPrivateSqliteSession(options,async s=>{await s.execute("CREATE VIRTUAL TABLE ft USING fts5(a,b,content=''); INSERT INTO ft(rowid,a,b) VALUES(1,'old alpha','original');");});
 await withPrivateSqliteSession(options,async s=>{
  await installSqliteFtsDocuments(s,{table:'ft',columns:2,signal,documents:(async function*(){
   yield {rowid:2n,columns:[toByteSource('alpha beta alpha'),toByteSource('gamma beta')]};
   yield {rowid:3n,columns:[toByteSource(''),toByteSource('')]};
   yield {rowid:4n,columns:[toByteSource('repeat '.repeat(9000)),toByteSource('finish')]};
  })()});
 });
 await withPrivateSqliteSession(options,async s=>{
  const matches=async(query:string)=>withSqliteStatement(s.module,{...s,signal,sql:'SELECT rowid FROM ft WHERE ft MATCH ? ORDER BY rowid'},async q=>{const ids=[];for await(const r of q.rows([query],['integer']))ids.push(r[0]);return ids;});
  assert.deepEqual(await matches('alpha'),[1n,2n]);
  assert.deepEqual(await matches('"alpha beta"'),[2n]);
  assert.deepEqual(await matches('b:gamma'),[2n]);
  assert.deepEqual(await matches('"repeat repeat"'),[4n]);
  await s.execute("INSERT INTO ft(ft) VALUES('integrity-check'); INSERT INTO ft(rowid,a,b) VALUES(5,'new alpha','new'); INSERT INTO ft(ft) VALUES('optimize'); INSERT INTO ft(ft) VALUES('integrity-check');");
  assert.deepEqual(await matches('alpha'),[1n,2n,5n]);
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT count(*) FROM ft_docsize'},async q=>{for await(const r of q.rows([],['integer']))assert.deepEqual(r,[5n]);});
 });
});

test('duplicate document IDs roll back an entire batch and leave the native index usable',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/private');
 const options={fs,directory:'/private',path:'/private/db',signal,maxFileBytes:1048576,maxOpenFiles:16};
 await withPrivateSqliteSession(options,async s=>{await s.execute("CREATE VIRTUAL TABLE ft USING fts5(a,content=''); INSERT INTO ft(rowid,a) VALUES(2,'original');");});
 await withPrivateSqliteSession(options,async s=>{
  await assert.rejects(installSqliteFtsDocuments(s,{table:'ft',columns:1,signal,documents:(async function*(){yield {rowid:1n,columns:[toByteSource('new')]};yield {rowid:2n,columns:[toByteSource('replacement')]};})()}));
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT id FROM ft_docsize ORDER BY id'},async q=>{const ids=[];for await(const r of q.rows([],['integer']))ids.push(r[0]);assert.deepEqual(ids,[2n]);});
 });
 await withPrivateSqliteSession(options,async s=>{await s.execute("INSERT INTO ft(ft) VALUES('integrity-check');");});
});

test('append preserves optimized levels and signed rowids through a later native merge',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/private');
 const options={fs,directory:'/private',path:'/private/db',signal,maxFileBytes:1048576,maxOpenFiles:16};
 await withPrivateSqliteSession(options,async s=>{await s.execute("CREATE VIRTUAL TABLE ft USING fts5(a,content=''); INSERT INTO ft(rowid,a) VALUES(1,'shared'); INSERT INTO ft(rowid,a) VALUES(2,'shared'); INSERT INTO ft(ft) VALUES('optimize');");});
 for(let i=0;i<3;i++)await withPrivateSqliteSession(options,async s=>{
  await installSqliteFtsDocuments(s,{table:'ft',columns:1,signal,documents:(async function*(){yield {rowid:[-129n,9007199254740993n,130n][i]!,columns:[toByteSource('shared phrase')]};})()});
 });
 await withPrivateSqliteSession(options,async s=>{
  await s.execute("INSERT INTO ft(ft) VALUES('integrity-check'); INSERT INTO ft(ft) VALUES('optimize'); INSERT INTO ft(ft) VALUES('integrity-check');");
  await withSqliteStatement(s.module,{...s,signal,sql:"SELECT rowid FROM ft WHERE ft MATCH 'shared' ORDER BY rowid"},async q=>{const ids=[];for await(const r of q.rows([],['integer']))ids.push(r[0]);assert.deepEqual(ids,[-129n,1n,2n,130n,9007199254740993n]);});
 });
});

test('empty documents update averages without manufacturing an empty segment',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/private');
 const options={fs,directory:'/private',path:'/private/db',signal,maxFileBytes:1048576,maxOpenFiles:16};
 await withPrivateSqliteSession(options,async s=>{await s.execute("CREATE VIRTUAL TABLE ft USING fts5(a,content='');");});
 await withPrivateSqliteSession(options,async s=>{await installSqliteFtsDocuments(s,{table:'ft',columns:1,signal,documents:(async function*(){yield {rowid:1n,columns:[toByteSource('')]};})()});});
 await withPrivateSqliteSession(options,async s=>{
  await s.execute("INSERT INTO ft(ft) VALUES('integrity-check'); INSERT INTO ft(rowid,a) VALUES(2,'word'); INSERT INTO ft(ft) VALUES('optimize'); INSERT INTO ft(ft) VALUES('integrity-check');");
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT block FROM ft_data WHERE id=1'},async q=>{for await(const r of q.rows([],['blob']))assert.deepEqual([...(r[0] as Uint8Array)],[2,1]);});
 });
});

test('external-content index installs multi-page term boundaries and supports native delete triggers',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/private');
 const options={fs,directory:'/private',path:'/private/db',signal,maxFileBytes:8*1048576,maxOpenFiles:16};
 const prompt=Array.from({length:1600},(_,i)=>'term'+String(i).padStart(5,'0')).join(' ');
 await withPrivateSqliteSession(options,async s=>{
  await s.execute("CREATE TABLE responses(prompt TEXT,response TEXT); CREATE VIRTUAL TABLE responses_fts USING fts5(prompt,response,content='responses');");
  await withSqliteStatement(s.module,{...s,signal,sql:'INSERT INTO responses(rowid,prompt,response) VALUES(1,?,?)'},async q=>{for await(const r of q.rows([prompt,'answer'],[]))void r;});
 });
 await withPrivateSqliteSession(options,async s=>{
  const heap=s.module.HEAPU8.length;
  await installSqliteFtsDocuments(s,{table:'responses_fts',columns:2,signal,documents:(async function*(){yield {rowid:1n,columns:[toByteSource(prompt),toByteSource('answer')]};})()});
  assert.equal(s.module.HEAPU8.length,heap);
 });
 await withPrivateSqliteSession(options,async s=>{
  await s.execute("INSERT INTO responses_fts(responses_fts,rank) VALUES('integrity-check',1);");
  await withSqliteStatement(s.module,{...s,signal,sql:"SELECT rowid FROM responses_fts WHERE responses_fts MATCH ?"},async q=>{
   for(const term of ['term00000','term00800','term01599','"term00999 term01000"']){const ids=[];for await(const r of q.rows([term],['integer']))ids.push(r[0]);assert.deepEqual(ids,[1n]);}
  });
  await s.execute("CREATE TRIGGER responses_ad AFTER DELETE ON responses BEGIN INSERT INTO responses_fts(responses_fts,rowid,prompt,response) VALUES('delete',old.rowid,old.prompt,old.response); END; DELETE FROM responses WHERE rowid=1; INSERT INTO responses_fts(responses_fts,rank) VALUES('integrity-check',1); INSERT INTO responses_fts(responses_fts) VALUES('optimize');");
 });
});
