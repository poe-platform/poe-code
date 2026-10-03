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
async function* lzw(reader:SourceBytes,start:number,length:number,expected:number) {
 const prefix=new Int16Array(4096),suffix=new Uint8Array(4096),stack=new Uint8Array(4097);
 let next=258,width=9,previous=-1,at=start,bits=0,buffer=0,written=0;
 const code=async()=>{while(bits<width){if(at>=start+length)return 257;buffer=(buffer<<8)|(await reader.at(at++)??0);bits+=8;}bits-=width;return (buffer>>>bits)&((1<<width)-1);};
 const expand=(value:number)=>{let used=0;while(value>=258){stack[used++]=suffix[value]!;value=prefix[value]!;}if(value<256)stack[used++]=value;return used;};
 while(written<expected) {
  let current=await code();if(current===257)break;
  if(current===256){next=258;width=9;current=await code();if(current===257)break;previous=current<258?current:current&255;const count=expand(previous);for(let i=count-1;i>=0&&written<expected;i--){yield stack[i]!;written++;}continue;}
  const special=current===next&&previous>=0;
  if(current>=next&&!special)break;
  const count=expand(special?previous:current),first=count?stack[count-1]!:0;
  for(let i=count-1;i>=0&&written<expected;i--){yield stack[i]!;written++;}
  if(special&&written<expected){yield first;written++;}
  if(previous>=0&&next<4096){prefix[next]=previous;suffix[next]=first;next++;if(next===511||next===1023||next===2047)width++;}
  previous=current;
 }
 // Existing TIFF semantics pad incomplete streams to the expected strip length.
 while(written++<expected)yield 0;
}
async function* packBits(reader:SourceBytes,start:number,length:number,expected:number) {
 let at=start,written=0;
 while(at<start+length&&written<expected){const n=await reader.at(at++)??0;
  if(n<128){for(let i=0;i<=n&&at<start+length&&written<expected;i++){yield await reader.at(at++)??0;written++;}}
  else if(n!==128){const value=at<start+length?await reader.at(at++)??0:0;for(let i=0;i<257-n&&written<expected;i++){yield value;written++;}}
 }
 while(written++<expected)yield 0;
}

