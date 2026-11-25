import assert from 'node:assert/strict';
import test from 'node:test';
import {RustWasmBash} from './index.js';

test('host trash capability preserves recursive items through mount and device views', {skip:!WebAssembly.Suspending}, async()=>{
 const {createMemoryFileSystem,createMountFileSystem,createDeviceFileSystem}=await import('../../safe-fs/dist/core.js');
 const backing=createMemoryFileSystem();await backing.mkdir('/folder');await backing.writeFile('/folder/note',new TextEncoder().encode('saved'));
 const puts=[];const backend=new Proxy(backing,{get(target,key){
  if(key==='capabilities')return {...target.capabilities,atomicTrash:true};
  if(key==='trashPut')return async path=>{puts.push(path);await target.rename(path,'/saved');};
  if(key==='trashList')return async()=>[{item:'one',path:'/folder',deletionDate:'2026-11-25T12:00:00'}];
  if(key==='trashRestore')return async(_path,item)=>{assert.equal(item,'one');await target.rename('/saved','/folder');};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 const fs=createDeviceFileSystem(createMountFileSystem({root:createMemoryFileSystem(),mounts:{'/org':backend}}));
 const shell=new RustWasmBash({fs,cwd:'/org',forceNative:true});
 try{
  const removed=await shell.exec("printf 'y\\n' | rm -ri /org/folder; trash-list");
  assert.equal(removed.exitCode,0,removed.stderr);assert.deepEqual(puts,['/folder']);assert.match(removed.stdout,/one/);
  const restored=await shell.exec('trash-restore one; cat /org/folder/note');
  assert.equal(restored.exitCode,0,restored.stderr);assert.equal(restored.stdout,'saved');
 }finally{await shell.dispose();}
});
