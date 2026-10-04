import {beforeAll,expect,it} from "vitest";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";

let script: string;
beforeAll(async()=>{
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../../",import.meta.url)),sourcefile:"stored-path-worker.ts",contents:`
 import {PdfFileSource} from './packages/pdf-ast/src/source.ts';
 import {parseContentRangeEvents} from './packages/pdf-ast/src/content/range-events.ts';
 import {evaluateRetainedContentSteps} from './packages/pdf-ast/src/content/retained-evaluator.ts';
 import {renderOperationStreamWindow} from './packages/pdf-ast/src/render/raster.ts';
 export default {async fetch(request,env){
 const count=Number(new URL(request.url).searchParams.get('count')),stroke=new URL(request.url).searchParams.has('stroke'),long=new URL(request.url).searchParams.has('long'),clips=new URL(request.url).searchParams.has('clips'),states=new URL(request.url).searchParams.has('states'),marked=new URL(request.url).searchParams.has('marked'),body=states?'q ':marked?'/Span BMC ':clips?'0 0 4 4 re W n ':long?'1 1 l 3 1 l 3 3 l 1 3 l ':'0 0 4 4 re ',tail=states?'0 0 4 4 re f '+'Q '.repeat(count):marked?'0 0 4 4 re f '+'EMC '.repeat(count):clips?'0 0 4 4 re f':long?'8 w [1 0.5] 0.25 d h S':stroke?'8 w S':'W n 0 0 4 4 re f',size=body.length*count+tail.length;
 let end=0,peak=0,reads=0;
 const storage={allocate(length){const at=end;end+=length;return at;},async write(position,bytes){await env.BACKING.fetch('https://backing/?at='+position,{method:'PUT',body:bytes});},async read(position,length){reads++;return new Uint8Array(await(await env.BACKING.fetch('https://backing/?at='+position+'&length='+length)).arrayBuffer());}};
 const fs={capabilities:{retainedRead:true},async openReadFile(){return {async stat(){return {type:'file',size};},async read(at,length){const bytes=new Uint8Array(Math.min(length,size-at));for(let i=0;i<bytes.length;i++){const p=at+i;bytes[i]=(p<body.length*count?body[p%body.length]:tail[p-body.length*count]).charCodeAt(0);}return bytes;},async close(){}};}};
 const Native=Uint8Array,push=Array.prototype.push,iterator=Array.prototype[Symbol.iterator];
 globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const length=typeof args[0]==='number'?args[0]:args[0]?.byteLength??args[0]?.length??0;peak=Math.max(peak,length);if(length>8192)throw Error('unbounded bytes');return Reflect.construct(target,args);}});
 Array.prototype.push=function(...items){if(this.length+items.length>128)throw Error('collected path');return Reflect.apply(push,this,items);};
 Array.prototype[Symbol.iterator]=function(){if(this.length>128)throw Error('collected clip list');return Reflect.apply(iterator,this,[]);};
 let source;
 try{source=await PdfFileSource.open(fs,'/input',{chunkBytes:256,cacheBytes:256});const scratch={fs,directory:'/'};
 const image=await renderOperationStreamWindow({width:4,height:4},async function*(){
 const events=parseContentRangeEvents(source,scratch,{chunkBytes:256,pathStorage:storage});
 for await(const event of evaluateRetainedContentSteps({}, {events},{pageIndex:0,width:4,height:4},scratch,{imageStorage:storage,chunkBytes:256}))if(!event.captured)yield event.operation;
 },{x:1,y:1,width:1,height:1},{scale:1,transparent:true});
 return Response.json({pixels:[...image.data],peak,reads,bytes:end,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{await source?.close();globalThis.Uint8Array=Native;Array.prototype.push=push;Array.prototype[Symbol.iterator]=iterator;}
 }};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 script=bundle.outputFiles[0]!.text;
});
it.each(["fill","stroke","long","clips","states","marked"])("parses and evaluates growing %s paths in a Worker using external backing",async mode=>{
 let backing=new Uint8Array(2**23);
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script,serviceBindings:{BACKING:async(request:Request)=>{
  const url=new URL(request.url),at=Number(url.searchParams.get("at"));
  if(request.method==="PUT"){backing.set(new Uint8Array(await request.arrayBuffer()),at);return new Response();}
  return new Response(backing.slice(at,at+Number(url.searchParams.get("length"))));
 }}});
 try{for(const count of [256,512]){
  backing=new Uint8Array(2**23);
  const response=await runtime.dispatchFetch("https://verify/?count="+count+(mode==="fill"?"":"&stroke")+(mode==="long"?"&long":"")+(mode==="clips"?"&clips":"")+(mode==="states"?"&states":"")+(mode==="marked"?"&marked":""));if(response.status!==200)throw Error(await response.text());
  const result=await response.json() as {pixels:number[];peak:number;reads:number;bytes:number;nodeGlobals:boolean};
  // Exact coverage from the committed AGG renderer, including dash overlap ties.
  expect(result.pixels).toEqual([0,0,0,mode==="long"?(count===256?207:143):255]);expect(result.peak).toBeLessThanOrEqual(8192);expect(result.reads).toBeGreaterThan(8);expect(result.bytes).toBeGreaterThan(count*56);expect(result.nodeGlobals).toBe(false);
 }}finally{await runtime.dispose();}
},15000);
