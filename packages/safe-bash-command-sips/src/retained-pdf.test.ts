import {StoredSipsImages} from "./stored-image-backend.js";
import {expect,it,vi,afterEach} from "vitest";
import sharp,{decodeImage} from "@poe-code/image-ast";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {runSipsCli,runIdentifyCli} from "./index.js";

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

for(const args of [["-s","format","png"],["-r","90","-s","format","png"],["--resampleWidth","9","-s","format","png"]])it(`retains PDF conversion ${args.join(" ")}`,async()=>{
 const bytes=sharp({create:{width:23,height:17,channels:4,background:"red"}}).toFormat("pdf").toBufferSync(),fs=new MemoryFileSystem();await fs.writeFile("/in.pdf",bytes);
 const files=new Map([["in.pdf",bytes]]),argv=[...args,"in.pdf","-o","out.png"],expected=await runSipsCli(argv,files),whole=vi.fn(()=>{throw Error("whole-file I/O");});
 vi.spyOn(StoredSipsImages.prototype,"materialize").mockRejectedValue(new Error("buffered PDF fallback"));
 const filesystem=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return whole;const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 expect(await runSipsCli(argv,{filesystem,cwd:"/"})).toEqual(expected);expect(expected.exitCode).toBe(0);
 expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));expect(whole).not.toHaveBeenCalled();
 expect((await fs.readdir("/")).map(entry=>entry.name).sort()).toEqual(["in.pdf","out.png"]);
});

it("computes PDF identify statistics from retained pixels",async()=>{
 const pdf=sharp({create:{width:23,height:17,channels:4,background:"red"}}).toFormat("pdf").toBufferSync(),bytes=new Uint8Array(pdf.length+200000).fill(32);bytes.set(pdf);
 const fs=new MemoryFileSystem();await fs.writeFile("/in.pdf",bytes);
 const expected=await runIdentifyCli(["-verbose","in.pdf"],new Map([["in.pdf",bytes]]));
 const Native=Uint8Array;vi.stubGlobal("Uint8Array",new Proxy(Native,{construct(target,args){if(args[0]===bytes.length)throw Error("whole PDF allocation");return Reflect.construct(target,args);}}));
 const handleOpen=fs.openReadFile.bind(fs);let largest=0;
 const filesystem=new Proxy(fs,{get(target,key){
  if(key==="readFile")return ()=>{throw Error("whole-file I/O");};
  if(key==="openReadFile")return async(...args:Parameters<typeof handleOpen>)=>{const handle=await handleOpen(...args);return {stat:handle.stat.bind(handle),close:handle.close.bind(handle),read:async(position:number,length:number,options?:Parameters<typeof handle.read>[2])=>{largest=Math.max(largest,length);return handle.read(position,length,options);}};};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 expect(await runIdentifyCli(["-verbose","in.pdf"],{filesystem,cwd:"/"})).toEqual(expected);
 expect(largest).toBeLessThanOrEqual(65536);expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in.pdf"]);
});
