import type {ImageAstNode,OutputEncodeOptions,RgbaImage} from "../ast.js";
import type {ImageByteStorage,StoredRgbaImage} from "./png-storage.js";
import {encodeImage} from "./index.js";
import {defaultRuntime} from "@poe-code/compression";

/** Match Sharp's raw-output channel expansion, shared by both terminal APIs. */
export function prepareRawOutput<T extends Pick<RgbaImage,"channels"|"space"|"hasAlpha">>(image:T,nodes:readonly ImageAstNode[]):T {
 if((image.channels===2 || (image.channels===1 && nodes.some(n=>n.kind==="removeAlpha"||n.kind==="flatten"))) &&
  !nodes.some(n=>(n.kind==="toColorspace"&&n.space==="b-w")||n.kind==="grayscale"||n.kind==="joinChannel"||n.kind==="extractChannel"))
  return {...image,space:"srgb",channels:image.hasAlpha?4:3};
 return image;
}

/** Encode owned chunks from caller-backed samples; no source or storage is acquired here. */
export async function* encodeRawFromStorage(image:StoredRgbaImage,storage:ImageByteStorage,signal:AbortSignal,options:OutputEncodeOptions={}):AsyncGenerator<Uint8Array> {
 signal.throwIfAborted();
 image={...image,...(image.storedData16?{storedData16:{...image.storedData16}}:{})};options={...options};
 const count=image.width*image.height,original=image.storedData16;
 if(![image.width,image.height,count*4].every(n=>Number.isSafeInteger(n)&&n>0) ||
  ![image.position,image.position+count*4,...(original?[original.position,original.length,original.position+original.length*2]:[])].every(n=>Number.isSafeInteger(n)&&n>=0))
  throw new RangeError("Invalid raw backing allocation");
 for(let offset=0;offset<count;offset+=512){
  signal.throwIfAborted();if(offset%16384===0)await defaultRuntime.yieldTurn(signal);
  const pixels=Math.min(512,count-offset),length=pixels*4;
  const borrowed=await storage.read(image.position+offset*4,length,{signal});signal.throwIfAborted();
  if(!(borrowed instanceof Uint8Array)||borrowed.length!==length)throw new Error("Truncated raw pixel storage");
  const data=new Uint8Array(borrowed);let data16:Uint16Array|undefined;
  if(image.storedData16 && (image.space==="rgb16"||image.space==="grey16")){
   data16=new Uint16Array(length);
   const available=Math.max(0,Math.min(length,image.storedData16.length-offset*4));
   if(available){
    const samples=await storage.read(image.storedData16.position+offset*8,available*2,{signal});signal.throwIfAborted();
    if(!(samples instanceof Uint8Array)||samples.length!==available*2)throw new Error("Truncated raw sample storage");
    new Uint8Array(data16.buffer).set(samples);
   }
  }
  yield encodeImage({...image,width:pixels,height:1,data,...(data16?{data16}:{})},{...options,format:"raw"}).data;
 }
}
