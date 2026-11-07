import {BmpPalette} from "./bmp-palette.js";
import {BmpRle,bmpRlePacketSize} from "./bmp-rle.js";
import type {SharpInputOptions} from "../ast.js";
import {checkLimitInputPixels} from "../limits.js";
import type {ImageByteSource,ImageByteStorage,StoredRgbaImage} from "./png-storage.js";
import {readBmpMetadata} from "./netpbm.js";
import {createBmpHeader,readBmpMasks,bmpMaskedChannel} from "./bmp-header.js";
import {SourceBytes} from "./storage-source.js";
import {Pixels,Output} from "../ops/storage-raster.js";

/** Decode BMP rows and bounded palettes into caller-owned storage. */
export async function decodeBmpToStorage(source:ImageByteSource,storage:ImageByteStorage,signal:AbortSignal,options?:SharpInputOptions):Promise<StoredRgbaImage> {
 signal.throwIfAborted();
 const reader=new SourceBytes(source,signal,"BMP"),header=new Uint8Array(Math.min(70,source.size));
 for(let i=0;i<header.length;i++) header[i]=(await reader.at(i))!;
 if(header[0]!==66||header[1]!==77) throw new Error("Invalid BMP signature");
 const metadata=readBmpMetadata(header),view=new DataView(header.buffer),{width,height}=metadata;
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(width*height*4)) throw new RangeError("Invalid BMP dimensions");
 checkLimitInputPixels(width,height,options);
 const dataOffset=view.getUint32(10,true),dibHeaderSize=view.getUint32(14,true),topDown=dibHeaderSize!==12&&view.getInt32(22,true)<0,bpp=view.getUint16(dibHeaderSize===12?24:28,true),rowStride=Math.floor((width*bpp+31)/32)*4;
 const bitfieldMasks=readBmpMasks(view);
 const palette=new Uint8Array(bpp<=8?(bpp===8?256:bpp===4?16:bpp===1?2:1)*3:0),paletteOffset=14+dibHeaderSize,paletteStep=dibHeaderSize===12?3:4;
 for(let i=0;i<palette.length/3;i++) for(let c=0;c<3;c++) palette[i*3+c]=await reader.at(paletteOffset+i*paletteStep+c)??0;
 const {size:ignoredSize,...raster}=metadata;
 const output=new Output({...raster,position:0},width,height,storage,signal);
 const compression=dibHeaderSize>=40?view.getUint32(30,true):0;
 if(compression===1||compression===2) {
  if(bpp!==(compression===1?8:4)) throw new Error("Invalid BMP RLE bit depth");
  const decoder=new BmpRle(width,height,bpp,topDown);
  // Delta packets and early end markers leave palette-zero pixels behind.
  for(let i=0;i<width*height;i++) await output.pixel(palette[2]!,palette[1]!,palette[0]!,255);
  const image=await output.finish();
  let offset=dataOffset;
  while(!decoder.done) {
   const count=await reader.at(offset),value=await reader.at(offset+1);
   if(count===undefined||value===undefined) throw new Error("Truncated BMP RLE packet");
   const packet=new Uint8Array(bmpRlePacketSize(count,value,bpp));
   for(let i=0;i<packet.length;i++) {
    const byte=await reader.at(offset+i);
    if(byte===undefined) throw new Error("Truncated BMP RLE packet");
    packet[i]=byte;
   }
   offset+=packet.length;
   const run=decoder.packet(packet),rgba=new Uint8Array(run.indices.length*4);
   for(let i=0;i<run.indices.length;i++) {
    const index=run.indices[i]!;
    rgba.set([palette[index*3+2]!,palette[index*3+1]!,palette[index*3]!,255],i*4);
   }
   if(rgba.length) await storage.write(image.position+(run.y*width+run.x)*4,rgba,{signal});
   signal.throwIfAborted();
  }
  return image;
 }
 // Scan through the bounded source cache; keep meaningful alpha, including zero samples.
 let opaqueReserved=bpp===32&&dibHeaderSize>=40&&view.getUint32(30,true)===0;
 if(opaqueReserved) {
  for(let offset=dataOffset+3;offset<dataOffset+rowStride*height;offset+=4) {
   if((await reader.at(offset)??255)!==0){opaqueReserved=false;break;}
  }
 }

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
    if(bitfieldMasks) {
     const low=(await reader.at(start)??0)|((await reader.at(start+1)??0)<<8);
     const pixel=bpp===16?low:low|((await reader.at(start+2)??0)<<16)|((await reader.at(start+3)??0)<<24);
     await output.pixel(bmpMaskedChannel(pixel,bitfieldMasks[0]!),bmpMaskedChannel(pixel,bitfieldMasks[1]!),bmpMaskedChannel(pixel,bitfieldMasks[2]!),bmpMaskedChannel(pixel,bitfieldMasks[3]!));
     continue;
    }
    await output.pixel(await reader.at(start+2)??0,await reader.at(start+1)??0,await reader.at(start)??0,bytesPerPixel===4&&!opaqueReserved?await reader.at(start+3)??255:255);
   }
  }
 }
 return output.finish();
}
/** Emit BMP color and alpha rows without retaining whole rows or output. */
export async function* encodeBmpFromStorage(image:StoredRgbaImage,storage:ImageByteStorage,signal:AbortSignal,options?:Parameters<typeof createBmpHeader>[1]):AsyncGenerator<Uint8Array> {
 signal.throwIfAborted();
 const {width,height,position}=image;
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(width*height*4)||!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(position+width*height*4)) throw new RangeError("Invalid BMP backing dimensions");
 const pixels=new Pixels(image,storage,signal);
 let palette=BmpPalette.forImage(image);
 if(palette) for(let i=0;i<width*height;i++) {
  const value=await pixels.pixel(i);
  if(!palette.add(value&255,value>>>8&255,value>>>16&255,value>>>24)){palette=undefined;break;}
 }
 const {data:header,rowStride,bytesPerPixel,bitDepth}=createBmpHeader(image,options,palette);
 yield header;
 const buffer=new Uint8Array(4096);let used=0;
 for(let y=height-1;y>=0;y--) {
  let packed=0;
  for(let x=0;x<width;x++) {
   const value=await pixels.pixel(y*width+x);
   if(palette) {
    packed |= palette.index(value&255,value>>>8&255,value>>>16&255) << (8-bitDepth-x*bitDepth%8);
    if((x+1)*bitDepth%8===0 || x===width-1) {
     buffer[used++]=packed;packed=0;
     if(used===buffer.length){yield new Uint8Array(buffer);used=0;}
    }
    continue;
   }
   for(const byte of bytesPerPixel===4 ? [value>>>16&255,value>>>8&255,value&255,value>>>24] : [value>>>16&255,value>>>8&255,value&255]) {buffer[used++]=byte;if(used===buffer.length){yield new Uint8Array(buffer);used=0;}}
  }
  for(let i=Math.ceil(width*bitDepth/8);i<rowStride;i++){buffer[used++]=0;if(used===buffer.length){yield new Uint8Array(buffer);used=0;}}
 }
 signal.throwIfAborted();if(used) yield new Uint8Array(buffer.subarray(0,used));
}
