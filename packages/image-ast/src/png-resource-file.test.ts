import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
const pipelines=[
 (s:ReturnType<typeof sharp>,input:string|Uint8Array)=>s.boolean(input,"and"),
 (s:ReturnType<typeof sharp>,input:string|Uint8Array)=>s.boolean(input,"or").resize(9,7),
 (s:ReturnType<typeof sharp>,input:string|Uint8Array)=>s.boolean(input,"eor").normalize(),
 (s:ReturnType<typeof sharp>,input:string|Uint8Array)=>s.joinChannel(input),
 (s:ReturnType<typeof sharp>,input:string|Uint8Array)=>s.removeAlpha().grayscale().joinChannel([input,input,input]),
 (s:ReturnType<typeof sharp>,input:string|Uint8Array)=>s.grayscale().joinChannel([input,input]).blur(1.5)
];
it.each(pipelines.map((pipeline,index)=>({pipeline,index})))("loads secondary PNG $index through caller backing",async({pipeline})=>{
 const fs=new MemoryFileSystem(),data=Uint8Array.from({length:19*13*4},(_,i)=>(i*43+Math.floor(i/7))%256);
 const input=sharp(data,{raw:{width:19,height:13,channels:4}}).png().toBufferSync();
 const operand=sharp(data.subarray(0,7*5*4),{raw:{width:7,height:5,channels:4}}).png().toBufferSync();
 await fs.writeFile("/in.png",input);await fs.writeFile("/other.png",operand);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile") return ()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const expected=pipeline(sharp(input),operand).png().toBufferWithObjectSync();
 const info=await pipeline(sharp("/in.png",{filesystem:guarded}),"/other.png").png().toFile("/out.png"),output=await fs.readFile("/out.png");
 expect(info).toEqual({...expected.info,size:output.length});
 expect(Buffer.compare(sharp(output).raw().toBufferSync(),sharp(expected.data).raw().toBufferSync())).toBe(0);
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in.png","other.png","out.png"]);
});
