import {encodeTiffIntegerSamples} from "./tiff-integer.js";
import {encodeTiffFloatSamples} from "./tiff-float.js";
import type {ImageByteStorage,StoredRgbaImage} from "./png-storage.js";
import {BackingArena} from "./backing-arena.js";
import {createTiffCompressor,tiffReversedBytes} from "./tiff-compression.js";
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
 const pageOptions={...options,...(options?.tiffIntegerDepth === undefined && options?.tiffCompression !== "jpeg" && page.space !== "cmyk" && (page.bitsPerSample === 16 || page.depth === "ushort") ? {tiffIntegerDepth:16 as const} : {})};
 const highDepth=page.space !== "cmyk" && !pageOptions.tiffFloatDepth && (pageOptions.tiffIntegerDepth ?? 8) > 8 && !!page.storedData16;
 const channels=createTiffLayout(page,pageOptions).channels;
 async function* pixels(start=0,end=length) {
 const chunkSize=highDepth ? 2048 : 4096;
 for(let offset=start;offset<end;offset+=chunkSize) {
  signal.throwIfAborted();if(offset%65536===0) await defaultRuntime.yieldTurn(signal);
  const size=Math.min(chunkSize,end-offset),bytes=await storage.read(highDepth ? page.storedData16!.position+offset*2 : position+offset,highDepth ? size*2 : size,{signal});signal.throwIfAborted();
  if(!(bytes instanceof Uint8Array)||bytes.length!==(highDepth ? size*2 : size)) throw new Error("Truncated TIFF backing storage");
  const samples=highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
  const output=highDepth ? new Uint16Array(size/4*channels) : new Uint8Array(size/4*channels);
  const baseChannels = pageOptions.tiffCompression === "jpeg" ? 3 : tiffChannels(page);
  let inks: Float64Array | undefined;
  if(page.space === "cmyk") {
   if(page.storedHueSamples === undefined) throw new Error("Invalid TIFF CMYK samples");
   const samples=await storage.read(page.storedHueSamples+offset*8,size*8,{signal});
   signal.throwIfAborted();
   if(samples.length!==size*8) throw new Error("Truncated TIFF CMYK samples");
   inks=new Float64Array(new Uint8Array(samples).buffer);
  }
  for(let src=0,dst=0;src<size;src+=4) {
   if(inks) {
    for(let channel=0;channel<4;channel++) output[dst++]=Math.round(Math.max(0,Math.min(1,inks[src+channel]!))*255);
    if(page.hasAlpha) output[dst]=bytes[src+3]!;
   } else {
   output[dst++]=samples[src]!;
   if(baseChannels>=3) { output[dst++]=samples[src+1]!;output[dst++]=samples[src+2]!; }
   if(baseChannels===2 || baseChannels===4) output[dst]=samples[src+3]!;
   }
   dst=(src/4+1)*channels;
  }
  for (const [channel, meta] of (page.storedMetaChannels ?? []).entries()) {
   if (baseChannels + channel >= channels) break;
   const wide=highDepth && meta.storedData16;
   const bytes=await storage.read(wide ? wide.position+offset*2 : meta.position+offset,wide ? size*2 : size,{signal});
   signal.throwIfAborted();
   const samples=wide ? new Uint16Array(bytes.slice().buffer) : bytes;
   if(samples.length!==size) throw new Error("Truncated TIFF backing storage");
   for(let src=0;src<size;src+=4) output[src/4*channels+baseChannels+channel]=samples[src]! * (highDepth && !wide ? 257 : 1);
  }
  if (page.hasAlpha && pageOptions.tiffAlpha === "associated" && pageOptions.tiffCompression !== "jpeg") associateTiffSamples(output, channels, baseChannels - 1);
  yield output;
 }
 }
 const compressed=pageOptions.tiffCompression !== undefined && pageOptions.tiffCompression !== "none";
 let encodedBytes:number|undefined;
 let stripSizes:number[]|undefined;
 if(compressed || pageOptions.tiffTile || pageOptions.tiffPlanar) {
  scratch.reset();encodedBytes=0;stripSizes=[];
  const rows=pageOptions.tiffTile?.height ?? pageOptions.tiffRowsPerStrip ?? height,columns=pageOptions.tiffTile?.width ?? width;
  for(let plane=0;plane<(pageOptions.tiffPlanar ? channels : 1);plane++) {
  for(let row=0;row<height;row+=rows) {
  for(let left=0;left<width;left+=columns) {
  const stripHeight=pageOptions.tiffTile ? rows : Math.min(rows,height-row),start=encodedBytes;
  let block={...page,height:stripHeight,position:position+row*width*4};
  let blockStorage:ImageByteStorage=storage;
  if(pageOptions.tiffTile && pageOptions.tiffCompression === "jpeg") {
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
   if(!pageOptions.tiffTile) {yield* pixels(row*width*4,(row+stripHeight)*width*4);return;}
   for(let y=0;y<stripHeight;y++) {
    for(let x=0;x<columns;x+=1024) {
     const size=Math.min(1024,columns-x),valid=row+y<height ? Math.max(0,Math.min(size,width-left-x)) : 0;
     const raw=highDepth ? new Uint16Array(size*channels) : new Uint8Array(size*channels);
     if(valid) {
      const start=((row+y)*width+left+x)*4;
      let at=0;
      for await(const bytes of pixels(start,start+valid*4)) {raw.set(bytes,at);at+=bytes.length;}
     }
     yield raw;
    }
   }
  }
  async function* encode() {
   if(pageOptions.tiffCompression === "jpeg") {yield* encodeJpegFromStorage({...block,space:"srgb"},blockStorage,signal,{...pageOptions,chromaSubsampling:"4:4:4"});return;}
   const compressor=createTiffCompressor(pageOptions.tiffCompression,columns*(pageOptions.tiffPlanar ? 1 : channels)*((pageOptions.tiffFloatDepth ?? pageOptions.tiffIntegerDepth ?? 8)/8));
   try {
    for await(const raw of blockPixels()) {
     const samples=pageOptions.tiffPlanar ? tiffSamplePlane(raw,channels,plane) : raw;
     yield* compressor.push(pageOptions.tiffFloatDepth ? encodeTiffFloatSamples(samples,pageOptions.tiffFloatDepth,pageOptions.tiffEndian !== "msb") : encodeTiffIntegerSamples(samples,pageOptions.tiffIntegerDepth,pageOptions.tiffEndian !== "msb"));
    }
    yield* compressor.push(new Uint8Array(),true);
   } finally {compressor.close();}
  }
  for await(const bytes of encode()) {
   if(options.tiffFillOrder === "lsb" && options.tiffCompression !== "jpeg") for(let i=0;i<bytes.length;i++) bytes[i]=tiffReversedBytes[bytes[i]!]!;
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
 const {header,directory,padding,end:nextEnd}=createTiffLayout(page,pageOptions,end,index+1<count,stripSizes,index,count);
 end=nextEnd;
 yield index===0 ? header : directory;
 if(encodedBytes === undefined) {
  for await (const raw of pixels()) {
   const bytes=pageOptions.tiffFloatDepth ? encodeTiffFloatSamples(raw,pageOptions.tiffFloatDepth,pageOptions.tiffEndian !== "msb") : encodeTiffIntegerSamples(raw,pageOptions.tiffIntegerDepth,pageOptions.tiffEndian !== "msb");
   if(options.tiffFillOrder === "lsb") for(let i=0;i<bytes.length;i++) bytes[i]=tiffReversedBytes[bytes[i]!]!;
   yield bytes;
  }
 }
 else for(let at=0;at<encodedBytes;at+=4096) {
  signal.throwIfAborted();yield await scratch.read(at,Math.min(4096,encodedBytes-at),{signal});
 }
 signal.throwIfAborted();
 if(padding) yield new Uint8Array(padding);
 signal.throwIfAborted();if(index===0) yield directory;
 }
}
