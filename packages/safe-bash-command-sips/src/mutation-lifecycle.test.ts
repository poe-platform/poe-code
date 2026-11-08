import {expect,it} from "vitest";
import sharp from "@poe-code/image-ast";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {runSipsCli} from "./index.js";

it("propagates pixel backing failures without publishing output",async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:513,height:1024,channels:3,background:"blue"}}).png().toBuffer();await fs.writeFile("/in",bytes);const failure=new Error("remote scratch unavailable");let published=0;
 const filesystem=new Proxy(fs,{get(target,key){if(key==="open")return async()=>{throw failure;};if(key==="publishFileConditional")return async()=>{published++;};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 await expect(runSipsCli(["-f","horizontal","in","-o","out"],{filesystem,cwd:"/"})).rejects.toBe(failure);expect(published).toBe(0);await expect(fs.stat("/out")).rejects.toMatchObject({code:"ENOENT"});
});

for(const failureAt of [1,2])it(`does not publish when scratch ${failureAt} cannot close`,async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:513,height:1024,channels:3,background:"blue"}}).bmp().toBuffer();await fs.writeFile("/in",bytes);const failure=new Error("scratch close failed");let opened=0,closed=0;
 const open=fs.open.bind(fs),filesystem=new Proxy(fs,{get(target,key){if(key==="open")return async(...args:Parameters<typeof open>)=>{const handle=await open(...args),id=++opened;return new Proxy(handle,{get(target,key){if(key==="close")return async()=>{closed++;await handle.close();if(id===failureAt)throw failure;};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 await expect(runSipsCli(["-f","horizontal","in","-o","out"],{filesystem,cwd:"/"})).rejects.toBe(failure);
 expect(opened).toBe(2);expect(closed).toBe(2);await expect(fs.stat("/out")).rejects.toMatchObject({code:"ENOENT"});
});

for(const mode of ["read","changed","cancel","close","read-and-close","short"] as const)
it(`owns retained mutation input on ${mode}`,async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:3,height:2,channels:3,background:"red"}}).png().toBuffer();await fs.writeFile("/in",bytes);
 const controller=new AbortController(),failure=new Error(mode),secondary=new Error("secondary close");let closed=0,stats=0;
 const open=fs.openReadFile!.bind(fs),filesystem=new Proxy(fs,{get(target,key){if(key==="openReadFile")return async(...args:Parameters<typeof open>)=>{const handle=await open(...args);return new Proxy(handle,{get(target,key){
  if(key==="stat")return async(...args:Parameters<typeof handle.stat>)=>{const value=await handle.stat(...args);stats++;return mode==="changed"?{...value,opaqueVersion:String(stats)}:value;};
  if(key==="read")return async(position:number,length:number,options?:Parameters<typeof handle.read>[2])=>{if(mode==="read"||mode==="read-and-close")throw failure;if(mode==="cancel")controller.abort(failure);return handle.read(position,mode==="short"?Math.min(1,length):length,options);};
  if(key==="close")return async()=>{closed++;await handle.close();if(mode==="close")throw failure;if(mode==="read-and-close")throw secondary;};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const result=runSipsCli(["-r","90","in","-o","out"],{filesystem,cwd:"/"},controller.signal);
 if(mode==="short"){expect((await result).exitCode).toBe(0);expect(await fs.stat("/out")).toMatchObject({type:"file"});}
 else{if(mode==="changed")await expect(result).rejects.toMatchObject({code:"EAGAIN"});else await expect(result).rejects.toBe(failure);await expect(fs.stat("/out")).rejects.toMatchObject({code:"ENOENT"});}
 expect(closed).toBe(1);
});

it("preserves the destination when atomic output consumption fails",async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:3,height:2,channels:3,background:"red"}}).png().toBuffer(),original=new Uint8Array([7,8,9]);await fs.writeFile("/in",bytes);await fs.writeFile("/out",original);const failure=new Error("remote publication failed");
 const filesystem=new Proxy(fs,{get(target,key){if(key==="capabilitiesFor")return async()=>({...fs.capabilities,atomicFilePublication:true});if(key==="publishFileConditional")return async(_path:string,chunks:AsyncIterable<Uint8Array>)=>{for await(const ignoredChunk of chunks)throw failure;};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 await expect(runSipsCli(["-r","90","in","-o","out"],{filesystem,cwd:"/"})).rejects.toBe(failure);expect(await fs.readFile("/out")).toEqual(original);
});

it("refuses to replace an input changed before in-place publication",async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:3,height:2,channels:3,background:"red"}}).png().toBuffer(),replacement=new Uint8Array([7,8,9]);await fs.writeFile("/in",bytes);
 const publish=fs.publishStagedFile!.bind(fs),filesystem=new Proxy(fs,{get(target,key){if(key==="publishStagedFile")return async(...args:Parameters<typeof publish>)=>{await fs.writeFile("/in",replacement);return publish(...args);};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 await expect(runSipsCli(["-r","90","in"],{filesystem,cwd:"/"})).rejects.toMatchObject({code:"EAGAIN"});expect(await fs.readFile("/in")).toEqual(replacement);
});

for(const fail of [false,true])it(`uses retained staged publication with cleanup (${fail?"failure":"success"})`,async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:3,height:2,channels:3,background:"red"}}).png().toBuffer();await fs.writeFile("/in",bytes);const failure=new Error("staged write failed");let removed=0,closed=0;
 const create=fs.createStagedFile!.bind(fs),filesystem=new Proxy(fs,{get(target,key){
  if(key==="capabilitiesFor")return async()=>({...fs.capabilities,atomicFilePublication:false});
  if(key==="createStagedFile")return async(...args:Parameters<typeof create>)=>{const staging=await create(...args),writer=staging.writer!,cleanup=staging.cleanup!;return {...staging,writer:{...writer,write:async(...args:Parameters<typeof writer.write>)=>{if(fail)throw failure;return writer.write(...args);},finish:writer.finish.bind(writer)},cleanup:{...cleanup,async remove(){removed++;await cleanup.remove();},async close(){closed++;await cleanup.close();}}};};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 const result=runSipsCli(["-r","90","in","-o","out"],{filesystem,cwd:"/"});
 if(fail){await expect(result).rejects.toBe(failure);await expect(fs.stat("/out")).rejects.toMatchObject({code:"ENOENT"});}else{expect((await result).exitCode).toBe(0);expect(await fs.stat("/out")).toMatchObject({type:"file"});}
 expect(removed).toBe(1);expect(closed).toBe(1);
});
