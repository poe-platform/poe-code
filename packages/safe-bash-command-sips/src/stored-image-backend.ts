import type {FileSystem} from "@poe-code/safe-fs/contracts";
import {tryPdfDecode,tryPdfMetadata,decodeImage,readImageMetadata,encodeImage,decodeImageToStorage,readImageMetadataFromSource,encodeStoredImage,isStoredOutputFormat,transformStoredImage,UnsupportedStoredResource,parseColor,type ImageByteSource,type ImageByteStorage,type RgbaImage,type StoredRgbaImage,type StoredImageOperation} from "@poe-code/image-ast/portable";
import type {PagedStorage} from "@poe-code/safe-fs/storage";
import {yieldTurn} from "safe-bash-contracts/yield";
import {readPropertiesFromSource,writePropertiesStream} from "./properties.js";
import {bufferedImageBackend,canvasSample,ImageStorageFailure,type ImageOperation,type SipsImageBackend} from "./image-backend.js";

export type SipsPayload=Uint8Array|ImageByteSource;
export type SipsImage=RgbaImage|StoredRgbaImage;

/** Encoded snapshots are separate from pixel scratch so encoder allocations cannot interleave. */
export class StoredSipsImages {
 readonly backend:SipsImageBackend<SipsPayload,SipsImage>;
 private readonly pixelStorage:ImageByteStorage;
 private readonly payloadStorage:ImageByteStorage;
 constructor(readonly pixels:PagedStorage,readonly payloads:PagedStorage,readonly signal:AbortSignal,fs:FileSystem,directory:string){
  const protect=(storage:PagedStorage):ImageByteStorage=>({
   allocate(length){try{return storage.allocate(length);}catch(error){throw new ImageStorageFailure(error);}},
   async read(position,length){try{return await storage.read(position,length);}catch(error){throw new ImageStorageFailure(error);}},
   async write(position,bytes){try{await storage.write(position,bytes);}catch(error){throw new ImageStorageFailure(error);}}
  });
  this.pixelStorage=protect(pixels);this.payloadStorage=protect(payloads);
  const transform=(image:SipsImage,node:StoredImageOperation,buffered:(image:RgbaImage)=>ImageOperation<RgbaImage>):ImageOperation<SipsImage>=>"data" in image?buffered(image):transformStoredImage(image,this.pixelStorage,node,signal);
  this.backend={
   decode:async bytes=>{
    if(bytes instanceof Uint8Array)return decodeImage(bytes);
    try{return await decodeImageToStorage(bytes,this.pixelStorage,signal);}catch(error){if(!(error instanceof UnsupportedStoredResource))throw error;const pdf=await tryPdfDecode(bytes,this.pixelStorage,fs,directory,signal).catch(error=>{if(error instanceof UnsupportedStoredResource)return undefined;throw error;});return pdf??decodeImage(await this.materialize(bytes));}
   },
   metadata:async bytes=>{
    if(bytes instanceof Uint8Array)return readImageMetadata(bytes);
    try{const {storedDelay:ignoredDelay,...metadata}=await readImageMetadataFromSource(bytes,signal,undefined,this.pixelStorage);return metadata;}catch(error){if(!(error instanceof UnsupportedStoredResource))throw error;const pdf=await tryPdfMetadata(bytes,fs,directory,signal,{}).catch(error=>{if(error instanceof UnsupportedStoredResource)return undefined;throw error;});return pdf??readImageMetadata(await this.materialize(bytes));}
   },
   readProperties:(bytes,format)=>bytes instanceof Uint8Array?bufferedImageBackend.readProperties(bytes,format):readPropertiesFromSource(bytes,format,signal),
   encode:async(image,options)=>{
    if("data" in image)return encodeImage(image,options).data;
    if(!isStoredOutputFormat(options.format??image.format))return encodeImage(await this.materializeImage(image),options).data;
    return this.retain(encodeStoredImage(image,this.pixelStorage,signal,options));
   },
   writeProperties:(bytes,format,properties)=>bytes instanceof Uint8Array?bufferedImageBackend.writeProperties(bytes,format,properties):properties.size?this.retain(writePropertiesStream(this.chunks(bytes),format,properties,signal)):bytes,
   rotate:(image,degrees,background)=>transform(image,{kind:"rotate",angle:degrees,background},image=>bufferedImageBackend.rotate(image,degrees,background)),
   flip:image=>transform(image,{kind:"flip"},image=>bufferedImageBackend.flip(image)),
   flop:image=>transform(image,{kind:"flop"},image=>bufferedImageBackend.flop(image)),
   resize:(image,options)=>transform(image,{kind:"resize",...options},image=>bufferedImageBackend.resize(image,options)),
   extract:(image,options)=>transform(image,{kind:"extract",...options},image=>bufferedImageBackend.extract(image,options)),
   extend:(image,options)=>transform(image,{kind:"extend",...options},image=>bufferedImageBackend.extend(image,options)),
   oddCanvas:(image,width,height,destinationWidth,destinationHeight,background)=>"data" in image?bufferedImageBackend.oddCanvas(image,width,height,destinationWidth,destinationHeight,background):this.oddCanvas(image,width,height,destinationWidth,destinationHeight,background)
  };
 }

