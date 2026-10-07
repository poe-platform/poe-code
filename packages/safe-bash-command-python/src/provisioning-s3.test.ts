import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem,MountFileSystem} from '@poe-code/safe-fs/core';
import {MockS3Client,S3FileSystem} from '@poe-code/safe-fs/fs/s3';
import {createPythonPackageEnvironment} from './provisioning.js';

test('canonical S3 wheel streams into caller storage and retains durable installation bytes',async()=>{
 const client=new MockS3Client({buckets:['packages']});
 const bytes=new Uint8Array(131079).map((_,index)=>index%251);
 await client.putObject({Bucket:'packages',Key:'fixture.whl',Body:bytes});
 let streams=0;
 const transport=new Proxy(client,{get(target,key){
  if(key==='getObject')return ()=>assert.fail('whole S3 object must not be buffered');
  if(key==='getObjectStream')return (...args:Parameters<typeof target.getObjectStream>)=>{streams++;return target.getObjectStream(...args);};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const remote=new S3FileSystem({bucket:'packages',transport});
 const root=new MemoryFileSystem();
 const fs=new MountFileSystem({root,mounts:{'/packages':remote}});
 const environment=createPythonPackageEnvironment({noCache:true});
 const context={fs,cwd:'/',signal:new AbortController().signal},start=await environment.prepare(context);
 try{
  const opened=await environment.dispatch('package-open',[start.session,'file:///packages/fixture.whl'],context) as {key:string;size:number};
  assert.equal(opened.size,bytes.length);assert.equal(streams,1);
  await client.deleteObject({Bucket:'packages',Key:'fixture.whl'});
  assert.deepEqual(await environment.dispatch('package-read',[start.session,opened.key,65530,16],context),Array.from(bytes.subarray(65530,65546)));
  const retained=await environment.dispatch('package-retain',[start.session,opened.key],context) as {token:string;url:string};
  assert.ok(retained.url.startsWith('file:///.python-packages/installed/'));
  await environment.dispatch('package-close',[start.session,opened.key],context);
  assert.deepEqual(await environment.dispatch('package-read-retained',[start.session,retained.token,bytes.length-7,7],context),Array.from(bytes.subarray(-7)));
  assert.equal(streams,1,'retention must reuse the staged snapshot');
 }finally{await environment.finish(start);await environment.dispose();}
 assert.deepEqual((await root.readdir('/')).map(entry=>entry.name),['.python-packages']);
});

for(const cached of [false,true])for(const corrupt of [false,true])test(`S3 package sources use invocation staging when the configured cache cannot retain files; cached=${cached}; corrupt=${corrupt}`,async()=>{
 const client=new MockS3Client({buckets:['packages']});
 const bytes=new Uint8Array(131079).fill(42);
 await client.putObject({Bucket:'packages',Key:'fixture.whl',Body:bytes});
 let forbidBuffers=false,streams=0,requests=0;
 const transport=new Proxy(client,{get(target,key){
  if(key==='getObject')return (...args:Parameters<typeof target.getObject>)=>{
   if(forbidBuffers&&(args[0].Key==='fixture.whl'||args[0].Key.includes('-sha256-')))assert.fail('package content must stream');
   return target.getObject(...args);
  };
  if(key==='getObjectStream')return (...args:Parameters<typeof target.getObjectStream>)=>{if(args[0].Key==='fixture.whl'||args[0].Key.includes('-sha256-'))streams++;return target.getObjectStream(...args);};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const root=new MemoryFileSystem();
 const remote=new S3FileSystem({bucket:'packages',transport});
 const guarded=new Proxy(remote,{get(target,key){
  if(key==='readFile')return (...args:Parameters<typeof target.readFile>)=>{if(forbidBuffers&&(args[0]==='/fixture.whl'||args[0].includes('-sha256-')))assert.fail('package readFile must not buffer');return target.readFile(...args);};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const fs=new MountFileSystem({root,mounts:{'/packages':guarded}});
 const environment=createPythonPackageEnvironment({cacheDirectory:'/packages/cache',authorize:()=>true,transport:async()=>{
  requests++;return {status:200,statusText:'OK',headers:[],body:(async function*(){yield bytes;})(),async dispose(){}};
 }});
 const context={fs,cwd:'/',signal:new AbortController().signal};
 const url=cached?'https://packages.example/fixture.whl':'file:///packages/fixture.whl';
 try{
  if(cached){
   const seed=await environment.prepare(context);
   try{await environment.dispatch('package-open',[seed.session,url],context);}finally{await environment.finish(seed);}
  }
  if(cached&&corrupt){
   const [runtime]=await fs.readdir('/packages/cache');assert.ok(runtime);
   const directory='/packages/cache/'+runtime.name;
   const artifact=(await fs.readdir(directory)).find(entry=>entry.name.includes('-sha256-'));assert.ok(artifact);
   await fs.writeFile(directory+'/'+artifact.name,new Uint8Array(bytes.length).fill(43));
  }
  forbidBuffers=true;streams=0;
  const start=await environment.prepare({...context,offline:true});
  try{
   const opening=environment.dispatch('package-open',[start.session,url,corrupt&&!cached?'0'.repeat(64):undefined],context);
   if(corrupt)await assert.rejects(opening,/integrity mismatch/);
   else {
    const opened=await opening as {key:string;size:number};
    assert.equal(opened.size,bytes.length);
    assert.deepEqual(await environment.dispatch('package-read',[start.session,opened.key,65530,16],context),Array(16).fill(42));
   }
   assert.equal(streams,1);
   assert.equal(requests,cached?1:0);
  }finally{await environment.finish(start);}
 }finally{await environment.dispose();}
 assert.deepEqual(await root.readdir('/'),[],'invocation staging must retire');
});
