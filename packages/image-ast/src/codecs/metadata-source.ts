import { isDdsBytes, readDdsMetadataFromSource } from "./dds-input.js";
import { isSgiBytes, readSgiHeader } from "./sgi-input.js";
import { isSunBytes, readSunHeader } from "./sun-input.js";
import { isPalmBytes, readPalmHeader } from "./palm-input.js";
import { isWbmpBytes, readWbmpHeader } from "./wbmp-input.js";
import { isFitsBytes, readFitsFromSource } from "./fits-input.js";
import { isOtbBytes, readOtbHeader } from "./otb-input.js";
import { isSixelBytes, readSixelFromSource } from "./sixel-input.js";
import { bmpProfileRange } from "./bmp-profile.js";
import { isPsdBytes, readPsdFromSource } from "./psd-input.js";
import { isPcxBytes, readPcxHeader } from "./pcx-input.js";
import { isXwdBytes, readXwdHeader } from "./xwd-input.js";
import { isQoiBytes, readQoiMetadata } from "./qoi-input.js";
import { isMiffBytes } from "./miff-input.js";
import { readMiffFromSource } from "./miff-input-storage.js";
import { isXpmBytes, readXpmFromSource } from "./xpm.js";
import { isXbmSource, readXbmFromSource } from "./xbm.js";
import { isRadianceBytes } from "./radiance.js";
import { readRadianceFromSource } from "./radiance-storage.js";
import { isExrBytes } from "./exr.js";
import { readExrFromSource } from "./exr-storage.js";
import { isFarbfeldBytes, readFarbfeldMetadata } from "./farbfeld.js";
import { isPhmBytes } from "./phm.js";
import { readPhmFromSource } from "./phm-storage.js";
import { isPfmBytes } from "./pfm.js";
import { readPfmFromSource } from "./pfm-storage.js";
import { isTgaBytes, readTgaMetadata } from "./tga.js";
import { isTxtBytes, readTxtFromSource } from "./txt.js";
import { isIcoBytes } from "./ico-input.js";
import { readIcoEntryFromSource } from "./ico-input-storage.js";
import { isMngBytes } from "./mng-input.js";
import { readMngLayoutFromSource } from "./mng-input-storage.js";
import {isSvgBytes,isPdfBytes} from "./svg-pdf.js";
import {readSvgMetadataFromSource} from "./svg-metadata-source.js";
import {detectHeifFormatFromSource} from "./heif-format.js";
import {readHeifMetadataFromSource} from "./heif-storage.js";
import {isGifBytes} from "./gif-metadata.js";
import {readGifMetadataFromSource} from "./gif-metadata-storage.js";
import {decodeTiffToStorage} from "./tiff-input-storage.js";
import {isWebpBytes} from "./webp.js";
import {readWebpMetadataFromSource} from "./webp-input-storage.js";
import type {RetainedImageMetadata,SharpInputOptions} from "../ast.js";
import type {ImageByteSource,ImageByteStorage} from "./png-storage.js";
import {readPngMetadataFromSource} from "./png-storage.js";
import {readJpegMetadataFromSource} from "./jpeg-input-storage.js";
import {readImageMetadata} from "./index.js";
import {isPngBytes} from "./png.js";
import {isJpegBytes} from "./jpeg.js";
import {isBmpBytes,isNetpbmBytes,isTiffBytes,readBmpHeaderMetadata} from "./netpbm.js";
import {netpbmSequenceSteps} from "./netpbm-header.js";
import {SourceBytes} from "./storage-source.js";
import {UnsupportedStoredResource,rejectUnknownImage} from "./unsupported-storage.js";
import {checkLimitInputPixels} from "../limits.js";

