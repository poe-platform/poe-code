import assert from 'node:assert/strict';
import test from 'node:test';
import {createMemoryFileSystem} from '@poe-code/safe-fs';
import {createCommandArguments} from 'safe-bash-contracts';
import {createSqlite3Command, type SqliteEngineInstance} from './index.js';

for(const destination of ['stdout','once','output'] as const) test(`streams SQL dump to ${destination} with bounded writes`,async()=>{
 const fs=createMemoryFileSystem(),value="é😀'".repeat(20000);
 let largest=0,stdout='',stderr='';const decoder=new TextDecoder();
 const engine:SqliteEngineInstance={tables:new Map([['t',{name:'t',sql:'CREATE TABLE t(x)',columns:[{name:'x'}],rows:[{data:{x:value}},{data:{x:new Uint8Array([0,255,17])}}]}]]),executeStatement(){return null;}};
 const filesystem=new Proxy(fs,{get(target,key){
  if(key==='writeFile'||key==='appendFile')return()=>{throw new Error('whole-file output forbidden');};
  if(key==='open')return async(...args:Parameters<typeof fs.open>)=>{
   const handle=await fs.open(...args);return new Proxy(handle,{get(target,key){
    if(key==='write')return async(...args:Parameters<typeof handle.write>)=>{largest=Math.max(largest,args[0].length);return handle.write(...args);};
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
   }});
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 const args=[':memory:',...(destination==='stdout'?[]:[`.${destination} /result`]),'.dump','.print after'];
 const result=await createSqlite3Command({engine}).execute({command:'sqlite3',...createCommandArguments(args),fs:filesystem,cwd:'/',env:{},signal:new AbortController().signal,
  stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(bytes){largest=Math.max(largest,bytes.length);stdout+=decoder.decode(bytes,{stream:true});}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
 assert.equal(result.exitCode,0,stderr);
 const dump="PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\nCREATE TABLE t(x);\nINSERT INTO t VALUES('"+value.replaceAll("'","''")+"');\nINSERT INTO t VALUES(X'00FF11');\nCOMMIT;\n";
 if(destination==='stdout')assert.equal(stdout,dump+'after\n');
 else{assert.equal(new TextDecoder().decode(await fs.readFile('/result')),dump+(destination==='output'?'after\n':''));assert.equal(stdout,destination==='once'?'after\n':'');}
 assert.ok(largest>0&&largest<=16384,`largest write ${largest}`);
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),destination==='stdout'?[]:['result']);
});

for(const mode of ['limit','cancel','publish','pipe'] as const) test(`cleans retained output and preserves the destination on ${mode}`,async()=>{
 const fs=createMemoryFileSystem(),controller=new AbortController(),reason=new Error('output failure');
 await fs.writeFile('/result',new TextEncoder().encode('saved'));
 let created=0,removed=0,closed=0,diagnostic='';
 const filesystem=new Proxy(fs,{get(target,key){
  if(key==='publishStagedFile'&&mode==='publish')return async()=>{throw reason;};
  if(key==='createStagedFile')return async(...args:Parameters<typeof fs.createStagedFile>)=>{
   const stage=await fs.createStagedFile(...args);created++;
   return {...stage,writer:{async write(bytes:Uint8Array,options?:{signal?:AbortSignal}){await stage.writer!.write(bytes,options);if(mode==='cancel')controller.abort(reason);},finish:stage.writer!.finish.bind(stage.writer)},
    cleanup:{async remove(){removed++;await stage.cleanup!.remove();},async close(){closed++;await stage.cleanup!.close();}}};
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 const engine:SqliteEngineInstance={tables:new Map([['t',{name:'t',sql:'CREATE TABLE t(x)',columns:[{name:'x'}],rows:[{data:{x:'x'.repeat(200000)}}]}]]),executeStatement(){return null;}};
 const result=createSqlite3Command({engine,limits:mode==='limit'?{maxOutputBytes:70000}:{}}).execute({command:'sqlite3',...createCommandArguments([':memory:',...(mode==='pipe'?[]:['.once /result']),'.dump']),fs:filesystem,cwd:'/',env:{},signal:controller.signal,
  stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(){throw reason;}},stderr:{async write(bytes){diagnostic+=new TextDecoder().decode(bytes);}}});
 if(mode==='cancel')await assert.rejects(Promise.resolve(result),error=>error===reason);
 else{assert.equal((await result).exitCode,1);assert.ok(diagnostic.includes(mode==='limit'?'maxOutputBytes':'output failure'));}
 assert.equal(new TextDecoder().decode(await fs.readFile('/result')),'saved');
 assert.equal(removed,created);assert.equal(closed,created);
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['result']);
});

test('atomic once output follows symlinks and preserves hardlink identity and mode',async()=>{
 const fs=createMemoryFileSystem();await fs.writeFile('/target',new TextEncoder().encode('saved'));await fs.chmod('/target',0o640);await fs.link('/target','/hard');await fs.symlink('/target','/alias');
 const before=await fs.stat('/target');
 const result=await createSqlite3Command().execute({command:'sqlite3',...createCommandArguments([':memory:','.once /alias','.print replaced']),fs,cwd:'/',env:{},signal:new AbortController().signal,
  stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(){assert.fail('unexpected stdout');}},stderr:{async write(bytes){assert.fail(new TextDecoder().decode(bytes));}}});
 assert.equal(result.exitCode,0);assert.equal(new TextDecoder().decode(await fs.readFile('/hard')),'replaced\n');
 const after=await fs.stat('/target');assert.equal(after.ino,before.ino);assert.equal(after.mode&0o777,0o640);assert.equal(await fs.readlink('/alias'),'/target');
});

test('streamed UTF-8 retains a leading BOM and surrogate pairs across fragments',async()=>{
 const {encodeOutput}=await import('./stream-output.js');
 const parts=['\ufeff','a'.repeat(4095)+'\ud83d','\ude00','\ud83d'];
 const chunks:Uint8Array[]=[];
 for await(const chunk of encodeOutput(parts)){assert.ok(chunk.length<=16384);chunks.push(chunk);}
 assert.deepEqual(Buffer.concat(chunks),Buffer.from(parts.join(''),'utf8'));
});
