import {expect,it} from "vitest";
import sharp from "@poe-code/image-ast";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments,type CommandContext} from "safe-bash-contracts/command";
import {createIdentifyCommand,runIdentifyCli,runSipsCli} from "./index.js";

for(const format of ["png","jpeg","webp","tiff","gif","bmp","ppm","pgm","pbm"] as const)
for(const args of [[],["-format","%f %wx%h %[size] %[channels]"],["-verbose"]])
it(`identifies retained ${format} ${args.join(" ")} without whole-file reads`,async()=>{
 const bytes=await sharp({create:{width:17,height:13,channels:4,background:"green"}}).toFormat(format).toBuffer(),fs=new MemoryFileSystem();await fs.writeFile("/in",bytes);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile")return ()=>{throw new Error("whole input forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const arguments_=createCommandArguments([...args,"in"]),stdout:string[]=[],stderr:string[]=[];
 const context={command:"identify",args:arguments_.args,argumentValues:arguments_,cwd:"/",env:{},fs:guarded,signal:new AbortController().signal,stdin:(async function*(){})(),stdout:{async write(bytes:Uint8Array){stdout.push(new TextDecoder().decode(bytes));}},stderr:{async write(bytes:Uint8Array){stderr.push(new TextDecoder().decode(bytes));}}} as CommandContext;
 const expected=await runIdentifyCli([...args,"in"],new Map([["in",bytes]])),actual=await createIdentifyCommand().execute(context);
 expect({...actual,stdout:stdout.join(""),stderr:stderr.join("")}).toEqual(expected);
});

it("keeps SDK file inspection parity and caller input admission before reads",async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:13,height:7,channels:3,background:"red"}}).png().toBuffer();await fs.writeFile("/a",bytes);await fs.writeFile("/b",bytes);
 const counts:number[]=[],input={filesystem:fs,cwd:"/",inputBudget:{check(size:number){counts.push(size);}}};
 expect(await runIdentifyCli(["-verbose","a","b"],input)).toEqual(await runIdentifyCli(["-verbose","a","b"],new Map([["a",bytes],["b",bytes]])));
 expect(counts).toEqual([bytes.length,bytes.length*2]);
 const failure=new Error("caller budget");await expect(runIdentifyCli(["a"],{...input,inputBudget:{check(){throw failure;}}})).rejects.toBe(failure);
});

for(const args of [[],["--help"]])it(`observes SDK cancellation before ${JSON.stringify(args)}`,async()=>{
 const controller=new AbortController(),reason=new Error("cancel identify");controller.abort(reason);
 await expect(runIdentifyCli(args,new Map(),controller.signal)).rejects.toBe(reason);
});

it("preserves missing and malformed image diagnostics",async()=>{
 const fs=new MemoryFileSystem(),bytes=new Uint8Array([1,2,3]);await fs.writeFile("/bad",bytes);
 expect(await runIdentifyCli(["missing","bad"],{filesystem:fs,cwd:"/"})).toEqual(await runIdentifyCli(["missing","bad"],new Map([["bad",bytes]])));
});

