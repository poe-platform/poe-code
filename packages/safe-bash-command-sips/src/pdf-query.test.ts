import {expect,it} from "vitest";
import sharp from "@poe-code/image-ast";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {runIdentifyCli,runSipsCli} from "./index.js";

for(const query of ["identify","sips"] as const)it(`retains PDF ${query} metadata in caller backing`,async()=>{
 const pixels=new Uint8Array(257*257*4);let state=1234567;for(let i=0;i<pixels.length;i++){state^=state<<13;state^=state>>>17;state^=state<<5;pixels[i]=state&255;}
 const bytes=await sharp(pixels,{raw:{width:257,height:257,channels:4}}).toFormat("pdf").toBuffer(),fs=new MemoryFileSystem();expect(bytes.length).toBeGreaterThan(131072);await fs.writeFile("/input.pdf",bytes);
 const run=query==="identify"?runIdentifyCli:runSipsCli,args=query==="identify"?["input.pdf"]:["-g","all","input.pdf"],expected=await run(args,new Map([["input.pdf",bytes]]));
 const Native=Uint8Array;
 const filesystem=new Proxy(fs,{get(target,key){
  // The injected memory backend owns its file contents; the allocation bound is for the consumer.
  if(key==="createStagedFile")return async(...args:Parameters<typeof fs.createStagedFile>)=>{const stage=await fs.createStagedFile(...args);return {...stage,writer:{...stage.writer,finish:stage.writer!.finish.bind(stage.writer),async write(...args:Parameters<NonNullable<typeof stage.writer>["write"]>){const instrumented=globalThis.Uint8Array;globalThis.Uint8Array=Native;try{return await stage.writer!.write(...args);}finally{globalThis.Uint8Array=instrumented;}}}};};
  if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file PDF I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==="number"?value:value?.byteLength??value?.length??0;if(length>65536)throw new Error("unbounded PDF allocation");return Reflect.construct(target,args);}});
 try{expect(await run(args,{filesystem,cwd:"/"})).toEqual(expected);}finally{globalThis.Uint8Array=Native;}
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["input.pdf"]);
});
