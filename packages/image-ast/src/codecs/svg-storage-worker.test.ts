import {expect,test} from "vitest";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";

test("renders an SVG canvas with external Worker backing and bounded allocations",async()=>{
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../../",import.meta.url)),sourcefile:"svg-surface-worker.ts",contents:`
 import {decodeSvgToStorage} from './packages/image-ast/src/codecs/svg-storage.ts';
 export default {async fetch(request,env){let size=0,maxAllocation=0;const storage={allocate(length){const start=size;size+=length;return start;},async read(position,length){if(length>4096)throw Error('large read');return new Uint8Array(await(await env.BACKING.fetch('https://backing/?position='+position+'&length='+length)).arrayBuffer());},async write(position,bytes){if(bytes.length>4096)throw Error('large write');await env.BACKING.fetch('https://backing/?position='+position,{method:'PUT',body:bytes});}};
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw Error('unbounded SVG allocation '+length);return Reflect.construct(target,args);}});
 try{const image=await decodeSvgToStorage(new TextEncoder().encode('<svg width="512" height="512"><rect width="512" height="512" fill="red"/><rect width="256" height="512" fill="blue" opacity="0.5"/></svg>'),storage,new AbortController().signal);return Response.json({image,size,maxAllocation,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});}finally{globalThis.Uint8Array=Native;}
 }};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 const pages=new Map<number,Uint8Array>();let reads=0,writes=0;
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{BACKING:async(request:Request)=>{const url=new URL(request.url),position=Number(url.searchParams.get("position"));if(request.method==="PUT"){writes++;pages.set(position,new Uint8Array(await request.arrayBuffer()));return new Response();}reads++;return new Response(pages.get(position)?.slice(0,Number(url.searchParams.get("length"))));}}});
 try{const response=await runtime.dispatchFetch("https://verify/");if(response.status!==200)throw new Error(await response.text());const result=await response.json() as {image:{width:number;height:number};size:number;maxAllocation:number;nodeGlobals:boolean};
 expect(result.image).toMatchObject({width:512,height:512});expect(result.size).toBe(512*512*4);expect(result.maxAllocation).toBeLessThanOrEqual(65536);expect(result.nodeGlobals).toBe(false);expect(reads).toBeGreaterThan(16);expect(writes).toBeGreaterThan(256);
 for(const [position,bytes]of pages)for(let offset=0;offset<bytes.length;offset+=4){const x=((position+offset)/4)%512;if(bytes[offset]!== (x<256?127:255)||bytes[offset+1]!==0||bytes[offset+2]!== (x<256?128:0)||bytes[offset+3]!==255)throw new Error(`Unexpected SVG pixel at ${position+offset}`);}
 }finally{await runtime.dispose();}
},15000);
