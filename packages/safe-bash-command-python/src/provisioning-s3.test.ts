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

for(const noCache of [false,true])for(const outcome of ['success','integrity','upload','cancel'] as const){
 if(noCache&&outcome==='upload')continue;
 test(`network wheels stage in caller storage before weak-cache publication; noCache=${noCache}; outcome=${outcome}`,async()=>{
  const client=new MockS3Client({buckets:['packages']}),root=new MemoryFileSystem();
  const controller=new AbortController(),reason=new Error('cancel cache upload');
  const bytes=new Uint8Array(131079).fill(42);
  let uploads=0,maximum=0,disposed=0,requests=0;
  const transport=new Proxy(client,{get(target,key){
   if(key==='putObjectStream')return async(...args:Parameters<typeof target.putObjectStream>)=>{
    if(!args[0].Key.includes('-sha256-'))return target.putObjectStream(...args);
    uploads++;
    const source=args[0].Body;
    return target.putObjectStream({...args[0],Body:(async function*(){for await(const chunk of source){
     maximum=Math.max(maximum,chunk.length);
     if(outcome==='upload')throw new Error('cache upload failed');
     if(outcome==='cancel')controller.abort(reason);
     yield chunk;
    }})()},args[1]);
   };
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  const remote=new S3FileSystem({bucket:'packages',transport});
  const guarded=new Proxy(remote,{get(target,key){
   if(key==='readFile'||key==='writeFile')return (...args:Parameters<typeof target.writeFile>)=>{
    if(args[0].includes('-sha256-'))assert.fail('wheel content must never use whole-file cache APIs');
    return Reflect.apply(target[key],target,args);
   };
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  const fs=new MountFileSystem({root,mounts:{'/packages':guarded}}),context={fs,cwd:'/',signal:controller.signal};
  const environment=createPythonPackageEnvironment({cacheDirectory:'/packages/cache',noCache,authorize:()=>true,transport:async()=>{
   requests++;
   return {status:200,statusText:'OK',headers:[],body:(async function*(){
    assert.ok((await root.readdir('/')).some(entry=>entry.name.startsWith('.python-package-')),'download must enter caller staging before pulling bytes');
    for(let offset=0;offset<bytes.length;offset+=32768){
     if(noCache&&outcome==='cancel')controller.abort(reason);
     yield bytes.subarray(offset,offset+32768);
    }
   })(),async dispose(){disposed++;}};
  }});
  const start=await environment.prepare(context),url='https://packages.example/streamed.whl';
  try{
   const opened=environment.dispatch('package-open',[start.session,url,outcome==='integrity'?'0'.repeat(64):undefined],context);
   if(outcome!=='success')await assert.rejects(opened,outcome==='integrity'?/integrity mismatch/:outcome==='upload'?/EIO:.*writeStream/:()=>controller.signal.aborted);
   else{
    const artifact=await opened as {key:string;size:number};
    assert.equal(artifact.size,bytes.length);
    assert.deepEqual(await environment.dispatch('package-read',[start.session,artifact.key,65530,16],context),Array(16).fill(42));
   }
  }finally{await environment.finish(start);}
  assert.equal(disposed,1);assert.equal(uploads,noCache||outcome==='integrity'?0:1);
  assert.ok(maximum<=65536);
  assert.deepEqual(await root.readdir('/'),[],'download staging retires');
  if(!noCache){
   const offlineContext={...context,signal:new AbortController().signal};
   const offline=await environment.prepare({...offlineContext,offline:true});
   try{
    const opened=environment.dispatch('package-open',[offline.session,url],offlineContext);
    if(outcome==='success'){
     const artifact=await opened as {key:string};
     assert.deepEqual(await environment.dispatch('package-read',[offline.session,artifact.key,0,2],offlineContext),[42,42]);
    }else await assert.rejects(opened,/Offline package cache miss/);
   }finally{await environment.finish(offline);}
  }
  await environment.dispose();assert.equal(requests,1);assert.deepEqual(await root.readdir('/'),[]);
 });
}

for(const strongCache of [false,true])test(`extraction and ZIP index storage admit capable cache parents or caller cwd; strongCache=${strongCache}`,async()=>{
 const root=new MemoryFileSystem();await root.mkdir('/work');
 const cache=strongCache?new MemoryFileSystem():new S3FileSystem({bucket:'packages',transport:new MockS3Client({buckets:['packages']})});
 const fs=new MountFileSystem({root,mounts:{'/cache':cache}});
 const context={fs,cwd:'/work',signal:new AbortController().signal};
 const environment=createPythonPackageEnvironment({cacheDirectory:'/cache'}),start=await environment.prepare(context);
 try{
  const directory=await environment.dispatch('package-root',[start.session],context) as string;
  assert.ok(directory.startsWith((strongCache?'/cache':'/work')+'/.python-install-'),directory);
  await fs.writeFile(directory+'/payload',new Uint8Array([42]));
  const index=(operation:string,...args:unknown[])=>environment.dispatch('package-index',[start.session,operation,...args],context);
  await index('start');await index('append','fixture','0','payload');await index('seal','7');
  assert.deepEqual(JSON.parse(await index('name','fixture',0) as string),['payload','7']);
  assert.ok((await fs.readdir(strongCache?'/cache':'/work')).some(entry=>entry.name.startsWith('.zip-metadata-')));
 }finally{await environment.finish(start);await environment.dispose();}
 assert.deepEqual(await root.readdir('/work'),[]);assert.deepEqual(await cache.readdir('/'),[]);
});
