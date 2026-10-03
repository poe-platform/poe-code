import {readPngMetadataFromSource} from "./codecs/png-storage.js";
import {readJpegMetadataFromSource} from "./codecs/jpeg-input-storage.js";
import {readJpegMetadata} from "./codecs/jpeg.js";
import {expect,it} from "vitest";
import sharp from "./index.js";
import {readPngMetadata} from "./codecs/png.js";
import {buildExifApp1Segment} from "./codecs/exif.js";
import {makeChunk,PNG_SIGNATURE} from "./codecs/png-chunks.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";

function join(chunks:Uint8Array[]):Uint8Array {
 const bytes=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let at=0;
 for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
}
function png(depth:number,color:number,trns:boolean,interlace:number):Uint8Array {
 const header=new Uint8Array(13),view=new DataView(header.buffer);
 view.setUint32(0,17);view.setUint32(4,19);header[8]=depth;header[9]=color;header[12]=interlace;
 const phys=new Uint8Array(9);new DataView(phys.buffer).setUint32(0,5669);phys[8]=1;
 return join([PNG_SIGNATURE,makeChunk("IHDR",header),makeChunk("pHYs",phys),
 ...(trns?[makeChunk("tRNS",new Uint8Array())]:[]),makeChunk("eXIf",buildExifApp1Segment({orientation:6,density:144})),
 makeChunk("IDAT",Uint8Array.of(1,2,3)),makeChunk("IEND",new Uint8Array())]);
}
for(const depth of [1,2,4,8,16]) for(const color of [0,2,3,4,6]) for(const trns of [false,true]) {
 it(`preserves PNG metadata ${depth}/${color}/${trns}`,async()=>{
  const bytes=png(depth,color,trns,depth%2),expected=readPngMetadata(bytes);
  expect(expected).toMatchSnapshot();
  expect(await readPngMetadataFromSource(source(bytes),new AbortController().signal)).toEqual(expected);
 });
}
for(const length of [0,8,23,24,28,29,32,33,45,76,128]) it(`preserves truncated PNG metadata at ${length}`,async()=>{
 const input=png(8,6,false,0).subarray(0,length);
 let result:unknown;try {result=readPngMetadata(input);}catch(error){result=(error as Error).message;}
 expect(result).toMatchSnapshot();
 let actual:unknown;try{actual=await readPngMetadataFromSource(source(input),new AbortController().signal);}catch(error){actual=(error as Error).message;}
 expect(actual).toEqual(result);
});
for(const format of ["png","jpeg","webp","bmp","ppm","pgm","pbm"] as const) it(`reads file ${format} metadata without whole-file I/O or pixel storage`,async()=>{
 const fs=new MemoryFileSystem();
 const bytes=await sharp({create:{width:91,height:73,channels:3,background:"red"}}).toFormat(format).toBuffer();
 await fs.writeFile("/image",bytes);
 const expected=await sharp(bytes).metadata();
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile" || key==="writeFile" || key==="open")return ()=>{throw new Error("metadata must not buffer the file or allocate pixel storage");};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 expect(await sharp("/image",{filesystem:guarded}).metadata()).toEqual(expected);
});

