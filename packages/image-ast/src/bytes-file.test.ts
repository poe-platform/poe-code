import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";

for(const kind of ["encoded","raw-bytes","raw-file","text","create","cached"] as const) it(`publishes ${kind} inputs without buffered file I/O`,async()=>{
 const fs=new MemoryFileSystem(),raw={width:53,height:37,channels:4 as const};
 const data=Uint8Array.from({length:53*37*4},(_,i)=>(i*17+(i>>>5)*31)%256);
 const png=await sharp(data,{raw}).png().toBuffer();
 await fs.writeFile("/input",kind==="raw-file"?data:png);
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile" || key==="writeFile")return ()=>{throw new Error("whole-file I/O forbidden");};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 const text={text:'<span color="red">file bytes</span>',width:53,height:37,rgba:true};
 const create={width:53,height:37,channels:4 as const,background:"blue"};
 const actual=kind==="encoded"?sharp(png,{filesystem:guarded}):kind==="raw-bytes"?sharp(data,{raw,filesystem:guarded}):kind==="raw-file"?sharp("/input",{raw,filesystem:guarded}):kind==="text"?sharp(png,{text,filesystem:guarded}):kind==="create"?sharp(png,{create,filesystem:guarded}):sharp("/input",{filesystem:fs});
 if(kind==="cached") {await actual.metadata();await fs.writeFile("/input",new Uint8Array());}
 const expected=await (kind==="text"?sharp(png,{text}):kind==="create"?sharp(png,{create}):kind.startsWith("raw")?sharp(data,{raw}):sharp(png)).resize(31,23).gamma(1.8,2.4).png().toBuffer({resolveWithObject:true});
 const originalWrite=fs.writeFile.bind(fs);
 if(kind==="cached") fs.writeFile=async()=>{throw new Error("whole-file I/O forbidden");};
 try {
  const info=await actual.resize(31,23).gamma(1.8,2.4).png().toFile("/output.png");
  const output=await fs.readFile("/output.png");
  expect({...info,size:0}).toEqual({...expected.info,size:0});expect(info.size).toBe(output.length);
  expect(await sharp(output).raw().toBuffer()).toEqual(await sharp(expected.data).raw().toBuffer());
 } finally {fs.writeFile=originalWrite;}
});

import type {SharpInputOptions} from "./ast.js";
for(const depth of ["uchar","char","ushort","short","uint","int","float","double","bit"] as const) {
 for(const channels of [1,2,3,4] as const) for(const file of [false,true]) it(`streams raw ${depth}/${channels} file=${file}`,async()=>{
  const fs=new MemoryFileSystem(),raw={width:17,height:9,channels,depth,pageHeight:3};
  const sampleBytes=depth==="double"?8:["uint","int","float"].includes(depth)?4:["ushort","short"].includes(depth)?2:1;
  const data=Uint8Array.from({length:17*9*channels*sampleBytes},(_,i)=>(i*37)%256);
  const expected=await sharp(data,{raw}).png().toBuffer({resolveWithObject:true});
  await fs.writeFile("/raw",data);
  const guarded=new Proxy(fs,{get(target,key){
   if(key==="readFile" || key==="writeFile")return ()=>{throw new Error("whole-file I/O forbidden");};
   const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
  const info=await sharp(file?"/raw":data,{raw,filesystem:guarded}).png().toFile("/output.png");
  const output=await fs.readFile("/output.png");
  expect({...info,size:0}).toEqual({...expected.info,size:0});expect(info.size).toBe(output.length);
  expect(await sharp(output).raw().toBuffer()).toEqual(await sharp(expected.data).raw().toBuffer());
 });
}

it("publishes with cached resource snapshots even when their paths change",async()=>{
 const fs=new MemoryFileSystem();
 const bytes=await sharp({create:{width:13,height:11,channels:4,background:"red"}}).png().toBuffer();
 await fs.writeFile("/input",bytes);await fs.writeFile("/overlay",bytes);await fs.writeFile("/operand",bytes);
 const image=sharp("/input",{filesystem:fs}).composite([{input:"/overlay"}]).boolean("/operand","or").png();
 const expected=await image.toBuffer();
 await fs.writeFile("/input",new Uint8Array());await fs.writeFile("/overlay",new Uint8Array());await fs.writeFile("/operand",new Uint8Array());
 const original=fs.readFile.bind(fs);fs.readFile=async()=>{throw new Error("cached resources must not reopen");};
 try {await image.toFile("/output.png");}finally{fs.readFile=original;}
 expect(await sharp(await fs.readFile("/output.png")).raw().toBuffer()).toEqual(await sharp(expected).raw().toBuffer());
});

for(const generated of ["text","create"] as const) it(`does not acquire a source for ${generated} overrides`,async()=>{
 const fs=new MemoryFileSystem();
 const options:SharpInputOptions=generated==="text"?{text:{text:"source-free",width:31,height:19,rgba:true}}:{create:{width:31,height:19,channels:4,background:"blue"}};
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile" || key==="writeFile" || key==="openReadFile")return ()=>{throw new Error("source acquisition forbidden");};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 const expected=await sharp(new Uint8Array([1]),options).png().toBuffer();
 await sharp(new Uint8Array([1]),{...options,filesystem:guarded}).png().toFile("/output.png");
 expect(await sharp(await fs.readFile("/output.png")).raw().toBuffer()).toEqual(await sharp(expected).raw().toBuffer());
});

for(const cancel of [false,true]) it(`preserves output and closes byte-input scratch on publication ${cancel?"cancellation":"failure"}`,async()=>{
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
 await expect(sharp(data,{raw,filesystem:guarded,signal:controller.signal}).png().toFile("/output.png")).rejects.toBe(reason);
 expect(opened).toBeGreaterThan(0);expect(closed).toBe(opened);
 expect(await fs.readFile("/output.png")).toEqual(before);
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["output.png"]);
 expect(data.every(byte=>byte===91)).toBe(true);
});

import {decodeRawResource} from "./codecs/resource-storage.js";
import {decodeImage} from "./codecs/index.js";
it("captures raw layout before asynchronous backing writes",async()=>{
 const raw={width:257,height:2,channels:4 as 1|2|3|4,depth:"uchar" as const},options={raw,density:72};
 const data=Uint8Array.from({length:raw.width*raw.height*4},(_,i)=>(i*37)%256);
 const expected=decodeImage(data,{raw:{...raw},density:72}),output=new Uint8Array(data.length);
 const metadata=await decodeRawResource({size:data.length,async read(at,length){return data.subarray(at,at+length);}}, {
  allocate(length){expect(length).toBe(output.length);return 0;},
  async read(){throw new Error("unexpected backing read");},
  async write(at,bytes){output.set(bytes,at);raw.channels=1;options.density=144;}
 },options,new AbortController().signal);
 expect(output).toEqual(expected.data);expect(metadata.density).toBe(72);
});
