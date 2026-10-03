import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
it.each(["dilate","erode"] as const)("runs backed PNG %s after resize and threshold",async kind=>{
 const fs=new MemoryFileSystem(),data=Uint8Array.from({length:19*13*4},(_,i)=>(i*43+Math.floor(i/7))%256);
 const input=sharp(data,{raw:{width:19,height:13,channels:4}}).png().toBufferSync();await fs.writeFile("/in.png",input);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile") return ()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const apply=(s:ReturnType<typeof sharp>)=>s.resize(9,7).threshold(128)[kind](3);
 const expected=apply(sharp(input)).png().toBufferWithObjectSync();
 const info=await apply(sharp("/in.png",{filesystem:guarded})).png().toFile("/out.png"),output=await fs.readFile("/out.png");
 expect(info).toEqual({...expected.info,size:output.length});
 expect(Buffer.compare(sharp(output).raw().toBufferSync(),sharp(expected.data).raw().toBufferSync())).toBe(0);
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in.png","out.png"]);
});