function source(bytes:Uint8Array) {
 const borrowed=new Uint8Array(4096);
 return {size:bytes.length,async read(position:number,length:number){
  expect(length).toBeLessThanOrEqual(4096);borrowed.fill(0);borrowed.set(bytes.subarray(position,position+length));
  return borrowed.subarray(0,length);
 }};
}
for(const marker of [0xc0,0xc1,0xc2])for(const channels of [1,3,4])it(`preserves JPEG frame metadata ${marker}/${channels}`,async()=>{
 const segment=(marker:number,data:Uint8Array)=>join([Uint8Array.of(255,marker,(data.length+2)>>>8,(data.length+2)&255),data]);
 const bytes=join([Uint8Array.of(255,216),segment(0xe1,buildExifApp1Segment({orientation:8,density:300})),segment(marker,Uint8Array.of(8,1,2,3,4,channels)),Uint8Array.of(255,217)]);
 expect(await readJpegMetadataFromSource(source(bytes),new AbortController().signal)).toEqual(readJpegMetadata(bytes));
});
it("seeks across large PNG ancillary blocks and offset EXIF values with bounded reads",async()=>{
 const header=png(16,0,true,1).subarray(0,33),exif=new Uint8Array(256*1024),view=new DataView(exif.buffer);
 exif.set([73,73,42,0]);view.setUint32(4,200000,true);view.setUint16(200000,2,true);
 view.setUint16(200002,0x0112,true);view.setUint16(200004,3,true);view.setUint16(200010,7,true);
 view.setUint16(200014,0x011a,true);view.setUint16(200016,5,true);view.setUint32(200022,220000,true);
 view.setUint32(220000,240,true);view.setUint32(220004,1,true);
 const bytes=join([header,makeChunk("unknown",new Uint8Array(128*1024)),makeChunk("eXIf",exif),makeChunk("IDAT",new Uint8Array(256*1024)),makeChunk("IEND",new Uint8Array())]);
 expect(await readPngMetadataFromSource(source(bytes),new AbortController().signal)).toEqual(readPngMetadata(bytes));
});
for(const mode of ["read","cancel","changed","close"] as const)it(`closes metadata source on ${mode}`,async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),reason=new Error(mode);
 await fs.writeFile("/image",png(8,6,false,0));let closed=0,reads=0,callbackCount=0;
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile")return ()=>{throw new Error("whole-file I/O forbidden");};
  if(key==="openReadFile")return async(...args:Parameters<NonNullable<typeof fs.openReadFile>>)=>{
   const handle=await fs.openReadFile(...args);let stats=0;
   return {...handle,async read(...values:Parameters<typeof handle.read>){
    reads++;if(reads===2 && mode==="read")throw reason;if(reads===2 && mode==="cancel")controller.abort(reason);
    return handle.read(...values);
   },async stat(...values:Parameters<typeof handle.stat>){const value=await handle.stat(...values);return ++stats===2 && mode==="changed"?{...value,size:value.size+1}:value;},
   async close(){closed++;await handle.close();if(mode==="close")throw reason;}};
  };
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 const promise=sharp("/image",{filesystem:guarded,signal:controller.signal}).metadata(error=>{callbackCount++;expect(error).not.toBeNull();});
 if(mode==="changed")await expect(promise).rejects.toMatchObject({code:"EAGAIN"});else await expect(promise).rejects.toBe(reason);
 expect(closed).toBe(1);expect(callbackCount).toBe(1);
});
it("reads raw metadata from stat without reading samples",async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile("/raw",new Uint8Array(4096));
 const raw={width:17,height:19,channels:2 as const,depth:"ushort" as const};
 const expected=await sharp(new Uint8Array(4096),{raw}).metadata();
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile" || key==="open")return ()=>{throw new Error("metadata must not buffer");};
  if(key==="openReadFile")return async(...args:Parameters<NonNullable<typeof fs.openReadFile>>)=>{
   const handle=await fs.openReadFile(...args);return {...handle,async read(){throw new Error("raw metadata must not read samples");}};
  };
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 expect(await sharp("/raw",{raw,filesystem:guarded}).metadata()).toEqual(expected);
});
it("does not turn metadata inspection into an implicit file snapshot",async()=>{
 const fs=new MemoryFileSystem();
 await fs.writeFile("/image",await sharp({create:{width:7,height:9,channels:3,background:"red"}}).png().toBuffer());
 const image=sharp("/image",{filesystem:fs});expect((await image.metadata()).width).toBe(7);
 await fs.writeFile("/image",await sharp({create:{width:11,height:13,channels:3,background:"blue"}}).png().toBuffer());
 expect((await image.metadata()).width).toBe(11);expect((await image.png().toFile("/output.png")).width).toBe(11);
});

