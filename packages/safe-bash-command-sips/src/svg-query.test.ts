import {expect,it} from "vitest";
import sharp from "@poe-code/image-ast";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {runIdentifyCli,runSipsCli} from "./index.js";

for(const query of ["identify","sips","sdk"] as const)it(`reads only retained SVG header ranges for ${query}`,async()=>{
 const bytes=new TextEncoder().encode('<svg width="13" height="7">'+" ".repeat(1024*1024)+'</svg>'),fs=new MemoryFileSystem();await fs.writeFile("/input.svg",bytes);
 let furthest=0,closed=0;
 const filesystem=new Proxy(fs,{get(target,key){
  if(key==="readFile"||key==="writeFile")return()=>{throw new Error("whole-file SVG I/O forbidden");};
  if(key==="openReadFile")return async(...args:Parameters<typeof fs.openReadFile>)=>{const handle=await fs.openReadFile(...args);return {...handle,stat:handle.stat.bind(handle),async read(position:number,length:number,options?:Parameters<typeof handle.read>[2]){furthest=Math.max(furthest,position+length);if(length>4096)throw new Error("unbounded SVG metadata read");return handle.read(position,length,options);},async close(){closed++;await handle.close();}};};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 if(query==="sdk")expect(await sharp("/input.svg",{filesystem}).metadata()).toEqual(await sharp(bytes).metadata());
 else{const run=query==="identify"?runIdentifyCli:runSipsCli,args=query==="identify"?["input.svg"]:["-g","all","input.svg"];expect(await run(args,{filesystem,cwd:"/"})).toEqual(await run(args,new Map([["input.svg",bytes]])));}
 expect(furthest).toBeLessThanOrEqual(4096);expect(closed).toBe(1);
});
