import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {prepareSqliteAttachments} from './sqlite-attachments.js';
import {transactSqlite} from './sqlite-transaction.js';
const limits={maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:16},signal=new AbortController().signal;
test('attachment preparation bounds reads and preserves canonical data and metadata',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/source',signal,...limits},s=>s.execute('CREATE TABLE sample(value); INSERT INTO sample VALUES(zeroblob(70000))'));
 const original=await fs.readFile('/source'),before=await fs.stat('/source');let reads=0;
 const view=new Proxy(fs,{get(target,key){
  if(key==='readFile')return ()=>{throw new Error('whole file forbidden');};
  if(key==='openReadFile')return async(...args:Parameters<typeof fs.openReadFile>)=>{
   const file=await target.openReadFile(...args);return {...file,async read(position:number,count:number,controls?:{signal?:AbortSignal}){assert.ok(count<=16384);reads++;return file.read(position,count,controls);}};
  };
  const value:unknown=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 await prepareSqliteAttachments({fs:view,path:'/db',directory:'/',signal,...limits,attachments:[{alias:'source',path:'/source'},{alias:'new',path:'/empty'}]});
 assert.ok(reads>1);assert.deepEqual(await fs.readFile('/source'),original);
 const after=await fs.stat('/source');assert.equal(after.mtimeMs,before.mtimeMs);assert.equal(after.ctimeMs,before.ctimeMs);
 assert.equal((await fs.stat('/db')).size,0);assert.equal((await fs.stat('/empty')).size,0);
 assert.deepEqual((await fs.readdir('/')).map(e=>e.name),['db','empty','source']);
});
test('attachment preparation retires storage after a byte-limit failure',async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile('/source',new Uint8Array(1025));
 await assert.rejects(prepareSqliteAttachments({fs,path:'/db',directory:'/',signal,...limits,maxFileBytes:1024,attachments:[{alias:'source',path:'/source'},{alias:'later',path:'/later'}]}),{code:'EFBIG'});
 assert.deepEqual((await fs.readdir('/')).map(e=>e.name),['db','source']);
});
test('cancelled attachment copying retires descriptors and skips later sources',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite({fs,path:'/source',signal,...limits},s=>s.execute('CREATE TABLE sample(value)'));
 const controller=new AbortController(),reason=new Error('cancel copying');let closed=0;
 const view=new Proxy(fs,{get(target,key){
  if(key==='openReadFile')return async(...args:Parameters<typeof fs.openReadFile>)=>{
   const file=await target.openReadFile(...args);if(args[0]!=='/source')return file;
   return {...file,async read(){controller.abort(reason);throw reason;},async close(){closed++;await file.close();}};
  };
  const value:unknown=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 await assert.rejects(prepareSqliteAttachments({fs:view,path:'/db',directory:'/',signal:controller.signal,...limits,attachments:[{alias:'source',path:'/source'},{alias:'later',path:'/later'}]}),error=>error===reason);
 assert.equal(closed,1);assert.deepEqual((await fs.readdir('/')).map(e=>e.name),['db','source']);
});
