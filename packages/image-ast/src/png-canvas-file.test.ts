import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
it("preserves trim offsets through backed PNG median and extension",async()=>{
  const fs=new MemoryFileSystem();
  const input=sharp({create:{width:17,height:13,channels:4,background:"red"}}).extend({top:5,bottom:3,left:7,right:2,background:"white"}).png().toBufferSync();
  await fs.writeFile("/in.png",input);
  const guarded=new Proxy(fs,{get(target,key){if(key==="readFile" || key==="writeFile") return ()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  const apply=(s:ReturnType<typeof sharp>)=>s.trim({threshold:5}).median(3).extend({top:3,bottom:1,left:2,right:4,extendWith:"mirror"});
  const expected=apply(sharp(input)).png().toBufferWithObjectSync();
  const info=await apply(sharp("/in.png",{filesystem:guarded})).png().toFile("/out.png");
  const output=await fs.readFile("/out.png");
  expect(info).toEqual({...expected.info,size:output.length});
  expect(Buffer.compare(sharp(output).raw().toBufferSync(),sharp(expected.data).raw().toBufferSync())).toBe(0);
  expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in.png","out.png"]);
});
