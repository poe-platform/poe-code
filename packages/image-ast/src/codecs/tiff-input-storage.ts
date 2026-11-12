import {tiffReversedBytes} from "./tiff-compression.js";
import {tiffTextProperties,tiffPhotometricNames} from "./tiff-properties.js";
import {decodeCcittFaxChunks} from "@poe-code/pdf-ast";
import {tiffPageSteps} from "./tiff-pages.js";
import {tiffLabToRgb} from "./tiff-lab.js";
import {tiffYCbCrToRgb} from "./tiff-ycbcr.js";
import {readTiffFloat8} from "./tiff-float.js";
import {BackingArena} from "./backing-arena.js";
import {createByteCodec,defaultRuntime} from "@poe-code/compression";
import type {SharpInputOptions} from "../ast.js";
import {checkLimitInputPixels} from "../limits.js";
import {Output} from "../ops/storage-raster.js";
import type {ImageByteSource,ImageByteStorage,StoredRgbaImage} from "./png-storage.js";
import {SourceBytes} from "./storage-source.js";
import {decodeJpegToStorage} from "./jpeg-input-storage.js";

interface Values {count:number;at(index:number):Promise<number|undefined>}
const empty:Values={count:0,async at(){return undefined;}};

/** Fixed dirty-page cache for TIFF predictors, including rows wider than memory. */
class Raster {
 private readonly pages=new Map<number,{bytes:Uint8Array;dirty:boolean}>();
 constructor(readonly position:number,readonly length:number,private readonly storage:ImageByteStorage,private readonly signal:AbortSignal) {}
 private async flushPage(page:number,value:{bytes:Uint8Array;dirty:boolean}) {
  if(value.dirty) {this.signal.throwIfAborted();await this.storage.write(this.position+page*4096,value.bytes,{signal:this.signal});this.signal.throwIfAborted();value.dirty=false;}
 }
 private async page(offset:number) {
  this.signal.throwIfAborted();const index=Math.floor(offset/4096);let value=this.pages.get(index);
  if(!value) {
   if(this.pages.size===32){const [key,old]=this.pages.entries().next().value!;await this.flushPage(key,old);this.pages.delete(key);}
   const length=Math.min(4096,this.length-index*4096),bytes=await this.storage.read(this.position+index*4096,length,{signal:this.signal});this.signal.throwIfAborted();
   if(!(bytes instanceof Uint8Array)||bytes.length!==length)throw new Error("Truncated TIFF backing storage");
   value={bytes:new Uint8Array(bytes),dirty:false};this.pages.set(index,value);
  }
  return value;
 }
 async at(offset:number) {return offset<0||offset>=this.length?0:(await this.page(offset)).bytes[offset%4096]!;}
 async set(offset:number,value:number) {const page=await this.page(offset);page.bytes[offset%4096]=value;page.dirty=true;}
 async flush(){for(const [key,value] of this.pages)await this.flushPage(key,value);}
}

