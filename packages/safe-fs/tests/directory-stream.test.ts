import * as native from 'node:fs/promises';
import type {Dir,Dirent} from 'node:fs';
import {beforeEach,expect,it,vi} from 'vitest';
import {vol} from 'memfs';
import {MemoryFileSystem} from '../src/fs/memory/index.js';
import {RealFileSystem} from '../src/fs/real/index.js';
import {withFileSystemQuota} from '../src/fs/quota/index.js';
import {ReadOnlyFileSystem} from '../src/fs/readonly/index.js';
import type {FileSystem} from '../src/contracts/filesystem.js';
vi.mock('node:fs/promises',async()=>{const {fs}=await import('memfs');return {...fs.promises,readdir:vi.fn(fs.promises.readdir),opendir:vi.fn()};});
beforeEach(()=>{vi.clearAllMocks();vol.reset();vol.fromJSON({'/machine/a':'a'});});

it('memory directory streams visit only consumed entries and retain the legacy sorted listing',async()=>{
 const fs=new MemoryFileSystem();for(const name of ['z','a','m'])await fs.writeFile('/'+name,new Uint8Array());
 const entries=Reflect.get(Reflect.get(fs,'root'),'entries') as Map<string,unknown>;
 const original=entries[Symbol.iterator].bind(entries);let visits=0;
 const spy=vi.spyOn(entries,Symbol.iterator).mockImplementation(function*(){for(const entry of original()){visits++;yield entry;}return undefined;});
 try{
  const iterator=fs.iterateDirectory('/')[Symbol.asyncIterator]();expect(visits).toBe(0);
  expect((await iterator.next()).value).toEqual({name:'z',type:'file'});expect(visits).toBe(1);
  await iterator.return?.();expect(visits).toBe(1);
 }finally{spy.mockRestore();}
 expect((await fs.readdir('/')).map(entry=>entry.name)).toEqual(['a','m','z']);
});
it('memory streams reject changed directories and preserve abort reasons and permissions',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/dir');await fs.writeFile('/dir/a',new Uint8Array());
 const iterator=fs.iterateDirectory('/dir')[Symbol.asyncIterator]();await iterator.next();await fs.writeFile('/dir/b',new Uint8Array());
 await expect(iterator.next()).rejects.toMatchObject({code:'EBUSY'});
 const controller=new AbortController();controller.abort(false);
 await expect(fs.iterateDirectory('/missing',{signal:controller.signal})[Symbol.asyncIterator]().next()).rejects.toBe(false);
 await fs.chmod('/dir',0);
 await expect(fs.iterateDirectory('/dir')[Symbol.asyncIterator]().next()).rejects.toMatchObject({code:'EACCES'});
});
it('readonly delegates streaming without falling back to a complete listing',async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile('/file',new Uint8Array());
 const view=new ReadOnlyFileSystem(fs);const found=[];
 for await(const entry of view.iterateDirectory('/'))found.push(entry);
 expect(found).toEqual([{name:'file',type:'file'}]);
 const absent=new Proxy(fs,{get(target,key){if(key==='iterateDirectory')return undefined;const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}}) as FileSystem;
 await expect(new ReadOnlyFileSystem(absent).iterateDirectory('/')[Symbol.asyncIterator]().next()).rejects.toMatchObject({code:'ENOTSUP'});
});
function handle(){
 let index=0;
 const read=vi.fn(async()=>index++===0?{name:'a',isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false} as Dirent:null);
 const close=vi.fn(async()=>{});vi.mocked(native.opendir).mockResolvedValue({read,close} as unknown as Dir);return {read,close};
}
it('native streams open a one-entry buffer and close on early return without readdir',async()=>{
 const {read,close}=handle(),fs=new RealFileSystem('/machine');
 for await(const entry of fs.iterateDirectory('/')){expect(entry).toEqual({name:'a',type:'file'});break;}
 expect(native.opendir).toHaveBeenCalledWith('/machine',{bufferSize:1});expect(native.readdir).not.toHaveBeenCalled();expect(read).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);
});
it('native streams close after read failures and cancellation during opening',async()=>{
 const fs=new RealFileSystem('/machine');const first=handle();first.read.mockRejectedValueOnce(Object.assign(new Error('failed'),{code:'EIO'}));
 await expect(fs.iterateDirectory('/')[Symbol.asyncIterator]().next()).rejects.toMatchObject({code:'EIO',syscall:'iterateDirectory',path:'/'});expect(first.close).toHaveBeenCalledTimes(1);
 const controller=new AbortController(),second=handle();vi.mocked(native.opendir).mockImplementationOnce(async()=>{controller.abort('cancel');return {read:second.read,close:second.close} as unknown as Dir;});
 await expect(fs.iterateDirectory('/',{signal:controller.signal})[Symbol.asyncIterator]().next()).rejects.toBe('cancel');expect(second.read).not.toHaveBeenCalled();expect(second.close).toHaveBeenCalledTimes(1);
});

it('quota and readonly retire the backing iterator on early exit',async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile('/a',new Uint8Array());
 let closed=false;const original=fs.iterateDirectory.bind(fs);
 fs.iterateDirectory=async function*(path,options){try{yield* original(path,options);}finally{closed=true;}};
 const view=new ReadOnlyFileSystem(withFileSystemQuota(fs,{maxBytes:10}));
 for await(const entry of view.iterateDirectory('/')){expect(entry.name).toBe('a');break;}
 expect(closed).toBe(true);
});
it('native EOF closes and primary read failures survive cleanup failure',async()=>{
 const fs=new RealFileSystem('/machine'),first=handle();
 const values=[];for await(const entry of fs.iterateDirectory('/'))values.push(entry.name);
 expect(values).toEqual(['a']);expect(first.close).toHaveBeenCalledTimes(1);
 const second=handle();second.read.mockRejectedValueOnce(Object.assign(new Error('read'),{code:'EIO'}));
 second.close.mockRejectedValueOnce(new Error('close'));
 await expect(fs.iterateDirectory('/')[Symbol.asyncIterator]().next()).rejects.toMatchObject({code:'EIO'});
 expect(second.close).toHaveBeenCalledTimes(1);
});
