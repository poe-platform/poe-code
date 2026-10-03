import {expect,it} from "vitest";
import sharp from "./index.js";
import {readGifMetadataFromSource} from "./codecs/gif-metadata-storage.js";
import {readGifMetadata} from "./codecs/gif.js";
import {readImageMetadataFromSource} from "./codecs/metadata-source.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {PagedStorage} from "@poe-code/safe-fs/storage";

function fixture(frames:number,loop=0):Uint8Array {
 const prefix=Uint8Array.of(71,73,70,56,57,97,3,0,5,0,0,0,0,33,255,11,...new TextEncoder().encode("NETSCAPE2.0"),3,1,loop&255,loop>>>8,0);
 const bytes=new Uint8Array(prefix.length+frames*23+1);bytes.set(prefix);
 for(let i=0;i<frames;i++)bytes.set([33,249,4,0,i&255,(i>>>8)&255,0,0,44,0,0,0,0,3,0,5,0,0,2,2,68,1,0],prefix.length+i*23);
 bytes[bytes.length-1]=59;return bytes;
}
for(const frames of [0,1,4])for(const loop of [0,7])for(const options of [{},{animated:true},{page:2,pages:-1},{page:1,pages:2}])it(`preserves GIF metadata ${frames}/${loop}/${JSON.stringify(options)}`,async()=>{
 const bytes=fixture(frames,loop),expected=readGifMetadata(bytes,options);expect(expected).toMatchSnapshot();
 const fs=new MemoryFileSystem(),signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/",env:{},signal});
 try {
  const actual=await readImageMetadataFromSource({size:bytes.length,async read(at,length){expect(length).toBeLessThanOrEqual(4096);return bytes.subarray(at,at+length);}},signal,options,storage);
  const {storedDelay,...metadata}=actual;const delay=[];if(storedDelay)for(let i=0;i<storedDelay.length;i++)delay.push(await storedDelay.at(i));
  expect({...metadata,...(delay.length?{delay}:{})}).toEqual(expected);
 }finally{await storage.close();}
});
it("inspects caller-backed GIF delays within an owned metadata scope",async()=>{
 const fs=new MemoryFileSystem(),bytes=fixture(17);await fs.writeFile("/image",bytes);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const value=await sharp("/image",{filesystem:guarded,animated:true}).inspectMetadata(async metadata=>{
  expect(metadata.delay).toBeUndefined();expect(metadata.storedDelay?.length).toBe(17);
  expect(await metadata.storedDelay?.at(16)).toBe(160);return metadata.height;
 });
 expect(value).toBe(85);
 expect(await sharp("/image",{filesystem:guarded,animated:true}).metadata()).toEqual({...readGifMetadata(bytes,{animated:true}),autoOrient:{width:3,height:85}});
});

for(const length of [0,5,6,12,13,15,17,29,30,33,34,41,42,50,51,54,55,56,57,80,123])it(`preserves GIF metadata truncation at ${length}`,async()=>{
 const bytes=fixture(4,7).subarray(0,length);let expected:unknown;
 try{expected=readGifMetadata(bytes,{animated:true});}catch(error){expected=(error as Error).message;}
 const fs=new MemoryFileSystem(),signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/",env:{},signal});
 try{
  let actual:unknown;
  try{const {storedDelay,...meta}=await readGifMetadataFromSource({size:bytes.length,async read(at,length){return bytes.subarray(at,at+length);}},storage,signal,{animated:true});const delay=[];if(storedDelay)for(let i=0;i<storedDelay.length;i++)delay.push(await storedDelay.at(i));actual={...meta,...(delay.length?{delay}:{})};}catch(error){actual=(error as Error).message;}
  expect(actual).toEqual(expected);
 }finally{await storage.close();}
});

