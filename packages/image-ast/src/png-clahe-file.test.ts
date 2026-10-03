import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
it.each([1,2].flatMap(channels=>[false,true].map(explicit=>({channels,explicit}))))("preserves CLAHE grayscale input channels=$channels explicit=$explicit",async({channels,explicit})=>{
 const fs=new MemoryFileSystem(),data=Uint8Array.from({length:19*13*channels},(_,i)=>(i*43+Math.floor(i/7))%256);
 const input=sharp(data,{raw:{width:19,height:13,channels}}).png().toBufferSync();await fs.writeFile("/in.png",input);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile") return ()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const pipeline=(s:ReturnType<typeof sharp>)=>(explicit?s.grayscale():s).clahe({width:5,height:3,maxSlope:2}).png();
 const expected=pipeline(sharp(input)).toBufferWithObjectSync(),info=await pipeline(sharp("/in.png",{filesystem:guarded})).toFile("/out.png"),output=await fs.readFile("/out.png");
 expect(info).toEqual({...expected.info,size:output.length});
 expect(Buffer.compare(sharp(output).raw().toBufferSync(),sharp(expected.data).raw().toBufferSync())).toBe(0);
});
