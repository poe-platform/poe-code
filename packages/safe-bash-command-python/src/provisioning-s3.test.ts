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
