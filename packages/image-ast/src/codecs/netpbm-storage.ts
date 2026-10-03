import type {SharpInputOptions} from "../ast.js";
import {checkLimitInputPixels} from "../limits.js";
import type {ImageByteSource,ImageByteStorage,StoredRgbaImage} from "./png-storage.js";
import {netpbmHeaderSteps} from "./netpbm-header.js";
import {SourceBytes} from "./storage-source.js";
import {Pixels,Output} from "../ops/storage-raster.js";

/** Decode all six Netpbm variants without retaining the encoded file or raster. */
export async function decodeNetpbmToStorage(source:ImageByteSource,storage:ImageByteStorage,signal:AbortSignal,options?:SharpInputOptions):Promise<StoredRgbaImage> {
 signal.throwIfAborted();
 const reader=new SourceBytes(source,signal,"Netpbm"),steps=netpbmHeaderSteps(source.size);let next=steps.next();
 while(!next.done) next=steps.next(await reader.at(next.value));
 const {width,height,maxval,magic,format,dataOffset}=next.value;
 if(!["P1","P2","P3","P4","P5","P6"].includes(magic)) throw new Error("Invalid Netpbm signature");
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(width*height*4)) throw new RangeError("Invalid Netpbm dimensions");
 checkLimitInputPixels(width,height,options);
 const metadata:StoredRgbaImage={width,height,position:0,format,space:format==="ppm"?"srgb":"b-w",channels:format==="ppm"?3:1,depth:format==="pbm"?"bit":maxval>255?"ushort":"uchar",density:72,hasAlpha:false};
 const output=new Output(metadata,width,height,storage,signal);let position=dataOffset;
 const ascii=async():Promise<number>=>{
  while(position<source.size) {
   const value=(await reader.at(position))!;
   if(value===35) {while(position<source.size&&(await reader.at(position))!==10) position++;}
   else if(value<=32) position++;
   else break;
  }
  let value=0;
  while(position<source.size) {
   const digit=(await reader.at(position))!;
   if(digit<48||digit>57) break;
   value=value*10+(digit-48);position++;
  }
  return value;
 };
 const sample=async():Promise<number>=>{
  if(magic==="P1"||magic==="P2"||magic==="P3") return ascii();
  const hi=await reader.at(position++)??0;
  return maxval>255?(hi<<8)|(await reader.at(position++)??0):hi;
 };
 for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
  if(magic==="P4") {
   const value=await reader.at(dataOffset+y*Math.ceil(width/8)+(x>>>3))??0,g=(value>>>(7-(x&7)))&1?0:255;
   await output.pixel(g,g,g,255);
  } else if(magic==="P1") {const g=await ascii()===1?0:255;await output.pixel(g,g,g,255);}
  else if(format==="ppm") await output.pixel(Math.round((await sample())*255/maxval),Math.round((await sample())*255/maxval),Math.round((await sample())*255/maxval),255);
  else {const g=Math.round((await sample())*255/maxval);await output.pixel(g,g,g,255);}
 }
 return output.finish();
}
/** Owned output chunks and pull-driven backpressure; rows never require full buffers. */
export async function* encodeNetpbmFromStorage(image:StoredRgbaImage,storage:ImageByteStorage,signal:AbortSignal,format:"ppm"|"pgm"|"pbm"):AsyncGenerator<Uint8Array> {
 signal.throwIfAborted();
 if(format!=="ppm"&&format!=="pgm"&&format!=="pbm") throw new Error(`Unsupported Netpbm output format: ${format}`);
 const {width,height,position}=image;
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(width*height*4)||!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(position+width*height*4)) throw new RangeError("Invalid Netpbm backing dimensions");
 yield new TextEncoder().encode(`${format==="ppm"?"P6":format==="pgm"?"P5":"P4"}\n${width} ${height}\n${format==="pbm"?"":"255\n"}`);
 const pixels=new Pixels(image,storage,signal),buffer=new Uint8Array(4096);let used=0;
 for(let y=0;y<height;y++) {
  let bits=0;
  for(let x=0;x<width;x++) {
   const value=await pixels.pixel(y*width+x),r=value&255,g=value>>>8&255,b=value>>>16&255;
   if(format==="ppm") {
    for(const channel of [r,g,b]) {buffer[used++]=channel;if(used===buffer.length){yield new Uint8Array(buffer);used=0;}}
   } else if(format==="pgm") {buffer[used++]=Math.round(0.299*r+0.587*g+0.114*b);}
   else {if(0.299*r+0.587*g+0.114*b<128)bits|=1<<(7-(x&7));if((x&7)===7||x+1===width){buffer[used++]=bits;bits=0;}}
   if(used===buffer.length){yield new Uint8Array(buffer);used=0;}
  }
 }
 signal.throwIfAborted();if(used) yield new Uint8Array(buffer.subarray(0,used));
}
