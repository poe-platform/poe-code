import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect,it} from "vitest";
import {decodeJbig2ToRgba} from "./images.js";

it.each(["page", "region", "arithmetic", "segments", "random segments", "repeated regions", "text region", "halftone", "patterns", "repeated text", "repeated halftone", "symbols", "MMR symbols", "refinement symbols", "adaptive refinement symbols", "dictionary tables", "dictionary index", "pattern index", "Huffman tables", "Huffman lower", "Huffman upper", "Huffman OOB", "Huffman index", "symbol ID tables", "symbol ID runs", "extended headers", "random extended headers"])("keeps growing JBIG2 %s state in external caller storage in Workerd",async profile=>{
 const inputs=new Map<number,{bytes:Uint8Array;sum:number}>();
 for(const height of profile.endsWith("index") ? [17,129] : profile.startsWith("Huffman") ? [128,512] : profile.startsWith("symbol ID") ? [512,1024] : profile === "dictionary tables" ? [1024,4096] : profile === "adaptive refinement symbols" ? [129,520] : profile === "patterns" ? [129,255] : profile === "arithmetic" ? [129,513] : (profile.includes("segments") || profile.startsWith("repeated")) ? [17,129] : [8193,32769]){
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
  if(profile === "halftone" || profile === "repeated halftone" || profile === "pattern index") {
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
   if(profile.includes("refinement")) {
    const adaptive=profile === "adaptive refinement symbols",offset=adaptive?39:35;
    const refined=new Uint8Array(start+offset+height*2+2);refined.set(input.subarray(0,start+(adaptive?31:35)));const view=new DataView(refined.buffer);
    view.setUint16(start+29,adaptive?18:32786);view.setUint32(start+8,offset-12+height*2+2);
    if(adaptive){refined.set([255,128,255,255],start+31);view.setUint32(start+35,1);}
    let state=adaptive?3:height===8193?22:8;for(let at=start+offset;at<refined.length-2;at++){state=(Math.imul(state,1664525)+1013904223)>>>0;refined[at]=state>>>24;}
    refined.set([255,172],refined.length-2);bytes=refined;
   }
  }

  if(profile === "dictionary tables" || profile.startsWith("symbol ID")) {
   const pack=(bits:string)=>{const bytes=new Uint8Array(Math.ceil(bits.length/8));for(let i=0;i<bits.length;i++)if(bits[i]==="1")bytes[i>>3]!|=128>>(i&7);return bytes;};
   const parts:Uint8Array[]=[];
   // Sixty-four narrow glyphs per height class keep every decoded row at 64 pixels.
   for(let h=1;h<=height/64;h++)parts.push(pack("0"+"10"+"0".repeat(63)+"111111"+"00000"),new Uint8Array(h*8).fill(85));
   parts.push(pack(profile.startsWith("symbol ID") ? "00000"+"110"+(height-272).toString(2).padStart(16,"0") : "110"+(height-1-272).toString(2).padStart(16,"0")+"00001"));
   const length=10+parts.reduce((sum,part)=>sum+part.length,0),start=41+length,input=new Uint8Array(start+51);input.set(bytes.subarray(0,30));const view=new DataView(input.buffer);
   view.setUint32(30,1);input[36]=1;view.setUint32(37,length);view.setUint16(41,1);view.setUint32(43,profile.startsWith("symbol ID")?height:1);view.setUint32(47,height);
   let at=51;for(const part of parts){input.set(part,at);at+=part.length;}
   view.setUint32(start,2);input[start+4]=6;input[start+5]=32;input[start+6]=1;input[start+7]=1;view.setUint32(start+8,39);
   view.setUint32(start+12,64);view.setUint32(start+16,height);view.setUint16(start+29,16);view.setUint32(start+31,1);bytes=input;
   if(profile.startsWith("symbol ID")) {
    const length=Math.log2(height),runs=profile === "symbol ID runs";
    let encoded="0".repeat(height);
    if(runs){encoded="10"+"000"+"11"+"0000000"+"00";let remaining=height-15;while(remaining>=3){const count=Math.min(6,remaining);encoded+="01"+(count-3).toString(2).padStart(2,"0");remaining-=count;}encoded+="00".repeat(remaining);}
    const table=pack(Array.from({length:35},(_,i)=>runs?(i===length||i>=32?"0010":"0000"):i===length?"0001":"0000").join("")+encoded);
    const codes=pack("00"+"000000000"+(height-(runs?15:1)).toString(2).padStart(length,"0")+"01"),output=new Uint8Array(start+37+table.length+codes.length);output.set(input.subarray(0,start+37));
    const view=new DataView(output.buffer);view.setUint32(start+8,25+table.length+codes.length);view.setUint16(start+29,17);view.setUint16(start+31,0);view.setUint32(start+33,1);output.set(table,start+37);output.set(codes,start+37+table.length);bytes=output;
   }
  }
  if(profile === "dictionary index") {
   const pack=(bits:string)=>{const result=new Uint8Array(Math.ceil(bits.length/8));for(let i=0;i<bits.length;i++)if(bits[i]==="1")result[i>>3]!|=128>>(i&7);return result;};
   const input=new Uint8Array(30+height*26+3*54);input.set(bytes.subarray(0,30));const view=new DataView(input.buffer);
   for(let i=0;i<height;i++) {
    const at=30+i*26;view.setUint32(at,i*0x01010101+1);input[at+6]=1;view.setUint32(at+7,15);
    view.setUint16(at+11,1);view.setUint32(at+13,1);view.setUint32(at+17,1);
    input.set(pack("0"+"10"+"111111"+"00000"),at+21);input[at+23]=128;input.set(pack("00000"+"00001"),at+24);
   }
   for(const [n,index] of [0,Math.floor(height/2),height-1].entries()) {
    const at=30+height*26+n*54;view.setUint32(at,0xfffffffd+n);input[at+4]=6;input[at+5]=32;view.setUint32(at+6,index*0x01010101+1);input[at+10]=1;view.setUint32(at+11,39);
    view.setUint32(at+15,64);view.setUint32(at+19,1);view.setUint32(at+27,n);view.setUint16(at+32,16);view.setUint32(at+34,1);
   }
   bytes=input;
  }
  if(profile === "pattern index") {
   const input=new Uint8Array(30+height*19+bytes.length-49+3);input.set(bytes.subarray(0,30));const view=new DataView(input.buffer);
   for(let i=0;i<height;i++){input.set(bytes.subarray(30,49),30+i*19);view.setUint32(30+i*19,i*0x01010101+1);}
   const at=30+height*19;input.set(bytes.subarray(49,55),at);view.setUint32(at,0xfffffffe);view.setUint32(at+6,(height-1)*0x01010101+1);input.set(bytes.subarray(56),at+10);bytes=input;
  }
  if(profile.startsWith("Huffman")) {
   const pack=(bits:string)=>{const result=new Uint8Array(Math.ceil(bits.length/8));for(let i=0;i<bits.length;i++)if(bits[i]==="1")result[i>>3]!|=128>>(i&7);return result;};
   const count=profile === "Huffman index"?2:height,oob=profile === "Huffman OOB",low=oob?1:2;
   const codeLength=Math.ceil(Math.log2(count+3)),prefix=codeLength.toString(2).padStart(4,"0");
   const lines=pack((prefix+"0").repeat(count)+prefix+prefix+(oob?prefix:"")),table=new Uint8Array(9+lines.length);table[0]=6+(oob?1:0);new DataView(table.buffer).setUint32(1,low);new DataView(table.buffer).setUint32(5,count+low);table.set(lines,9);
   const special=profile === "Huffman lower" || profile === "Huffman upper",selected=profile === "Huffman lower"?count:count+1;
   const dh=special?selected.toString(2).padStart(codeLength,"0")+"0".repeat(32):"0".repeat(codeLength);
   const coded=pack(oob?"0"+"0".repeat(codeLength)+(count+2).toString(2).padStart(codeLength,"0")+"00000":dh+"10"+"111111"+"00000");
   const rows=profile === "Huffman lower" || oob?1:profile === "Huffman upper"?count+low:low,dictionary=new Uint8Array(10+coded.length+rows+2),dv=new DataView(dictionary.buffer);
   dv.setUint16(0,oob?49:13);dv.setUint32(2,1);dv.setUint32(6,1);dictionary.set(coded,10);dictionary.fill(128,10+coded.length,10+coded.length+rows);dictionary.set(pack("00000"+"00001"),10+coded.length+rows);
   const region=new Uint8Array(39),rv=new DataView(region.buffer);rv.setUint32(0,64);rv.setUint32(4,1);rv.setUint16(17,16);rv.setUint32(19,1);
   const records=[bytes.subarray(0,30)];
   const tables=profile === "Huffman index"?height:1;
   for(let i=0;i<tables+2;i++) {const isTable=i<tables,payload=isTable?table:i===tables?dictionary:region,head=new Uint8Array(isTable?11:12),hv=new DataView(head.buffer);hv.setUint32(0,i+1);head[4]=isTable?53:i===tables?0:6;if(!isTable){head[5]=32;head[6]=i;}head[head.length-5]=1;hv.setUint32(head.length-4,payload.length);records.push(head,payload);}
   const input=new Uint8Array(records.reduce((n,record)=>n+record.length,0));let at=0;for(const record of records){input.set(record,at);at+=record.length;}bytes=input;
  }
  if(profile.endsWith("extended headers")) {
   const retention=Math.ceil((height+1)/8),input=new Uint8Array(30+14+retention+height*4);input.set(bytes.subarray(0,30));const view=new DataView(input.buffer);
   view.setUint32(30,0xfffffffe);input[34]=62;view.setUint32(35,0xe0000000+height);input[39+retention+height*4]=1;bytes=input;
   if(profile.startsWith("random")) {
    view.setUint32(15,height);
    const output=new Uint8Array(9+input.length+11);output.set([151,74,66,50,13,10,26,10,2]);output.set(input.subarray(0,11),9);output.set(input.subarray(30),20);
    const end=20+input.length-30;new DataView(output.buffer).setUint32(end,0xffffffff);output[end+4]=51;output.set(input.subarray(11,30),end+11);bytes=output;
   }
  }
  if(profile !== "random extended headers")new DataView(bytes.buffer).setUint32(15,height);
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
  if(profile.includes("symbols") || profile.startsWith("dictionary") || profile.startsWith("Huffman") || profile.startsWith("symbol ID"))expect(expected.some(value=>value!==255)).toBe(true);
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
 const image=await PdfRetainedJbig2.open(source,64,height,{bitmapStorage:storage,maxWorkingBytes:${profile.includes("refinement") ? 1048576 : (profile.includes("symbols") || profile.startsWith("dictionary") || profile.startsWith("Huffman") || profile.startsWith("symbol ID")) ? 524288 : 262144}});let sum=0,index=0;try{for await(const row of image.rows())for(const value of row)sum=(sum+value*(index++%65521+1))%1000000007;}finally{image.close();await storage.close();}
 return Response.json({sum,pixels:index,peak,opened,closed,decoderBytes:image.decoderBytes,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{await storage.close();for(const [name,Native]of originals)globalThis[name]=Native;}}};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 let backing=new Uint8Array();
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{
  INPUT:async(request:Request)=>{const url=new URL(request.url),at=Number(url.searchParams.get("at"));return new Response(inputs.get(Number(url.searchParams.get("height")))!.bytes.slice(at,at+Number(url.searchParams.get("length"))));},
  BACKING:async(request:Request)=>{const url=new URL(request.url),at=Number(url.searchParams.get("at"));if(request.method==="DELETE"){backing=new Uint8Array();return new Response();}if(request.method==="PUT"){const bytes=new Uint8Array(await request.arrayBuffer());if(at+bytes.length>backing.length){const next=new Uint8Array(Math.max(at+bytes.length,backing.length*2));next.set(backing);backing=next;}backing.set(bytes,at);return new Response();}return new Response(backing.slice(at,at+Number(url.searchParams.get("length"))));}
 }});
 let admission:number|undefined;
 try{for(const[height,input]of inputs){const response=await runtime.dispatchFetch("https://verify/",{method:"POST",body:JSON.stringify({height,length:input.bytes.length})});if(response.status!==200)throw Error(await response.text());
  const result=await response.json() as {sum:number;pixels:number;peak:number;opened:number;closed:number;decoderBytes:number;nodeGlobals:boolean};
  expect(result.pixels).toBe(64*height*4);expect(result.sum).toBe(input.sum);expect(result.peak).toBeLessThanOrEqual(65536);if(profile==="page")expect(result.opened).toBe(1);expect(result.closed).toBe(result.opened);expect(result.nodeGlobals).toBe(false);expect(backing.length).toBe(0);
  if(admission!==undefined)expect(result.decoderBytes).toBe(admission);admission=result.decoderBytes;
 }}finally{await runtime.dispose();}
});
