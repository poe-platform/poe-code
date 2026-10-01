import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import type {FileSystem} from 'safe-bash-contracts';
import {createSqlitePageStaging} from './sqlite-page-staging.js';
async function setup(){
 const memory=new MemoryFileSystem();await memory.mkdir('/private');
 const fs=new Proxy(memory,{get(target,key){if(key==='open')return undefined;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}) as FileSystem;
 return {memory,fs};
}
const options={directory:'/private',chunkBytes:4096,maxFileBytes:4096*100001};
test('stores owned sparse pages through injected storage without positioned descriptors',async()=>{
 const {memory,fs}=await setup(),store=await createSqlitePageStaging(fs,options);
 const bytes=new Uint8Array(4096).fill(7);
 await store.writePage(100000,bytes);bytes.fill(9);
 assert.deepEqual(await store.readPage(100000),new Uint8Array(4096).fill(7));assert.equal(await store.readPage(99999),undefined);
 await store.writePage(0,new Uint8Array(4096).fill(3));assert.equal((await memory.readdir('/private')).length,2);
 await store.close();assert.deepEqual(await memory.readdir('/private'),[]);
});
test('truncation masks old pages and zeros the retained partial page',async()=>{
 const {memory,fs}=await setup(),store=await createSqlitePageStaging(fs,options);
 await store.writePage(0,new Uint8Array(4096).fill(5));await store.writePage(100000,new Uint8Array(4096).fill(8));
 await store.truncate(10);
 const first=await store.readPage(0);assert.ok(first);assert.deepEqual(first.slice(0,10),new Uint8Array(10).fill(5));assert.ok(first.slice(10).every(v=>v===0));assert.equal(await store.readPage(100000),undefined);
 await store.writePage(100000,new Uint8Array(4096).fill(4));assert.equal((await memory.readdir('/private')).length,2);
 await store.close();assert.deepEqual(await memory.readdir('/private'),[]);
});
test('does not delete a replaced private directory or replaced page',async()=>{
 const {memory,fs}=await setup(),store=await createSqlitePageStaging(fs,options);
 await store.writePage(0,new Uint8Array(4096));const name=(await memory.readdir('/private'))[0]?.name;assert.ok(name);
 await memory.rename('/private','/moved');await memory.mkdir('/private');await memory.writeFile('/private/'+name,new Uint8Array([42]));
 await assert.rejects(store.close(),{code:'EAGAIN'});assert.deepEqual(await memory.readFile('/private/'+name),Uint8Array.of(42));
 const next=await createSqlitePageStaging(fs,options);await next.writePage(0,new Uint8Array(4096));const own=(await memory.readdir('/private')).map(entry=>entry.name).find(value=>value!==name)!;
 await memory.writeFile('/private/'+own,new Uint8Array(4121).fill(2));await assert.rejects(next.close(),{code:'EAGAIN'});assert.equal((await memory.readFile('/private/'+own))[0],2);
});
test('rejects invalid page controls before writing and rejects use after close',async()=>{
 const {memory,fs}=await setup(),store=await createSqlitePageStaging(fs,options);
 await assert.rejects(store.writePage(100001,new Uint8Array(4096)),RangeError);await assert.rejects(store.writePage(0,new Uint8Array(4097)),RangeError);
 assert.deepEqual(await memory.readdir('/private'),[]);await store.close();await assert.rejects(store.readPage(0),{code:'EBADF'});
});
test('captures admitted bytes before IO and drains active writes before closing',async()=>{
 const {memory,fs}=await setup();let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{entered=resolve});let delay=false;
 const wrapped=new Proxy(fs,{get(target,key){if(key==='stat')return async(...args:Parameters<FileSystem['stat']>)=>{if(delay){delay=false;entered();await gate;}return target.stat(...args);};return Reflect.get(target,key);}});
 const store=await createSqlitePageStaging(wrapped,options),input=new Uint8Array(4096).fill(7);
 delay=true;const write=store.writePage(0,input);input.fill(9);await started;
 await assert.rejects(store.writePage(1,input),{code:'EBUSY'});
 let closed=false;const closing=store.close().then(()=>{closed=true;});await Promise.resolve();assert.equal(closed,false);
 release();await write;await closing;assert.deepEqual(await memory.readdir('/private'),[]);
});
test('cleans an owned page when publication commits but reports failure',async()=>{
 const {memory,fs}=await setup(),failure=new Error('lost publication response');
 const wrapped=new Proxy(fs,{get(target,key){if(key==='writeFileConditional')return async(...args:Parameters<NonNullable<FileSystem['writeFileConditional']>>)=>{await target.writeFileConditional!(...args);throw failure;};return Reflect.get(target,key);}});
 const store=await createSqlitePageStaging(wrapped,options);
 await assert.rejects(store.writePage(0,new Uint8Array(4096)),error=>error===failure);assert.equal((await memory.readdir('/private')).length,1);
 await assert.rejects(store.readPage(0),error=>error===failure);await store.close();assert.deepEqual(await memory.readdir('/private'),[]);
});
test('owns input before a delayed read of the destination',async()=>{
 const {fs}=await setup();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});let delay=false;
 const wrapped=new Proxy(fs,{get(target,key){if(key==='stat')return async(...args:Parameters<FileSystem['stat']>)=>{if(delay){delay=false;await gate;}return target.stat(...args);};return Reflect.get(target,key);}});
 const store=await createSqlitePageStaging(wrapped,options),input=new Uint8Array(4096).fill(7);
 delay=true;const write=store.writePage(0,input);input.fill(9);release();await write;
 assert.deepEqual(await store.readPage(0),new Uint8Array(4096).fill(7));await store.close();
});
test('rejects a backend read larger than requested without deleting its page',async()=>{
 const {memory,fs}=await setup();let corrupt=false;
 const wrapped=new Proxy(fs,{get(target,key){if(key==='openReadFile')return async(...args:Parameters<NonNullable<FileSystem['openReadFile']>>)=>{const reader=await target.openReadFile!(...args);return {...reader,read:async(position:number,maxBytes:number,io?:Parameters<typeof reader.read>[2])=>reader.read(position,corrupt?maxBytes+1:maxBytes,io)};};return Reflect.get(target,key);}});
 const store=await createSqlitePageStaging(wrapped,{...options,chunkBytes:32768});
 await store.writePage(0,new Uint8Array(32768));corrupt=true;
 await assert.rejects(store.readPage(0),{code:'EIO'});assert.equal((await memory.readdir('/private')).length,1);
 corrupt=false;await store.close();assert.deepEqual(await memory.readdir('/private'),[]);
});
test('cleans private pages independently after operation cancellation',async()=>{
 const {memory,fs}=await setup(),store=await createSqlitePageStaging(fs,options);
 await store.writePage(0,new Uint8Array(4096));const controller=new AbortController(),reason=new Error('cancelled');controller.abort(reason);
 await assert.rejects(store.writePage(1,new Uint8Array(4096),{signal:controller.signal}),error=>error===reason);
 assert.deepEqual(await store.readPage(0),new Uint8Array(4096));
 await store.close();assert.deepEqual(await memory.readdir('/private'),[]);
});
