import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {openCommandFile} from './filesystem-descriptor.js';

test('descriptor operations reuse cancellation composition for repeated and alternating callers',async()=>{
 const memory=new MemoryFileSystem();await memory.writeFile('/file',new Uint8Array());
 const observed:AbortSignal[]=[];
 const fs=new Proxy(memory,{get(target,key){
  if(key==='open')return async(...args:Parameters<MemoryFileSystem['open']>)=>{
   const descriptor=await target.open(...args);
   return new Proxy(descriptor,{get(handle,method){
    if(method==='stat')return (options?:{signal?:AbortSignal})=>{observed.push(options!.signal!);return handle.stat(options);};
    const value=Reflect.get(handle,method);return typeof value==='function'?value.bind(handle):value;
   }});
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const owner=new AbortController(),first=new AbortController(),second=new AbortController();
 const descriptor=await openCommandFile({fs,signal:owner.signal},'/file',{access:'read'});
 try{
  for(const signal of [first.signal,first.signal,second.signal,first.signal,second.signal])await descriptor.stat({signal});
  assert.equal(observed[0],observed[1]);assert.equal(observed[0],observed[3]);assert.equal(observed[2],observed[4]);
  first.abort('caller stopped');assert.equal(observed[0]!.reason,'caller stopped');assert.equal(observed[2]!.aborted,false);
  owner.abort('owner stopped');assert.equal(observed[2]!.reason,'owner stopped');
 }finally{await descriptor.close();}
});
