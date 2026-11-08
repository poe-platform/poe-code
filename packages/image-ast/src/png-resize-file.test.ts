import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
const pipelines=[
  (s:ReturnType<typeof sharp>)=>s.resize(13,17,{fit:"cover",position:"attention"}),
  (s:ReturnType<typeof sharp>)=>s.resize(13,17,{fit:"cover",position:"entropy"}).flip().rotate(90).flop(),
  (s:ReturnType<typeof sharp>)=>s.flip().resize(13,17,{fit:"contain",background:{r:17,g:39,b:79,alpha:0.5}}).rotate(90),
  (s:ReturnType<typeof sharp>)=>s.gamma(2.2).resize(13,17).modulate({brightness:1.2}).normalize(),
  (s:ReturnType<typeof sharp>)=>s.resize(13,17).gamma(2.2).negate()
];
it.each(pipelines.map((pipeline,index)=>({pipeline,index})))("resizes PNG files without whole-file fallback for pipeline $index",async({pipeline})=>{
  const fs=new MemoryFileSystem(),data=Uint8Array.from({length:31*23*4},(_,i)=>(i*43+Math.floor(i/7))%256);
  const input=sharp(data,{raw:{width:31,height:23,channels:4}}).png().toBufferSync();
  await fs.writeFile("/in.png",input);
  const guarded=new Proxy(fs,{get(target,key){if(key==="readFile" || key==="writeFile") return ()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  const expected=pipeline(sharp(input)).png().toBufferWithObjectSync();
  const actual=await pipeline(sharp("/in.png",{filesystem:guarded})).toFile("/output");
  const output=await fs.readFile("/output");
  // Streaming PNGs may split IDAT chunks differently; metadata size is the actual file size.
  expect(actual).toEqual({...expected.info,size:output.length});
  expect(Buffer.compare(sharp(output).raw().toBufferSync(),sharp(expected.data).raw().toBufferSync())).toBe(0);
  expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in.png","output"]);
});
