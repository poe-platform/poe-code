import {defaultRuntime} from "@poe-code/compression";
import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import {NormalizationHistogram,normalizeRgb} from "./normalize.js";

export async function normalizeStoredImage(image:StoredRgbaImage,storage:ImageByteStorage,options:{readonly lower?:number;readonly upper?:number},signal:AbortSignal):Promise<StoredRgbaImage> {
  const length=image.width*image.height*4;
  let work=0;
  const read=async(offset:number):Promise<Uint8Array>=>{
    signal.throwIfAborted();
    if(++work%16===0) await defaultRuntime.yieldTurn(signal);
    const count=Math.min(4096,length-offset);
    const bytes=await storage.read(image.position+offset,count,{signal});
    signal.throwIfAborted();
    if(!(bytes instanceof Uint8Array) || bytes.length!==count) throw new Error("Truncated image backing storage");
    return new Uint8Array(bytes);
  };
  const histogram=new NormalizationHistogram(image.width*image.height);
  for(let offset=0;offset<length;offset+=4096) {
    const bytes=await read(offset);
    for(let i=0;i<bytes.length;i+=4) histogram.add(bytes[i]!,bytes[i+1]!,bytes[i+2]!);
  }
  const scale=histogram.scale(options);
  if(!scale) return image;
  const position=storage.allocate(length);
  for(let offset=0;offset<length;offset+=4096) {
    const bytes=await read(offset);
    for(let i=0;i<bytes.length;i+=4) bytes.set(normalizeRgb(bytes[i]!,bytes[i+1]!,bytes[i+2]!,scale),i);
    await storage.write(position+offset,bytes,{signal});
    signal.throwIfAborted();
  }
  return {...image,position};
}
