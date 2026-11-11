import {encodeTiffIntegerSamples} from "./tiff-integer.js";
import {encodeTiffFloatSamples} from "./tiff-float.js";
import type {ImageByteStorage,StoredRgbaImage} from "./png-storage.js";
import {BackingArena} from "./backing-arena.js";
import {createTiffCompressor} from "./tiff-compression.js";
import {encodeJpegFromStorage} from "./jpeg-storage.js";
import {tiffChannels,tiffSamplePlane,associateTiffSamples,createTiffLayout} from "./tiff-layout.js";
import {defaultRuntime} from "@poe-code/compression";
export type StoredTiffEncodeOptions=NonNullable<Parameters<typeof createTiffLayout>[1]>;
/** Pull-driven TIFF output with owned chunks and a strip directory. */
export async function* encodeTiffFromStorage(image:StoredRgbaImage,storage:ImageByteStorage,signal:AbortSignal,options:StoredTiffEncodeOptions={}):AsyncGenerator<Uint8Array> {
 signal.throwIfAborted();
 let end=0;
 const scratch=new BackingArena(storage);
 const tileBacking=new BackingArena(storage);
 const count=image.storedTiffPages?.length ?? 1;
 for(let index=0;index<count;index++) {
 const page=image.storedTiffPages ? await image.storedTiffPages.at(index) : image;
 signal.throwIfAborted();
 const {width,height,position}=page,length=width*height*4;
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(length)||!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(position+length)) throw new RangeError("Invalid TIFF backing dimensions");
 const channels=createTiffLayout(page,options).channels;
 async function* pixels(start=0,end=length) {
 for(let offset=start;offset<end;offset+=4096) {
  signal.throwIfAborted();if(offset%65536===0) await defaultRuntime.yieldTurn(signal);
  const size=Math.min(4096,end-offset),bytes=await storage.read(position+offset,size,{signal});signal.throwIfAborted();
  if(!(bytes instanceof Uint8Array)||bytes.length!==size) throw new Error("Truncated TIFF backing storage");
  const output=new Uint8Array(size/4*channels);
  const baseChannels = options.tiffCompression === "jpeg" ? 3 : tiffChannels(page);
  for(let src=0,dst=0;src<size;src+=4) {
   output[dst++]=bytes[src]!;
   if(baseChannels>=3) { output[dst++]=bytes[src+1]!;output[dst++]=bytes[src+2]!; }
   if(baseChannels===2 || baseChannels===4) output[dst]=bytes[src+3]!;
   dst=(src/4+1)*channels;
  }
  for (const [channel, meta] of (page.storedMetaChannels ?? []).entries()) {
   if (baseChannels + channel >= channels) break;
   const samples = await storage.read(meta.position+offset,size,{signal});
   signal.throwIfAborted();
   if(samples.length!==size) throw new Error("Truncated TIFF backing storage");
   for(let src=0;src<size;src+=4) output[src/4*channels+baseChannels+channel]=samples[src]!;
  }
  if (page.hasAlpha && options.tiffAlpha === "associated" && options.tiffCompression !== "jpeg") associateTiffSamples(output, channels, baseChannels - 1);
  yield output;
 }
 }
 const compressed=options.tiffCompression !== undefined && options.tiffCompression !== "none";
 let encodedBytes:number|undefined;
 let stripSizes:number[]|undefined;
 if(compressed || options.tiffTile || options.tiffPlanar) {
  scratch.reset();encodedBytes=0;stripSizes=[];
  const rows=options.tiffTile?.height ?? options.tiffRowsPerStrip ?? height,columns=options.tiffTile?.width ?? width;
  for(let plane=0;plane<(options.tiffPlanar ? channels : 1);plane++) {
  for(let row=0;row<height;row+=rows) {
  for(let left=0;left<width;left+=columns) {
  const stripHeight=options.tiffTile ? rows : Math.min(rows,height-row),start=encodedBytes;
  let block={...page,height:stripHeight,position:position+row*width*4};
  let blockStorage:ImageByteStorage=storage;
  if(options.tiffTile && options.tiffCompression === "jpeg") {
   tileBacking.reset();const tilePosition=tileBacking.allocate(columns*stripHeight*4);
   for(let y=0;y<stripHeight;y++) {
    await defaultRuntime.yieldTurn(signal);
    for(let x=0;x<columns;x+=1024) {
     const size=Math.min(1024,columns-x),bytes=new Uint8Array(size*4),valid=Math.max(0,Math.min(size,width-left-x));
     if(row+y<height && valid>0) {
      const source=await storage.read(position+((row+y)*width+left+x)*4,valid*4,{signal});
      if(source.length!==valid*4) throw new Error("Truncated TIFF backing storage");
      bytes.set(source);
     }
     await tileBacking.write(tilePosition+(y*columns+x)*4,bytes,{signal});
    }
   }
   block={...page,width:columns,height:stripHeight,position:tilePosition};blockStorage=tileBacking;
  }
  async function* blockPixels() {
   if(!options.tiffTile) {yield* pixels(row*width*4,(row+stripHeight)*width*4);return;}
   for(let y=0;y<stripHeight;y++) {
    for(let x=0;x<columns;x+=1024) {
     const size=Math.min(1024,columns-x),valid=row+y<height ? Math.max(0,Math.min(size,width-left-x)) : 0;
     const raw=new Uint8Array(size*channels);
     if(valid) {
      const start=((row+y)*width+left+x)*4;
      for await(const bytes of pixels(start,start+valid*4)) raw.set(bytes);
     }
     yield raw;
    }
   }
  }
  async function* encode() {
   if(options.tiffCompression === "jpeg") {yield* encodeJpegFromStorage({...block,space:"srgb"},blockStorage,signal,{...options,chromaSubsampling:"4:4:4"});return;}
   const compressor=createTiffCompressor(options.tiffCompression,columns*(options.tiffPlanar ? 1 : channels)*((options.tiffFloatDepth ?? options.tiffIntegerDepth ?? 8)/8));
   try {
    for await(const raw of blockPixels()) yield* compressor.push(encodeTiffIntegerSamples(encodeTiffFloatSamples(options.tiffPlanar ? tiffSamplePlane(raw, channels, plane) : raw, options.tiffFloatDepth, options.tiffEndian !== "msb"), options.tiffFloatDepth ? undefined : options.tiffIntegerDepth, options.tiffEndian !== "msb"));
    yield* compressor.push(new Uint8Array(),true);
   } finally {compressor.close();}
  }
  for await(const bytes of encode()) {
   for(let at=0;at<bytes.length;at+=4096) {
    signal.throwIfAborted();const part=bytes.subarray(at,at+4096);
    await scratch.write(scratch.allocate(part.length),part,{signal});encodedBytes+=part.length;
   }
  }
  stripSizes.push(encodedBytes-start);
  }
  }
  }
 }
 const {header,directory,padding,end:nextEnd}=createTiffLayout(page,options,end,index+1<count,stripSizes);
 end=nextEnd;
 yield index===0 ? header : directory;
 if(encodedBytes === undefined) {
  for await (const raw of pixels()) yield encodeTiffIntegerSamples(encodeTiffFloatSamples(raw, options.tiffFloatDepth, options.tiffEndian !== "msb"), options.tiffFloatDepth ? undefined : options.tiffIntegerDepth, options.tiffEndian !== "msb");
 }
 else for(let at=0;at<encodedBytes;at+=4096) {
  signal.throwIfAborted();yield await scratch.read(at,Math.min(4096,encodedBytes-at),{signal});
 }
 signal.throwIfAborted();
 if(padding) yield new Uint8Array(padding);
 signal.throwIfAborted();if(index===0) yield directory;
 }
}
