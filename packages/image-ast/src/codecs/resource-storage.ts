import type {SharpInputOptions} from "../ast.js";
import type {ImageByteSource,ImageByteStorage,StoredRgbaImage} from "./png-storage.js";
import {CreatedPixels} from "./create-pixels.js";
import {decodeImage} from "./index.js";
import {defaultRuntime} from "@poe-code/compression";

/** Resource rasters consumed by compositing and channel operations use RGBA8. */
export async function decodeRawResource(source:ImageByteSource,storage:ImageByteStorage,options:SharpInputOptions & {raw:NonNullable<SharpInputOptions["raw"]>},signal:AbortSignal):Promise<StoredRgbaImage> {
 signal.throwIfAborted();
 const {width,height,channels,depth,pageHeight}=options.raw;
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(width*height*4)||!Number.isSafeInteger(source.size)||source.size<0||![1,2,3,4].includes(channels)) throw new RangeError("Invalid raw resource dimensions");
 const sampleBytes=depth==="double"?8:depth==="float"||depth==="uint"||depth==="int"?4:depth==="ushort"||depth==="short"?2:1;
 const pixelBytes=channels*sampleBytes,count=width*height;
 if(!Number.isSafeInteger(count*pixelBytes)) throw new RangeError("Invalid raw resource dimensions");
 const position=storage.allocate(count*4);
 if(!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(position+count*4)) throw new RangeError("Invalid image backing allocation");
 for(let offset=0;offset<count;offset+=128) {
  signal.throwIfAborted();if(offset%16384===0) await defaultRuntime.yieldTurn(signal);
  const pixels=Math.min(128,count-offset),start=offset*pixelBytes,length=Math.min(pixels*pixelBytes,Math.max(0,source.size-start));
  const borrowed=length?await source.read(start,length,{signal}):new Uint8Array();signal.throwIfAborted();
  if(!(borrowed instanceof Uint8Array)||borrowed.length!==length) throw new Error("Truncated raw backing source");
  const chunk=decodeImage(new Uint8Array(borrowed),{raw:{...options.raw,width:pixels,height:1}});
  await storage.write(position+offset*4,chunk.data,{signal});signal.throwIfAborted();
 }
 return {width,height,position,channels,format:"raw",space:channels<3?"b-w":"srgb",depth:"uchar",density:options.density??72,hasAlpha:channels===2||channels===4,...(pageHeight!==undefined?{pageHeight,pages:Math.max(1,Math.floor(height/pageHeight))}:{})};
}
export async function createStoredResource(storage:ImageByteStorage,options:SharpInputOptions & {create:NonNullable<SharpInputOptions["create"]>},signal:AbortSignal):Promise<StoredRgbaImage> {
 signal.throwIfAborted();
 const source=new CreatedPixels(options),{width,height}=source.metadata;
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(width*height*4)) throw new RangeError("Invalid generated resource dimensions");
 const length=width*height*4,position=storage.allocate(length),buffer=new Uint8Array(4096);
 if(!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(position+length)) throw new RangeError("Invalid image backing allocation");
 for(let offset=0;offset<length;offset+=buffer.length) {
  signal.throwIfAborted();if(offset%65536===0) await defaultRuntime.yieldTurn(signal);
  const chunk=buffer.subarray(0,Math.min(buffer.length,length-offset));source.fill(chunk);
  await storage.write(position+offset,chunk,{signal});signal.throwIfAborted();
 }
 return {...source.metadata,position};
}
