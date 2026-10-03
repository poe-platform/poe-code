import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";

for(const across of [1,2,3])for(const animated of [false,true])for(const terminal of ["file","metadata","stats"] as const)
it(`retains joined images across=${across} animated=${animated} ${terminal}`,async()=>{
 const fs=new MemoryFileSystem(),bytes=await Promise.all([0,1,2].map(i=>sharp({create:{width:7+i*2,height:5+i*2,channels:i===1?3:4,background:i===0?"red":i===1?"blue":"green"}}).png().toBuffer()));
 for(let i=0;i<bytes.length;i++)await fs.writeFile(`/in${i}`,bytes[i]!);
 const join={across,animated,shim:2,halign:"center",valign:"bottom",background:{r:10,g:20,b:30,alpha:.3}};
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file join I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const expected=sharp(bytes,{join}).resize(13,11).grayscale(),actual=sharp(["/in0","/in1","/in2"],{join,filesystem:guarded}).resize(13,11).grayscale();
 if(terminal==="metadata")expect(await actual.metadata()).toEqual(await expected.metadata());
 else if(terminal==="stats")expect(await actual.stats()).toEqual(await expected.stats());
 else {const result=await expected.raw().toBuffer({resolveWithObject:true});expect({info:result.info,hash:createHash("sha256").update(result.data).digest("hex")}).toMatchSnapshot();expect(await actual.raw().toFile("/out")).toEqual(result.info);expect(await fs.readFile("/out")).toEqual(result.data);}
});

for(const halign of ["left","top","low","center","centre","right","bottom","high"])
for(const valign of ["left","top","low","center","centre","right","bottom","high"])
it(`preserves mixed join input alignment ${halign}/${valign}`,async()=>{
 const fs=new MemoryFileSystem(),png=await sharp({create:{width:11,height:7,channels:3,background:"green"}}).png().toBuffer();await fs.writeFile("/in",png);
 const create={create:{width:5,height:13,channels:4 as const,background:{r:10,g:20,b:30,alpha:.4}}},text={text:{text:"join",width:17,height:9,rgba:true}};
 const array=png.buffer.slice(png.byteOffset,png.byteOffset+png.byteLength) as ArrayBuffer;
 const join={across:3,shim:3,halign,valign},expected=await sharp([png,array,png,create,text],{join,density:144}).raw().toBuffer({resolveWithObject:true});
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file join I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const info=await sharp([png,array,"/in",create,text],{join,density:144,filesystem:guarded}).raw().toFile("/out");expect(info).toEqual(expected.info);expect(await fs.readFile("/out")).toEqual(expected.data);
});

it("retains one snapshot for repeated joined paths",async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:11,height:7,channels:4,background:"red"}}).png().toBuffer();await fs.writeFile("/in",bytes);
 let opened=0;
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file join I/O forbidden");};
  if(key==="openReadFile")return async(...args:Parameters<NonNullable<typeof fs.openReadFile>>)=>{opened++;const handle=await fs.openReadFile(...args);return {...handle,async close(){await handle.close();await fs.writeFile("/in",new Uint8Array());}};};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 await sharp(["/in","/in"],{filesystem:guarded}).raw().toFile("/out");expect(opened).toBe(1);
 expect(await fs.readFile("/out")).toEqual(await sharp([bytes,bytes]).raw().toBuffer());
});

it("preserves explicit joined file and resource caches",async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:11,height:7,channels:4,background:"red"}}).png().toBuffer();
 await fs.writeFile("/in",bytes);await fs.writeFile("/overlay",bytes);
 const image=sharp(["/in","/in"],{filesystem:fs}).composite([{input:"/overlay",left:0,top:0}]).raw();
 const expected=await image.toBuffer({resolveWithObject:true}),metadata=await image.metadata(),stats=await image.stats();
 await fs.writeFile("/in",new Uint8Array());await fs.writeFile("/overlay",new Uint8Array());
 const read=fs.readFile.bind(fs),write=fs.writeFile.bind(fs);fs.readFile=async()=>{throw new Error("cache must not reread");};fs.writeFile=async()=>{throw new Error("output must stream");};
 try{expect(await image.toFile("/out")).toEqual(expected.info);expect(await image.metadata()).toEqual(metadata);expect(await image.stats()).toEqual(stats);}finally{fs.readFile=read;fs.writeFile=write;}
 expect(await fs.readFile("/out")).toEqual(expected.data);
});

