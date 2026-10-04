import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect,it} from "vitest";
import {decodeJbig2ToRgba} from "./images.js";

it.each(["page", "region"])("keeps growing JBIG2 %s state in external caller storage in Workerd",async profile=>{
 const inputs=new Map<number,{bytes:Uint8Array;sum:number}>();
 for(const height of [8193,32769]){
  let bytes=new Uint8Array(readFileSync(new URL("../fixtures/jbig2-generic-stream.bin",import.meta.url)));
  if(profile === "region") {
   // One vertical-zero MMR code per all-white row, with a complete region
   // payload rather than relying on truncated-input recovery.
   const payload = Math.ceil(height / 8), region = new Uint8Array(30 + 11 + 18 + payload);
   region.set(bytes.subarray(0,30));
   const view = new DataView(region.buffer);
   view.setUint32(30,1); region[34]=38; region[36]=1; view.setUint32(37,18+payload);
   view.setUint32(41,64); view.setUint32(45,height); region[58]=1; region.fill(255,59);
   bytes=region;
  }
  new DataView(bytes.buffer).setUint32(15,height);
  const expected=decodeJbig2ToRgba(bytes,64,height);
  inputs.set(height,{bytes,sum:expected.reduce((sum,value,index)=>(sum+value*(index%65521+1))%1000000007,0)});
 }
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../../",import.meta.url)),contents:`
 import {PdfRetainedJbig2} from './packages/pdf-ast/src/extract/retained-jbig2.ts';
 import {PagedStorage} from '@poe-code/safe-fs/storage';
 export default {async fetch(request,env){const {height,length}=await request.json();let opened=0,closed=0,peak=0;const originals=new Map();
 const fs={async stat(){return {type:'directory',size:0};},async removeFileConditional(){},async open(){opened++;return {capabilities:{positionedRead:true,positionedWrite:true},async stat(){return {type:'file',size:0};},async write(bytes,position){if(bytes.length>16384)throw Error('large write');await env.BACKING.fetch('https://backing/?at='+position,{method:'PUT',body:bytes});return bytes.length;},async read(bytes,position){if(bytes.length>16384)throw Error('large read');bytes.set(new Uint8Array(await(await env.BACKING.fetch('https://backing/?at='+position+'&length='+bytes.length)).arrayBuffer()));return bytes.length;},async close(){closed++;await env.BACKING.fetch('https://backing/',{method:'DELETE'});}};}};
 const storage=new PagedStorage({fs,cwd:'/',env:{},signal:new AbortController().signal},2);
 for(const name of ['Int8Array','Uint8Array','Uint8ClampedArray','Uint16Array','Uint32Array']){const Native=globalThis[name];originals.set(name,Native);globalThis[name]=new Proxy(Native,{construct(target,args){const bytes=typeof args[0]==='number'?args[0]*target.BYTES_PER_ELEMENT:args[0]?.byteLength??(args[0]?.length??0)*target.BYTES_PER_ELEMENT;peak=Math.max(peak,bytes);if(bytes>65536)throw Error('resident bitmap '+bytes);return Reflect.construct(target,args);}});}
 try{const source={size:length,chunkBytes:128,async read(at,length){if(length>128)throw Error('whole input');return new Uint8Array(await(await env.INPUT.fetch('https://input/?height='+height+'&at='+at+'&length='+length)).arrayBuffer());}};
 const image=await PdfRetainedJbig2.open(source,64,height,{bitmapStorage:storage,maxWorkingBytes:262144});let sum=0,index=0;try{for await(const row of image.rows())for(const value of row)sum=(sum+value*(index++%65521+1))%1000000007;}finally{image.close();await storage.close();}
 return Response.json({sum,peak,opened,closed,decoderBytes:image.decoderBytes,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{await storage.close();for(const [name,Native]of originals)globalThis[name]=Native;}}};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 let backing=new Uint8Array();
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{
  INPUT:async(request:Request)=>{const url=new URL(request.url),at=Number(url.searchParams.get("at"));return new Response(inputs.get(Number(url.searchParams.get("height")))!.bytes.slice(at,at+Number(url.searchParams.get("length"))));},
  BACKING:async(request:Request)=>{const url=new URL(request.url),at=Number(url.searchParams.get("at"));if(request.method==="DELETE"){backing=new Uint8Array();return new Response();}if(request.method==="PUT"){const bytes=new Uint8Array(await request.arrayBuffer());if(at+bytes.length>backing.length){const next=new Uint8Array(Math.max(at+bytes.length,backing.length*2));next.set(backing);backing=next;}backing.set(bytes,at);return new Response();}return new Response(backing.slice(at,at+Number(url.searchParams.get("length"))));}
 }});
 let admission:number|undefined;
 try{for(const[height,input]of inputs){const response=await runtime.dispatchFetch("https://verify/",{method:"POST",body:JSON.stringify({height,length:input.bytes.length})});if(response.status!==200)throw Error(await response.text());
  const result=await response.json() as {sum:number;peak:number;opened:number;closed:number;decoderBytes:number;nodeGlobals:boolean};
  expect(result.sum).toBe(input.sum);expect(result.peak).toBeLessThanOrEqual(65536);if(profile==="page")expect(result.opened).toBe(1);expect(result.closed).toBe(result.opened);expect(result.nodeGlobals).toBe(false);expect(backing.length).toBe(0);
  if(admission!==undefined)expect(result.decoderBytes).toBe(admission);admission=result.decoderBytes;
 }}finally{await runtime.dispose();}
});
