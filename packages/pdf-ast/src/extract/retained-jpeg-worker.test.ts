import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect,it} from "vitest";
import {decodeJpegToRgba} from "./images.js";

it('reads growing JPEG input ranges in Workerd without an encoded-payload allocation',async()=>{
 const bytes=new Uint8Array(readFileSync(new URL('../fixtures/jpeg-RGB-1-0-17.jpg',import.meta.url))),expected=decodeJpegToRgba(bytes);
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL('../../../../',import.meta.url)),contents:`
 import {PdfRetainedJpeg} from './packages/pdf-ast/src/extract/retained-jpeg.ts';
 export default {async fetch(request,env){const {prefix,length}=await request.json();let reads=0,peak=0;
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const length=typeof args[0]==='number'?args[0]:args[0]?.byteLength??args[0]?.length??0;peak=Math.max(peak,length);if(length>65536)throw Error('whole JPEG allocation');return Reflect.construct(target,args);}});
 try{const source={size:prefix+length,chunkBytes:4096,async read(at,length){if(length>4096)throw Error('whole JPEG read');reads++;const response=await env.BACKING.fetch('https://source/?prefix='+prefix+'&at='+at+'&length='+length);return new Uint8Array(await response.arrayBuffer());}};
 const image=await PdfRetainedJpeg.open(source);let sum=0,index=0;for await(const row of image.rows())for(const value of row)sum=(sum+value*(++index))%1000000007;image.close();
 return Response.json({sum,reads,peak,decoderBytes:image.decoderBytes,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{globalThis.Uint8Array=Native;}}};`},bundle:true,write:false,platform:'browser',conditions:['workerd'],format:'esm',metafile:true,logLevel:'silent'});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 const runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{BACKING:async(request:Request)=>{
  const url=new URL(request.url),prefix=Number(url.searchParams.get('prefix')),at=Number(url.searchParams.get('at')),length=Number(url.searchParams.get('length')),result=new Uint8Array(length);for(let i=0;i<length;i++)result[i]=bytes[at+i-prefix]??0;return new Response(result);
 }}});
 try{let admission:number|undefined;for(const prefix of [131072,524288]){
 const response=await runtime.dispatchFetch('https://verify/',{method:'POST',body:JSON.stringify({prefix,length:bytes.length})});if(response.status!==200)throw Error(await response.text());
 const result=await response.json() as {sum:number;reads:number;peak:number;decoderBytes:number;nodeGlobals:boolean};
 expect(result.sum).toBe(expected.data.reduce((sum,value,index)=>(sum+value*(index+1))%1000000007,0));expect(result.peak).toBeLessThanOrEqual(65536);expect(result.reads).toBeGreaterThan(prefix/4096);expect(result.nodeGlobals).toBe(false);if(admission!==undefined)expect(result.decoderBytes).toBe(admission);admission=result.decoderBytes;
 }}finally{await runtime.dispose();}
},15000);
