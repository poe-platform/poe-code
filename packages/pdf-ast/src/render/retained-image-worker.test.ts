import {expect,test} from "vitest";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";
import {renderDisplayListToBitmap} from "./raster.js";

test("Worker raster samples externally backed images and stages reductions with fixed ranges",async()=>{
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../../",import.meta.url)),sourcefile:"retained-pixels-worker.ts",contents:`
 import {renderOperationStreamWindow} from './packages/pdf-ast/src/render/raster.ts';
 export default {async fetch(request,env){
 const Native=Uint8Array,BufferType=ArrayBuffer;let maximum=0,next=512*256*4;
 globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const size=typeof args[0]==='number'?args[0]:args[0]?.byteLength??0;maximum=Math.max(maximum,size);if(size>65536)throw Error('whole pixel allocation');return Reflect.construct(target,args);}});
 globalThis.ArrayBuffer=new Proxy(BufferType,{construct(target,args){if(args[0]>65536)throw Error('whole pixel buffer');return Reflect.construct(target,args);}});
 try{
 const borrowed=new Uint8Array(4096);
 const storage={allocate(length){const position=next;next+=length;return position;},async read(position,length){if(length>4096)throw Error('unbounded read');borrowed.set(new Uint8Array(await(await env.BACKING.fetch('https://backing/?position='+position+'&length='+length)).arrayBuffer()));return borrowed.subarray(0,length);},async write(position,bytes){if(bytes.length>4096)throw Error('unbounded write');await env.BACKING.fetch('https://backing/?position='+position,{method:'PUT',body:bytes});}};
 const image={name:'test',width:512,height:256,bitsPerComponent:8,colorSpace:'DeviceRGB',matrix:[31,0,0,17,0,0],storedRgba:{storage,position:0}};
 const result=await renderOperationStreamWindow({width:31,height:17},async function*(){yield {kind:'image',value:image};},{x:3,y:4,width:7,height:9},{scale:1});
 return Response.json({pixels:Array.from(result.data),maximum,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{globalThis.Uint8Array=Native;globalThis.ArrayBuffer=BufferType;}
 }};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 const pages=new Map<number,Uint8Array>();let reads=0,writes=0;
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{BACKING:async(request:Request)=>{
  const url=new URL(request.url),position=Number(url.searchParams.get("position"));
  if(request.method==="PUT"){writes++;pages.set(position,new Uint8Array(await request.arrayBuffer()));return new Response();}
  reads++;const length=Number(url.searchParams.get("length")),bytes=new Uint8Array(length);
  if(position<512*256*4)for(let i=0;i<length;i++)bytes[i]=(position+i)%4===3?255:((position+i)*17)%251;
  else for(const [start,data]of pages){const low=Math.max(start,position),high=Math.min(start+data.length,position+length);if(high>low)bytes.set(data.subarray(low-start,high-start),low-position);}
  return new Response(bytes);
 }}});
 try{
  const response=await runtime.dispatchFetch("https://verify/");if(response.status!==200)throw Error(await response.text());
  const result=await response.json() as {pixels:number[];maximum:number;nodeGlobals:boolean};
  const data=Uint8Array.from({length:512*256*4},(_,i)=>i%4===3?255:(i*17)%251);
  const full=renderDisplayListToBitmap({pageIndex:0,width:31,height:17,rotation:0,paths:[],glyphs:[],annotations:[],images:[{name:"test",width:512,height:256,bitsPerComponent:8,colorSpace:"DeviceRGB",matrix:[31,0,0,17,0,0],decodedRgba:data}]},{scale:1});
  const expected=[];for(let y=4;y<13;y++)expected.push(...full.data.subarray((y*31+3)*4,(y*31+10)*4));
  expect(result.pixels).toEqual(expected);expect(result.maximum).toBeLessThanOrEqual(65536);expect(result.nodeGlobals).toBe(false);expect(reads).toBeGreaterThan(0);expect(writes).toBeGreaterThan(0);
 }finally{await runtime.dispose();}
},15000);
