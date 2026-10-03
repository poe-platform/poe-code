import {expect,it} from 'vitest';
import {MemoryFileSystem} from '../src/fs/memory/index.js';
import {createDeviceFileSystem} from '../src/fs/devices/index.js';
import {scopeFileSystem} from '../src/fs/scoped.js';
it('device view streams ordinary directories and merges virtual entries once',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/docs');await fs.writeFile('/docs/a',new Uint8Array());await fs.writeFile('/dev',new Uint8Array());
 const view=createDeviceFileSystem(fs),root=[];for await(const entry of view.iterateDirectory!('/'))root.push(entry);
 expect(root).toEqual([{name:'docs',type:'directory'},{name:'dev',type:'directory'}]);
 const docs=[];for await(const entry of view.iterateDirectory!('/docs'))docs.push(entry.name);expect(docs).toEqual(['a']);
 const dev=[];for await(const entry of view.iterateDirectory!('/dev'))dev.push(entry);expect(dev).toEqual([{name:'null',type:'character'}]);
 await expect(view.iterateDirectory!('/dev/null')[Symbol.asyncIterator]().next()).rejects.toMatchObject({code:'ENOTDIR'});
});
it('scoped streams charge admission and advancement and retire on scope cancellation',async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile('/a',new Uint8Array());let closed=false,charges=0;
 const iterate=fs.iterateDirectory.bind(fs);fs.iterateDirectory=async function*(path,options){try{yield* iterate(path,options);}finally{closed=true;}};
 const controller=new AbortController(),view=scopeFileSystem(fs,()=>{charges++;},controller.signal);
 const iterator=view.iterateDirectory!('/')[Symbol.asyncIterator]();await iterator.next();expect(charges).toBeGreaterThanOrEqual(2);
 controller.abort(false);await expect(iterator.next()).rejects.toBe(false);expect(closed).toBe(true);
});
it('device early return closes the backend and never falls back to array listings',async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile('/a',new Uint8Array());let closed=false;
 const iterate=fs.iterateDirectory.bind(fs);fs.iterateDirectory=async function*(path,options){try{yield* iterate(path,options);}finally{closed=true;}};
 fs.readdir=async()=>{throw Error('array fallback');};
 for await(const ignored of createDeviceFileSystem(fs).iterateDirectory('/'))break;
 expect(closed).toBe(true);
 const missing=new Proxy(fs,{get(target,key){if(key==='iterateDirectory')return undefined;const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 await expect(createDeviceFileSystem(missing).iterateDirectory('/')[Symbol.asyncIterator]().next()).rejects.toMatchObject({code:'ENOTSUP'});
});
