import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {transactSqlite} from './sqlite-transaction.js';
import {withSqliteQueryRecords} from './sqlite-query-records.js';
const limits={maxFileBytes:8*1024*1024,maxIndexBytes:1024*1024,maxOpenFiles:16};
const signal=new AbortController().signal;
test('query results stream large mixed fields from caller storage and preserve attached sources',async()=>{
 const fs=new MemoryFileSystem();
 for(const path of ['/main','/other'])await transactSqlite({fs,path,signal,...limits},s=>s.execute("CREATE TABLE sample(id INTEGER,content TEXT); INSERT INTO sample VALUES(7,'original')"));
 const before=await Promise.all(['/main','/other'].map(path=>fs.readFile(path)));
 let rows=0;
 await withSqliteQueryRecords({fs,path:'/main',directory:'/',signal,...limits,attachments:[{alias:'other',path:'/other'}],sql:"SELECT a.id,b.content,zeroblob(1048577),NULL,1.5 FROM sample a JOIN other.sample b"},async values=>{
  for await(const row of values){
   rows++;assert.equal(row[0],7n);assert.equal(row[3],null);assert.equal(row[4],1.5);
   for(const [index,expected]of [[1,8],[2,1048577]]){
    const value=row[index!]!;assert.equal(typeof value,'object');assert.ok(value&&typeof value==='object');
    assert.equal(value.size,expected);let size=0;
    for await(const part of value.bytes){assert.ok(part.length<=65536);size+=part.length;}
    assert.equal(size,expected);
   }
  }
 });
 assert.equal(rows,1);assert.deepEqual(await Promise.all(['/main','/other'].map(path=>fs.readFile(path))),before);
 assert.deepEqual((await fs.readdir('/')).map(e=>e.name),['main','other']);
});
test('early query consumer failure preserves its reason and cleans private results',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/main',signal,...limits},s=>s.execute('CREATE TABLE sample(id INTEGER)'));
 const reason=new Error('consumer stopped');
 await assert.rejects(withSqliteQueryRecords({fs,path:'/main',directory:'/',signal,...limits,sql:'SELECT 1'},async rows=>{for await(const ignored of rows)throw reason;}),error=>error===reason);
 assert.deepEqual((await fs.readdir('/')).map(e=>e.name),['main']);
});
for(const sql of ['SELECT 1); SELECT 2 --','SELECT 1); --','DELETE FROM sample RETURNING id'])test('query input cannot escape its SELECT: '+sql,async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/main',signal,...limits},s=>s.execute('CREATE TABLE sample(id INTEGER)'));
 let admitted=false;
 await assert.rejects(withSqliteQueryRecords({fs,path:'/main',directory:'/',signal,...limits,sql},async()=>{admitted=true;}));
 assert.equal(admitted,false);
 assert.deepEqual((await fs.readdir('/')).map(e=>e.name),['main']);
});
test('query metadata preserves duplicate names and original column order',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/main',signal,...limits},s=>s.execute('CREATE TABLE sample(id INTEGER)'));
 await withSqliteQueryRecords({fs,path:'/main',directory:'/',signal,...limits,sql:'SELECT 1 AS id,2 AS content,3 AS content'},async(rows,columns)=>{
  assert.deepEqual(columns,['id','content','content']);
  for await(const row of rows)assert.deepEqual(row,[1n,2n,3n]);
 });
});
test('computed queries yield to cancellation and retire snapshots before rejection',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/main',signal,...limits},s=>s.execute('CREATE TABLE sample(id INTEGER)'));
 const controller=new AbortController(),reason=new Error('stop computed query');
 const timer=setTimeout(()=>controller.abort(reason),25);
 try{
  await assert.rejects(withSqliteQueryRecords({fs,path:'/main',directory:'/',signal:controller.signal,...limits,sql:'WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<1000000000) SELECT sum(n) FROM numbers'},async()=>{}),error=>error===reason);
 }finally{clearTimeout(timer);}
 assert.deepEqual((await fs.readdir('/')).map(e=>e.name),['main']);
});
test('escaped query field sources fail after the callback returns',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/main',signal,...limits},s=>s.execute('CREATE TABLE sample(id INTEGER)'));
 let escaped:AsyncIterable<Uint8Array>|undefined;
 await withSqliteQueryRecords({fs,path:'/main',directory:'/',signal,...limits,sql:"SELECT 'borrowed'"},async rows=>{for await(const row of rows){const field=row[0];assert.ok(field&&typeof field==='object');escaped=field.bytes;break;}});
 await assert.rejects(async()=>{for await(const ignored of escaped!)assert.fail('escaped bytes');},{code:'EBADF'});
});
test('querying the source schema does not observe the result table',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/main',signal,...limits},s=>s.execute('CREATE TABLE sample(id INTEGER)'));
 const names:string[]=[];
 await withSqliteQueryRecords({fs,path:'/main',directory:'/',signal,...limits,sql:'SELECT name FROM sqlite_schema'},async rows=>{for await(const row of rows){const field=row[0];assert.ok(field&&typeof field==='object');let name='';for await(const bytes of field.bytes)name+=new TextDecoder().decode(bytes);names.push(name);}});
 assert.deepEqual(names,['sample']);
});
for(const encoding of ['UTF-16le','UTF-16be'])test('query fields from '+encoding+' databases are exposed as UTF-8',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/main',signal,...limits},s=>s.execute("PRAGMA encoding='"+encoding+"'; CREATE TABLE sample(content TEXT); INSERT INTO sample VALUES ('界🙂')"));
 let value='';
 await withSqliteQueryRecords({fs,path:'/main',directory:'/',signal,...limits,sql:'SELECT content FROM sample'},async rows=>{for await(const row of rows){const field=row[0];assert.ok(field&&typeof field==='object');let size=0;for await(const bytes of field.bytes){size+=bytes.length;value+=new TextDecoder().decode(bytes);}assert.equal(size,field.size);}});
 assert.equal(value,'界🙂');
});
test('query diagnostics retain SQLite syntax and missing-table explanations',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/main',signal,...limits},s=>s.execute('CREATE TABLE sample(id INTEGER)'));
 for(const [sql,message]of [['SELECT * FROM missing','no such table: missing'],['SELECT FROM sample','syntax error']])await assert.rejects(withSqliteQueryRecords({fs,path:'/main',directory:'/',signal,...limits,sql:sql!},async()=>{}),error=>error instanceof Error&&error.message.includes(message!));
});
test('result staging preserves query value types without inferred column affinity',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/main',signal,...limits},s=>s.execute("CREATE TABLE sample(id INTEGER); INSERT INTO sample VALUES(7)"));
 const values:unknown[]=[];
 await withSqliteQueryRecords({fs,path:'/main',directory:'/',signal,...limits,sql:"SELECT id FROM sample UNION ALL SELECT '001'"},async rows=>{for await(const row of rows){const field=row[0];if(field&&typeof field==='object'){let text='';for await(const bytes of field.bytes)text+=new TextDecoder().decode(bytes);values.push(text);}else values.push(field);}});
 assert.deepEqual(values,[7n,'001']);
});
