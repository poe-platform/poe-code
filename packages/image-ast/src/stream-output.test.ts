import {expect,it,vi} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import type {OutputInfo} from "./ast.js";

for(const format of ["raw","png","jpeg","webp","tiff","gif","bmp","ppm","pgm","pbm"] as const)
for(const observeInfo of [false,true])it(`streams ${format} output from retained file input with info=${observeInfo}`,async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:17,height:13,channels:3,background:"green"}}).png().toBuffer();await fs.writeFile("/in",bytes);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile")return ()=>{throw new Error("buffered input forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const input=sharp("/in",{filesystem:guarded}).toFormat(format),chunks:Uint8Array[]=[];let info:OutputInfo|undefined;if(observeInfo)input.on("info",value=>{info=value as OutputInfo;});
 for await(const chunk of input){if(observeInfo)expect(info).toMatchObject({width:17,height:13,format});expect(chunk.length).toBeLessThanOrEqual(16384);chunks.push(chunk);}
 const actual=new Uint8Array(chunks.reduce((size,bytes)=>size+bytes.length,0));let offset=0;for(const chunk of chunks){actual.set(chunk,offset);offset+=chunk.length;}
 const expectedResult=await sharp(bytes).toFormat(format).toBuffer({resolveWithObject:true}),expected=expectedResult.data;if(observeInfo)expect(info).toEqual({...expectedResult.info,size:actual.length});
 expect(format==="raw"?actual:await sharp(actual).raw().toBuffer()).toEqual(format==="raw"?expected:await sharp(expected).raw().toBuffer());
});

for(const observeInfo of [false,true])it(`bounds large generated stream output with info=${observeInfo}`,async()=>{
 const fs=new MemoryFileSystem(),input=sharp({create:{width:1024,height:513,channels:4,background:"red"},filesystem:fs,workingDirectory:"/"}).raw();
 const buffer=vi.spyOn(input,"toBufferWithObjectSync").mockImplementation(()=>{throw new Error("buffered encoding forbidden");});
 let info:OutputInfo|undefined,total=0,count=0;if(observeInfo)input.on("info",value=>{info=value as OutputInfo;});
 for await(const chunk of input){if(observeInfo)expect(info?.size).toBe(1024*513*4);expect(chunk.length).toBeLessThanOrEqual(16384);total+=chunk.length;count++;}
 expect(total).toBe(1024*513*4);expect(count).toBeGreaterThan(128);expect(buffer).not.toHaveBeenCalled();await input.dispose();expect(await fs.readdir("/")).toEqual([]);
});

import {PagedStorage} from "@poe-code/safe-fs/storage";
it("stops encoding between reader requests and releases scratch on cancellation",async()=>{
 const fs=new MemoryFileSystem(),input=sharp({create:{width:1024,height:513,channels:4,background:"red"},filesystem:fs,workingDirectory:"/"}).raw();
 const reads=vi.spyOn(PagedStorage.prototype,"read"),reader=input.readable.getReader();
 try {const first=await reader.read();expect(first.value?.length).toBeLessThanOrEqual(16384);const before=reads.mock.calls.length;await Promise.resolve();await Promise.resolve();expect(reads).toHaveBeenCalledTimes(before);await reader.cancel();expect(await fs.readdir("/")).toEqual([]);}
 finally {reads.mockRestore();await input.dispose();}
});

