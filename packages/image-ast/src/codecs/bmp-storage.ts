import type {SharpInputOptions} from "../ast.js";
import {checkLimitInputPixels} from "../limits.js";
import type {ImageByteSource,ImageByteStorage,StoredRgbaImage} from "./png-storage.js";
import {readBmpMetadata} from "./netpbm.js";
import {createBmpHeader} from "./bmp-header.js";
import {SourceBytes} from "./storage-source.js";
import {Pixels,Output} from "../ops/storage-raster.js";

/** Decode BMP rows and bounded palettes into caller-owned storage. */
export async function decodeBmpToStorage(source:ImageByteSource,storage:ImageByteStorage,signal:AbortSignal,options?:SharpInputOptions):Promise<StoredRgbaImage> {
 signal.throwIfAborted();
 const reader=new SourceBytes(source,signal,"BMP"),header=new Uint8Array(Math.min(54,source.size));
 for(let i=0;i<header.length;i++) header[i]=(await reader.at(i))!;
 if(header[0]!==66||header[1]!==77) throw new Error("Invalid BMP signature");
 const metadata=readBmpMetadata(header),view=new DataView(header.buffer),{width,height}=metadata;
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(width*height*4)) throw new RangeError("Invalid BMP dimensions");
 checkLimitInputPixels(width,height,options);
 const dataOffset=view.getUint32(10,true),dibHeaderSize=view.getUint32(14,true),topDown=view.getInt32(22,true)<0,bpp=view.getUint16(28,true),rowStride=Math.floor((width*bpp+31)/32)*4;
 const palette=new Uint8Array(bpp<=8?(bpp===8?256:bpp===4?16:bpp===1?2:1)*3:0),paletteOffset=14+dibHeaderSize,paletteStep=dibHeaderSize===12?3:4;
 for(let i=0;i<palette.length/3;i++) for(let c=0;c<3;c++) palette[i*3+c]=await reader.at(paletteOffset+i*paletteStep+c)??0;
 const {size:ignoredSize,...raster}=metadata;
 const output=new Output({...raster,position:0},width,height,storage,signal);
 for(let y=0;y<height;y++) {
  const rowStart=dataOffset+(topDown?y:height-1-y)*rowStride;
  for(let x=0;x<width;x++) {
   if(bpp<=8) {
    let index=0;
    if(bpp===8) index=await reader.at(rowStart+x)??0;
    else if(bpp===4){const value=await reader.at(rowStart+(x>>>1))??0;index=(x&1)===0?(value>>>4)&15:value&15;}
    else if(bpp===1){const value=await reader.at(rowStart+(x>>>3))??0;index=(value>>>(7-(x&7)))&1;}
    await output.pixel(palette[index*3+2]!,palette[index*3+1]!,palette[index*3]!,255);
   } else {
    const bytesPerPixel=bpp>>>3,start=rowStart+x*bytesPerPixel;
    await output.pixel(await reader.at(start+2)??0,await reader.at(start+1)??0,await reader.at(start)??0,bytesPerPixel===4?await reader.at(start+3)??255:255);
   }
  }
 }
 return output.finish();
}
/** Emit standard 24-bit BMP rows without retaining whole rows or output. */
export async function* encodeBmpFromStorage(image:StoredRgbaImage,storage:ImageByteStorage,signal:AbortSignal):AsyncGenerator<Uint8Array> {
 signal.throwIfAborted();
 const {width,height,position}=image;
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(width*height*4)||!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(position+width*height*4)) throw new RangeError("Invalid BMP backing dimensions");
 const {data:header,rowStride}=createBmpHeader(image);
 yield header;
 const pixels=new Pixels(image,storage,signal),buffer=new Uint8Array(4096);let used=0;
 for(let y=height-1;y>=0;y--) {
  for(let x=0;x<width;x++) {
   const value=await pixels.pixel(y*width+x);
   for(const byte of [value>>>16&255,value>>>8&255,value&255]) {buffer[used++]=byte;if(used===buffer.length){yield new Uint8Array(buffer);used=0;}}
  }
  for(let i=width*3;i<rowStride;i++){buffer[used++]=0;if(used===buffer.length){yield new Uint8Array(buffer);used=0;}}
 }
 signal.throwIfAborted();if(used) yield new Uint8Array(buffer.subarray(0,used));
}
