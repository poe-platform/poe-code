import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource,type FileSystem} from 'safe-bash-contracts';
import {createPythonSourceSnapshot} from './source-snapshot.js';

const context=(fs:FileSystem,signal=new AbortController().signal)=>({fs,cwd:'/',env:{},signal,command:'python',args:[],stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}}});

test('source snapshots stream files and directories, preserve links and metadata, and apply native root exclusions',async()=>{
 const backing=new MemoryFileSystem(),bytes=new Uint8Array(200001).fill(7);
 for(const path of ['/source/.tox','/source/.nox','/source/nested/.tox','/builds'])await backing.mkdir(path,{recursive:true});
 for(const path of ['/source/.tox/skip','/source/.nox/skip','/source/nested/.tox/keep'])await backing.writeFile(path,new Uint8Array([1]));
 await backing.writeFile('/source/payload',bytes);await backing.chmod('/source/payload',0o751);await backing.utimes('/source/payload',1234,5678);
 await backing.symlink('payload','/source/link');await backing.symlink('missing','/source/dangling');await backing.symlink('.','/source/cycle');
 let reads=0,closed=0,largest=0,enumerated=0;
 const fs=new Proxy(backing,{get(target,key){
  if(key==='readFile'||key==='readdir')return ()=>assert.fail('source snapshot buffered a file or directory');
  if(key==='iterateDirectory')return async function*(...args:Parameters<typeof target.iterateDirectory>){enumerated++;yield* target.iterateDirectory(...args);};
  if(key==='openReadFile')return async(...args:Parameters<typeof target.openReadFile>)=>{const handle=await target.openReadFile(...args);return {stat:handle.stat.bind(handle),async read(offset:number,length:number,options:Parameters<typeof handle.read>[2]){reads++;largest=Math.max(largest,length);return handle.read(offset,length,options);},async close(){closed++;await handle.close();}};};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const snapshot=await createPythonSourceSnapshot('/source','/builds',context(fs));
 try{
  assert.deepEqual(await backing.readFile(snapshot.path+'/payload'),bytes);
  assert.equal((await backing.stat(snapshot.path+'/payload')).mode&0o7777,0o751);
  assert.equal((await backing.stat(snapshot.path+'/payload')).mtimeMs,5678);
  assert.equal(await backing.readlink(snapshot.path+'/link'),'payload');
  assert.equal(await backing.readlink(snapshot.path+'/dangling'),'missing');
  assert.equal(await backing.readlink(snapshot.path+'/cycle'),'.');
  await assert.rejects(backing.stat(snapshot.path+'/.tox'),{code:'ENOENT'});
  await assert.rejects(backing.stat(snapshot.path+'/.nox'),{code:'ENOENT'});
  assert.deepEqual(await backing.readFile(snapshot.path+'/nested/.tox/keep'),new Uint8Array([1]));
  await backing.writeFile('/source/payload',new Uint8Array([9]));
  assert.deepEqual(await backing.readFile(snapshot.path+'/payload'),bytes);
  assert.equal(closed,2);assert.ok(reads>3);assert.ok(largest<=65536);assert.equal(enumerated,3);
 }finally{await snapshot.dispose();await snapshot.dispose();}
 assert.deepEqual(await backing.readdir('/builds'),[]);
 assert.deepEqual(await backing.readFile('/source/payload'),new Uint8Array([9]));
});

test('a snapshot nested inside the source excludes its own target without recursion',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/source');await fs.writeFile('/source/file',new Uint8Array([1]));
 const snapshot=await createPythonSourceSnapshot('/source','/source',context(fs));
 try{assert.deepEqual((await fs.readdir(snapshot.path)).map(entry=>entry.name),['file']);}finally{await snapshot.dispose();}
 assert.deepEqual((await fs.readdir('/source')).map(entry=>entry.name),['file']);
});

test('disposal refuses a substituted snapshot directory and preserves unrelated entries',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/source');await fs.mkdir('/builds');
 const snapshot=await createPythonSourceSnapshot('/source','/builds',context(fs));
 await fs.rename(snapshot.path,'/moved');await fs.mkdir(snapshot.path);await fs.writeFile(snapshot.path+'/keep',new Uint8Array([1]));
 await assert.rejects(snapshot.dispose(),/identity/);
 assert.deepEqual(await fs.readFile(snapshot.path+'/keep'),new Uint8Array([1]));assert.equal((await fs.stat('/moved')).type,'directory');
});

test('cancelled copy waits for its retained reader before removing the incomplete snapshot',async()=>{
 const backing=new MemoryFileSystem();await backing.mkdir('/source');await backing.mkdir('/builds');await backing.writeFile('/source/file',new Uint8Array([1]));
 const controller=new AbortController();let enter!:()=>void,release!:()=>void,closed=false;
 const started=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const fs=new Proxy(backing,{get(target,key){
  if(key==='openReadFile')return async(...args:Parameters<typeof target.openReadFile>)=>{const handle=await target.openReadFile(...args);return {stat:handle.stat.bind(handle),async read(offset:number,length:number,options:Parameters<typeof handle.read>[2]){enter();await gate;return handle.read(offset,length,options);},async close(){closed=true;await handle.close();}};};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const running=createPythonSourceSnapshot('/source','/builds',context(fs,controller.signal)),reason=new Error('cancel copy');
 const rejected=assert.rejects(running,error=>error===reason);
 await started;controller.abort(reason);await Promise.resolve();assert.equal(closed,false);release();await rejected;
 assert.equal(closed,true);assert.deepEqual(await backing.readdir('/builds'),[]);
});

test('missing bounded directory capability refuses snapshot creation before effects',async()=>{
 const backing=new MemoryFileSystem();await backing.mkdir('/source');await backing.mkdir('/builds');
 const fs=new Proxy(backing,{get(target,key){if(key==='iterateDirectory')return undefined;const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 await assert.rejects(createPythonSourceSnapshot('/source','/builds',context(fs)),/directory/);
 assert.deepEqual(await backing.readdir('/builds'),[]);
});

test('source copies retain only one invocation cleanup across multiple files',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/source');await fs.mkdir('/builds');
 for(let index=0;index<5;index++)await fs.writeFile('/source/'+index,new Uint8Array([index]));
 const cleanups:Array<()=>void|Promise<void>>=[];
 const snapshot=await createPythonSourceSnapshot('/source','/builds',{...context(fs),registerCleanup(cleanup){cleanups.push(cleanup);}});
 try{assert.equal(cleanups.length,1);await cleanups[0]!();}finally{await snapshot.dispose();}
});

test('a raced destination symlink cannot redirect source-copy writes outside the owned tree',async t=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/source');await fs.mkdir('/builds');await fs.mkdir('/outside');await fs.writeFile('/source/file',new Uint8Array([1]));
 await fs.chmod('/source/file',0o751);await fs.writeFile('/outside/file',new Uint8Array([9]));await fs.chmod('/outside/file',0o600);
 const open=fs.openReadFile.bind(fs);let replaced=false;
 t.mock.method(fs,'openReadFile',async(...args:Parameters<typeof fs.openReadFile>)=>{
  const handle=await open(...args);
  return {stat:handle.stat.bind(handle),close:handle.close.bind(handle),async read(offset:number,length:number,options:Parameters<typeof handle.read>[2]){
   if(!replaced){replaced=true;const [entry]=await fs.readdir('/builds');const root='/builds/'+entry!.name;await fs.rename(root,'/moved');await fs.symlink('/outside',root);}
   return handle.read(offset,length,options);
  }};
 });
  await assert.rejects(createPythonSourceSnapshot('/source','/builds',context(fs)));
 assert.deepEqual(await fs.readFile('/outside/file'),new Uint8Array([9]));
 assert.equal((await fs.stat('/outside/file')).mode&0o7777,0o600);
});