import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";
it("inspects externally retained metadata in Workerd without whole-file allocation",async()=>{
 const segment=(marker:number,data:Uint8Array)=>join([Uint8Array.of(255,marker,(data.length+2)>>>8,(data.length+2)&255),data]);
 const app=new Uint8Array(65533);app.set(buildExifApp1Segment({orientation:8,density:144}));
 const smallWebp=await sharp({create:{width:17,height:19,channels:4,background:"red"}}).webp().toBuffer();
 const largeWebp=new Uint8Array(smallWebp.length+8+256*1024);largeWebp.set(smallWebp.subarray(0,12));largeWebp.set([74,85,78,75],12);
 new DataView(largeWebp.buffer).setUint32(16,256*1024,true);largeWebp.set(smallWebp.subarray(12),20+256*1024);new DataView(largeWebp.buffer).setUint32(4,largeWebp.length-8,true);
 const gifFrames=524289,gif=new Uint8Array(14+gifFrames*23);gif.set([71,73,70,56,57,97,1,0,1,0,0,0,0]);
 for(let i=0;i<gifFrames;i++)gif.set([33,249,4,0,i&255,(i>>>8)&255,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0],13+i*23);gif[gif.length-1]=59;
 const cases=[
  {bytes:join([png(8,0,true,1).subarray(0,33),makeChunk("tEXt",new Uint8Array(256*1024)),makeChunk("IEND",new Uint8Array())]),options:{}},
  {bytes:join([Uint8Array.of(255,216),segment(0xe1,app),segment(0xe1,app),segment(0xe1,app),segment(0xc2,Uint8Array.of(8,1,3,3,5,3)),Uint8Array.of(255,217)]),options:{}},
  {bytes:new Uint8Array(256*1024),options:{raw:{width:257,height:129,channels:2 as const,depth:"ushort" as const}}},
  {bytes:new TextEncoder().encode("P6\n#"+"x".repeat(256*1024)+"\n17 19\n65535\n"),options:{}},
  {bytes:await sharp({create:{width:1024,height:64,channels:3,background:"red"}}).bmp().toBuffer(),options:{}},
  {bytes:largeWebp,options:{}},
  {bytes:await sharp({create:{width:531,height:513,channels:4,background:"red"}}).tiff().toBuffer(),options:{}},
  {bytes:await sharp({create:{width:531,height:513,channels:4,background:"red"}}).png().toBuffer(),options:{},transform:true},
  {bytes:gif,options:{},inspect:true}
 ];
 const expected=await Promise.all(cases.map(async sample=>{
  const metadata=await (sample.transform?sharp(sample.bytes,sample.options).resize(401,257).withMetadata({density:144,orientation:6}):sharp(sample.bytes,sample.options)).metadata();
  if(!sample.inspect)return metadata;const {delay,...fields}=metadata;return {...fields,count:delay!.length,first:delay![0],last:delay!.at(-1)};
 }));
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../",import.meta.url)),sourcefile:"metadata-worker.ts",contents:`
 import sharp from './packages/image-ast/src/index.ts';
 export default {async fetch(request,env){
  const {id,size,options,transform,inspect}=await request.json();let reads=0,closed=0,scratchClosed=0,scratchWrites=0,largestAllocation=0;const scope={};
  const filesystem={capabilities:{retainedRead:true},
   async stat(){return {type:'directory'};},async removeFileConditional(){},async open(){return {
    capabilities:{positionedRead:true,positionedWrite:true},async stat(){return {type:'file',size:0};},
    async write(bytes,position){if(bytes.length>16384)throw new Error('large scratch write');scratchWrites++;const response=await env.SCRATCH.fetch('https://scratch/'+id+'?position='+position,{method:'PUT',body:bytes});if(!response.ok)throw new Error('scratch write failed');return bytes.length;},
    async read(bytes,position){if(bytes.length>16384)throw new Error('large scratch read');const response=await env.SCRATCH.fetch('https://scratch/'+id+'?position='+position+'&length='+bytes.length);if(!response.ok)throw new Error('scratch read failed');bytes.set(new Uint8Array(await response.arrayBuffer()));return bytes.length;},
    async close(){scratchClosed++;}
   };},readFile(){throw new Error('whole-file read');},writeFile(){throw new Error('metadata write');},async openReadFile(){return {
   async stat(){return {type:'file',size,mode:420,mtimeMs:1,atimeMs:1,ctimeMs:1,identityScope:scope,opaqueIdentity:String(id),opaqueVersion:'v1'};},
   async read(position,length){if(length>4096)throw new Error('large transfer');reads++;const response=await env.SOURCE.fetch('https://source/'+id+'?position='+position+'&length='+length);if(!response.ok)throw new Error('source failed');return new Uint8Array(await response.arrayBuffer());},
   async close(){closed++;}
  };}};
  const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;largestAllocation=Math.max(largestAllocation,length);if(length>65536)throw new Error('unbounded metadata allocation');return Reflect.construct(target,args);}});
  let metadata;try{const input=sharp('/image',{...options,filesystem});metadata=inspect?await input.inspectMetadata(async meta=>{const {storedDelay,delay,...fields}=meta;if(delay!==undefined)throw new Error("materialized delays");return {...fields,count:storedDelay.length,first:await storedDelay.at(0),last:await storedDelay.at(storedDelay.length-1)};}):await (transform?input.resize(401,257).withMetadata({density:144,orientation:6}):input).metadata();}finally{globalThis.Uint8Array=Native;}
  return Response.json({metadata,reads,closed,scratchClosed,scratchWrites,largestAllocation,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 expect(Object.keys(bundle.metafile!.inputs).some(input=>input.startsWith("node:"))).toBe(false);
 const scratch=new Map<string,Uint8Array>();
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{SCRATCH:async request=>{
  const url=new URL(request.url),position=Number(url.searchParams.get("position")),key=url.pathname+":"+position;
  if(request.method==="PUT"){const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.length>16384)return new Response(null,{status:400});scratch.set(key,bytes);return new Response();}
  const length=Number(url.searchParams.get("length"));return new Response(scratch.get(key)?.slice(0,length)??new Uint8Array(length));
 },SOURCE:async request=>{
  const url=new URL(request.url),id=Number(url.pathname.slice(1)),position=Number(url.searchParams.get("position")),length=Number(url.searchParams.get("length"));
  if(!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(length)||length<0||length>4096)return new Response(null,{status:400});
  return new Response(cases[id]!.bytes.slice(position,position+length));
 }}});
 try {
  for(const [id,sample] of cases.entries()) {
   const response=await runtime.dispatchFetch("https://metadata/",{method:"POST",body:JSON.stringify({id,size:sample.bytes.length,options:sample.options,transform:sample.transform,inspect:sample.inspect})});
   expect(response.status).toBe(200);
   const result=await response.json() as {metadata:unknown;reads:number;closed:number;scratchClosed:number;scratchWrites:number;largestAllocation:number;nodeGlobals:boolean};
   if(id>=6){expect(result.scratchClosed).toBe(1);expect(result.scratchWrites).toBeGreaterThan(64);}else expect(result.scratchClosed).toBe(0);
   expect(result.metadata).toEqual(expected[id]);expect(result.closed).toBe(1);expect(result.nodeGlobals).toBe(false);
   expect(result.largestAllocation).toBeLessThanOrEqual(id===5?4096:65536);if(id===2)expect(result.reads).toBe(0);else expect(result.reads).toBeGreaterThan(0);
  }
 } finally {await runtime.dispose();}
},15000);

