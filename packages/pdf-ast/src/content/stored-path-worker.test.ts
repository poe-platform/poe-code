import {expect,it} from "vitest";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";

it("parses, evaluates and clips growing paths in a Worker using external backing",async()=>{
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../../",import.meta.url)),sourcefile:"stored-path-worker.ts",contents:`
 import {PdfFileSource} from './packages/pdf-ast/src/source.ts';
 import {parseContentRangeEvents} from './packages/pdf-ast/src/content/range-events.ts';
 import {evaluateRetainedContentSteps} from './packages/pdf-ast/src/content/retained-evaluator.ts';
 import {renderOperationStreamWindow} from './packages/pdf-ast/src/render/raster.ts';
 export default {async fetch(request,env){
 const count=Number(new URL(request.url).searchParams.get('count')),body='0 0 4 4 re ',tail='W n 0 0 4 4 re f',size=body.length*count+tail.length;
 let end=0,peak=0,reads=0;
 const storage={allocate(length){const at=end;end+=length;return at;},async write(position,bytes){await env.BACKING.fetch('https://backing/?at='+position,{method:'PUT',body:bytes});},async read(position,length){reads++;return new Uint8Array(await(await env.BACKING.fetch('https://backing/?at='+position+'&length='+length)).arrayBuffer());}};
 const fs={capabilities:{retainedRead:true},async openReadFile(){return {async stat(){return {type:'file',size};},async read(at,length){const bytes=new Uint8Array(Math.min(length,size-at));for(let i=0;i<bytes.length;i++){const p=at+i;bytes[i]=(p<body.length*count?body[p%body.length]:tail[p-body.length*count]).charCodeAt(0);}return bytes;},async close(){}};}};
 const Native=Uint8Array,push=Array.prototype.push;
 globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const length=typeof args[0]==='number'?args[0]:args[0]?.byteLength??args[0]?.length??0;peak=Math.max(peak,length);if(length>8192)throw Error('unbounded bytes');return Reflect.construct(target,args);}});
 Array.prototype.push=function(...items){if(this.length+items.length>128)throw Error('collected path');return Reflect.apply(push,this,items);};
 let source;
 try{source=await PdfFileSource.open(fs,'/input',{chunkBytes:256,cacheBytes:256});const scratch={fs,directory:'/'};
 const image=await renderOperationStreamWindow({width:4,height:4},async function*(){
 const events=parseContentRangeEvents(source,scratch,{chunkBytes:256,pathStorage:storage});
 for await(const event of evaluateRetainedContentSteps({}, {events},{pageIndex:0,width:4,height:4},scratch,{imageStorage:storage,chunkBytes:256}))if(!event.captured)yield event.operation;
 },{x:1,y:1,width:1,height:1},{scale:1,transparent:true});
 return Response.json({pixels:[...image.data],peak,reads,bytes:end,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{await source?.close();globalThis.Uint8Array=Native;Array.prototype.push=push;}
 }};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 let backing=new Uint8Array(2**20);
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{BACKING:async(request:Request)=>{
  const url=new URL(request.url),at=Number(url.searchParams.get("at"));
  if(request.method==="PUT"){backing.set(new Uint8Array(await request.arrayBuffer()),at);return new Response();}
  return new Response(backing.slice(at,at+Number(url.searchParams.get("length"))));
 }}});
 try{for(const count of [256,2048]){
  backing=new Uint8Array(2**20);
  const response=await runtime.dispatchFetch("https://verify/?count="+count);if(response.status!==200)throw Error(await response.text());
  const result=await response.json() as {pixels:number[];peak:number;reads:number;bytes:number;nodeGlobals:boolean};
  expect(result.pixels).toEqual([0,0,0,255]);expect(result.peak).toBeLessThanOrEqual(8192);expect(result.reads).toBeGreaterThan(8);expect(result.bytes).toBeGreaterThan(count*56);expect(result.nodeGlobals).toBe(false);
 }}finally{await runtime.dispose();}
},15000);
