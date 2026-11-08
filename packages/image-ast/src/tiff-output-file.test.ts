import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
it.each(["png","ppm","pgm","pbm","bmp"] as const)("streams TIFF output from %s through caller storage",async format=>{
 const fs=new MemoryFileSystem(),pixels=Uint8Array.from({length:37*29*4},(_,i)=>i*43%256),bytes=sharp(pixels,{raw:{width:37,height:29,channels:4}}).toFormat(format).toBufferSync();
 await fs.writeFile("/in",bytes);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const pipeline=(image:ReturnType<typeof sharp>)=>image.resize(19,13).flip().rotate(17).withMetadata({density:144,orientation:6}).tiff();
 const expected=pipeline(sharp(bytes)).toBufferWithObjectSync(),info=await pipeline(sharp("/in",{filesystem:guarded})).toFile("/out");
 const actual=await fs.readFile("/out");expect(info).toEqual({...expected.info,size:actual.length});
 expect(Buffer.compare(actual,expected.data)).toBe(0);
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in","out"]);
});