 async *chunks(source:ImageByteSource):AsyncGenerator<Uint8Array>{
  for(let position=0;position<source.size;position+=16384){this.signal.throwIfAborted();const length=Math.min(16384,source.size-position),bytes=await source.read(position,length,{signal:this.signal});this.signal.throwIfAborted();if(bytes.length!==length)throw new Error("Truncated Sips image snapshot");yield new Uint8Array(bytes);}
 }

 async retain(chunks:AsyncIterable<Uint8Array>):Promise<ImageByteSource>{
  const start=this.payloadStorage.allocate(0);let size=0;
  for await(const bytes of chunks){this.signal.throwIfAborted();for(let offset=0;offset<bytes.length;offset+=16384){const chunk=bytes.subarray(offset,offset+16384),position=this.payloadStorage.allocate(chunk.length);if(position!==start+size)throw new Error("Interleaved Sips snapshot allocation");await this.payloadStorage.write(position,chunk);size+=chunk.length;}}
  return this.source(start,size);
 }

 source(start:number,size:number):ImageByteSource{
  return {size,read:async(position,length)=>{
   this.signal.throwIfAborted();if(!Number.isSafeInteger(position)||!Number.isSafeInteger(length)||position<0||length<0||position+length>size)throw new RangeError("Invalid Sips snapshot range");
   const bytes=new Uint8Array(length);for(let offset=0;offset<length;offset+=16384)bytes.set(await this.payloadStorage.read(start+position+offset,Math.min(16384,length-offset)),offset);this.signal.throwIfAborted();return bytes;
  }};
 }

 // Explicit compatibility paths for formats whose retained codecs are still pending.
 async materialize(source:ImageByteSource):Promise<Uint8Array>{
  const bytes=new Uint8Array(source.size);let offset=0;for await(const chunk of this.chunks(source)){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
 }

 private async materializeImage(image:StoredRgbaImage):Promise<RgbaImage>{
  const {position,storedData16,storedDelay,...metadata}=image,data=new Uint8Array(image.width*image.height*4);
  for(let offset=0;offset<data.length;offset+=16384)data.set(await this.pixelStorage.read(position+offset,Math.min(16384,data.length-offset)),offset);
  let data16:Uint16Array|undefined;if(storedData16){data16=new Uint16Array(storedData16.length);const bytes=new Uint8Array(data16.buffer);for(let offset=0;offset<bytes.length;offset+=16384)bytes.set(await this.pixelStorage.read(storedData16.position+offset,Math.min(16384,bytes.length-offset)),offset);}
  let delay:number[]|undefined;if(storedDelay){delay=[];for(let index=0;index<storedDelay.length;index++)delay.push((await storedDelay.at(index,{signal:this.signal}))!);}
  return {...metadata,data,...(data16?{data16}:{}),...(delay?{delay}:{})};
 }

 private async oddCanvas(image:StoredRgbaImage,width:number,height:number,destinationWidth:number,destinationHeight:number,background:Parameters<typeof bufferedImageBackend.oddCanvas>[5]):Promise<StoredRgbaImage>{
  const channels=image.channels===2?4:image.channels,pad=parseColor(background,channels===4?0:255),bg=pad.r|pad.g<<8|pad.b<<16|pad.a<<24;
  const pages=new Map<number,Uint8Array>(),pixelCount=image.width*image.height;
  const sample=async(x:number,y:number):Promise<number|undefined>=>{
   if(x<0||y<0||x>=width||y>=height)return bg;
   const index=y*width+x;if(index>=pixelCount)return undefined;
   const offset=index*4,page=Math.floor(offset/4096);let bytes=pages.get(page);
   if(!bytes){bytes=await this.pixelStorage.read(image.position+page*4096,Math.min(4096,pixelCount*4-page*4096));if(pages.size===8)pages.delete(pages.keys().next().value!);pages.set(page,bytes);}
   const local=offset%4096;return bytes[local]!|bytes[local+1]!<<8|bytes[local+2]!<<16|bytes[local+3]!<<24;
  };
  const start=this.payloadStorage.allocate(destinationWidth*destinationHeight*channels),buffer=new Uint8Array(4096);let used=0,written=0,work=63;
  const offsetX=(destinationWidth-width)/2,offsetY=(destinationHeight-height)/2;
  for(let y=0;y<destinationHeight;y++)for(let x=0;x<destinationWidth;x++){
   this.signal.throwIfAborted();if(++work%4096===0)await yieldTurn(this.signal);
   const sx=x-offsetX,sy=y-offsetY,ix=Math.floor(sx),iy=Math.floor(sy),wx1=sx-ix,wy1=sy-iy,wx0=1-wx1,wy0=1-wy1;
   const a=await sample(ix,iy),b=await sample(ix+1,iy),c=await sample(ix,iy+1),d=await sample(ix+1,iy+1);
   for(let channel=0;channel<channels;channel++){
    const shift=channel*8;
    buffer[used++]=canvasSample(a===undefined?NaN:a>>>shift&255,b===undefined?NaN:b>>>shift&255,c===undefined?NaN:c>>>shift&255,d===undefined?NaN:d>>>shift&255,wx0,wx1,wy0,wy1);
    if(used===buffer.length){await this.payloadStorage.write(start+written,buffer);written+=used;used=0;}
   }
  }
  if(used)await this.payloadStorage.write(start+written,buffer.subarray(0,used));
  return decodeImageToStorage(this.source(start,destinationWidth*destinationHeight*channels),this.pixelStorage,this.signal,{raw:{width:destinationWidth,height:destinationHeight,channels}});
 }
}