/** TIFF LZW's early-change dictionary is bounded by the 12-bit wire format. */
async function* lzw(readByte:(at:number)=>Promise<number>,start:number,length:number,expected:number) {
 const prefix=new Int16Array(4096),suffix=new Uint8Array(4096),stack=new Uint8Array(4097);
 let next=258,width=9,previous=-1,at=start,bits=0,buffer=0,written=0;
 const code=async()=>{while(bits<width){if(at>=start+length)return 257;buffer=(buffer<<8)|(await readByte(at++));bits+=8;}bits-=width;return (buffer>>>bits)&((1<<width)-1);};
 const expand=(value:number)=>{let used=0;while(value>=258){stack[used++]=suffix[value]!;value=prefix[value]!;}if(value<256)stack[used++]=value;return used;};
 while(written<expected) {
  const current=await code();if(current===257)break;
  if(current===256){next=258;width=9;previous=-1;continue;}
  const special=current===next&&previous>=0;
  if(current>=next&&!special)throw new Error("Invalid TIFF LZW dictionary code");
  const count=expand(special?previous:current),first=count?stack[count-1]!:0;
  for(let i=count-1;i>=0&&written<expected;i--){yield stack[i]!;written++;}
  if(special&&written<expected){yield first;written++;}
  if(previous>=0&&next<4096){prefix[next]=previous;suffix[next]=first;next++;if(next===511||next===1023||next===2047)width++;}
  previous=current;
 }
 if(written<expected)throw new Error("Truncated TIFF LZW pixels");
}
async function* packBits(readByte:(at:number)=>Promise<number>,start:number,length:number,expected:number) {
 let at=start,written=0;
 while(at<start+length&&written<expected){const n=await readByte(at++);
  if(n<128){
   if(n+1>start+length-at)throw new Error("Truncated TIFF PackBits literal run");
   for(let i=0;i<=n&&written<expected;i++){yield await readByte(at++);written++;}
  }
  else if(n!==128){if(at>=start+length)throw new Error("Truncated TIFF PackBits repeat run");const value=await readByte(at++);for(let i=0;i<257-n&&written<expected;i++){yield value;written++;}}
 }
 if(written<expected)throw new Error("Truncated TIFF PackBits pixels");
}