/** Classic TIFF strips/tiles and tags stay in the caller's source and scratch storage. */
export async function decodeTiffToStorage(source:ImageByteSource,storage:ImageByteStorage,signal:AbortSignal,options?:SharpInputOptions):Promise<StoredRgbaImage> {
 signal.throwIfAborted();const reader=new SourceBytes(source,signal,"TIFF");
 const byte=async(at:number)=>{const value=await reader.at(at);if(value===undefined)throw new RangeError("Truncated TIFF directory");return value;};
 const le=(await byte(0))===73;
 const number=async(at:number,size:number)=>{let value=0;for(let i=0;i<size;i++)value+=(await byte(at+i))*2**(8*(le?i:size-i-1));return value;};
 const ifd=await number(4,4),count=await number(ifd,2);
 let width=0,height=0,bits=8,compression=1,photometric=2,samples=4,rows=0,predictor=1,xRes=72,resUnit=2,tileWidth=0,tileHeight=0,orientation:number|undefined;
 let jpegTables:{start:number;length:number}|undefined;
 let offsets:Values={count:1,async at(i){return i===0?8:undefined;}},counts=empty,tileOffsets=empty,tileCounts=empty;
 for(let i=0;i<count;i++) {
  const p=ifd+2+i*12,tag=await number(p,2),type=await number(p+2,2),n=await number(p+4,4),size=type===3?2:type===4?4:type===5?8:1;
  const start=n*size<=4?p+8:await number(p+8,4),available=Math.max(0,Math.min(n,Math.floor((source.size-start)/size)));
  const values:Values={count:available,async at(index){if(index<0||index>=available)return undefined;const at=start+index*size;if(type!==5)return number(at,size);const num=await number(at,4),den=await number(at+4,4);return den>0?num/den:num;}};
  const first=await values.at(0)??0;
  if(tag===256)width=first;else if(tag===257)height=first;
  else if(tag===258&&first>0)bits=first;else if(tag===259&&first>0)compression=first;
  else if(tag===262)photometric=first;else if(tag===273&&available)offsets=values;
  else if(tag===274&&first>=1&&first<=8)orientation=first;else if(tag===277&&first>0)samples=first;
  else if(tag===278&&first>0)rows=first;else if(tag===279&&available)counts=values;
  else if(tag===282&&first>0)xRes=first;else if(tag===296&&(first===2||first===3))resUnit=first;
  else if(tag===317&&first>0)predictor=first;else if(tag===322&&first>0)tileWidth=first;
  else if(tag===323&&first>0)tileHeight=first;else if(tag===324&&available)tileOffsets=values;else if(tag===325&&available)tileCounts=values;
  else if(tag===347){const offset=n<=4?p+8:await number(p+8,4);if(offset+n<=source.size)jpegTables={start:offset,length:n};}
 }
 const sampleBytes=Math.max(1,bits>>>3),pixelBytes=samples*sampleBytes,stride=width*pixelBytes,total=height*stride;
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
 const decompress=async(off:number,rawLength:number,expected:number,max:number)=>{
  // Uint8Array.subarray clamps source offsets in the compatibility decoder.
  const start=Math.min(source.size,Math.max(0,Math.trunc(off))),end=Math.max(start,Math.min(source.size,Math.trunc(off+rawLength))),position=scratch;
  let length=0;
  const append=async(bytes:Uint8Array)=>{const size=Math.min(bytes.length,max-length);if(size>0){await write(position+length,bytes.subarray(0,size));length+=size;}};
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
   const copied=Math.min(image.width*image.height,Math.floor(expected/samples))*samples;
   for(let at=0;at<expected;at+=4096){
    const bytes=new Uint8Array(Math.min(4096,expected-at));
    for(let i=0;i<bytes.length&&at+i<copied;i++){const index=at+i;bytes[i]=await pixels.at(Math.floor(index/samples)*4+Math.min(index%samples,3));}
    await append(bytes);if(at%65536===0)await defaultRuntime.yieldTurn(signal);
   }
   return {position,length};
  }
  if(compression===5||compression===32773){const buffer=new Uint8Array(4096);let used=0,work=0;
   for await(const value of compression===5?lzw(reader,start,end-start,Math.trunc(expected)):packBits(reader,start,end-start,Math.trunc(expected))){
    signal.throwIfAborted();buffer[used++]=value;if(used===4096){await append(buffer);used=0;if(++work%16===0)await defaultRuntime.yieldTurn(signal);}
   }if(used)await append(buffer.subarray(0,used));return {position,length};
  }
  if(compression===8||compression===32946){const codec=createByteCodec({direction:"decode",format:"zlib-or-gzip",chunkSize:4096});let invalid=false;
   try {
    for(let at=start;at<end&&!codec.complete;at+=4096){const input=new Uint8Array(Math.min(4096,end-at));for(let i=0;i<input.length;i++)input[i]=await reader.at(at+i)??0;
     const iterator=codec.push(input);while(true){let next:IteratorResult<Uint8Array>;try{next=iterator.next();}catch{invalid=true;break;}if(next.done)break;await append(next.value);await defaultRuntime.yieldTurn(signal);}if(invalid)break;
    }
    if(!invalid&&!codec.complete){const iterator=codec.push(new Uint8Array(),true);while(true){let next:IteratorResult<Uint8Array>;try{next=iterator.next();}catch{invalid=true;break;}if(next.done)break;await append(next.value);await defaultRuntime.yieldTurn(signal);}}
   }finally{codec.close();}
   if(!invalid)return {position,length};length=0;
  }
  for(let at=start;at<end&&length<max;at+=4096){const bytes=new Uint8Array(Math.min(4096,end-at,max-length));for(let i=0;i<bytes.length;i++)bytes[i]=await reader.at(at+i)??0;await append(bytes);}
  return {position,length};
 };
 const predict=async(position:number,length:number,rowCount:number,rowStride:number)=>{
  if(predictor!==2||(sampleBytes!==1&&sampleBytes!==2))return;
  const step=samples*sampleBytes;if(rowStride<=step)return;
  const raster=new Raster(position,length,storage,signal);let work=0;
  for(let y=0;y<rowCount&&y*rowStride<length;y++)for(let x=step;x+sampleBytes<=rowStride&&y*rowStride+x+sampleBytes<=length;x+=sampleBytes){
   if(++work%16384===0)await defaultRuntime.yieldTurn(signal);const at=y*rowStride+x,previous=at-step;
   if(sampleBytes===1)await raster.set(at,(await raster.at(at))+(await raster.at(previous)));
   else {const a=await raster.at(at),b=await raster.at(at+1),c=await raster.at(previous),d=await raster.at(previous+1),sum=(le?a+(b<<8)+c+(d<<8):(a<<8)+b+(c<<8)+d)&65535;await raster.set(at,le?sum&255:sum>>>8);await raster.set(at+1,le?sum>>>8:sum&255);}
  }await raster.flush();
 };
 const copy=async(from:number,to:number,length:number)=>{for(let at=0;at<length;at+=4096){await write(to+at,await read(from+at,Math.min(4096,length-at)));if(at%65536===0)await defaultRuntime.yieldTurn(signal);}};
 if(tiled){const across=Math.max(1,Math.ceil(width/tileWidth)),expected=tileBytes;
  for(let i=0;i<tileOffsets.count;i++){const off=(await tileOffsets.at(i))!,raw=await tileCounts.at(i)??Math.max(0,source.size-off),tile=await decompress(off,raw,expected,expected);await predict(tile.position,tile.length,tileHeight,tileStride);
   const x=i%across*tileWidth,y=Math.floor(i/across)*tileHeight,validWidth=Math.max(0,Math.min(tileWidth,width-x)),validHeight=Math.max(0,Math.min(tileHeight,height-y)),rowBytes=validWidth*pixelBytes;
   for(let row=0;row<validHeight;row++){const from=row*tileStride,to=(y+row)*stride+x*pixelBytes;if(from+rowBytes<=tile.length&&to+rowBytes<=total)await copy(tile.position+from,combined+to,rowBytes);}
  }
 }else {let destination=0;for(let i=0;i<offsets.count&&destination<total;i++){const off=(await offsets.at(i))!,raw=await counts.at(i)??Math.max(0,source.size-off),expected=Math.min(total-destination,(rows>0?rows:height)*stride),strip=await decompress(off,raw,expected,total-destination);await copy(strip.position,combined+destination,strip.length);destination+=strip.length;}await predict(combined,total,height,stride);}
 const metadata:StoredRgbaImage={width,height,position:combined,format:"tiff",space:samples<3?bits===16?"grey16":"b-w":bits===16?"rgb16":"srgb",channels:samples===4?4:samples===1?1:3,depth:bits===16?"ushort":"uchar",bitsPerSample:bits,density:Math.max(1,Math.round(xRes*(resUnit===3?2.54:1))),hasAlpha:samples===2||samples===4,...(orientation===undefined?{}:{orientation})};
 const raster=new Raster(combined,total,storage,signal),output=new Output(metadata,width,height,storage,signal);
 for(let i=0;i<width*height;i++){const base=i*pixelBytes+(sampleBytes===2&&le?1:0),r=await raster.at(base);
  if(samples<3){const gray=photometric===0?255-r:r;await output.pixel(gray,gray,gray,samples===2?await raster.at(base+sampleBytes):255);}
  else await output.pixel(r,await raster.at(base+sampleBytes),await raster.at(base+sampleBytes*2),samples>=4?await raster.at(base+sampleBytes*3):255);
 }
 return output.finish();
}
