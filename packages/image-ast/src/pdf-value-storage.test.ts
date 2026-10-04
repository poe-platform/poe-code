import {expect,it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {PdfValueStorage} from "./pdf-value-storage.js";

it("preserves sparse pages and latest random writes across immutable run compaction",async()=>{
 const fs=new MemoryFileSystem(),storage=new PdfValueStorage(fs,"/",new AbortController().signal);
 const length=16384*33,position=storage.allocate(length),expected=new Uint8Array(length);
 try{
  let state=123;
  for(let round=0;round<3;round++)for(let page=0;page<33;page++){
   state=(state*1664525+1013904223)>>>0;
   const at=((page*17)%33)*16384+round*11,bytes=Uint8Array.of(state&255,round,page);
   expected.set(bytes,at);await storage.write(position+at,bytes);
  }
  // Cross-page writes, including pages previously written into older runs.
  const crossing=new Uint8Array(32771).fill(91);expected.set(crossing,16380);await storage.write(position+16380,crossing);
  for(let offset=0;offset<length;offset+=8191)expect(await storage.read(position+offset,Math.min(8191,length-offset))).toEqual(expected.subarray(offset,offset+8191));
  expect((await fs.readdir("/")).length).toBeGreaterThan(0);
 }finally{await storage.close();}
 expect(await fs.readdir("/")).toEqual([]);
 await expect(storage.close()).resolves.toBeUndefined();
 expect(()=>storage.allocate(1)).toThrow("closed");
});

it.each(["write","read","cancel"])("cleans every retained run after %s failure",async phase=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),failure=new Error("staged backing failed");let enabled=false;
 const filesystem=new Proxy(fs,{get(target,key){
  if(key==="createStagedFile")return async(...args:Parameters<typeof fs.createStagedFile>)=>{
   const stage=await fs.createStagedFile(...args);
   return {...stage,writer:{async write(...writeArgs:Parameters<NonNullable<typeof stage.writer>["write"]>){
    if(enabled&&phase!=="read"){if(phase==="cancel")controller.abort(failure);throw failure;}
    return stage.writer!.write(...writeArgs);
   },finish:stage.writer!.finish.bind(stage.writer)}};
  };
  if(key==="openReadFile")return async(...args:Parameters<typeof fs.openReadFile>)=>{
   const handle=await fs.openReadFile(...args);
   return {...handle,stat:handle.stat.bind(handle),close:handle.close.bind(handle),async read(...readArgs:Parameters<typeof handle.read>){if(enabled&&phase==="read")throw failure;return handle.read(...readArgs);}};
  };
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 const storage=new PdfValueStorage(filesystem,"/",controller.signal),position=storage.allocate(16384*20);
 try{
  for(let i=0;i<12;i++)await storage.write(position+i*16384,Uint8Array.of(i));
  enabled=true;
  const work=phase==="read"?storage.read(position,1):(async()=>{for(let i=12;i<20;i++)await storage.write(position+i*16384,Uint8Array.of(i));})();
  await expect(work).rejects.toBe(failure);
 }finally{await storage.close();}
 expect(await fs.readdir("/")).toEqual([]);
});

it("checks allocation, ranges, aborts and queued ownership",async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),storage=new PdfValueStorage(fs,"/",controller.signal);
 expect(()=>storage.allocate(-1)).toThrow(RangeError);
 const position=storage.allocate(4);
 expect(()=>storage.read(position,5)).toThrow(RangeError);
 const first=storage.write(position,Uint8Array.of(1,2)),second=storage.write(position+1,Uint8Array.of(3));
 await Promise.all([first,second]);expect(await storage.read(position,4)).toEqual(Uint8Array.of(1,3,0,0));
 const reason=new Error("stop");controller.abort(reason);expect(()=>storage.read(position,1)).toThrow(reason);
 await storage.close();expect(await fs.readdir("/")).toEqual([]);
});

it("allows timer cancellation during a long in-memory staging write",async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),storage=new PdfValueStorage(fs,"/",controller.signal),reason=new Error("timer cancelled");
 const bytes=new Uint8Array(16384*256),position=storage.allocate(bytes.length);
 const timer=setTimeout(()=>controller.abort(reason),0);
 try{await expect(storage.write(position,bytes)).rejects.toBe(reason);}
 finally{clearTimeout(timer);await storage.close();}
 expect(await fs.readdir("/")).toEqual([]);
});
