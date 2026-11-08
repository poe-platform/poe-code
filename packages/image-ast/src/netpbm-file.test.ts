import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
const formats=["png","ppm","pgm","pbm"] as const;
it.each(formats.flatMap(input=>formats.map(output=>({input,output}))))("converts $input to $output through retained caller storage",async({input,output})=>{
 const fs=new MemoryFileSystem(),pixels=Uint8Array.from({length:37*29*4},(_,i)=>i*43%256),bytes=sharp(pixels,{raw:{width:37,height:29,channels:4}}).toFormat(input).toBufferSync();
 await fs.writeFile("/in",bytes);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const pipeline=(image:ReturnType<typeof sharp>)=>image.resize(19,13).flip().rotate(17).toFormat(output);
 const expected=pipeline(sharp(bytes)).toBufferWithObjectSync(),info=await pipeline(sharp("/in",{filesystem:guarded})).toFile("/out");
 const actual=await fs.readFile("/out");
 expect(info).toEqual({...expected.info,size:actual.length});
 expect(Buffer.compare(sharp(actual).raw().toBufferSync(),sharp(expected.data).raw().toBufferSync())).toBe(0);
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in","out"]);
});
it.each(["ppm","pgm","pbm"] as const)("decodes %s file overlays using the parent's filesystem",async format=>{
 const fs=new MemoryFileSystem(),input=sharp({create:{width:17,height:13,channels:4,background:"red"}}).png().toBufferSync(),extra=sharp({create:{width:5,height:7,channels:3,noise:{type:"gaussian"}}}).toFormat(format).toBufferSync();
 await fs.writeFile("/in",input);await fs.writeFile("/overlay",extra);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const expected=sharp(input).composite([{input:extra,tile:true}]).png().toBufferSync();
 await sharp("/in",{filesystem:guarded}).composite([{input:"/overlay",tile:true}]).png().toFile("/out");
 expect(Buffer.compare(sharp(await fs.readFile("/out")).raw().toBufferSync(),sharp(expected).raw().toBufferSync())).toBe(0);
});