/** Inspect caller-retained encoded ranges. Source ownership stays with the caller. */
export async function readImageMetadataFromSource(source:ImageByteSource,signal:AbortSignal,options?:SharpInputOptions,storage?:ImageByteStorage):Promise<RetainedImageMetadata> {
 signal.throwIfAborted();
 if(!Number.isSafeInteger(source.size)||source.size<0)throw new RangeError("Invalid image source size");
 if(options?.text || options?.create)return readImageMetadata(undefined,options);
 if(options?.raw)return {...readImageMetadata(new Uint8Array(),options),size:source.size};
 const length=Math.min(138,source.size),borrowed=await source.read(0,length,{signal});signal.throwIfAborted();
 if(!(borrowed instanceof Uint8Array)||borrowed.length!==length)throw new Error("Truncated image metadata source");
 const prefix=new Uint8Array(borrowed);let metadata:RetainedImageMetadata;
 if(isSunBytes(prefix))metadata=readSunHeader(prefix,source.size).metadata;
 else if(isXwdBytes(prefix))metadata=readXwdHeader(prefix,source.size).metadata;
 else if(isSgiBytes(prefix))metadata=readSgiHeader(prefix,source.size).metadata;
 else if(isPcxBytes(prefix))metadata=readPcxHeader(prefix,source.size).metadata;
 else if(await detectHeifFormatFromSource(source,signal))metadata=await readHeifMetadataFromSource(source,signal);
 else if(await isXbmSource(source,signal))metadata=await readXbmFromSource(source,undefined,signal,options);
 else if(isDdsBytes(prefix))metadata=await readDdsMetadataFromSource(source,signal);
 else if(isSixelBytes(prefix))metadata=(await readSixelFromSource(source,signal,options)).metadata;
 else if(isFitsBytes(prefix))metadata=(await readFitsFromSource(source,signal)).metadata;
 else if(isQoiBytes(prefix))metadata={...readQoiMetadata(prefix),size:source.size};
 else if(isPsdBytes(prefix))metadata=(await readPsdFromSource(source,signal,options)).metadata;
 else if(isMiffBytes(prefix))metadata=(await readMiffFromSource(source,signal,options?.page)).metadata;
 else if(isXpmBytes(prefix))metadata=await readXpmFromSource(source,undefined,signal,options);
 else if(isTxtBytes(prefix))metadata=await readTxtFromSource(source,undefined,signal,options);
 else if(isTgaBytes(prefix))metadata={...readTgaMetadata(prefix),size:source.size};
 else if(isIcoBytes(prefix))metadata=(await readIcoEntryFromSource(source,signal,options)).metadata;
 else if(isPalmBytes(prefix))metadata=readPalmHeader(prefix,source.size).metadata;
 else if(isOtbBytes(prefix))metadata=readOtbHeader(prefix,source.size).metadata;
 else if(isMngBytes(prefix))metadata=(await readMngLayoutFromSource(source,signal)).metadata;
 else if(isPngBytes(prefix))metadata=await readPngMetadataFromSource(source,signal);
 else if(isJpegBytes(prefix))metadata=await readJpegMetadataFromSource(source,signal);
 else if(isWebpBytes(prefix))metadata=await readWebpMetadataFromSource(source,signal);
 else if(isGifBytes(prefix)){if(!storage)throw new UnsupportedStoredResource();metadata=await readGifMetadataFromSource(source,storage,signal,options);}
 else if(isTiffBytes(prefix)) {
  if(!storage)throw new UnsupportedStoredResource();
  const decoded=await decodeTiffToStorage(source,storage,signal,options);
  metadata={...(decoded.pages===undefined?{}:{pages:decoded.pages}),...(decoded.properties?{properties:decoded.properties}:{}),format:"tiff",width:decoded.width,height:decoded.height,space:decoded.space,channels:decoded.channels,depth:decoded.depth,
   ...(decoded.bitsPerSample===undefined?{}:{bitsPerSample:decoded.bitsPerSample}),density:decoded.density,...(decoded.resolution?{resolution:decoded.resolution}:{}),hasAlpha:decoded.hasAlpha,
   ...(decoded.orientation===undefined?{}:{orientation:decoded.orientation}),size:source.size};
 }
 else if(isBmpBytes(prefix)) {
  metadata={...readBmpHeaderMetadata(prefix),size:source.size};
  const profile=bmpProfileRange(new DataView(prefix.buffer),source.size);
  if(profile) {
   const reader=new SourceBytes(source,signal,"BMP");
   const icc=new Uint8Array(profile.length);
   for(let i=0;i<profile.length;i++) icc[i]=(await reader.at(profile.offset+i))!;
   metadata={...metadata,icc};
  }
 }
 else if(isExrBytes(prefix))metadata=(await readExrFromSource(source,signal)).metadata;
 else if(isPfmBytes(prefix)) { metadata=(await readPfmFromSource(source,signal,options?.page)).metadata; }
 else if(isRadianceBytes(prefix)) { metadata=(await readRadianceFromSource(source,signal)).metadata; }
 else if(isFarbfeldBytes(prefix))metadata=readFarbfeldMetadata(prefix,source.size);
 else if(isPhmBytes(prefix)) { metadata=(await readPhmFromSource(source,signal,options?.page)).metadata; }
 else if(isNetpbmBytes(prefix)) {
  const reader=new SourceBytes(source,signal,"Netpbm"),steps=netpbmSequenceSteps(source.size,options?.page);let next=steps.next();
  while(!next.done)next=steps.next(await reader.at(next.value));
  const {header:{format,width,height,maxval,channels,hasAlpha,cmyk,properties},pages}=next.value;
  metadata={...(properties?{properties}:{}),format,width,height,space:cmyk?"cmyk":channels>=3?"srgb":"b-w",channels,depth:format==="pbm"?"bit":maxval>255?"ushort":"uchar",bitsPerSample:Math.ceil(Math.log2(maxval+1)),density:72,hasAlpha,size:source.size,...(pages>1?{pages}:{})};
 } else if(isWbmpBytes(prefix))metadata=readWbmpHeader(prefix,source.size).metadata;
 else {
  const length=Math.min(1029,source.size),head=await source.read(0,length,{signal});signal.throwIfAborted();
  if(!(head instanceof Uint8Array)||head.length!==length)throw new Error("Truncated image metadata source");
  if(!isSvgBytes(head)){if(isPdfBytes(head))throw new UnsupportedStoredResource();return rejectUnknownImage(source,signal);}
  metadata=await readSvgMetadataFromSource(source,signal,options);
 }
 signal.throwIfAborted();checkLimitInputPixels(metadata.width,metadata.height,options);return metadata;
}
