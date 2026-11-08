import type {ImageByteSource} from "./png-storage.js";

type HeifFormat="heic"|"heif"|"avif";
const heicBrands=new Set(["heic","heix","hevc","hevx","heim","heis","hevm","hevs"]);
const avifBrands=new Set(["avif","avis","avio"]);
const genericBrands=new Set(["mif1","msf1","heif"]);
const brandAt=(bytes:Uint8Array,offset:number)=>String.fromCharCode(bytes[offset]!,bytes[offset+1]!,bytes[offset+2]!,bytes[offset+3]!);

/** Brand precedence is shared by explicit byte buffers and bounded retained reads. */
function* heifFormatSteps(size:number):Generator<{position:number;length:number},HeifFormat|undefined,Uint8Array>{
 if(size<16)return undefined;
 const header=yield {position:0,length:16};
 if(brandAt(header,4)!=="ftyp")return undefined;
 let end=new DataView(header.buffer,header.byteOffset,header.byteLength).getUint32(0,false);
 if(end===0||end>size)end=Math.min(size,64);
 if(end<16)return undefined;
 const major=brandAt(header,8);
 if(avifBrands.has(major))return "avif";
 if(heicBrands.has(major))return "heic";
 if(major==="heif")return "heif";
 let avif=false,heic=false,heif=false,generic=false;
 for(let position=16;position+4<=end;){
  const length=Math.min(4096,Math.floor((end-position)/4)*4),bytes=yield {position,length};
  for(let offset=0;offset<length;offset+=4){const brand=brandAt(bytes,offset);avif ||= avifBrands.has(brand);heic ||= heicBrands.has(brand);heif ||= brand==="heif";generic ||= genericBrands.has(brand);}
  position+=length;
 }
 if(genericBrands.has(major)){if(avif&&!heic)return "avif";if(heif)return "heif";return heic?"heic":"heif";}
 return avif?"avif":heic?"heic":generic?"heif":undefined;
}

export function detectHeifFormat(bytes:Uint8Array):HeifFormat|undefined{
 const steps=heifFormatSteps(bytes.length);let next=steps.next();
 while(!next.done)next=steps.next(bytes.subarray(next.value.position,next.value.position+next.value.length));
 return next.value;
}

export async function detectHeifFormatFromSource(source:ImageByteSource,signal:AbortSignal):Promise<HeifFormat|undefined>{
 signal.throwIfAborted();
 if(!Number.isSafeInteger(source.size)||source.size<0)throw new RangeError("Invalid image source size");
 const steps=heifFormatSteps(source.size);let next=steps.next(),reads=0;
 while(!next.done){
  signal.throwIfAborted();const {position,length}=next.value,bytes=await source.read(position,length,{signal});signal.throwIfAborted();
  if(!(bytes instanceof Uint8Array)||bytes.length!==length)throw new Error("Truncated HEIF source");
  next=steps.next(bytes);
  if(++reads%64===0){await new Promise<void>(resolve=>setTimeout(resolve,0));signal.throwIfAborted();}
 }
 return next.value;
}
