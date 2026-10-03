import {expect,it,vi} from "vitest";
import sharp from "../index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {normalizeImage} from "./transform.js";
import type {RgbaImage} from "../ast.js";

it("normalizes without allocating image-sized float planes",()=>{
  const data=Uint8Array.from({length:8193*4},(_,i)=>(i*43+Math.floor(i/257))%256);
  const image:RgbaImage={width:8193,height:1,data,format:"png",space:"srgb",channels:4,depth:"uchar",density:72,hasAlpha:true};
  const Original=Float32Array;
  vi.stubGlobal("Float32Array",new Proxy(Original,{construct(target,args){
    if(typeof args[0]==="number" && args[0]>4096) throw new Error("unbounded normalization plane");
    return Reflect.construct(target,args);
  }}));
  try {expect(normalizeImage(image).data.length).toBe(data.length);}
  finally {vi.unstubAllGlobals();}
});

it("normalizes a PNG through the supplied backing without whole-file I/O",async()=>{
  const fs=new MemoryFileSystem();
  const data=Uint8Array.from({length:1031*257*4},(_,i)=>(i*43+Math.floor(i/257))%256);
  const input=await sharp(data,{raw:{width:1031,height:257,channels:4}}).png().toBuffer();
  await fs.writeFile("/in.png",input);
  const guarded=new Proxy(fs,{get(target,key){
    if(key==="readFile" || key==="writeFile") return ()=>{throw new Error("whole-file I/O forbidden");};
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
  const expected=await sharp(input).normalize({lower:3,upper:95}).raw().toBuffer();
  await sharp("/in.png",{filesystem:guarded}).normalize({lower:3,upper:95}).png().toFile("/out.png");
  expect(Buffer.compare(await sharp(await fs.readFile("/out.png")).raw().toBuffer(),expected)).toBe(0);
  expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in.png","out.png"]);
});

const vectors=[{"options":{"lower":0,"upper":100},"bytes":[0,2,47,129,198,240,51,46,84,127,170,218,0,14,55,135,207,249,57,51,91,135,178,224,0,24,61,140,215,255,62,57,99,142,185,230,0,31,70,146,223,255,68,63,108,151,194,235,0,38,78,152,232,255,74,68,117,159,202,241,0,44,85,158]},{"options":{"lower":3,"upper":95},"bytes":[0,2,47,129,198,240,51,46,84,127,170,218,0,14,55,135,207,249,57,51,91,135,178,224,0,24,61,140,215,255,62,57,99,142,185,230,0,31,70,146,223,255,68,63,108,151,194,235,0,38,78,152,232,255,74,68,117,159,202,241,0,44,85,158]},{"options":{"lower":50,"upper":50},"bytes":[0,43,86,129,172,215,2,46,89,132,175,218,5,48,92,135,178,221,8,51,94,138,181,224,11,54,97,140,184,227,14,57,100,143,186,230,17,60,103,146,189,232,20,63,106,149,192,235,22,66,109,152,195,238,25,68,112,155,198,241,28,71,114,158]}];
it.each(vectors)("preserves recorded normalization bytes for $options",({options,bytes})=>{
 const data=Uint8Array.from({length:64},(_,i)=>(i*43+Math.floor(i/7))%256);
 const image:RgbaImage={width:16,height:1,data,format:"png",space:"srgb",channels:4,depth:"uchar",density:72,hasAlpha:true};
 expect([...normalizeImage(image,options).data]).toEqual(bytes);
});
