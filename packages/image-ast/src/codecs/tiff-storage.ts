import type {ImageByteStorage,StoredRgbaImage} from "./png-storage.js";
import {createTiffLayout} from "./tiff-layout.js";
import {defaultRuntime} from "@poe-code/compression";
export type StoredTiffEncodeOptions=NonNullable<Parameters<typeof createTiffLayout>[1]>;
/** Pull-driven RGBA TIFF output with owned chunks and a fixed-size directory. */
export async function* encodeTiffFromStorage(image:StoredRgbaImage,storage:ImageByteStorage,signal:AbortSignal,options:StoredTiffEncodeOptions={}):AsyncGenerator<Uint8Array> {
 signal.throwIfAborted();
 const {width,height,position}=image,length=width*height*4;
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(length)||!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(position+length)) throw new RangeError("Invalid TIFF backing dimensions");
 const {header,directory}=createTiffLayout(image,options);
 yield header;
 for(let offset=0;offset<length;offset+=4096) {
  signal.throwIfAborted();if(offset%65536===0) await defaultRuntime.yieldTurn(signal);
  const size=Math.min(4096,length-offset),bytes=await storage.read(position+offset,size,{signal});signal.throwIfAborted();
  if(!(bytes instanceof Uint8Array)||bytes.length!==size) throw new Error("Truncated TIFF backing storage");
  yield new Uint8Array(bytes);
 }
 signal.throwIfAborted();yield directory;
}
