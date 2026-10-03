import {readSvgMetadataFromSource} from "./svg-metadata-source.js";
import {svgSourcePixels} from "./svg-source-raster.js";
import type {SvgPixel} from "./svg-renderer.js";
import {defaultRuntime} from "@poe-code/compression";
import type {ImageMetadata,SharpInputOptions} from "../ast.js";
import {checkLimitInputPixels} from "../limits.js";
import type {ImageByteSource,ImageByteStorage,StoredRgbaImage} from "./png-storage.js";
import {blendSvgPixel,readSvgMetadata,svgRasterSteps} from "./svg-pdf.js";

/** Raster surface is caller-owned. Encoded SVG syntax is still supplied as bytes. */
export async function decodeSvgToStorage(bytes:Uint8Array,storage:ImageByteStorage,signal:AbortSignal,options?:SharpInputOptions):Promise<StoredRgbaImage> {
 signal.throwIfAborted();const metadata=readSvgMetadata(bytes,options);checkLimitInputPixels(metadata.width,metadata.height,options);
 const steps=svgRasterSteps(bytes,options,metadata),first=steps.next();
 // Own syntax before the first asynchronous caller-storage operation.
 function* pixels():Generator<SvgPixel|undefined>{try{if(!first.done)yield first.value;yield* steps;}finally{steps.return();}}
 try{return await storeSvgPixels(metadata,pixels(),storage,signal,options);}finally{steps.return();}
}

export async function decodeSvgSourceToStorage(source:ImageByteSource,storage:ImageByteStorage,signal:AbortSignal,options?:SharpInputOptions):Promise<StoredRgbaImage>{
 const metadata=await readSvgMetadataFromSource(source,signal,options);
 return storeSvgPixels(metadata,svgSourcePixels(source,storage,signal,metadata),storage,signal,options);
}

async function storeSvgPixels(metadata:ImageMetadata,pixels:Iterable<SvgPixel|undefined>|AsyncIterable<SvgPixel|undefined>,storage:ImageByteStorage,signal:AbortSignal,options?:SharpInputOptions):Promise<StoredRgbaImage>{
 signal.throwIfAborted();const {width,height}=metadata,length=width*height*4;
 checkLimitInputPixels(width,height,options);
 if(![width,height,length].every(value=>Number.isSafeInteger(value)&&value>0))throw new RangeError("Invalid SVG surface dimensions");
 const position=storage.allocate(length);
 if(!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(position+length))throw new RangeError("Invalid SVG backing allocation");
 const zero=new Uint8Array(4096);
 for(let offset=0;offset<length;offset+=4096){
  signal.throwIfAborted();if(offset%65536===0)await defaultRuntime.yieldTurn(signal);
  await storage.write(position+offset,zero.subarray(0,Math.min(4096,length-offset)),{signal});signal.throwIfAborted();
 }
 const pages=new Map<number,Uint8Array>();let work=0;
  for await(const pixel of pixels){
   if(!pixel){await defaultRuntime.yieldTurn(signal);continue;}
   const [x,y,r,g,b,a]=pixel;
   signal.throwIfAborted();if(++work%16384===0)await defaultRuntime.yieldTurn(signal);
   // Non-finite transformed coordinates do not address buffered pixels either.
   if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y))continue;
   const offset=(y*width+x)*4,page=Math.floor(offset/4096),start=page*4096;
   let data=pages.get(page);
   if(data)pages.delete(page);
   else{
    if(pages.size===16){const [oldPage,oldData]=pages.entries().next().value!;await storage.write(position+oldPage*4096,oldData,{signal});signal.throwIfAborted();pages.delete(oldPage);}
    const size=Math.min(4096,length-start),borrowed=await storage.read(position+start,size,{signal});signal.throwIfAborted();
    if(!(borrowed instanceof Uint8Array)||borrowed.length!==size)throw new Error("Truncated SVG backing storage");
    data=new Uint8Array(borrowed);
   }
   blendSvgPixel(data,offset-start,r,g,b,a);pages.set(page,data);
  }
  for(const [page,data]of pages){signal.throwIfAborted();await storage.write(position+page*4096,data,{signal});signal.throwIfAborted();}
 const {size:ignoredSize,...image}=metadata;
 return {...image,position};
}