for(const mode of ["source","scratch","publish","cancel"] as const)it(`preserves joined output and closes handles on ${mode}`,async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),reason=new Error(mode),before=Uint8Array.of(7,8,9);
 const bytes=await sharp({create:{width:1025,height:257,channels:4,background:"red"}}).png().toBuffer();
 await fs.writeFile("/a",bytes);await fs.writeFile("/b",bytes);await fs.writeFile("/out",before);
 let sources=0,sourceClosed=0,scratch=0,scratchClosed=0;
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file join I/O forbidden");};
  if(key==="openReadFile")return async(...args:Parameters<NonNullable<typeof fs.openReadFile>>)=>{sources++;const handle=await fs.openReadFile(...args);return {...handle,async read(...values:Parameters<typeof handle.read>){if(mode==="source"&&args[0]==="/b")throw reason;return handle.read(...values);},async close(){sourceClosed++;await handle.close();}};};
  if(key==="open")return async(...args:Parameters<typeof fs.open>)=>{scratch++;const handle=await fs.open(...args);return new Proxy(handle,{get(retained,method){if(method==="write"&&mode==="scratch")return async()=>{throw reason;};if(method==="close")return async()=>{scratchClosed++;await handle.close();};const value=Reflect.get(retained,method,retained);return typeof value==="function"?value.bind(retained):value;}});};
  if((key==="publishFileConditional"||key==="publishStagedFile")&&(mode==="publish"||mode==="cancel"))return async()=>{if(mode==="cancel")controller.abort(reason);throw reason;};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 await expect(sharp(["/a","/b"],{filesystem:guarded,signal:controller.signal}).png().toFile("/out")).rejects.toBe(reason);
 expect(sources).toBeGreaterThan(0);expect(sourceClosed).toBe(sources);expect(scratch).toBe(1);expect(scratchClosed).toBe(scratch);
 expect(await fs.readFile("/out")).toEqual(before);expect((await fs.readdir("/")).map(entry=>entry.name).sort()).toEqual(["a","b","out"]);
});

import {joinStoredImages} from "./ops/join-storage.js";
import {decodeImage} from "./codecs/index.js";
it("joins wide rows from borrowed backing above 32-bit positions with fixed buffers",async()=>{
 const inputs=[{create:{width:20001,height:2,channels:4 as const,background:"red"}},{create:{width:3001,height:3,channels:4 as const,background:"blue"}}],options={join:{across:2,shim:7,halign:"center",valign:"bottom",background:"transparent"}};
 const expected=await sharp(inputs,options).raw().toBuffer(),memory=new Uint8Array(2*1024*1024),borrowed=new Uint8Array(4096),base=2**32+17;let end=base;
 const images=inputs.map(input=>{const {data,data16:ignored,...metadata}=decodeImage(undefined,input),position=end;memory.set(data,position-base);end+=data.length+17;return {...metadata,position};});
 const storage={allocate(length:number){const at=end;end+=length;return at;},async read(at:number,length:number){expect(length).toBeLessThanOrEqual(4096);borrowed.fill(91);borrowed.set(memory.subarray(at-base,at-base+length));return borrowed.subarray(0,length);},async write(at:number,bytes:Uint8Array){expect(bytes.length).toBeLessThanOrEqual(4096);memory.set(bytes,at-base);}};
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const length=typeof args[0]==="number"?args[0]:args[0]?.byteLength??args[0]?.length??0;if(length>4096)throw new Error("unbounded join buffer");return Reflect.construct(target,args);}});
 let image;try{image=await joinStoredImages(images,storage,new AbortController().signal,options);}finally{globalThis.Uint8Array=Native;}
 expect(memory.subarray(image.position-base,image.position-base+image.width*image.height*4)).toEqual(new Uint8Array(expected));
});
