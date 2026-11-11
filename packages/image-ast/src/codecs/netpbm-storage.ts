import {NetpbmAscii} from "./netpbm-ascii.js";
import {defaultRuntime} from "@poe-code/compression";
import type {SharpInputOptions} from "../ast.js";
import {checkLimitInputPixels} from "../limits.js";
import type {ImageByteSource,ImageByteStorage,StoredRgbaImage} from "./png-storage.js";
import {netpbmComment,netpbmSequenceSteps} from "./netpbm-header.js";
import {SourceBytes} from "./storage-source.js";
import {Pixels,Output} from "../ops/storage-raster.js";

/** Decode Netpbm variants including PAM without retaining the encoded file or raster. */
export async function decodeNetpbmToStorage(source:ImageByteSource,storage:ImageByteStorage,signal:AbortSignal,options?:SharpInputOptions):Promise<StoredRgbaImage> {
 signal.throwIfAborted();
 const reader=new SourceBytes(source,signal,"Netpbm"),steps=netpbmSequenceSteps(source.size,options?.page??0);let next=steps.next();
 while(!next.done) next=steps.next(await reader.at(next.value));
 const {width,height,maxval,magic,format,dataOffset,channels,hasAlpha,cmyk,properties}=next.value.header;
 if(!["P1","P2","P3","P4","P5","P6","P7"].includes(magic)) throw new Error("Invalid Netpbm signature");
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(width*height*4)) throw new RangeError("Invalid Netpbm dimensions");
 checkLimitInputPixels(width,height,options);
 if(magic==="P6"&&source.size-dataOffset<width*height*3*(maxval>255?2:1)) throw new Error("Truncated PPM raster");
 if(magic==="P7"&&source.size-dataOffset<width*height*channels*(maxval>255?2:1)) throw new Error("Truncated PAM raster");
 const metadata:StoredRgbaImage={...(properties?{properties}:{}),width,height,position:0,format,space:cmyk?"cmyk":channels>=3?"srgb":"b-w",channels,depth:format==="pbm"?"bit":maxval>255?"ushort":"uchar",bitsPerSample:Math.ceil(Math.log2(maxval+1)),density:72,hasAlpha};
 // Native byte-depth binary rasters use the stored byte, even below maxval 255.
 const sampleMax=(magic==="P5"||magic==="P6"||magic==="P7")&&maxval>=128&&maxval<=255?255:maxval;
 const output=new Output(metadata,width,height,storage,signal);let position=dataOffset;
 // Retain precision whenever the input scale cannot be represented in 8 bits.
 const storedData16=255%sampleMax!==0?{position:storage.allocate(width*height*8),length:width*height*4}:undefined;
 const storedHueSamples=cmyk?storage.allocate(width*height*32):undefined;
 const storedEvaluateSamples=cmyk?storage.allocate(width*height*32):undefined;
 const evaluated=cmyk?new Float64Array(2048):undefined;
 const inks=new Float64Array(2048);let usedInks=0,offsetInks=0;
 const flushInks=async():Promise<void>=>{
  if(storedHueSamples===undefined||!usedInks)return;
  await storage.write(storedHueSamples+offsetInks,new Uint8Array(inks.buffer,0,usedInks*8),{signal});
  if(storedEvaluateSamples!==undefined&&evaluated)await storage.write(storedEvaluateSamples+offsetInks,new Uint8Array(evaluated.buffer,0,usedInks*8),{signal});
  offsetInks+=usedInks*8;usedInks=0;
 };
 const samples16=storedData16?new Uint16Array(2048):undefined;let used16=0,offset16=0;
 const flush16=async():Promise<void>=>{
  if(!storedData16||!samples16||!used16) return;
  await storage.write(storedData16.position+offset16,new Uint8Array(samples16.buffer,0,used16*2),{signal});
  offset16+=used16*2;used16=0;
 };
 const ascii=async():Promise<number>=>{
  while(position<source.size) {
   const value=(await reader.at(position))!;
   if(value===35) {while(position<source.size&&(await reader.at(position))!==10&&(await reader.at(position))!==13) position++;}
   else if(value<=32) position++;
   else break;
  }
  let value=0;
  while(position<source.size) {
   const digit=(await reader.at(position))!;
   if(digit<48||digit>57) break;
   value=value*10+(digit-48);position++;
   if(magic==="P1") break;
  }
  return value;
 };
 const sample=async():Promise<number>=>{
  if(magic==="P1"||magic==="P2"||magic==="P3") return ascii();
  const hi=await reader.at(position++)??0;
  if(magic==="P5"&&maxval>65535) return hi*16777216+(await reader.at(position++))!*65536+(await reader.at(position++))!*256+(await reader.at(position++))!;
  return maxval>255?(hi<<8)|(await reader.at(position++)??0):hi;
 };
 for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
  if(magic==="P4") {
   const value=await reader.at(dataOffset+y*Math.ceil(width/8)+(x>>>3))??0,g=(value>>>(7-(x&7)))&1?0:255;
   await output.pixel(g,g,g,255);
  } else if(magic==="P1") {const g=await ascii()===0?255:0;await output.pixel(g,g,g,255);}
  else {
   const r=format==="pgm"?Math.min(await sample(),sampleMax):await sample(),g=channels>=3?await sample():r,b=channels>=3?await sample():r,k=cmyk?await sample():0,a=hasAlpha?await sample():sampleMax;
   const values=cmyk?[(sampleMax-r)*(sampleMax-k)/sampleMax,(sampleMax-g)*(sampleMax-k)/sampleMax,(sampleMax-b)*(sampleMax-k)/sampleMax,a]:[r,g,b,a];
   if(evaluated)for(let channel=0;channel<4;channel++)evaluated[usedInks+channel]=values[channel]!*255/sampleMax;
   if(cmyk){for(const value of [r,g,b,k])inks[usedInks++]=value/sampleMax;if(usedInks===inks.length)await flushInks();}
   await output.pixel(Math.round(values[0]!*255/sampleMax),Math.round(values[1]!*255/sampleMax),Math.round(values[2]!*255/sampleMax),hasAlpha?Math.round(a*255/sampleMax):255);
   if(samples16) {
    for(const value of values) samples16[used16++]=Math.round(value*65535/sampleMax);
    if(used16===samples16.length) await flush16();
   }
  }
 }
 await flush16();
 await flushInks();
 return {...await output.finish(),...(storedData16?{storedData16}:{}),...(storedHueSamples===undefined?{}:{storedHueSamples}),...(storedEvaluateSamples===undefined?{}:{storedEvaluateSamples})};
}
/** Owned output chunks and pull-driven backpressure; rows never require full buffers. */
export async function* encodeNetpbmFromStorage(image:StoredRgbaImage,storage:ImageByteStorage,signal:AbortSignal,format:"ppm"|"pgm"|"pbm"|"pam",depth=format==="ppm"||format==="pam"?Math.min(16,image.bitsPerSample??(image.storedData16?16:8)):image.storedData16?16:8,ascii=false):AsyncGenerator<Uint8Array> {
 signal.throwIfAborted();
 if(format!=="pam"&&format!=="ppm"&&format!=="pgm"&&format!=="pbm") throw new Error(`Unsupported Netpbm output format: ${format}`);
 if(!Number.isInteger(depth)||depth<1||depth>16) throw new RangeError("Invalid Netpbm depth");
 if(format==="pam") ascii=false;
 const maximum=ascii?(depth<=8?255:65535):2**depth-1;
 const gray=format==="pam"&&(image.space==="b-w"||image.space==="grey16");
 const cmyk=format==="pam"&&image.space==="cmyk";
 const channels=format==="pam"?(gray?1:cmyk?4:3)+(image.hasAlpha?1:0):format==="ppm"?3:1;
 const comment=netpbmComment(image.properties?.comment);
 const pamHeader=`P7\n${comment}WIDTH ${image.width}\nHEIGHT ${image.height}\nDEPTH ${channels}\nMAXVAL ${maximum}\nTUPLTYPE ${gray?"GRAYSCALE":cmyk?"CMYK":"RGB"}${image.hasAlpha?"_ALPHA":""}\nENDHDR\n`;
 const {width,height,position}=image;
 const layout=new NetpbmAscii(width,height,channels);
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(width*height*4)||!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(position+width*height*4)) throw new RangeError("Invalid Netpbm backing dimensions");
 if(cmyk&&image.storedHueSamples!==undefined) {
  yield new TextEncoder().encode(pamHeader);
  for(let offset=0;offset<width*height;offset+=512) {
   signal.throwIfAborted();if(offset%16384===0)await defaultRuntime.yieldTurn(signal);
   const count=Math.min(512,width*height-offset);
   const bytes=await storage.read(image.storedHueSamples!+offset*32,count*32,{signal});
   if(bytes.length!==count*32)throw new Error("Truncated PAM ink storage");
   const inks=new Float64Array(new Uint8Array(bytes).buffer);
   const alpha= image.storedData16 ? await storage.read(image.storedData16.position+offset*8,count*8,{signal}) : await storage.read(position+offset*4,count*4,{signal});
   const samples=image.storedData16?new Uint16Array(new Uint8Array(alpha).buffer):alpha;
   const out=new Uint8Array(count*channels*(depth>8?2:1));let dst=0;
   for(let i=0;i<count;i++)for(let channel=0;channel<channels;channel++) {
    const value=Math.round(maximum*(channel<4?inks[i*4+channel]!:samples[i*4+3]!/(image.storedData16?65535:255)));
    if(depth>8)out[dst++]=value>>>8;out[dst++]=value&255;
   }
   yield out;
  }
  return;
 }
 if(format!=="pbm"&&image.storedData16) {
  const samples=image.storedData16,count=width*height;
  if(!Number.isSafeInteger(samples.position)||samples.position<0||!Number.isSafeInteger(samples.position+count*8)||!Number.isSafeInteger(samples.length)||samples.length<count*4) throw new RangeError("Invalid Netpbm sample backing");
  yield new TextEncoder().encode(format==="pam"?pamHeader:`${format==="ppm"?(ascii?"P3":"P6"):(ascii?"P2":"P5")}\n${comment}${width} ${height}\n${maximum}\n`);
  for(let offset=0;offset<count;offset+=512) {
   signal.throwIfAborted();if(offset%16384===0) await defaultRuntime.yieldTurn(signal);
   const pixels=Math.min(512,count-offset),length=pixels*8;
   const bytes=await storage.read(samples.position+offset*8,length,{signal});
   signal.throwIfAborted();
   if(bytes.length!==length) throw new Error("Truncated Netpbm sample storage");
   const data=new Uint16Array(new Uint8Array(bytes).buffer),out=new Uint8Array(ascii?0:pixels*channels*(depth>8?2:1));let dst=0;const text:string[]=[];
   for(let i=0;i<pixels;i++) {
    const r=data[i*4]!,g=data[i*4+1]!,b=data[i*4+2]!;
    const peak=Math.max(r,g,b),inks=cmyk?[peak===0?0:(1-r/peak)*65535,peak===0?0:(1-g/peak)*65535,peak===0?0:(1-b/peak)*65535,65535-peak]:[];
    if(cmyk&&image.hasAlpha) inks.push(data[i*4+3]!);
    for(const value of cmyk?inks:format==="pam"?(gray?(image.hasAlpha?[r,data[i*4+3]!]:[r]):(image.hasAlpha?[r,g,b,data[i*4+3]!]:[r,g,b])):format==="ppm"?[r,g,b]:[0.212656*r+0.715158*g+0.072186*b]) {const scaled=Math.round(value*maximum/65535);if(ascii){text.push(layout.sample(scaled));continue;}if(depth>8)out[dst++]=scaled>>>8;out[dst++]=scaled&255;}
   }
   yield ascii?new TextEncoder().encode(text.join("")):out;
  }
  return;
 }
 yield new TextEncoder().encode(format==="pam"?pamHeader:`${format==="ppm"?(ascii?"P3":"P6"):format==="pgm"?(ascii?"P2":"P5"):(ascii?"P1":"P4")}\n${comment}${width} ${height}\n${format==="pbm"?"":`${maximum}\n`}`);
 const pixels=new Pixels(image,storage,signal),buffer=new Uint8Array(4096);let used=0;
 for(let y=0;y<height;y++) {
  let bits=0;
  for(let x=0;x<width;x++) {
   const value=await pixels.pixel(y*width+x),r=value&255,g=value>>>8&255,b=value>>>16&255;
   if(format!=="pbm") {
    const peak=Math.max(r,g,b),inks=cmyk?[peak===0?0:(1-r/peak)*255,peak===0?0:(1-g/peak)*255,peak===0?0:(1-b/peak)*255,255-peak]:[];
    if(cmyk&&image.hasAlpha) inks.push(value>>>24);
    for(const channel of cmyk?inks:format==="pam"?(gray?(image.hasAlpha?[r,value>>>24]:[r]):(image.hasAlpha?[r,g,b,value>>>24]:[r,g,b])):format==="ppm"?[r,g,b]:[0.212656*r+0.715158*g+0.072186*b]) {
     const scaled=Math.round(channel*maximum/255);
     if(ascii) {
      for(const byte of new TextEncoder().encode(layout.sample(scaled))) {buffer[used++]=byte;if(used===buffer.length){yield new Uint8Array(buffer);used=0;}}
      continue;
     }
     if(depth>8) {buffer[used++]=scaled>>>8;if(used===buffer.length){yield new Uint8Array(buffer);used=0;}}
     buffer[used++]=scaled&255;
     if(used===buffer.length){yield new Uint8Array(buffer);used=0;}
    }
   } else if(ascii) {for(const byte of new TextEncoder().encode(layout.sample(0.299*r+0.587*g+0.114*b<128?1:0))){buffer[used++]=byte;if(used===buffer.length){yield new Uint8Array(buffer);used=0;}}} else {if(0.299*r+0.587*g+0.114*b<128)bits|=1<<(7-(x&7));if((x&7)===7||x+1===width){buffer[used++]=bits;bits=0;}}
   if(used===buffer.length){yield new Uint8Array(buffer);used=0;}
  }
 }
 signal.throwIfAborted();if(used) yield new Uint8Array(buffer.subarray(0,used));
}
