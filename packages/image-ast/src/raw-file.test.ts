import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";

for(const depth of ["uchar","char","ushort","short","uint","int","float","double"] as const)
for(const channels of [1,2,3,4] as const)
for(const operation of ["none","rgb16","resize16"] as const)it(`streams raw ${depth}/${channels}/${operation} with original sample precision`,async()=>{
 const fs=new MemoryFileSystem(),raw={width:19,height:7,channels,depth:"ushort" as const};
 const samples=Uint16Array.from({length:raw.width*raw.height*channels},(_,i)=>(i*433+17)%65536),bytes=new Uint8Array(samples.buffer);
 await fs.writeFile("/input",bytes);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const apply=(image:ReturnType<typeof sharp>)=>{if(operation==="rgb16")image.toColourspace("rgb16");if(operation==="resize16")image.resize(23,11).toColourspace("rgb16");return image.raw({depth});};
 const expected=await apply(sharp(bytes,{raw})).toBuffer({resolveWithObject:true});
 const info=await apply(sharp("/input",{raw,filesystem:guarded})).toFile("/output");
 expect(await fs.readFile("/output")).toEqual(expected.data);expect(info).toEqual(expected.info);
});

for(const cancel of [false,true]) it(`preserves output and closes raw-output scratch on publication ${cancel?"cancellation":"failure"}`,async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),reason=new Error("publisher failed"),before=Uint8Array.of(7,8,9);
 const raw={width:2053,height:129,channels:4 as const},data=new Uint8Array(raw.width*raw.height*4).fill(91);
 await fs.writeFile("/output.png",before);let opened=0,closed=0;
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile" || key==="writeFile")return ()=>{throw new Error("whole-file I/O forbidden");};
  if(key==="publishFileConditional" || key==="publishStagedFile")return async()=>{if(cancel)controller.abort(reason);throw reason;};
  if(key==="open")return async(...args:Parameters<typeof fs.open>)=>{
   const handle=await fs.open(...args);opened++;
   return new Proxy(handle,{get(retained,method){
    if(method==="close")return async()=>{closed++;await handle.close();};
    const value=Reflect.get(retained,method,retained);return typeof value==="function"?value.bind(retained):value;
   }});
  };
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 await expect(sharp(data,{raw,filesystem:guarded,signal:controller.signal}).raw({depth:"ushort"}).toFile("/output.png")).rejects.toBe(reason);
 expect(opened).toBeGreaterThan(0);expect(closed).toBe(opened);
 expect(await fs.readFile("/output.png")).toEqual(before);
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["output.png"]);
 expect(data.every(byte=>byte===91)).toBe(true);
});

for(const inputDepth of ["uchar","char","ushort","short","uint","int","float","double"] as const)
for(const operation of ["flip","rotate","grayscale","alpha","extract","extend","composite","modulate","blur","normalize","gamma","affine"] as const)
it(`preserves ${inputDepth} original samples across ${operation}`,async()=>{
 const fs=new MemoryFileSystem(),raw={width:17,height:9,channels:4 as const,depth:inputDepth,pageHeight:operation==="rotate"?9:3};
 const bytes=Uint8Array.from({length:17*9*4*8-1},(_,i)=>(i*37)%256);
 const guarded=new Proxy(fs,{get(target,key){if(key==="writeFile")return ()=>{throw new Error("whole-file output forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const apply=(image:ReturnType<typeof sharp>)=>{
  if(operation==="flip")image.flip().flop();
  if(operation==="rotate")image.rotate(90);
  if(operation==="grayscale")image.grayscale();
  if(operation==="alpha")image.removeAlpha().ensureAlpha(.7);
  if(operation==="extract")image.extract({left:1,top:1,width:11,height:2});
  if(operation==="extend")image.extend({top:1,bottom:1,left:1,right:1,background:"red"});
  if(operation==="composite")image.composite([{input:{create:{width:2,height:2,channels:4,background:"blue"}},left:0,top:0}]);
  if(operation==="modulate")image.modulate({brightness:1.4,saturation:.7});
  if(operation==="blur")image.blur(.7);
  if(operation==="normalize")image.normalize();
  if(operation==="gamma")image.gamma(1.8);
  if(operation==="affine")image.affine([1,0,0,1],{idx:1});
  return image.toColourspace("rgb16").raw({depth:"ushort"});
 };
 const expected=await apply(sharp(bytes,{raw})).toBuffer({resolveWithObject:true});
 const info=await apply(sharp(bytes,{raw,filesystem:guarded})).toFile("/out");
 expect(await fs.readFile("/out")).toEqual(expected.data);expect(info).toEqual(expected.info);
});