import {readImageMetadataFromSource} from "./codecs/metadata-source.js";
import {readImageMetadata} from "./codecs/index.js";
for(const magic of ["P1","P2","P3","P4","P5","P6"])for(const end of ["\n","\r\n"," # final comment\r\n"])it(`preserves Netpbm metadata ${magic}/${JSON.stringify(end)}`,async()=>{
 const bytes=new TextEncoder().encode(`${magic}\n# header comment\n17\t19\n${magic==="P1"||magic==="P4"?"":"65535"}${end}1 0 1`);
 expect(await readImageMetadataFromSource(source(bytes),new AbortController().signal)).toEqual(readImageMetadata(bytes));
});
for(const format of ["png","jpeg","bmp","ppm","tiff"] as const)it(`preserves ${format} pixel admission during file metadata`,async()=>{
 const fs=new MemoryFileSystem();
 const bytes=await sharp({create:{width:31,height:19,channels:3,background:"red"}}).toFormat(format).toBuffer();await fs.writeFile("/image",bytes);
 await expect(sharp("/image",{filesystem:fs,limitInputPixels:1}).metadata()).rejects.toThrow("Input image exceeds pixel limit");
});

for(const compression of ["none","deflate","lzw","packbits"] as const) it(`reads TIFF ${compression} metadata through caller backing`,async()=>{
 const fs=new MemoryFileSystem();
 const bytes=await sharp({create:{width:531,height:513,channels:4,background:"red"}}).tiff({compression}).toBuffer();
 await fs.writeFile("/image",bytes);let opened=0,closed=0;
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile" || key==="writeFile")return ()=>{throw new Error("whole-file metadata I/O forbidden");};
  if(key==="open")return async(...args:Parameters<typeof fs.open>)=>{
   const handle=await fs.open(...args);opened++;
   return new Proxy(handle,{get(target,key){if(key==="close")return async(...values:Parameters<typeof handle.close>)=>{closed++;return handle.close(...values);};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  };
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 expect(await sharp("/image",{filesystem:guarded}).metadata()).toEqual(await sharp(bytes).metadata());
 expect(opened).toBeGreaterThan(0);expect(closed).toBe(opened);
});

for(const mode of ["success","write","read","cancel","close"] as const) it(`owns spilled TIFF metadata handles on ${mode}`,async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),failure=new Error(`injected ${mode}`);
 await fs.mkdir("/scratch");
 const bytes=await sharp({create:{width:2053,height:129,channels:4,background:"red"}}).tiff().toBuffer();
 await fs.writeFile("/input.tiff",bytes);
 const expected=await sharp(bytes).metadata();
 let sourceHandles=0,scratchHandles=0,opens=0,reads=0,writes=0;
 const guarded=new Proxy(fs,{get(target,key){
  if(key==="readFile" || key==="writeFile") return ()=>{throw new Error("whole-file I/O forbidden");};
  if(key==="openReadFile") return async(...args:Parameters<NonNullable<typeof fs.openReadFile>>)=>{
   const handle=await fs.openReadFile(...args);sourceHandles++;
   return {...handle,async close(){sourceHandles--;await handle.close();}};
  };
  if(key==="open") return async(...args:Parameters<typeof fs.open>)=>{
   expect(args[0].startsWith("/scratch/.storage-")).toBe(true);
   const handle=await fs.open(...args);scratchHandles++;opens++;
   return new Proxy(handle,{get(retained,method){
    if(method==="write") return async(...values:Parameters<typeof handle.write>)=>{
     writes++;
     if(writes===2 && mode==="write") throw failure;
     if(writes===2 && mode==="cancel") controller.abort(failure);
     return handle.write(...values);
    };
    if(method==="read") return async(...values:Parameters<typeof handle.read>)=>{
     reads++;if(reads===2 && mode==="read") throw failure;return handle.read(...values);
    };
    if(method==="close") return async()=>{scratchHandles--;await handle.close();if(mode==="close") throw failure;};
    const value=Reflect.get(retained,method,retained);return typeof value==="function"?value.bind(retained):value;
   }});
  };
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 let callbackCount=0;
 const result=sharp("/input.tiff",{filesystem:guarded,workingDirectory:"/scratch",signal:controller.signal}).metadata((error,value)=>{
  callbackCount++;if(mode==="success"){expect(error).toBeNull();expect(value).toEqual(expected);}else expect(error).toBe(failure);
 });
 if(mode==="success") expect(await result).toEqual(expected);else await expect(result).rejects.toBe(failure);
 expect(callbackCount).toBe(1);expect(opens).toBe(1);expect(sourceHandles).toBe(0);expect(scratchHandles).toBe(0);
 expect(await fs.readdir("/scratch")).toEqual([]);
 expect(await fs.readFile("/input.tiff")).toEqual(bytes);
});
