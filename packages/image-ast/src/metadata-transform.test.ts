import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";

for(const format of ["png","jpeg","webp","bmp","ppm","pgm","pbm","tiff"] as const)
for(const operation of ["resize","composite","channels","metadata"] as const)
it(`inspects ${format} metadata after ${operation} using retained files`,async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:31,height:23,channels:4,background:"red"}}).toFormat(format).toBuffer();
 const overlay=await sharp({create:{width:3,height:5,channels:4,background:"blue"}}).png().toBuffer();
 await fs.writeFile("/input",bytes);await fs.writeFile("/overlay",overlay);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file metadata I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const apply=(image:ReturnType<typeof sharp>,resource:string|Uint8Array)=>{
  if(operation==="resize")image.resize(19,13).gamma(1.8).rotate(90).png();
  if(operation==="composite")image.composite([{input:resource,left:1,top:2}]);
  if(operation==="channels")image.grayscale().ensureAlpha(.7);
  if(operation==="metadata")image.withMetadata({density:144,orientation:6});
  return image;
 };
 const expected=await apply(sharp(bytes),overlay).metadata();
 expect(await apply(sharp("/input",{filesystem:guarded}),"/overlay").metadata()).toEqual(expected);
});

for(const mode of ["success","write","read","cancel","close"] as const) it(`owns spilled transformed metadata handles on ${mode}`,async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),failure=new Error(`injected ${mode}`);
 await fs.mkdir("/scratch");
 const bytes=await sharp({create:{width:2053,height:129,channels:4,background:"red"}}).png().toBuffer();
 await fs.writeFile("/input.png",bytes);
 const expected=await sharp(bytes).resize(1025,97).metadata();
 let sourceHandles=0,scratchHandles=0,opens=0,reads=0,writes=0;
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile" || key==="writeFile") return ()=>{throw new Error("whole-file I/O forbidden");};
  if(key==="openReadFile") return async(...args:Parameters<NonNullable<typeof fs.openReadFile>>)=>{
   const handle=await fs.openReadFile(...args);sourceHandles++;
   return {...handle,async close(){sourceHandles--;await handle.close();}};
  };
  if(key==="open") return async(...args:Parameters<typeof fs.open>)=>{
   expect(args[0].startsWith("/scratch/.storage-")).toBe(true);
   const handle=await fs.open(...args);scratchHandles++;opens++;
   return new Proxy(handle,{get(retained,method){
    if(method==="write") return async(...values:Parameters<typeof handle.write>)=>{
     writes++;
     if(writes===2 && mode==="write") throw failure;
     if(writes===2 && mode==="cancel") controller.abort(failure);
     return handle.write(...values);
    };
    if(method==="read") return async(...values:Parameters<typeof handle.read>)=>{
     reads++;if(reads===2 && mode==="read") throw failure;return handle.read(...values);
    };
    if(method==="close") return async()=>{scratchHandles--;await handle.close();if(mode==="close") throw failure;};
    const value=Reflect.get(retained,method,retained);return typeof value==="function"?value.bind(retained):value;
   }});
  };
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 let callbackCount=0;
 const result=sharp("/input.png",{filesystem:guarded,workingDirectory:"/scratch",signal:controller.signal}).resize(1025,97).metadata((error,value)=>{
  callbackCount++;if(mode==="success"){expect(error).toBeNull();expect(value).toEqual(expected);}else expect(error).toBe(failure);
 });
 if(mode==="success") expect(await result).toEqual(expected);else await expect(result).rejects.toBe(failure);
 expect(callbackCount).toBe(1);expect(opens).toBe(1);expect(sourceHandles).toBe(0);expect(scratchHandles).toBe(0);
 expect(await fs.readdir("/scratch")).toEqual([]);
 expect(await fs.readFile("/input.png")).toEqual(bytes);
});

for(const kind of ["raw-file","raw-bytes","encoded-bytes","text","create","cached"] as const)it(`retains transformed metadata for ${kind}`,async()=>{
 const fs=new MemoryFileSystem(),raw={width:17,height:9,channels:4 as const,depth:"ushort" as const,pageHeight:3};
 const data=new Uint8Array(17*9*8).fill(127),png=await sharp(data,{raw}).png().toBuffer();
 const text={text:"metadata text",width:17,height:9,rgba:true},create={width:17,height:9,channels:4 as const,background:"red"};
 await fs.writeFile("/input",kind==="raw-file"?data:png);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile"||(key==="openReadFile"&&(kind==="text"||kind==="create")))return ()=>{throw new Error("unexpected file acquisition");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const actual=kind==="raw-file"?sharp("/input",{raw,filesystem:guarded}):kind==="raw-bytes"?sharp(data,{raw,filesystem:guarded}):kind==="text"?sharp("/input",{text,filesystem:guarded}):kind==="create"?sharp("/input",{create,filesystem:guarded}):kind==="cached"?sharp("/input",{filesystem:fs}):sharp(png,{filesystem:guarded});
 if(kind==="cached"){await actual.toBuffer();await fs.writeFile("/input",new Uint8Array());}
 const buffered=kind.startsWith("raw")?sharp(data,{raw}):kind==="text"?sharp(undefined,{text}):kind==="create"?sharp(undefined,{create}):sharp(png);
 const expected=await buffered.resize(13,7).grayscale().metadata();
 expect(await actual.resize(13,7).grayscale().metadata()).toEqual(expected);
});

it("validates source identity after transformed metadata and closes every handle",async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:531,height:513,channels:4,background:"red"}}).png().toBuffer();
 await fs.writeFile("/input",bytes);let sourceClosed=0,scratchClosed=0;
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile")return ()=>{throw new Error("whole-file read forbidden");};
  if(key==="openReadFile")return async(...args:Parameters<NonNullable<typeof fs.openReadFile>>)=>{const handle=await fs.openReadFile(...args);let stats=0;return {...handle,async stat(){const value=await handle.stat();return ++stats===2?{...value,size:value.size+1}:value;},async close(){sourceClosed++;await handle.close();}};};
  if(key==="open")return async(...args:Parameters<typeof fs.open>)=>{const handle=await fs.open(...args);return new Proxy(handle,{get(retained,method){if(method==="close")return async()=>{scratchClosed++;await handle.close();};const value=Reflect.get(retained,method,retained);return typeof value==="function"?value.bind(retained):value;}});};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 await expect(sharp("/input",{filesystem:guarded}).resize(17,19).metadata()).rejects.toMatchObject({code:"EAGAIN"});
 expect(sourceClosed).toBe(1);expect(scratchClosed).toBe(1);expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["input"]);
});
