import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment} from './provisioning.js';

test('implicit manifests use bounded caller storage across invocations and retire with their environment',async()=>{
 const backing=new MemoryFileSystem();let writes=0,maximum=0;
 const fs=new Proxy(backing,{get(target,key){
  if(key==='readFile'||key==='writeFile'||key==='appendFile')return ()=>assert.fail('whole manifest filesystem IO');
  if(key==='createStagedFile')return async(...args:Parameters<typeof target.createStagedFile>)=>{
   const stage=await target.createStagedFile(...args),writer=stage.writer!;
   return {...stage,writer:{finish:writer.finish.bind(writer),async write(...args:Parameters<typeof writer.write>){writes++;maximum=Math.max(maximum,args[0].length);return writer.write(...args);}}};
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const invocation=new AbortController(),env=createPythonPackageEnvironment(),context={fs,cwd:'/',signal:invocation.signal};
 const first=await env.prepare(context);
 assert.deepEqual(await backing.readdir('/'),[],'reading an empty environment needs no manifest directory');
 const records=[['fixture','x'.repeat(200000)+'\ud800😀','',[],[],null] as const];
 try{
  await env.dispatch('package-commit',[first.session,{version:3,installed:['fixture==1'],records}],context);
  await env.finish(first);invocation.abort(new Error('invocation retired'));
  assert.ok(writes>1,'manifest publication must use caller-backed writers');assert.ok(maximum<=65536);
  assert.ok((await backing.readdir('/')).length>0,'published manifest remains caller-backed');
  const next=await env.prepare({...context,signal:new AbortController().signal});
  try{assert.deepEqual(next.restore,['fixture==1']);assert.deepEqual(next.records,records);}
  finally{await env.finish(next);}
 }finally{await env.finish(first);await env.dispose();}
 assert.deepEqual(await backing.readdir('/'),[],'environment-owned manifest storage must retire');
});

test('default environments isolate manifests and reject stale publication',async()=>{
 const fs=new MemoryFileSystem(),context={fs,cwd:'/',signal:new AbortController().signal};
 const first=createPythonPackageEnvironment(),second=createPythonPackageEnvironment();
 const one=await first.prepare(context),stale=await first.prepare(context),two=await second.prepare(context);
 try{
  await first.dispatch('package-commit',[one.session,['first==1']],context);
  await second.dispatch('package-commit',[two.session,['second==1']],context);
  await assert.rejects(first.dispatch('package-commit',[stale.session,['stale==1']],context),{code:'EPACKAGECONFLICT'});
  assert.equal((await fs.readdir('/')).length,2,'each environment owns its manifest directory');
  const restored=await first.prepare(context);
  try{assert.deepEqual(restored.restore,['first==1']);}finally{await first.finish(restored);}
  await first.finish(one);await first.finish(stale);await first.dispose();
  assert.equal((await fs.readdir('/')).length,1);
  const remaining=await second.prepare(context);
  try{assert.deepEqual(remaining.restore,['second==1']);}finally{await second.finish(remaining);}
 }finally{await first.dispose();await second.finish(two);await second.dispose();}
 assert.deepEqual(await fs.readdir('/'),[]);
});

test('default manifest cache limits preserve the prior caller-backed snapshot',async()=>{
 const fs=new MemoryFileSystem(),context={fs,cwd:'/',signal:new AbortController().signal};
 const env=createPythonPackageEnvironment({maxCacheBytes:64});
 const first=await env.prepare(context);
 try{
  await env.dispatch('package-commit',[first.session,['fixture==1']],context);
  const next=await env.prepare(context);
  try{await assert.rejects(env.dispatch('package-commit',[next.session,['x'.repeat(100)]],context),/manifest exceeds maxCacheBytes/);}
  finally{await env.finish(next);}
  const restored=await env.prepare(context);
  try{assert.deepEqual(restored.restore,['fixture==1']);}finally{await env.finish(restored);}
 }finally{await env.finish(first);await env.dispose();}
 assert.deepEqual(await fs.readdir('/'),[]);
});

 test('default manifest storage can retry after caller directory acquisition fails',async()=>{
 const backing=new MemoryFileSystem();let denied=true;
 const fs=new Proxy(backing,{get(target,key){
  if(key==='prepareDirectory')return async(...args:Parameters<typeof target.prepareDirectory>)=>{
   if(denied)throw new Error('caller denied directory');
   return target.prepareDirectory(...args);
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const env=createPythonPackageEnvironment(),context={fs,cwd:'/',signal:new AbortController().signal};
 const first=await env.prepare(context);
 try{
  await assert.rejects(env.dispatch('package-commit',[first.session,['fixture==1']],context),/caller denied directory/);
  assert.deepEqual(await backing.readdir('/'),[]);
  denied=false;
  const next=await env.prepare(context);
  try{assert.deepEqual(next.restore,[]);await env.dispatch('package-commit',[next.session,['fixture==2']],context);}
  finally{await env.finish(next);}
  const restored=await env.prepare(context);
  try{assert.deepEqual(restored.restore,['fixture==2']);}finally{await env.finish(restored);}
 }finally{await env.finish(first);await env.dispose();}
 assert.deepEqual(await backing.readdir('/'),[]);
});
