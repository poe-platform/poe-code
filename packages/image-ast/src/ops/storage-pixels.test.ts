import {expect,it} from "vitest";
import sharp from "../index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";

it("keeps point-operation order and split gamma on backed PNG files",async()=>{
  const fs=new MemoryFileSystem();
  const data=Uint8Array.from({length:73*35*4},(_,i)=>(i*23)%256);
  const input=await sharp(data,{raw:{width:73,height:35,channels:4}}).png().toBuffer();
  await fs.writeFile("/in.png",input);
  const guarded=new Proxy(fs,{get(target,key){
    if(key==="readFile" || key==="writeFile") return ()=>{throw new Error("whole-file I/O forbidden");};
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
  const operations=(image:ReturnType<typeof sharp>)=>image.grayscale().negate({alpha:true}).linear([1.1,0.8,1.2],[3,4,5]).gamma(1.8,2.4).modulate({brightness:1.1,saturation:0.7,hue:15}).flip().png();
  const expected=await operations(sharp(input)).toBuffer({resolveWithObject:true});
  const info=await operations(sharp("/in.png",{filesystem:guarded})).toFile("/out.png");
  const output=await fs.readFile("/out.png");
  expect(Buffer.compare(await sharp(output).raw().toBuffer(),await sharp(expected.data).raw().toBuffer())).toBe(0);
  expect({...info,size:0}).toEqual({...expected.info,size:0});
});