for(const mode of ["success","read","close","changed","cancel"] as const)
it(`owns one source across metadata and statistics on ${mode}`,async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:37,height:23,channels:4,background:"red"}}).png().toBuffer();await fs.writeFile("/in",bytes);
 const controller=new AbortController(),failure=new Error(mode);let opened=0,closed=0,stats=0;
 const open=fs.openReadFile!.bind(fs);const intercepted:NonNullable<typeof fs.openReadFile>=async(...args)=>{const handle=await open(...args);opened++;return new Proxy(handle,{get(target,key){
  if(key==="stat")return async(...args:Parameters<typeof handle.stat>)=>{stats++;const receipt=await handle.stat(...args);return mode==="changed"?{...receipt,opaqueVersion:String(stats)}:receipt;};
  if(key==="read")return async(...args:Parameters<typeof handle.read>)=>{if(mode==="read")throw failure;if(mode==="cancel")controller.abort(failure);return handle.read(...args);};
  if(key==="close")return async()=>{closed++;await handle.close();if(mode==="close")throw failure;};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});};
 const supplied=new Proxy(fs,{get(target,key){if(key==="openReadFile")return intercepted;const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const result=runIdentifyCli(["-verbose","in"],{filesystem:supplied,cwd:"/"},controller.signal);
 if(mode==="success")expect((await result).exitCode).toBe(0);else if(mode==="changed")await expect(result).rejects.toMatchObject({code:"EAGAIN"});else await expect(result).rejects.toBe(failure);
 expect(opened).toBe(1);expect(closed).toBe(1);if(mode==="success")expect(stats).toBe(2);
});

it("closes an admitted source without reading when the caller rejects its size",async()=>{
 const fs=new MemoryFileSystem(),bytes=await sharp({create:{width:2,height:2,channels:3,background:"blue"}}).png().toBuffer();await fs.writeFile("/in",bytes);
 const failure=new Error("too large"),open=fs.openReadFile!.bind(fs);let reads=0,closed=0;
 const intercepted:NonNullable<typeof fs.openReadFile>=async(...args)=>{const handle=await open(...args);return new Proxy(handle,{get(target,key){if(key==="read")return async(...args:Parameters<typeof handle.read>)=>{reads++;return handle.read(...args);};if(key==="close")return async()=>{closed++;await handle.close();};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});};
 const supplied=new Proxy(fs,{get(target,key){if(key==="openReadFile")return intercepted;const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 await expect(runIdentifyCli(["in"],{filesystem:supplied,cwd:"/",inputBudget:{check(){throw failure;}}})).rejects.toBe(failure);expect(reads).toBe(0);expect(closed).toBe(1);
});

import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";
it("runs image queries with external source and backing in Workerd above the cache window",async()=>{
 const bytes=await sharp({create:{width:1024,height:513,channels:3,background:"blue"}}).bmp().toBuffer();
 const cases=[{command:"identify",args:["-format","%wx%h %[size]","/in"],scratch:0},{command:"identify",args:["-verbose","/in"],scratch:1},{command:"sips",args:["-g","allxml","/in"],scratch:0}];
 const expected=await Promise.all(cases.map(({command,args})=>(command==="sips"?runSipsCli:runIdentifyCli)(args,new Map([["/in",bytes]]))));
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../",import.meta.url)),sourcefile:"identify-worker.ts",contents:`
 import {createIdentifyCommand,createSipsCommand} from './packages/safe-bash-command-sips/src/index.ts';
 import {createCommandArguments} from 'safe-bash-contracts/command';
 export default {async fetch(request,env){const {args,size,command}=await request.json();let reads=0,closed=0,scratchClosed=0,writes=0,maxAllocation=0,admitted=0,stdout='',stderr='';const scope={};
 const fs={capabilities:{retainedRead:true},async stat(){return {type:'directory'};},async removeFileConditional(){},
 async openReadFile(){return {async stat(){return {type:'file',size,mode:420,mtimeMs:1,atimeMs:1,ctimeMs:1,identityScope:scope,opaqueIdentity:'in',opaqueVersion:'v1'};},async read(position,length){if(length>16384||admitted!==size)throw new Error('source admission or range');reads++;const response=await env.SOURCE.fetch('https://source/?position='+position+'&length='+length);return new Uint8Array(await response.arrayBuffer());},async close(){closed++;}};},
 async open(){return {capabilities:{positionedRead:true,positionedWrite:true},async stat(){return {type:'file',size:0};},async write(bytes,position){if(bytes.length>16384)throw new Error('large write');writes++;await env.SCRATCH.fetch('https://scratch/?position='+position,{method:'PUT',body:bytes});return bytes.length;},async read(bytes,position){if(bytes.length>16384)throw new Error('large read');const response=await env.SCRATCH.fetch('https://scratch/?position='+position+'&length='+bytes.length);bytes.set(new Uint8Array(await response.arrayBuffer()));return bytes.length;},async close(){scratchClosed++;await env.SCRATCH.fetch('https://scratch/',{method:'DELETE'});}};},
 readFile(){throw new Error('whole input');},writeFile(){throw new Error('whole output');}};
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw new Error('unbounded identify allocation');return Reflect.construct(target,args);}});
 const arguments_=createCommandArguments(args);let result;try{result=await (command==='sips'?createSipsCommand():createIdentifyCommand()).execute({command,args:arguments_.args,argumentValues:arguments_,cwd:'/',env:{},fs,signal:new AbortController().signal,stdin:(async function*(){})(),inputBudget:{maxBytes:size,check(bytes){admitted=bytes;if(bytes>size)throw new Error('budget');}},stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});}finally{globalThis.Uint8Array=Native;}
 return Response.json({...result,stdout,stderr,reads,closed,scratchClosed,writes,maxAllocation,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 expect(Object.keys(bundle.metafile!.inputs).some(path=>path.startsWith("node:"))).toBe(false);
 const scratch=new Map<number,Uint8Array>();
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{SOURCE:async(request:Request)=>{const url=new URL(request.url),position=Number(url.searchParams.get("position")),length=Number(url.searchParams.get("length"));return new Response(bytes.slice(position,position+length));},SCRATCH:async(request:Request)=>{if(request.method==="DELETE"){scratch.clear();return new Response();}const url=new URL(request.url),position=Number(url.searchParams.get("position"));if(request.method==="PUT"){scratch.set(position,new Uint8Array(await request.arrayBuffer()));return new Response();}return new Response(scratch.get(position)?.slice(0,Number(url.searchParams.get("length"))));}}});
 try{for(const [index,{args,command,scratch:expectedScratch}]of cases.entries()){scratch.clear();const response=await runtime.dispatchFetch("https://identify/",{method:"POST",body:JSON.stringify({args,command,size:bytes.length})});expect(response.status).toBe(200);const result=await response.json() as {exitCode:number;stdout:string;stderr:string;reads:number;closed:number;scratchClosed:number;writes:number;maxAllocation:number;nodeGlobals:boolean};expect({exitCode:result.exitCode,stdout:result.stdout,stderr:result.stderr}).toEqual(expected[index]);expect(result.reads).toBeGreaterThan(0);expect(result.closed).toBe(1);expect(result.scratchClosed).toBe(expectedScratch);if(expectedScratch)expect(result.writes).toBeGreaterThan(64);expect(result.maxAllocation).toBeLessThanOrEqual(65536);expect(result.nodeGlobals).toBe(false);expect(scratch.size).toBe(0);}}
 finally{await runtime.dispose();}
},15000);

import {runInNewContext} from "node:vm";
it("preserves byte maps supplied by another JavaScript realm",async()=>{
 const bytes=await sharp({create:{width:3,height:2,channels:3,background:"red"}}).png().toBuffer(),files=runInNewContext("new Map()") as Map<string,Uint8Array>;files.set("in",bytes);
 expect(await runIdentifyCli(["in"],files)).toEqual(await runIdentifyCli(["in"],new Map([["in",bytes]])));
});

for(const brandOffset of [64,1028,16384])it(`preserves HEIF compatible brand admission at ${brandOffset}`,async()=>{
 const bytes=new Uint8Array(brandOffset+4),view=new DataView(bytes.buffer);view.setUint32(0,bytes.length);bytes.set(new TextEncoder().encode("ftypzzzz"),4);bytes.set(new TextEncoder().encode("heic"),brandOffset);
 const fs=new MemoryFileSystem();await fs.writeFile("/in",bytes);
 const expected=await runIdentifyCli(["in"],new Map([["in",bytes]]));
 expect(await runIdentifyCli(["in"],{filesystem:fs,cwd:"/"})).toEqual(expected);
});
