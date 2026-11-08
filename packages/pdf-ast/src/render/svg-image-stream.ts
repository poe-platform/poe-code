import type {PdfEvaluatedImage} from "../ast.js";
import type {PdfIndexStorage} from "../cos/object-index.js";
import {PdfError} from "../errors.js";
import {encodeRetainedPng,type PdfRetainedPngOptions} from "./retained-png.js";

/** Serialize one SVG image from resident or caller-backed RGBA pixels. PNG and
 * base64 are streamed; the caller retains ownership of the source pixels. */
export async function* encodeSvgImageChunks(image:PdfEvaluatedImage,pageHeight:number,storage:PdfIndexStorage,
 options:Omit<PdfRetainedPngOptions,"alpha">={}):AsyncGenerator<Uint8Array,void,void>{
 const {signal}=options;signal?.throwIfAborted();
 if(!image.decodedRgba&&!image.storedRgba)return;
 const {width,height}=image,chunkBytes=options.chunkBytes??65536,maximum=options.maxOutputBytes??Infinity;
 if(![width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=0xffffffff)||!Number.isSafeInteger(width*height*4))throw new PdfError("E_LIMIT","SVG image dimension limit exceeded");
 if(!Number.isSafeInteger(chunkBytes)||chunkBytes<1)throw new RangeError("Invalid SVG image chunk size");
 if(maximum!==Infinity&&(!Number.isSafeInteger(maximum)||maximum<0))throw new RangeError("Invalid SVG output byte limit");
 const [a,b,c,d,e,f]=image.matrix;
 const prefix=`<image width="1" height="1" preserveAspectRatio="none" transform="matrix(${a} ${-b} ${-c} ${d} ${e+c} ${pageHeight-f-d})" href="data:image/png;base64,`,suffix='"/>';
 const encoder=new TextEncoder(),header=encoder.encode(prefix),tail=encoder.encode(suffix),available=maximum-header.length-tail.length;
 const pngMaximum=maximum===Infinity?Infinity:Math.floor(available/4)*3;
 if(pngMaximum<57)throw new PdfError("E_LIMIT","SVG image output byte limit exceeded");
 let outputBytes=0;
 function* emit(bytes:Uint8Array){if(bytes.length>maximum-outputBytes)throw new PdfError("E_LIMIT","SVG image output byte limit exceeded");outputBytes+=bytes.length;for(let at=0;at<bytes.length;at+=chunkBytes){signal?.throwIfAborted();yield bytes.slice(at,at+chunkBytes);}}
 async function* pixels(){
  if(image.decodedRgba){for(let at=0;at<image.decodedRgba.length;at+=chunkBytes){signal?.throwIfAborted();yield image.decodedRgba.subarray(at,at+chunkBytes);}return;}
  const source=image.storedRgba!;
  for(let at=0;at<width*height*4;){signal?.throwIfAborted();const count=Math.min(chunkBytes,width*height*4-at),bytes=await source.storage.read(source.position+at,count,signal?{signal}:undefined);if(bytes.length>count)throw new Error("Oversized SVG pixel read");if(!bytes.length)return;yield bytes;at+=bytes.length;}
 }
 yield* emit(header);
 // Each base64 group owns only three source bytes. No payload-wide binary
 // string or padding between PNG chunks; padding belongs to the final group.
 const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
 const buffer=new Uint8Array(Math.min(8192,Math.max(4,chunkBytes))),triple=new Uint8Array(3);let used=0,pending=0,work=0;
 function group(count:number){const n=(triple[0]!<<16)|(triple[1]!<<8)|triple[2]!;buffer[used++]=alphabet.charCodeAt(n>>>18);buffer[used++]=alphabet.charCodeAt((n>>>12)&63);buffer[used++]=count>1?alphabet.charCodeAt((n>>>6)&63):61;buffer[used++]=count>2?alphabet.charCodeAt(n&63):61;triple.fill(0);pending=0;}
 const capacity=buffer.length-buffer.length%4;
 for await(const bytes of encodeRetainedPng(width,height,pixels(),storage,{...options,alpha:"rgba",maxOutputBytes:pngMaximum})){
  for(const byte of bytes){triple[pending++]=byte;if(pending===3){group(3);if(used===capacity){yield* emit(buffer.subarray(0,used));used=0;}if(++work%4096===0){await new Promise<void>(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();}}}
 }
 if(pending)group(pending);if(used)yield* emit(buffer.subarray(0,used));yield* emit(tail);
}
