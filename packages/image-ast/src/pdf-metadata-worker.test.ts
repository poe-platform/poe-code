import {expect,it} from "vitest";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";
import sharp from "./index.js";

it("inspects PDF metadata in Workerd with external input and index backing",async()=>{
 const pixels=new Uint8Array(257*257*4);let state=1234567;for(let i=0;i<pixels.length;i++){state^=state<<13;state^=state>>>17;state^=state<<5;pixels[i]=state&255;}
 const bytes=await sharp(pixels,{raw:{width:257,height:257,channels:4}}).toFormat("pdf").toBuffer();expect(bytes.length).toBeGreaterThan(131072);
 const expected=await sharp(bytes).metadata();
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../",import.meta.url)),sourcefile:"pdf-metadata-worker.ts",contents:`
 import sharp from './packages/image-ast/src/index.ts';
 export default {async fetch(request,env){const {size}=await request.json();let id=0,opened=0,closed=0,removed=0,maxAllocation=0,reads=0;const scope={},files=new Map([['/input',{id:'input',size}]]);
 const stat=(file,type='file')=>({type,size:file.size,mode:420,mtimeMs:1,ctimeMs:1,atimeMs:1,identityScope:scope,opaqueIdentity:file.id,opaqueVersion:'1'}),parent=stat({id:'root',size:0},'directory');
 const fs={capabilities:{retainedRead:true,retainedStagingWrite:true,retainedStagingCleanup:true},async stat(){return parent;},async capabilitiesFor(){return this.capabilities;},
 async openReadFile(path){const file=files.get(path);if(!file)throw new Error('missing retained source');opened++;return {async stat(){return stat(file);},async read(position,length){if(length>65536)throw new Error('large request');reads++;const response=await env.BACKING.fetch('https://backing/'+file.id+'?position='+position+'&length='+length);return new Uint8Array(await response.arrayBuffer());},async close(){closed++;}};},
 async createStagedFile(path,name){const file={id:String(++id),size:0},filePath=path+'/'+name;files.set(filePath,file);return {parent:{path:'/',stat:parent},directory:{path,stat:parent},file:{path:filePath,stat:stat(file)},writer:{async write(chunk){if(chunk.length>65536)throw new Error('large write');await env.BACKING.fetch('https://backing/'+file.id+'?position='+file.size,{method:'PUT',body:chunk});file.size+=chunk.length;},async finish(){return stat(file);}},cleanup:{async remove(){files.delete(filePath);removed++;await env.BACKING.fetch('https://backing/'+file.id,{method:'DELETE'});},async close(){}}};},
 readFile(){throw new Error('whole input');},writeFile(){throw new Error('whole output');}};
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw new Error('unbounded PDF allocation '+length);return Reflect.construct(target,args);}});
 try{const metadata=await sharp('/input',{filesystem:fs}).metadata();return Response.json({metadata,opened,closed,removed,files:files.size,reads,maxAllocation,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});}finally{globalThis.Uint8Array=Native;}
 }};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 const backing=new Map<string,Uint8Array>([["/input",bytes]]);
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{BACKING:async(request:Request)=>{
  const url=new URL(request.url),key=url.pathname,position=Number(url.searchParams.get("position"));
  if(request.method==="DELETE"){backing.delete(key);return new Response();}
  if(request.method==="PUT"){const chunk=new Uint8Array(await request.arrayBuffer()),old=backing.get(key)??new Uint8Array(),next=new Uint8Array(Math.max(old.length,position+chunk.length));next.set(old);next.set(chunk,position);backing.set(key,next);return new Response();}
  return new Response(backing.get(key)!.slice(position,position+Number(url.searchParams.get("length"))));
 }}});
 try{const response=await runtime.dispatchFetch("https://image/",{method:"POST",body:JSON.stringify({size:bytes.length})});if(response.status!==200)throw new Error(await response.text());const result=await response.json() as {metadata:unknown;opened:number;closed:number;removed:number;files:number;reads:number;maxAllocation:number;nodeGlobals:boolean};
 expect(result.metadata).toEqual(expected);expect(result.opened).toBeGreaterThan(2);expect(result.closed).toBe(result.opened);expect(result.removed).toBe(result.opened-1);expect(result.files).toBe(1);expect(result.reads).toBeGreaterThan(8);expect(result.maxAllocation).toBeLessThanOrEqual(65536);expect(result.nodeGlobals).toBe(false);expect([...backing.keys()]).toEqual(["/input"]);
 }finally{await runtime.dispose();}
});
