import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment} from './provisioning.js';
import {pythonPackageRuntimeKey} from './cache.js';

const filename=pythonPackageRuntimeKey+'-environment';
test('configured manifests preserve the legacy file and restore without whole-file IO',async()=>{
 const backing=new MemoryFileSystem(),directory='/cache/'+pythonPackageRuntimeKey;
 await backing.mkdir(directory,{recursive:true});
 await backing.writeFile(directory+'/'+filename,new TextEncoder().encode(JSON.stringify(['old==1'])));
 const fs=new Proxy(backing,{get(target,key){
  if(key==='readFile'||key==='writeFile'||key==='appendFile')return ()=>assert.fail('buffered manifest IO');
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const context={fs,cwd:'/',signal:new AbortController().signal,recordTransport:'host' as const};
 const env=createPythonPackageEnvironment({cacheDirectory:'/cache'}),first=await env.prepare(context);
 const row=['fixture','x'.repeat(20000),'',[],[],null];
 try{
  assert.deepEqual(first.restore,['old==1']);assert.equal(first.legacy,true);
  await env.dispatch('package-commit',[first.session,{version:3,installed:['fixture==2'],records:[row]}],context);
 }finally{await env.finish(first);await env.dispose();}
 assert.deepEqual((await backing.readdir(directory)).map(entry=>entry.name),[filename]);
 const restored=createPythonPackageEnvironment({cacheDirectory:'/cache'}),next=await restored.prepare(context);
 try{
  assert.deepEqual(next.restore,['fixture==2']);assert.equal(next.recordCount,1);let text='';
  for(;;){const part=await restored.dispatch('package-record-read',[next.session,0,text.length],context) as string;if(!part)break;text+=part;}
  assert.deepEqual(JSON.parse(text),row);
 }finally{await restored.finish(next);await restored.dispose();}
 assert.deepEqual((await backing.readdir(directory)).map(entry=>entry.name),[filename]);
});

test('configured manifest sessions retain their filesystem and detect competing publication',async()=>{
 const firstFs=new MemoryFileSystem(),secondFs=new MemoryFileSystem(),signal=new AbortController().signal;
 const env=createPythonPackageEnvironment({cacheDirectory:'cache'}),other=createPythonPackageEnvironment({cacheDirectory:'cache'});
 const one={fs:firstFs,cwd:'/one',signal},two={fs:secondFs,cwd:'/two',signal};
 const a=await env.prepare(one),b=await env.prepare(two),stale=await other.prepare(one);
 try{
  await env.dispatch('package-commit',[a.session,['one==1']],one);
  await env.dispatch('package-commit',[b.session,['two==2']],two);
  await assert.rejects(other.dispatch('package-commit',[stale.session,['stale==1']],one),{code:'EPACKAGECONFLICT'});
  for(const [context,expected] of [[one,['one==1']],[two,['two==2']]] as const){
   const restored=await env.prepare(context);try{assert.deepEqual(restored.restore,expected);}finally{await env.finish(restored);}
  }
 }finally{await env.finish(a);await env.finish(b);await other.finish(stale);await env.dispose();await other.dispose();}
});
