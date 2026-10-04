import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect,it} from "vitest";
import {decodeJbig2ToRgba} from "./images.js";

it.each(["page", "region", "arithmetic", "segments", "random segments", "repeated regions", "text region", "halftone", "patterns", "repeated text", "repeated halftone", "symbols", "MMR symbols"])("keeps growing JBIG2 %s state in external caller storage in Workerd",async profile=>{
 const inputs=new Map<number,{bytes:Uint8Array;sum:number}>();
 for(const height of profile === "patterns" ? [129,255] : profile === "arithmetic" ? [129,513] : (profile.includes("segments") || profile.startsWith("repeated")) ? [17,129] : [8193,32769]){
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
  if(profile === "arithmetic") {
   const region=new Uint8Array(30+11+26+8192);region.set(bytes.subarray(0,30));
   const view=new DataView(region.buffer);view.setUint32(30,1);region[34]=38;region[36]=1;
   view.setUint32(37,26+8192);view.setUint32(41,64);view.setUint32(45,height);
   region.set([3,255,253,255,2,254,254,254],59);region.set([255,172],region.length-2);bytes=region;
  }
  if(profile === "text region" || profile === "repeated text") {
   const region=new Uint8Array(30+11+23+16);region.set(bytes.subarray(0,30));
   const view=new DataView(region.buffer);view.setUint32(30,1);region[34]=6;region[36]=1;
   view.setUint32(37,39);view.setUint32(41,64);view.setUint32(45,height);view.setUint16(58,512);bytes=region;
  }
  if(profile === "halftone" || profile === "repeated halftone") {
   const bits="1".repeat(height)+"000000000001000000000001",payload=new Uint8Array(Math.ceil(bits.length/8));
   for(let i=0;i<bits.length;i++)if(bits[i]==="1")payload[i>>3]!|=128>>(i&7);
   const input=new Uint8Array(99+payload.length);input.set(bytes.subarray(0,30));const view=new DataView(input.buffer);
   view.setUint32(30,1);input[34]=16;input[36]=1;view.setUint32(37,8);input.set([1,1,1],41);view.setUint32(44,1);input[48]=128;
   view.setUint32(49,2);input[53]=22;input[54]=32;input[55]=1;input[56]=1;view.setUint32(57,38+payload.length);
   view.setUint32(61,64);view.setUint32(65,height);input[78]=129;view.setUint32(79,1);view.setUint32(83,height);view.setUint16(95,256);input.set(payload,99);bytes=input;
  }
  if(profile === "patterns") {
   const input=new Uint8Array(48+128+12+38+4);input.set(bytes.subarray(0,30));const view=new DataView(input.buffer);
   view.setUint32(30,1);input[34]=16;input[36]=1;view.setUint32(37,135);input.set([1,1,height],41);view.setUint32(44,1);input.fill(255,48,176);
   view.setUint32(176,2);input[180]=22;input[181]=32;input[182]=1;input[183]=1;view.setUint32(184,42);
   view.setUint32(188,64);view.setUint32(192,height);input[205]=129;view.setUint32(206,1);view.setUint32(210,1);view.setUint16(222,256);
   // White single-row MMR gray plane followed by end-of-block.
   input.set([128,8,0,128],226);bytes=input;
  }
  if(profile.includes("symbols")) {
   // Export only the second symbol, whose shared pixels begin inside a byte.
   let pixels=new Uint8Array(height).fill(180),widths="1110000"+"110",sizeBits="00000";
   if(profile === "MMR symbols") {
    const bits="0010001110101"+"111".repeat(height-1);pixels=new Uint8Array(Math.ceil(bits.length/8));
    for(let i=0;i<bits.length;i++)if(bits[i]==="1")pixels[i>>3]!|=128>>(i&7);
    widths="10"+"110";sizeBits="110"+(pixels.length-272).toString(2).padStart(16,"0");
   }
   const bits="11111"+(height-76).toString(2).padStart(32,"0")+widths+"111111"+sizeBits;
   const header=new Uint8Array(Math.ceil(bits.length/8));for(let i=0;i<bits.length;i++)if(bits[i]==="1")header[i>>3]!|=128>>(i&7);
   const start=53+header.length+pixels.length,input=new Uint8Array(start+51);input.set(bytes.subarray(0,30));const view=new DataView(input.buffer);
   view.setUint32(30,1);input[36]=1;view.setUint32(37,12+header.length+pixels.length);view.setUint16(41,1);view.setUint32(43,1);view.setUint32(47,2);
   input.set(header,51);input.set(pixels,51+header.length);input.set([8,64],51+header.length+pixels.length);
   view.setUint32(start,2);input[start+4]=6;input[start+5]=32;input[start+6]=1;input[start+7]=1;view.setUint32(start+8,39);
   view.setUint32(start+12,64);view.setUint32(start+16,height);view.setUint16(start+29,16);view.setUint32(start+31,1);bytes=input;
  }
  new DataView(bytes.buffer).setUint32(15,height);
  if(profile.includes("segments")) {
   const records:Uint8Array[]=[];
   for(let n=0;n<height;n++){const header=new Uint8Array(11);new DataView(header.buffer).setUint32(0,n+2);header[4]=62;records.push(header);}
   for(let at=0;at<bytes.length;){const length=11+new DataView(bytes.buffer).getUint32(at+7);records.push(bytes.slice(at,at+length));at+=length;}
   if(profile === "random segments") {
    const end=new Uint8Array(11);end[4]=51;records.push(end);
    const input=new Uint8Array(9+records.reduce((sum,record)=>sum+record.length,0));input.set([151,74,66,50,13,10,26,10,2]);
    let at=9;for(const record of records){input.set(record.subarray(0,11),at);at+=11;}
    for(const record of records){input.set(record.subarray(11),at);at+=record.length-11;}bytes=input;
   }else{const input=new Uint8Array(records.reduce((sum,record)=>sum+record.length,0));let at=0;for(const record of records){input.set(record,at);at+=record.length;}bytes=input;}
  }
  if(profile.startsWith("repeated")) {
   const start=profile === "repeated halftone"?49:30,region=bytes.subarray(start),input=new Uint8Array(start+height*region.length);input.set(bytes.subarray(0,start));
   for(let n=0;n<height;n++){input.set(region,start+n*region.length);new DataView(input.buffer).setUint32(start+n*region.length,n+2);}bytes=input;
  }
  const expected=decodeJbig2ToRgba(bytes,64,height);
  if(profile.includes("symbols"))expect(expected.some(value=>value!==255)).toBe(true);
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
 const image=await PdfRetainedJbig2.open(source,64,height,{bitmapStorage:storage,maxWorkingBytes:${profile.includes("symbols") ? 524288 : 262144}});let sum=0,index=0;try{for await(const row of image.rows())for(const value of row)sum=(sum+value*(index++%65521+1))%1000000007;}finally{image.close();await storage.close();}
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
