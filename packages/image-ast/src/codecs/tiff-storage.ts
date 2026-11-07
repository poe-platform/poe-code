import type {ImageByteStorage,StoredRgbaImage} from "./png-storage.js";
import {BackingArena} from "./backing-arena.js";
import {createTiffCompressor} from "./tiff-compression.js";
import {encodeJpegFromStorage} from "./jpeg-storage.js";
import {tiffSamplePlane,associateTiffSamples,createTiffLayout} from "./tiff-layout.js";
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
  if(channels===4) output.set(bytes);
  else for(let src=0,dst=0;src<size;src+=4) {
   output[dst++]=bytes[src]!;
   if(channels===2) output[dst++]=bytes[src+3]!;
   if(channels===3) { output[dst++]=bytes[src+1]!;output[dst++]=bytes[src+2]!; }
  }
  if (page.hasAlpha && options.tiffAlpha === "associated" && channels !== 3) associateTiffSamples(output, channels);
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
  if(options.tiffTile) {
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
   for(let at=0;at<columns*stripHeight*4;at+=4096) {
    signal.throwIfAborted();
    const bytes=await blockStorage.read(block.position+at,Math.min(4096,columns*stripHeight*4-at),{signal}),raw=new Uint8Array(bytes.length/4*channels);
    for(let src=0,dst=0;src<bytes.length;src+=4) {raw[dst++]=bytes[src]!;if(channels===2)raw[dst++]=bytes[src+3]!;if(channels>=3){raw[dst++]=bytes[src+1]!;raw[dst++]=bytes[src+2]!;}if(channels===4)raw[dst++]=bytes[src+3]!;}
    if (page.hasAlpha && options.tiffAlpha === "associated" && channels !== 3) associateTiffSamples(raw, channels);
    yield raw;
   }
  }
  async function* encode() {
   if(options.tiffCompression === "jpeg") {yield* encodeJpegFromStorage(block,blockStorage,signal,{...options,chromaSubsampling:"4:4:4"});return;}
   const compressor=createTiffCompressor(options.tiffCompression,columns*(options.tiffPlanar ? 1 : channels));
   try {
    for await(const raw of blockPixels()) yield* compressor.push(options.tiffPlanar ? tiffSamplePlane(raw, channels, plane) : raw);
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
 if(encodedBytes === undefined) yield* pixels();
 else for(let at=0;at<encodedBytes;at+=4096) {
  signal.throwIfAborted();yield await scratch.read(at,Math.min(4096,encodedBytes-at),{signal});
 }
 signal.throwIfAborted();
 if(padding) yield new Uint8Array(padding);
 signal.throwIfAborted();if(index===0) yield directory;
 }
}