for(const mode of ["success","callback","cancel","write","read","close"] as const)it(`owns large GIF delay backing on ${mode}`,async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),reason=new Error(mode),bytes=fixture(262145);await fs.writeFile("/image",bytes);
 let sourceClosed=0,scratchClosed=0,opened=0;const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file I/O forbidden");};
  if(key==="openReadFile")return async(...args:Parameters<NonNullable<typeof fs.openReadFile>>)=>{const handle=await fs.openReadFile(...args);return {...handle,async close(){sourceClosed++;await handle.close();}};};
  if(key==="open")return async(...args:Parameters<typeof fs.open>)=>{opened++;const handle=await fs.open(...args);return new Proxy(handle,{get(retained,method){
   if(method==="write"&&mode==="write")return async()=>{throw reason;};
   if(method==="read"&&mode==="read")return async()=>{throw reason;};
   if(method==="close")return async()=>{scratchClosed++;await handle.close();if(mode==="close")throw reason;};
   const value=Reflect.get(retained,method,retained);return typeof value==="function"?value.bind(retained):value;
  }});};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 let escaped:import("./ast.js").ImageDelayReader|undefined;
 const result=sharp("/image",{filesystem:guarded,signal:controller.signal}).inspectMetadata(async metadata=>{
  escaped=metadata.storedDelay;expect(escaped?.length).toBe(262145);expect(metadata.delay).toBeUndefined();
  if(mode==="callback")throw reason;if(mode==="cancel")controller.abort(reason);
  expect(await escaped?.at(0)).toBe(0);expect(await escaped?.at(262144)).toBe(0);
 });
 if(mode==="success")await result;else await expect(result).rejects.toBe(reason);
 expect(opened).toBe(1);expect(sourceClosed).toBe(1);expect(scratchClosed).toBe(1);
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["image"]);
 if(escaped)await expect(escaped.at(0)).rejects.toThrow();
},15000);

import {UnsupportedStoredResource} from "./codecs/unsupported-storage.js";
it("preserves a callback's unsupported error over scratch cleanup and never invokes it twice",async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile("/image",fixture(262145));const reason=new UnsupportedStoredResource();let calls=0,closed=0;
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="openReadFile")return async(...args:Parameters<NonNullable<typeof fs.openReadFile>>)=>{const handle=await fs.openReadFile(...args);return {...handle,async close(){closed++;await handle.close();}};};
  if(key==="open")return async(...args:Parameters<typeof fs.open>)=>{const handle=await fs.open(...args);return new Proxy(handle,{get(retained,method){if(method==="close")return async()=>{await handle.close();throw new Error("secondary close");};const value=Reflect.get(retained,method,retained);return typeof value==="function"?value.bind(retained):value;}});};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 await expect(sharp("/image",{filesystem:guarded}).inspectMetadata(()=>{calls++;throw reason;})).rejects.toBe(reason);
 expect(calls).toBe(1);expect(closed).toBe(1);
});

it("validates source identity before exposing metadata to the inspection callback",async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile("/image",fixture(1));let calls=0,closed=0;
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="openReadFile")return async(...args:Parameters<NonNullable<typeof fs.openReadFile>>)=>{const handle=await fs.openReadFile(...args);let stats=0;return {...handle,async stat(){const value=await handle.stat();return ++stats===2?{...value,size:value.size+1}:value;},async close(){closed++;await handle.close();}};};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 await expect(sharp("/image",{filesystem:guarded}).inspectMetadata(()=>{calls++;})).rejects.toMatchObject({code:"EAGAIN"});
 expect(calls).toBe(0);expect(closed).toBe(1);
});

import {decodeGifToStorage} from "./codecs/gif-input-storage.js";
for(const decode of [false,true])it(`owns concurrent borrowed GIF delay reads decode=${decode}`,async()=>{
 const bytes=fixture(4),memory=new Uint8Array(65536),borrowed=new Uint8Array(4096);let end=8,reads=0;
 const storage={allocate(length:number){const at=end;end+=length;return at;},async write(at:number,bytes:Uint8Array){memory.set(bytes,at);},async read(at:number,length:number){reads++;borrowed.fill(91);borrowed.set(memory.subarray(at,at+length));return borrowed.subarray(0,length);}};
 const source={size:bytes.length,async read(at:number,length:number){return bytes.subarray(at,at+length);}},controller=new AbortController();
 const metadata=await (decode?decodeGifToStorage:readGifMetadataFromSource)(source,storage,controller.signal);
 expect(await Promise.all([0,1,2,3].map(i=>metadata.storedDelay!.at(i)))).toEqual([0,10,20,30]);
 const before=reads,reason=new Error("original cancelled");controller.abort(reason);
 await expect(metadata.storedDelay!.at(0,{signal:new AbortController().signal})).rejects.toBe(reason);expect(reads).toBe(before);
});
