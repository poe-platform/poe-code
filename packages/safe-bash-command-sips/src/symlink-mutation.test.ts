import {expect,it} from "vitest";
import sharp from "@poe-code/image-ast";
import {MemoryFileSystem,MountFileSystem} from "@poe-code/safe-fs/core";
import {runSipsCli} from "./index.js";

for(const mounted of [false,true])
for(const mode of ["in-place","existing","missing"] as const)it(`streams Sips mutation through ${mode} symlinks, mounted=${mounted}`,async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:17,height:11,channels:4,background:"red"}}).png().toBuffer();
 await fs.writeFile("/input",bytes);if(mode!=="missing"){await fs.writeFile("/target",bytes);await fs.link("/target","/alias");}await fs.symlink("target","/link");
 const filesystem=new Proxy(mounted?new MountFileSystem({root:fs}):fs,{get(target,key){if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("buffered I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const args=mode==="in-place"?["-r","90","link"]:["-r","90","input","-o","link"];
 expect((await runSipsCli(args,{filesystem,cwd:"/"})).exitCode).toBe(0);
 expect(await fs.readlink("/link")).toBe("target");const result=await fs.readFile("/target");expect((await sharp(result).metadata()).width).toBe(11);
 if(mode!=="missing")expect(await fs.readFile("/alias")).toEqual(result);
});

it("binds the in-place link before reading its pixels",async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:17,height:11,channels:4,background:"red"}}).png().toBuffer();
 await fs.writeFile("/target",bytes);await fs.writeFile("/other",bytes);await fs.symlink("target","/link");
 const filesystem=new Proxy(fs,{get(target,key){
  if(key==="openReadFile")return async(...args:Parameters<typeof fs.openReadFile>)=>{const result=await fs.openReadFile(...args);if(args[0]==="/link"){await fs.unlink("/link");await fs.symlink("other","/link");}return result;};
  if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("buffered I/O forbidden");};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 await expect(runSipsCli(["-r","90","link"],{filesystem,cwd:"/"})).rejects.toMatchObject({code:"EAGAIN"});
 expect(await fs.readFile("/target")).toEqual(bytes);expect(await fs.readFile("/other")).toEqual(bytes);
});

for(const cancel of [false,true])it(`cleans in-place staging after failure, cancel=${cancel}`,async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),reason=new Error("publisher failed"),bytes=await sharp({create:{width:17,height:11,channels:4,background:"red"}}).png().toBuffer();
 await fs.writeFile("/target",bytes);await fs.symlink("target","/link");
 const filesystem=new Proxy(fs,{get(target,key){
  if(key==="publishStagedFile")return async()=>{if(cancel)controller.abort(reason);throw reason;};
  if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("buffered I/O forbidden");};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 await expect(runSipsCli(["-r","90","link"],{filesystem,cwd:"/"},controller.signal)).rejects.toBe(reason);
 expect(await fs.readFile("/target")).toEqual(bytes);expect(await fs.readlink("/link")).toBe("target");
 expect((await fs.readdir("/")).map(entry=>entry.name).sort()).toEqual(["link","target"]);
});