/** Classic TIFF and BigTIFF strips/tiles and tags stay in the caller's source and scratch storage. */
export async function decodeTiffToStorage(source:ImageByteSource,storage:ImageByteStorage,signal:AbortSignal,options?:SharpInputOptions):Promise<StoredRgbaImage> {
 signal.throwIfAborted();const reader=new SourceBytes(source,signal,"TIFF");
 const byte=async(at:number)=>{const value=await reader.at(at);if(value===undefined)throw new RangeError("Truncated TIFF directory");return value;};
 const le=(await byte(0))===73;
 const number=async(at:number,size:number)=>{let value=0;for(let i=0;i<size;i++)value+=(await byte(at+i))*2**(8*(le?i:size-i-1));if(!Number.isSafeInteger(value))throw new RangeError("Unsafe TIFF integer");return value;};
 const big=await number(2,2)===43,countSize=big?8:2,entrySize=big?20:12,offsetSize=big?8:4,valueOffset=big?12:8;
 const steps=tiffPageSteps(source.size,options?.page);
 let next=steps.next();
 while(!next.done)next=steps.next(await reader.at(next.value));
 const {offset:ifd,pages}=next.value,count=await number(ifd,countSize);
 let width=0,height=0,bits=8,compression=1,photometric=2,samples=4,rows=0,predictor=1,xRes=72,yRes=72,resUnit=2,tileWidth=0,tileHeight=0,orientation=1;
 let xPosition=0,yPosition=0;
 let hasResolution=false;
 let planar=false;
 let fillOrder=1,faxOptions=0;
 let colorMap=empty;
 let sampleFormat=1;
 let extraSample:number|undefined;
 let properties: Record<string,string> | undefined;
 let jpegTables:{start:number;length:number}|undefined;
 let offsets:Values={count:1,async at(i){return i===0?8:undefined;}},counts=empty,tileOffsets=empty,tileCounts=empty;
 for(let i=0;i<count;i++) {
  const p=ifd+countSize+i*entrySize,tag=await number(p,2),type=await number(p+2,2),n=await number(p+4,offsetSize),size=type===3?2:type===4?4:(type===5||type===16||type===18)?8:1;
  const start=n*size<=offsetSize?p+valueOffset:await number(p+valueOffset,offsetSize),available=Math.max(0,Math.min(n,Math.floor((source.size-start)/size)));
  const values:Values={count:available,async at(index){if(index<0||index>=available)return undefined;const at=start+index*size;if(type!==5)return number(at,size);const num=await number(at,4),den=await number(at+4,4);return den>0?num/den:num;}};
  const first=await values.at(0)??0;
  const property=tiffTextProperties[tag];
  if(property&&type===2){
   if(available>16*1024*1024)throw new Error("TIFF text property exceeds 16 MiB");
   const text:number[]=[];for(let j=0;j<available;j++){const value=await values.at(j);if(!value)break;text.push(value);}
   (properties??={})[property]=new TextDecoder().decode(new Uint8Array(text));
  }
  if(tag===262)(properties??={})["tiff:photometric"]=tiffPhotometricNames[first]??"unknown";
  if(tag===278)(properties??={})["tiff:rows-per-strip"]=String(first);
  if(tag===256)width=first;else if(tag===257)height=first;
  else if(tag===258&&first>0)bits=first;else if(tag===259)compression=first;
  else if(tag===262)photometric=first;else if(tag===273&&available)offsets=values;
  else if(tag===274&&first>=1&&first<=8)orientation=first;else if(tag===277&&first>0)samples=first;
  else if(tag===278&&first>0)rows=first;else if(tag===279&&available)counts=values;
  else if(tag===282&&first>0){xRes=first;hasResolution=true;}else if(tag===283&&first>0){yRes=first;hasResolution=true;}else if(tag===296&&(first===1||first===2||first===3))resUnit=first;
  else if(tag===284)planar=first===2;
  else if(tag===286)xPosition=first;else if(tag===287)yPosition=first;
  else if(tag===292||tag===293)faxOptions=first;
  else if(tag===266)fillOrder=first;
  else if(tag===317&&first>0)predictor=first;else if(tag===322&&first>0)tileWidth=first;
  else if(tag===323&&first>0)tileHeight=first;else if(tag===324&&available)tileOffsets=values;else if(tag===325&&available)tileCounts=values;
  else if(tag===320)colorMap=values;
  else if(tag===338)extraSample=first;
  else if(tag===339)sampleFormat=first;
  else if(tag===347){const offset=n<=offsetSize?p+valueOffset:await number(p+valueOffset,offsetSize);if(offset+n<=source.size)jpegTables={start:offset,length:n};}
 }
 if(![1,3,4,5,6,7,8,32773,32946].includes(compression))throw new Error(`Unsupported TIFF compression: ${compression}`);
 const sampleBytes=Math.max(1,bits>>>3),chunkSamples=planar?1:samples,pixelBytes=chunkSamples*sampleBytes,stride=width*pixelBytes,planeBytes=height*stride,total=planeBytes*(planar?samples:1);
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(samples)||samples<=0||!Number.isSafeInteger(total)||!Number.isSafeInteger(width*height*4))throw new RangeError("Invalid TIFF dimensions");
 checkLimitInputPixels(width,height,options);
 const allocate=(length:number)=>{if(!Number.isSafeInteger(length)||length<0)throw new RangeError("Invalid TIFF backing length");const position=storage.allocate(length);if(!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(position+length))throw new RangeError("Invalid TIFF backing allocation");return position;};
 const write=async(position:number,bytes:Uint8Array)=>{signal.throwIfAborted();await storage.write(position,bytes,{signal});signal.throwIfAborted();};
 const read=async(position:number,length:number)=>{signal.throwIfAborted();const bytes=await storage.read(position,length,{signal});signal.throwIfAborted();if(!(bytes instanceof Uint8Array)||bytes.length!==length)throw new Error("Truncated TIFF backing storage");return new Uint8Array(bytes);};
 const tiled=tileWidth>0&&tileHeight>0&&tileOffsets.count>0,tileStride=tileWidth*pixelBytes,tileBytes=tileHeight*tileStride;
 if(tiled&&(!Number.isSafeInteger(tileWidth)||!Number.isSafeInteger(tileHeight)||!Number.isSafeInteger(tileBytes)))throw new RangeError("Invalid TIFF tile dimensions");
 const combined=allocate(total),scratch=allocate(tiled?tileBytes:total),zeros=new Uint8Array(4096);
 for(let at=0;at<total;at+=4096){await write(combined+at,zeros.subarray(0,Math.min(4096,total-at)));if(at%65536===0)await defaultRuntime.yieldTurn(signal);}
 const jpegStorage=new BackingArena(storage);
 const stripByte=async(at:number)=>{
  const value=await reader.at(at)??0;
  return fillOrder===2?tiffReversedBytes[value]!:value;
 };
 const decompress=async(off:number,rawLength:number,expected:number,max:number,rowSamples:number)=>{
  if(!Number.isSafeInteger(off)||off<0||!Number.isSafeInteger(rawLength)||rawLength<0||off>source.size-rawLength)throw new Error("Truncated TIFF strip or tile range");
  const start=off,end=off+rawLength,position=scratch;
  let length=0;
  const append=async(bytes:Uint8Array)=>{const size=Math.min(bytes.length,max-length);if(size>0){await write(position+length,bytes.subarray(0,size));length+=size;}};
  if(compression===3||compression===4){
   if(bits!==1||samples!==1||(faxOptions&2))throw new Error("Unsupported TIFF CCITT options");
   const open=async function*(){
    for(let at=start;at<end;at+=4096){
     const bytes=new Uint8Array(Math.min(4096,end-at));
     for(let i=0;i<bytes.length;i++)bytes[i]=await stripByte(at+i);
     yield bytes;
    }
   };
   const packedStride=Math.ceil(rowSamples/8),rowCount=expected/rowSamples,buffer=new Uint8Array(4096);
   let packedAt=0,used=0;
   for await(const chunk of decodeCcittFaxChunks(open,{Columns:rowSamples,Rows:rowCount,K:compression===4?-1:faxOptions&1,EndOfLine:compression===3,BlackIs1:true},{signal,chunkBytes:4096,maxRowBytes:packedStride,maxDecodedBytes:packedStride*rowCount})){
    for(const byte of chunk){
     const x=(packedAt++%packedStride)*8;
     for(let bit=0;bit<Math.min(8,rowSamples-x);bit++){
      buffer[used++]=((byte>>>(7-bit))&1)*255;
      if(used===buffer.length){await append(buffer);used=0;await defaultRuntime.yieldTurn(signal);}
     }
    }
   }
   if(used)await append(buffer.subarray(0,used));
   return {position,length};
  }
  if(compression===1&&bits===1){
   const packedStride=Math.ceil(rowSamples/8);
   if(rawLength<packedStride*(expected/rowSamples))throw new Error("Truncated TIFF strip or tile pixels");
   for(let at=0;at<expected;at+=4096){
    const bytes=new Uint8Array(Math.min(4096,expected-at));
    for(let i=0;i<bytes.length;i++){
     const index=at+i,x=index%rowSamples,offset=start+Math.floor(index/rowSamples)*packedStride+(x>>>3);
     const value=offset<end?await stripByte(offset):0;
     bytes[i]=((value>>>(7-x%8))&1)*255;
    }
    await append(bytes);await defaultRuntime.yieldTurn(signal);
   }
   return {position,length};
  }
  if(compression===6||compression===7){
   const tables=jpegTables;
   const shared=tables&&tables.length>4&&await reader.at(tables.start)===255&&await reader.at(tables.start+1)===216&&end-start>2&&await reader.at(start)===255&&await reader.at(start+1)===216;
   const regions=shared?[{start,length:2},{start:tables.start+2,length:tables.length-4},{start:start+2,length:end-start-2}]:[{start,length:end-start}];
   const jpegSource:ImageByteSource={size:regions.reduce((size,region)=>size+region.length,0),async read(at,count){
    signal.throwIfAborted();
    const bytes=new Uint8Array(count);let cursor=0,used=0;
    for(const region of regions){
     const local=Math.max(0,at+used-cursor),take=Math.min(region.length-local,count-used);
     if(take>0){const input=await source.read(region.start+local,take,{signal});signal.throwIfAborted();if(!(input instanceof Uint8Array)||input.length!==take)throw new Error("Truncated TIFF JPEG source");bytes.set(input,used);used+=take;}
     cursor+=region.length;if(used===count)break;
    }
    if(used!==count)throw new Error("Truncated TIFF JPEG source");return bytes;
   }};
   // The embedded JPEG keeps its own dimensions and receives no TIFF shrink/orientation options.
   jpegStorage.reset();
   const image=await decodeJpegToStorage(jpegSource,jpegStorage,signal),pixels=new Raster(image.position,image.width*image.height*4,jpegStorage,signal);
   const copied=Math.min(image.width*image.height,Math.floor(expected/chunkSamples))*chunkSamples;
   for(let at=0;at<expected;at+=4096){
    const bytes=new Uint8Array(Math.min(4096,expected-at));
    for(let i=0;i<bytes.length&&at+i<copied;i++){const index=at+i;bytes[i]=await pixels.at(Math.floor(index/chunkSamples)*4+Math.min(index%chunkSamples,3));}
    await append(bytes);if(at%65536===0)await defaultRuntime.yieldTurn(signal);
   }
   return {position,length};
  }
  if(compression===5||compression===32773){const buffer=new Uint8Array(4096);let used=0,work=0;
   for await(const value of compression===5?lzw(stripByte,start,end-start,Math.trunc(expected)):packBits(stripByte,start,end-start,Math.trunc(expected))){
    signal.throwIfAborted();buffer[used++]=value;if(used===4096){await append(buffer);used=0;if(++work%16===0)await defaultRuntime.yieldTurn(signal);}
   }if(used)await append(buffer.subarray(0,used));return {position,length};
  }
  if(compression===8||compression===32946){const codec=createByteCodec({direction:"decode",format:"zlib-or-gzip",chunkSize:4096});
   try {
    for(let at=start;at<end&&!codec.complete;at+=4096){const input=new Uint8Array(Math.min(4096,end-at));for(let i=0;i<input.length;i++)input[i]=await stripByte(at+i);
     for(const bytes of codec.push(input)){await append(bytes);await defaultRuntime.yieldTurn(signal);}
    }
    if(!codec.complete)for(const bytes of codec.push(new Uint8Array(),true)){await append(bytes);await defaultRuntime.yieldTurn(signal);}
   }finally{codec.close();}
   return {position,length};
  }
  for(let at=start;at<end&&length<max;at+=4096){const bytes=new Uint8Array(Math.min(4096,end-at,max-length));for(let i=0;i<bytes.length;i++)bytes[i]=await stripByte(at+i);await append(bytes);}
  return {position,length};
 };
 const predict=async(position:number,length:number,rowCount:number,rowStride:number)=>{
  if(predictor!==2||(sampleBytes!==1&&sampleBytes!==2&&sampleBytes!==4))return;
  const step=chunkSamples*sampleBytes;if(rowStride<=step)return;
  const raster=new Raster(position,length,storage,signal);let work=0;
  for(let y=0;y<rowCount&&y*rowStride<length;y++)for(let x=step;x+sampleBytes<=rowStride&&y*rowStride+x+sampleBytes<=length;x+=sampleBytes){
   if(++work%16384===0)await defaultRuntime.yieldTurn(signal);const at=y*rowStride+x,previous=at-step;
   if(sampleBytes===1)await raster.set(at,(await raster.at(at))+(await raster.at(previous)));
   else {
    let carry=0;
    for(let byte=0;byte<sampleBytes;byte++) {
     const offset=le?byte:sampleBytes-1-byte;
     const sum=(await raster.at(at+offset))+(await raster.at(previous+offset))+carry;
     await raster.set(at+offset,sum&255);carry=sum>>>8;
    }
   }
  }await raster.flush();
 };
 const copy=async(from:number,to:number,length:number)=>{for(let at=0;at<length;at+=4096){await write(to+at,await read(from+at,Math.min(4096,length-at)));if(at%65536===0)await defaultRuntime.yieldTurn(signal);}};
 if(tiled){const across=Math.max(1,Math.ceil(width/tileWidth)),expected=tileBytes,tilesPerPlane=across*Math.ceil(height/tileHeight);
  for(let i=0;i<tileOffsets.count;i++){const off=(await tileOffsets.at(i))!,raw=await tileCounts.at(i)??Math.max(0,source.size-off),tile=await decompress(off,raw,expected,expected,tileStride);await predict(tile.position,tile.length,tileHeight,tileStride);
   const x=i%across*tileWidth,y=Math.floor((planar?i%tilesPerPlane:i)/across)*tileHeight,planeOffset=planar?Math.floor(i/tilesPerPlane)*planeBytes:0,validWidth=Math.max(0,Math.min(tileWidth,width-x)),validHeight=Math.max(0,Math.min(tileHeight,height-y)),rowBytes=validWidth*pixelBytes;
   for(let row=0;row<validHeight;row++){const from=row*tileStride,to=planeOffset+(y+row)*stride+x*pixelBytes;if(from+rowBytes<=tile.length&&to+rowBytes<=total)await copy(tile.position+from,combined+to,rowBytes);}
  }
 }else {
  const stripRows=rows||height,stripsPerPlane=Math.ceil(height/stripRows);
  let destination=0;
  for(let i=0;i<offsets.count&&destination<total;i++){
   if(planar){
    if(i>=stripsPerPlane*samples)break;
    destination=Math.floor(i/stripsPerPlane)*planeBytes+(i%stripsPerPlane)*stripRows*stride;
   }
   const remaining=planar?planeBytes-destination%planeBytes:total-destination;
   const off=(await offsets.at(i))!,raw=await counts.at(i)??Math.max(0,source.size-off),expected=Math.min(remaining,stripRows*stride),strip=await decompress(off,raw,expected,remaining,stride);
   if(strip.length<expected)throw new Error("Truncated TIFF strip pixels");
   await copy(strip.position,combined+destination,strip.length);destination+=strip.length;
  }
  if(destination<total)throw new Error("Truncated TIFF strips");
  await predict(combined,total,height*(planar?samples:1),stride);
 }
 const palette=photometric===3,paletteSize=2**bits;
 if(palette&&(colorMap.count!==paletteSize*3||![8,16].includes(bits)))throw new Error("Invalid or unsupported TIFF ColorMap");
 const cmyk=photometric===5;
 const colorSamples=cmyk?4:photometric===0||photometric===1||palette?1:3;
 const hasAlpha=samples>colorSamples&&(extraSample===undefined||extraSample===1||extraSample===2);
 const metadata:StoredRgbaImage={...(xPosition||yPosition?{virtualCanvas:{width,height,x:Math.round(xPosition*xRes),y:Math.round(yPosition*yRes)}}:{}),...(pages>1?{pages}:{}),...(properties?{properties}:{}),width,height,position:combined,format:"tiff",space:cmyk?"cmyk":!palette&&colorSamples===1?bits===16?"grey16":"b-w":bits===16?"rgb16":"srgb",channels:cmyk?hasAlpha?5:4:!palette&&colorSamples===1?hasAlpha?2:1:hasAlpha?4:3,depth:bits===16?"ushort":"uchar",bitsPerSample:bits,density:Math.max(1,Math.round(xRes*(resUnit===3?2.54:1))),...(hasResolution?{resolution:{x:xRes,y:yRes,unit:resUnit===3?"cm" as const:resUnit===1?"unknown" as const:"inch" as const}}:{}),hasAlpha,orientation};
 const raster=new Raster(combined,total,storage,signal);
 const sampleBuffer=new Uint8Array(8),sampleView=new DataView(sampleBuffer.buffer);
 const readSample=async(at:number,high:boolean)=>{
  if(high)return (await raster.at(at+(le?1:0)))*256+await raster.at(at+(le?0:1));
  if(sampleFormat!==3&&bits!==32)return raster.at(at+(sampleBytes===2&&le?1:0));
  if(bits!==16&&bits!==32&&bits!==64)throw new Error(`Unsupported floating-point TIFF sample width: ${bits}`);
  for(let byte=0;byte<sampleBytes;byte++)sampleBuffer[byte]=await raster.at(at+byte);
  // ImageMagick imports both integer formats as unsigned bits into float Q16 samples.
  if(sampleFormat!==3)return Math.round(Math.fround(sampleView.getUint32(0,le)/65537)/257);
  return readTiffFloat8(sampleView,0,bits,le);
 };
 const images:StoredRgbaImage[]=[];
 // Decode the color image first, then each additional grayscale plane.
 for(let channel=colorSamples+Number(hasAlpha)-1;channel<samples;channel++) {
 const meta=channel>=colorSamples+Number(hasAlpha);
 const output=new Output(meta?{...metadata,space:bits===16?"grey16":"b-w",channels:1,hasAlpha:false}:metadata,width,height,storage,signal);
 const storedData16=bits===16&&sampleFormat!==3?{position:allocate(width*height*8),length:width*height*4}:undefined;
 const storedHueSamples=cmyk&&!meta?allocate(width*height*32):undefined;
 const inks=new Float64Array(storedHueSamples===undefined?0:2048);
 for(const high of storedData16?[false,true]:[false]) {
  const max=high?65535:255,buffer=new Uint16Array(2048);
  let used=0,offset=0;
  const pixel=async(r:number,g:number,b:number,a:number)=>{
   if(!high){await output.pixel(r,g,b,a);return;}
   buffer[used++]=r;buffer[used++]=g;buffer[used++]=b;buffer[used++]=a;
   if(used===buffer.length){await write(storedData16!.position+offset,new Uint8Array(buffer.buffer));offset+=used*2;used=0;await defaultRuntime.yieldTurn(signal);}
  };
  for(let i=0;i<width*height;i++){const base=i*pixelBytes,channelStep=planar?planeBytes:sampleBytes,r=await readSample(base,high);
   if(meta){const value=await readSample(base+channelStep*channel,high);await pixel(value,value,value,max);continue;}
   const alpha=hasAlpha?await readSample(base+channelStep*colorSamples,high):max;
   const straight=(value:number)=>hasAlpha&&extraSample===1?Math.min(max,Math.round(value*max/Math.max(alpha,Number.EPSILON))):value;
   if(palette){
    const index=await readSample(base,bits===16);
    const color=async(channel:number)=>{const value=(await colorMap.at(channel*paletteSize+index))!;return straight(high?value:Math.round(value/257));};
    await pixel(await color(0),await color(1),await color(2),alpha);
   }
   else if(cmyk){
    if(storedHueSamples!==undefined&&(high||!storedData16)){
     const offset=(i*4)%inks.length;
     for(let c=0;c<4;c++)inks[offset+c]=straight(await readSample(base+channelStep*c,high))/max;
     if(offset+4===inks.length||i+1===width*height)await write(storedHueSamples+(i*4-offset)*8,new Uint8Array(inks.buffer,0,(offset+4)*8));
    }
    const black=straight(await readSample(base+channelStep*3,high));
    const rgb=(ink:number)=>Math.round((max-straight(ink))*(max-black)/max);
    await pixel(rgb(r),rgb(await readSample(base+channelStep,high)),rgb(await readSample(base+channelStep*2,high)),alpha);
   }
   else if(colorSamples===1){const gray=straight(photometric===0?max-r:r);await pixel(gray,gray,gray,alpha);}
   else if(photometric===6&&compression!==6&&compression!==7){const rgb=tiffYCbCrToRgb(r,await readSample(base+channelStep,high),await readSample(base+channelStep*2,high),max);await pixel(straight(rgb[0]),straight(rgb[1]),straight(rgb[2]),alpha);}
   else if(photometric===8){const rgb=tiffLabToRgb(r,await readSample(base+channelStep,high),await readSample(base+channelStep*2,high),max);await pixel(straight(rgb[0]),straight(rgb[1]),straight(rgb[2]),alpha);}
   else await pixel(straight(r),straight(await readSample(base+channelStep,high)),straight(await readSample(base+channelStep*2,high)),alpha);
  }
  if(high&&used)await write(storedData16!.position+offset,new Uint8Array(buffer.buffer,0,used*2));
 }
 images.push({...await output.finish(),...(storedData16?{storedData16}:{}),...(storedHueSamples===undefined?{}:{storedHueSamples})});
 }
 const [image,...storedMetaChannels]=images;
 return {...image!,...(storedMetaChannels.length?{storedMetaChannels}:{})};
}