import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";
it("streams a raster larger than its cache in Workerd through external scratch",async()=>{
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../",import.meta.url)),sourcefile:"stream-output-worker.ts",contents:`
 import sharp from './packages/image-ast/src/index.ts';
 export default {async fetch(request,env){
 const {observeInfo}=await request.json();let handles=0,closed=0,writes=0,maxAllocation=0;
 const fs={capabilities:{},async stat(){return {type:'directory'};},async removeFileConditional(){},async open(){const id=++handles;return {
 capabilities:{positionedRead:true,positionedWrite:true},async stat(){return {type:'file',size:0};},
 async write(bytes,position){if(bytes.length>16384)throw new Error('large write');writes++;await env.SCRATCH.fetch('https://scratch/'+id+'?position='+position,{method:'PUT',body:bytes});return bytes.length;},
 async read(bytes,position){if(bytes.length>16384)throw new Error('large read');const result=await env.SCRATCH.fetch('https://scratch/'+id+'?position='+position+'&length='+bytes.length);bytes.set(new Uint8Array(await result.arrayBuffer()));return bytes.length;},
 async close(){closed++;}};},readFile(){throw new Error('whole read');},writeFile(){throw new Error('whole write');}};
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw new Error('large allocation');return Reflect.construct(target,args);}});
 const input=sharp({create:{width:531,height:513,channels:4,background:'red'},filesystem:fs,workingDirectory:'/'}).raw();let info,total=0,chunks=0;
 if(observeInfo)input.on('info',value=>{info=value;});
 try{for await(const bytes of input){if(bytes.length>16384)throw new Error('large output');if(observeInfo&&info?.size!==531*513*4)throw new Error('late info');for(let i=0;i<bytes.length;i++){const channel=(total+i)%4;if(bytes[i]!==((channel===0||channel===3)?255:0))throw new Error('pixel mismatch');}total+=bytes.length;chunks++;}}
 finally{await input.dispose();globalThis.Uint8Array=Native;}
 return Response.json({total,chunks,handles,closed,writes,maxAllocation,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 const scratch=new Map<string,Uint8Array>();
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{SCRATCH:async request=>{
 const url=new URL(request.url),position=Number(url.searchParams.get("position")),key=url.pathname+":"+position;
 if(request.method==="PUT"){scratch.set(key,new Uint8Array(await request.arrayBuffer()));return new Response();}
 return new Response(scratch.get(key)?.slice(0,Number(url.searchParams.get("length"))));
 }}});
 try{for(const observeInfo of [false,true]){const response=await runtime.dispatchFetch("https://output/",{method:"POST",body:JSON.stringify({observeInfo})});expect(response.status).toBe(200);const result=await response.json() as {total:number;chunks:number;handles:number;closed:number;writes:number;maxAllocation:number;nodeGlobals:boolean};expect(result.total).toBe(531*513*4);expect(result.chunks).toBeGreaterThan(64);expect(result.handles).toBe(observeInfo?2:1);expect(result.closed).toBe(result.handles);expect(result.writes).toBeGreaterThan(64);expect(result.maxAllocation).toBeLessThanOrEqual(65536);expect(result.nodeGlobals).toBe(false);}}
 finally{await runtime.dispose();}
},15000);

for(const mode of ["write","read","close"] as const)for(const observeInfo of [false,true])
it(`closes output backing after ${mode} failure with info=${observeInfo}`,async()=>{
 const fs=new MemoryFileSystem(),open=fs.open.bind(fs),failure=new Error(`${mode} failed`);let acquired=0,closed=0;
 fs.open=async(...args)=>{const handle=await open(...args);acquired++;return new Proxy(handle,{get(target,key){if(key==="close")return async(...args:Parameters<typeof handle.close>)=>{closed++;await handle.close(...args);if(mode==="close")throw failure;};if(key===mode)return async()=>{throw failure;};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});};
 const input=sharp({create:{width:1024,height:513,channels:4,background:"red"},filesystem:fs,workingDirectory:"/"}).raw();if(observeInfo)input.on("info",()=>{});
 const consume=async()=>{for await(const ignoredChunk of input){/* drain */}};
 await expect(consume()).rejects.toBe(failure);await input.dispose().catch(error=>{expect(error).toBe(failure);});expect(acquired).toBeGreaterThan(0);expect(closed).toBe(acquired);expect(await fs.readdir("/")).toEqual([]);
});

it("cancels one output clone without invalidating the retained parent input",async()=>{
 const fs=new MemoryFileSystem(),parent=sharp({raw:{width:32,height:32,channels:4},filesystem:fs,workingDirectory:"/"}),child=parent.clone().raw();
 const writer=parent.writable.getWriter();await writer.write(new Uint8Array(4096).fill(137));await writer.close();
 const reader=child.readable.getReader();expect((await reader.read()).value?.length).toBeGreaterThan(0);await reader.cancel();
 expect(await parent.metadata()).toMatchObject({width:32,height:32});expect((await parent.raw().toBuffer())[0]).toBe(137);await parent.dispose();
});

for(const observeInfo of [false,true])it(`awaits cancellation during ${observeInfo?"encoded output retention":"raster preparation"}`,async()=>{
 const fs=new MemoryFileSystem(),open=fs.open.bind(fs);let acquired=0,closed=0,resume!:()=>void,entered!:()=>void;
 const pending=new Promise<void>(resolve=>{resume=resolve;}),waiting=new Promise<void>(resolve=>{entered=resolve;});
 fs.open=async(...args)=>{const id=++acquired,handle=await open(...args);if(id===(observeInfo?2:1)){entered();await pending;}return new Proxy(handle,{get(target,key){if(key==="close")return async(...args:Parameters<typeof handle.close>)=>{closed++;return handle.close(...args);};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});};
 const input=sharp({create:{width:1024,height:513,channels:4,background:"red"},filesystem:fs,workingDirectory:"/"}).raw();if(observeInfo)input.on("info",()=>{});
 const reader=input.readable.getReader(),reading=reader.read();await waiting;let cancelled=false;
 const cancellation=reader.cancel().then(()=>{cancelled=true;});await Promise.resolve();expect(cancelled).toBe(false);resume();await cancellation;await reading;expect(closed).toBe(acquired);expect(await fs.readdir("/")).toEqual([]);
});
