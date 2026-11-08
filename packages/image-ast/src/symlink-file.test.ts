import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem,MountFileSystem} from "@poe-code/safe-fs/core";

for(const mounted of [false,true])
for(const exists of [false,true])it(`streams through a final symlink with existing target=${exists}, mounted=${mounted}`,async()=>{
 const fs=new MemoryFileSystem(),before=new Uint8Array([7]);
 await fs.mkdir("/dir");if(exists){await fs.writeFile("/dir/target",before);await fs.link("/dir/target","/alias");}
 await fs.symlink("dir/target","/link");
 const filesystem=new Proxy(mounted?new MountFileSystem({root:fs}):fs,{get(target,key){
  if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("buffered I/O forbidden");};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 await sharp({create:{width:17,height:11,channels:4,background:"red"},filesystem}).png().toFile("/link");
 expect(await fs.readlink("/link")).toBe("dir/target");
 const output=await fs.readFile("/dir/target");expect((await sharp(output).metadata()).width).toBe(17);
 if(exists)expect(await fs.readFile("/alias")).toEqual(output);
 expect((await fs.readdir("/dir")).map(entry=>entry.name)).toEqual(["target"]);
});

it("refuses symlink retargeting at publication without changing either target",async()=>{
 const fs=new MemoryFileSystem(),before=new Uint8Array([7]);
 await fs.writeFile("/target",before);await fs.writeFile("/other",before);await fs.symlink("target","/link");
 const filesystem=new Proxy(fs,{get(target,key){
  if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("buffered I/O forbidden");};
  if(key==="publishStagedFile")return async(...args:Parameters<typeof fs.publishStagedFile>)=>{await fs.unlink("/link");await fs.symlink("other","/link");return fs.publishStagedFile(...args);};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 await expect(sharp({create:{width:17,height:11,channels:4,background:"red"},filesystem}).png().toFile("/link")).rejects.toMatchObject({code:"EAGAIN"});
 expect(await fs.readFile("/target")).toEqual(before);expect(await fs.readFile("/other")).toEqual(before);
 expect((await fs.readdir("/")).map(entry=>entry.name).sort()).toEqual(["link","other","target"]);
});

for(const cancel of [false,true])it(`cleans symlink staging after publication failure, cancel=${cancel}`,async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),reason=new Error("publisher failed"),before=new Uint8Array([7]);
 await fs.writeFile("/target",before);await fs.symlink("target","/link");
 const filesystem=new Proxy(fs,{get(target,key){
  if(key==="publishStagedFile")return async()=>{if(cancel)controller.abort(reason);throw reason;};
  if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("buffered I/O forbidden");};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 await expect(sharp({create:{width:17,height:11,channels:4,background:"red"},filesystem,signal:controller.signal}).png().toFile("/link")).rejects.toBe(reason);
 expect(await fs.readFile("/target")).toEqual(before);expect(await fs.readlink("/link")).toBe("target");
 expect((await fs.readdir("/")).map(entry=>entry.name).sort()).toEqual(["link","target"]);
});

it("rejects input/output aliases through a final symlink",async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:17,height:11,channels:4,background:"red"}}).png().toBuffer();
 await fs.writeFile("/input",bytes);await fs.symlink("input","/link");
 await expect(sharp("/input",{filesystem:fs}).png().toFile("/link")).rejects.toThrow("Cannot use same file for input and output");
 expect(await fs.readFile("/input")).toEqual(bytes);
});
