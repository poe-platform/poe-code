import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment} from './provisioning.js';

test('extracted package roots survive manifest publication and retire after invocation',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/work');
 const context={fs,cwd:'/work',signal:new AbortController().signal};
 const environment=createPythonPackageEnvironment(),start=await environment.prepare(context);
 const root=await environment.dispatch('package-root',[start.session],context) as string;
 assert.ok(root.startsWith('/work/.python-install-'));
 assert.equal(await environment.dispatch('package-root',[start.session],context),root);
 await fs.writeFile(root+'/payload',new Uint8Array(131079));
 await environment.dispatch('package-commit',[start.session,[]],context);
 assert.equal((await fs.stat(root+'/payload')).size,131079);
 await environment.finish(start);
 await assert.rejects(fs.stat(root),{code:'ENOENT'});
 await environment.dispose();
});

test('extracted package root cleanup refuses a substituted directory',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/work');
 const context={fs,cwd:'/work',signal:new AbortController().signal};
 const environment=createPythonPackageEnvironment(),start=await environment.prepare(context);
 const root=await environment.dispatch('package-root',[start.session],context) as string;
 await fs.rename(root,root+'-original');await fs.mkdir(root);await fs.writeFile(root+'/keep',new Uint8Array([42]));
 await assert.rejects(Promise.resolve(environment.finish(start)),/identity changed/);
 assert.deepEqual(await fs.readFile(root+'/keep'),new Uint8Array([42]));
 await assert.rejects(environment.dispose(),/identity changed/);
});

test('cancellation after directory acquisition still retires the owned root',async()=>{
 const {PythonInstallationRoot}=await import('./installation-root.js');
 const backend=new MemoryFileSystem();await backend.mkdir('/work');
 const controller=new AbortController(),reason=new Error('cancel installation');
 const fs=new Proxy(backend,{get(target,key){
  if(key==='prepareDirectory')return async(...args:Parameters<MemoryFileSystem['prepareDirectory']>)=>{
   const identity=await target.prepareDirectory(...args);controller.abort(reason);return identity;
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const root=new PythonInstallationRoot({fs,cwd:'/work',signal:controller.signal});
 await assert.rejects(root.path(),error=>error===reason);
 await root.close();
 assert.deepEqual(await backend.readdir('/work'),[]);
 await assert.rejects(root.path(),/closed/);
});

test('closing during directory acquisition waits for and removes only its owned root',async()=>{
 const {PythonInstallationRoot}=await import('./installation-root.js');
 const backend=new MemoryFileSystem();await backend.mkdir('/work');
 let acquired!:()=>void,release!:()=>void;
 const ready=new Promise<void>(resolve=>{acquired=resolve;});
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const fs=new Proxy(backend,{get(target,key){
  if(key==='prepareDirectory')return async(...args:Parameters<MemoryFileSystem['prepareDirectory']>)=>{
   const identity=await target.prepareDirectory(...args);acquired();await gate;return identity;
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const root=new PythonInstallationRoot({fs,cwd:'/work',signal:new AbortController().signal});
 const opening=root.path();await ready;
 const closing=root.close();let closed=false;void closing.then(()=>{closed=true;});
 await Promise.resolve();assert.equal(closed,false);
 release();const path=await opening;await closing;
 await assert.rejects(backend.stat(path),{code:'ENOENT'});
});
