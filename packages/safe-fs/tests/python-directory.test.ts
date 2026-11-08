import {expect,it,vi} from 'vitest';
import {MemoryFileSystem} from '../src/fs/memory/index.js';
import {PythonFileSystem} from '../src/python/index.js';

it('Python directory cursors consume lazily and close the caller iterator on early exit',async()=>{
 const fs=new MemoryFileSystem();let consumed=0,closed=0;
 vi.spyOn(fs,'readdir').mockRejectedValue(new Error('buffered directory read'));
 vi.spyOn(fs,'iterateDirectory').mockImplementation(async function*(){
  try{for(let i=0;i<4096;i++){consumed++;yield {name:'entry-'+i,type:'file' as const};}}
  finally{closed++;}
 });
 const service=new PythonFileSystem(fs,{cwd:'/'});
 try{
  const id=await service.dispatch({op:'directoryOpen',args:['/']});
  expect(consumed).toBe(1);
  expect(await service.dispatch({op:'directoryNext',args:[id]})).toBe('entry-0');
  expect(await service.dispatch({op:'directoryNext',args:[id]})).toBe('entry-1');
  expect(consumed).toBe(2);
  await service.dispatch({op:'close',args:[id]});expect(closed).toBe(1);
  await expect(service.dispatch({op:'directoryNext',args:[id]})).rejects.toMatchObject({code:'EBADF'});
 }finally{await service.close();}
});

it('Python directory cursors share descriptor admission and enforce the configured entry limit',async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile('/a',new Uint8Array());await fs.writeFile('/b',new Uint8Array());
 const service=new PythonFileSystem(fs,{cwd:'/',maxOpenFiles:1,maxDirectoryEntries:1});
 try{
  const id=await service.dispatch({op:'directoryOpen',args:['/']});
  await expect(service.dispatch({op:'open',args:['/a',{access:'read'}]})).rejects.toMatchObject({code:'EMFILE'});
  expect(await service.dispatch({op:'directoryNext',args:[id]})).toBe('a');
  await expect(service.dispatch({op:'directoryNext',args:[id]})).rejects.toMatchObject({code:'EFBIG'});
  await service.dispatch({op:'close',args:[id]});
  const file=await service.dispatch({op:'open',args:['/a',{access:'read'}]});
  await expect(service.dispatch({op:'directoryOpen',args:['/']})).rejects.toMatchObject({code:'EMFILE'});
  await service.dispatch({op:'close',args:[file]});
 }finally{await service.close();}
});

it('Python directory acquisition errors are eager and disposal retires abandoned cursors',async()=>{
 const fs=new MemoryFileSystem();let closed=0;
 const service=new PythonFileSystem(fs,{cwd:'/'});
 await expect(service.dispatch({op:'directoryOpen',args:['/missing']})).rejects.toMatchObject({code:'ENOENT'});
 vi.spyOn(fs,'iterateDirectory').mockImplementation(async function*(){try{yield {name:'a',type:'file' as const};}finally{closed++;}});
 await service.dispatch({op:'directoryOpen',args:['/']});await service.close();expect(closed).toBe(1);
});

it('Python directory close drains a pending read after cancellation and retires its iterator',async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController();let pulls=0,closed=0;
 let release!:()=>void;
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 vi.spyOn(fs,'iterateDirectory').mockImplementation(()=>({[Symbol.asyncIterator](){return {
  async next(){if(++pulls>1)await blocked;return {done:false as const,value:{name:'entry',type:'file' as const}};},
  async return(){closed++;return {done:true as const,value:undefined};},
 };}}));
 const service=new PythonFileSystem(fs,{cwd:'/',signal:controller.signal});
 const id=await service.dispatch({op:'directoryOpen',args:['/']});
 await service.dispatch({op:'directoryNext',args:[id]});
 const pending=service.dispatch({op:'directoryNext',args:[id]});
 await Promise.resolve();
 const reason=new Error('cancelled directory read');controller.abort(reason);
 const rejected=expect(pending).rejects.toBe(reason);
 const retired=service.dispatch({op:'close',args:[id]});
 expect(closed).toBe(0);release();await rejected;await retired;await service.close();expect(closed).toBe(1);
});
