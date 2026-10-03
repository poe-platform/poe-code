import type {ImageMetadata,SharpInputOptions} from "../ast.js";
import type {ImageByteSource} from "./png-storage.js";
import {readPngMetadataFromSource} from "./png-storage.js";
import {readJpegMetadataFromSource} from "./jpeg-input-storage.js";
import {readImageMetadata} from "./index.js";
import {isPngBytes} from "./png.js";
import {isJpegBytes} from "./jpeg.js";
import {isBmpBytes,isNetpbmBytes,readBmpMetadata} from "./netpbm.js";
import {netpbmHeaderSteps} from "./netpbm-header.js";
import {SourceBytes} from "./storage-source.js";
import {UnsupportedStoredResource} from "./unsupported-storage.js";
import {checkLimitInputPixels} from "../limits.js";

/** Inspect caller-retained encoded ranges. Source ownership stays with the caller. */
export async function readImageMetadataFromSource(source:ImageByteSource,signal:AbortSignal,options?:SharpInputOptions):Promise<ImageMetadata> {
 signal.throwIfAborted();
 if(!Number.isSafeInteger(source.size)||source.size<0)throw new RangeError("Invalid image source size");
 if(options?.text || options?.create)return readImageMetadata(undefined,options);
 if(options?.raw)return {...readImageMetadata(new Uint8Array(),options),size:source.size};
 const length=Math.min(54,source.size),borrowed=await source.read(0,length,{signal});signal.throwIfAborted();
 if(!(borrowed instanceof Uint8Array)||borrowed.length!==length)throw new Error("Truncated image metadata source");
 const prefix=new Uint8Array(borrowed);let metadata:ImageMetadata;
 if(isPngBytes(prefix))metadata=await readPngMetadataFromSource(source,signal);
 else if(isJpegBytes(prefix))metadata=await readJpegMetadataFromSource(source,signal);
 else if(isBmpBytes(prefix))metadata={...readBmpMetadata(prefix),size:source.size};
 else if(isNetpbmBytes(prefix)) {
  const reader=new SourceBytes(source,signal,"Netpbm"),steps=netpbmHeaderSteps(source.size);let next=steps.next();
  while(!next.done)next=steps.next(await reader.at(next.value));
  const {format,width,height,maxval}=next.value;
  metadata={format,width,height,space:format==="ppm"?"srgb":"b-w",channels:format==="ppm"?3:1,depth:format==="pbm"?"bit":maxval>255?"ushort":"uchar",density:72,hasAlpha:false,size:source.size};
 } else throw new UnsupportedStoredResource();
 signal.throwIfAborted();checkLimitInputPixels(metadata.width,metadata.height,options);return metadata;
}
