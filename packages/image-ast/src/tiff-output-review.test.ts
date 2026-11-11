import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import type {FileSystem} from "@poe-code/safe-fs/contracts";
import type {RgbaImage} from "./ast.js";
import sharp from "./index.js";
import {decodeTiffImage,encodeTiffImage} from "./codecs/netpbm.js";
import {encodeTiffFromStorage} from "./codecs/tiff-storage.js";
// TIFF byte vectors include a single-page PageNumber tag.
// Supply density explicitly to retain those resolution tags.
const vectors:{image:Omit<RgbaImage,"data">;options:{density?:number;orientation?:number};hash:string}[]=[
{"image":{"width":67,"height":19,"channels":1,"space":"srgb","depth":"uchar","format":"raw","hasAlpha":false,"density":72},"options":{},"hash":"e104b3bc828b5df17589408eadfb96761007fbeb2c7740b2135fb2d54c02ab7a"},
{"image":{"width":67,"height":19,"channels":1,"space":"rgb16","depth":"uchar","format":"raw","hasAlpha":false,"density":-10,"orientation":2},"options":{},"hash":"bde6e6c89138abe95fae5304dc164ef6db9be7528793e181acc8e63d71ea8eae"},
{"image":{"width":67,"height":19,"channels":1,"space":"srgb","depth":"uchar","format":"raw","hasAlpha":false,"density":300,"orientation":4},"options":{"density":1,"orientation":4},"hash":"4090d3344403f8ec56ac906633f790cf184d042806213a1f2f10f4566f42fc36"},
{"image":{"width":67,"height":19,"channels":1,"space":"rgb16","depth":"uchar","format":"raw","hasAlpha":false,"density":72,"orientation":6},"options":{"density":450,"orientation":2},"hash":"6f97d28a3b204ed811dc1a3d42b6fa5ca209d7a02e3209a377bdc798c5e3ed9f"},
{"image":{"width":67,"height":19,"channels":2,"space":"srgb","depth":"uchar","format":"raw","hasAlpha":true,"density":72},"options":{},"hash":"e104b3bc828b5df17589408eadfb96761007fbeb2c7740b2135fb2d54c02ab7a"},
{"image":{"width":67,"height":19,"channels":2,"space":"rgb16","depth":"uchar","format":"raw","hasAlpha":true,"density":-10,"orientation":2},"options":{},"hash":"bde6e6c89138abe95fae5304dc164ef6db9be7528793e181acc8e63d71ea8eae"},
{"image":{"width":67,"height":19,"channels":2,"space":"srgb","depth":"uchar","format":"raw","hasAlpha":true,"density":300,"orientation":4},"options":{"density":1,"orientation":4},"hash":"4090d3344403f8ec56ac906633f790cf184d042806213a1f2f10f4566f42fc36"},
{"image":{"width":67,"height":19,"channels":2,"space":"rgb16","depth":"uchar","format":"raw","hasAlpha":true,"density":72,"orientation":6},"options":{"density":450,"orientation":2},"hash":"6f97d28a3b204ed811dc1a3d42b6fa5ca209d7a02e3209a377bdc798c5e3ed9f"},
{"image":{"width":67,"height":19,"channels":3,"space":"srgb","depth":"uchar","format":"raw","hasAlpha":false,"density":72},"options":{},"hash":"e104b3bc828b5df17589408eadfb96761007fbeb2c7740b2135fb2d54c02ab7a"},
{"image":{"width":67,"height":19,"channels":3,"space":"rgb16","depth":"uchar","format":"raw","hasAlpha":false,"density":-10,"orientation":2},"options":{},"hash":"bde6e6c89138abe95fae5304dc164ef6db9be7528793e181acc8e63d71ea8eae"},
{"image":{"width":67,"height":19,"channels":3,"space":"srgb","depth":"uchar","format":"raw","hasAlpha":false,"density":300,"orientation":4},"options":{"density":1,"orientation":4},"hash":"4090d3344403f8ec56ac906633f790cf184d042806213a1f2f10f4566f42fc36"},
{"image":{"width":67,"height":19,"channels":3,"space":"rgb16","depth":"uchar","format":"raw","hasAlpha":false,"density":72,"orientation":6},"options":{"density":450,"orientation":2},"hash":"6f97d28a3b204ed811dc1a3d42b6fa5ca209d7a02e3209a377bdc798c5e3ed9f"},
{"image":{"width":67,"height":19,"channels":4,"space":"srgb","depth":"uchar","format":"raw","hasAlpha":true,"density":72},"options":{},"hash":"e104b3bc828b5df17589408eadfb96761007fbeb2c7740b2135fb2d54c02ab7a"},
{"image":{"width":67,"height":19,"channels":4,"space":"rgb16","depth":"uchar","format":"raw","hasAlpha":true,"density":-10,"orientation":2},"options":{},"hash":"bde6e6c89138abe95fae5304dc164ef6db9be7528793e181acc8e63d71ea8eae"},
{"image":{"width":67,"height":19,"channels":4,"space":"srgb","depth":"uchar","format":"raw","hasAlpha":true,"density":300,"orientation":4},"options":{"density":1,"orientation":4},"hash":"4090d3344403f8ec56ac906633f790cf184d042806213a1f2f10f4566f42fc36"},
{"image":{"width":67,"height":19,"channels":4,"space":"rgb16","depth":"uchar","format":"raw","hasAlpha":true,"density":72,"orientation":6},"options":{"density":450,"orientation":2},"hash":"6f97d28a3b204ed811dc1a3d42b6fa5ca209d7a02e3209a377bdc798c5e3ed9f"},
];
function backing(image:Omit<RgbaImage,"data">=vectors[0]!.image){const data=Uint8Array.from({length:image.width*image.height*4},(_,i)=>(i*43+Math.floor(i/7))%256),borrowed=new Uint8Array(4096),storage={allocate:vi.fn(()=>{throw new Error("encode cannot allocate storage");}),write:vi.fn(async()=>{throw new Error("encode cannot write storage");}),read:vi.fn(async(position:number,length:number)=>{if(length>4096||position<8||position+length>data.length+8)throw new Error("invalid backing read");borrowed.fill(37);borrowed.set(data.subarray(position-8,position-8+length));return borrowed.subarray(0,length);})};return {data,storage,image:{...image,position:8}};}
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
it.each(vectors.filter(vector=>vector.image.hasAlpha))("matches TIFF byte vector channel=$image.channels density=$image.density orientation=$image.orientation overrides=$options",async vector=>{const {data,storage,image}=backing(vector.image),hash=createHash("sha256"),options={density:vector.image.density??72,...vector.options};for await(const bytes of encodeTiffFromStorage(image,storage,new AbortController().signal,options))hash.update(bytes);expect(hash.digest("hex")).toBe(vector.hash);expect(digest(encodeTiffImage({...vector.image,data,data16:new Uint16Array(data.length).fill(65535)},options))).toBe(vector.hash);expect(storage.allocate).not.toHaveBeenCalled();expect(storage.write).not.toHaveBeenCalled();});
it("owns bounded output chunks and honours pull demand and early return",async()=>{const {data,storage,image}=backing({...vectors[0]!.image,width:5001,height:3}),copy=new Uint8Array(data),Original=Uint8Array;
 vi.stubGlobal("Uint8Array",new Proxy(Original,{construct(target,args){const length=typeof args[0]==="number"?args[0]:args[0]?.length??0;if(length>4096)throw new Error("unbounded TIFF bytes");return Reflect.construct(target,args);}}));
 try{const stream=encodeTiffFromStorage(image,storage,new AbortController().signal);await stream.next();expect(storage.read).not.toHaveBeenCalled();const first=await stream.next(),owned=new Uint8Array(first.value!);await stream.next();expect(first.value).toEqual(owned);const reads=storage.read.mock.calls.length;await stream.return(undefined);await stream.next();expect(storage.read).toHaveBeenCalledTimes(reads);expect(data).toEqual(copy);}finally{vi.unstubAllGlobals();}
});
it.each(["start","header","read","directory"])("preserves TIFF %s cancellation",async phase=>{const {storage,image}=backing({...vectors[0]!.image,width:1,height:1}),controller=new AbortController(),reason={phase};if(phase==="start")controller.abort(reason);if(phase==="read"){const read=storage.read.getMockImplementation()!;storage.read.mockImplementationOnce(async(position,length)=>{const bytes=await read(position,length);controller.abort(reason);return bytes;});}const stream=encodeTiffFromStorage(image,storage,controller.signal);if(phase!=="start")await stream.next();if(phase==="directory")await stream.next();if(phase!=="read")controller.abort(reason);await expect(stream.next()).rejects.toBe(reason);expect(storage.read).toHaveBeenCalledTimes(phase==="directory"||phase==="read"?1:0);});
it.each(["short","throw"])("propagates TIFF %s backing failure",async kind=>{const {storage,image}=backing(),reason=new Error("backing failed");if(kind==="short")storage.read.mockResolvedValueOnce(new Uint8Array(1));else storage.read.mockRejectedValueOnce(reason);const stream=encodeTiffFromStorage(image,storage,new AbortController().signal);await stream.next();if(kind==="short")await expect(stream.next()).rejects.toThrow("Truncated TIFF backing storage");else await expect(stream.next()).rejects.toBe(reason);});
it.each([{width:0},{height:1.5},{position:-1},{position:Number.MAX_SAFE_INTEGER}])("rejects invalid TIFF backing dimensions %j",async invalid=>{const {storage,image}=backing(),stream=encodeTiffFromStorage({...image,...invalid},storage,new AbortController().signal);await expect(stream.next()).rejects.toThrow();expect(storage.read).not.toHaveBeenCalled();});
it.each([1073741776,1073741824])("rejects unrepresentable classic TIFF width %i before yielding a header",async width=>{const {storage,image}=backing(),stream=encodeTiffFromStorage({...image,width,height:1,hasAlpha:true},storage,new AbortController().signal);await expect(stream.next()).rejects.toThrow();expect(storage.read).not.toHaveBeenCalled();});
function guarded(fs:MemoryFileSystem,overrides:Partial<FileSystem>={}):FileSystem{return new Proxy(fs,{get(target,key){if(Object.hasOwn(overrides,key))return Reflect.get(overrides,key);if(key==="readFile"||key==="writeFile")return()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});}
it.each(["tif","tiff"])("infers .%s output and preserves exact bytes",async extension=>{const fs=new MemoryFileSystem(),bytes=sharp({create:{width:19,height:11,channels:4,noise:{type:"gaussian",mean:80,sigma:40}}}).png().toBufferSync();await fs.writeFile("/in",bytes);const expected=sharp(bytes).flip().tiff().toBufferWithObjectSync(),actual=await sharp("/in",{filesystem:guarded(fs)}).flip().toFile(`/out.${extension}`);expect(actual).toEqual(expected.info);expect(await fs.readFile(`/out.${extension}`)).toEqual(expected.data);});
it("preserves destination when TIFF backing reads fail during publication",async()=>{const fs=new MemoryFileSystem(),bytes=sharp({create:{width:513,height:513,channels:4,background:"red"}}).png().toBufferSync();await fs.writeFile("/in",bytes);await fs.writeFile("/out.tiff",Uint8Array.of(42));const reason=new Error("scratch read failure");let closed=0,opened=0;
 const filesystem=guarded(fs,{open:async(...args)=>{const descriptor=await fs.open(...args);opened++;return new Proxy(descriptor,{get(target,key){if(key==="read")return async()=>{throw reason;};if(key==="close")return async()=>{closed++;await descriptor.close();};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});}});
 await expect(sharp("/in",{filesystem}).toFile("/out.tiff")).rejects.toBe(reason);expect(opened).toBeGreaterThan(0);expect(closed).toBe(opened);expect(await fs.readFile("/out.tiff")).toEqual(Uint8Array.of(42));expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in","out.tiff"]);
});
it("admits the largest one-row layout that fits classic TIFF without reading the raster",async()=>{const {storage,image}=backing(),stream=encodeTiffFromStorage({...image,width:1073741775,height:1,hasAlpha:true},storage,new AbortController().signal),first=await stream.next();expect(first.done).toBe(false);expect(new DataView(first.value!.buffer,first.value!.byteOffset,first.value!.byteLength).getUint32(4,true)).toBe(4294967108);expect(storage.read).not.toHaveBeenCalled();await stream.return(undefined);});
it("rejects unrepresentable buffered TIFF layout before allocating pixel output",()=>{const {image}=backing(),Original=Uint8Array;vi.stubGlobal("Uint8Array",new Proxy(Original,{construct(target,args){if(typeof args[0]==="number"&&args[0]>4096)throw new Error("unbounded allocation");return Reflect.construct(target,args);}}));try{expect(()=>encodeTiffImage({...image,width:1073741776,height:1,hasAlpha:true,data:new Uint8Array()})).toThrow("TIFF layout exceeds classic TIFF offsets");}finally{vi.unstubAllGlobals();}});

for(const space of ["b-w","grey16","srgb"] as const) {
 it.each([false,true])(`preserves ${space} TIFF samples and alpha=%s across storage chunks`,async hasAlpha=>{
  const {data,storage,image}=backing({...vectors[0]!.image,width:1025,height:1,space,hasAlpha,channels:space==="srgb"?hasAlpha?4:3:hasAlpha?2:1});
  const buffered=encodeTiffImage({...image,data});
  expect(new DataView(buffered.buffer).getUint32(4,true)%2).toBe(0);
  const chunks:Uint8Array[]=[];
  for await(const bytes of encodeTiffFromStorage(image,storage,new AbortController().signal)) chunks.push(bytes);
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(buffered));
  expect(decodeTiffImage(buffered)).toMatchObject({space:space==="srgb"?"srgb":"b-w",channels:space==="srgb"?hasAlpha?4:3:hasAlpha?2:1,hasAlpha});
  const expected=new Uint8Array(data.length);
  for(let i=0;i<data.length;i+=4) {
   expected[i]=data[i]!;
   expected[i+1]=data[i+(space==="srgb"?1:0)]!;
   expected[i+2]=data[i+(space==="srgb"?2:0)]!;
   expected[i+3]=hasAlpha?data[i+3]!:255;
  }
  expect(decodeTiffImage(buffered).data).toEqual(expected);
 });
}
it.each([false,true])("reports grayscale TIFF output channels with alpha=%s",async hasAlpha=>{
 const fs=new MemoryFileSystem(),input=sharp({create:{width:3,height:1,channels:hasAlpha?4:3,background:"red"}}).png().toBufferSync();
 await fs.writeFile("/in.png",input);
 const buffered=sharp(input).greyscale().tiff().toBufferWithObjectSync();
 const stored=await sharp("/in.png",{filesystem:guarded(fs)}).greyscale().toFile("/out.tiff");
 expect(buffered.info.channels).toBe(hasAlpha?2:1);
 expect(stored).toEqual(buffered.info);
 expect(await fs.readFile("/out.tiff")).toEqual(buffered.data);
});
