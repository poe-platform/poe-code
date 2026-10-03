import {yieldTurn} from "safe-bash-contracts/yield";
import type { ImageByteSource, ImageFormat } from "@poe-code/image-ast/portable";

// A namespaced payload in standard PNG iTXt / JPEG COM containers. No process
// state: copying, replacing, or deleting a file also copies/replaces/deletes its properties.
const keyword = "safe-bash-sips";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const maxMetadataBytes = 65500;

function payloadProperties(bytes: Uint8Array): Map<string, string | null> {
  if (bytes.length > maxMetadataBytes) throw new Error("sips metadata byte limit exceeded");
  const value: unknown = JSON.parse(decoder.decode(bytes));
  if (!Array.isArray(value)) throw new Error("Invalid sips metadata");
  const result = new Map<string, string | null>();
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || (entry[1] !== null && typeof entry[1] !== "string")) {
      throw new Error("Invalid sips metadata property");
    }
    result.set(entry[0], entry[1]);
  }
  return result;
}

type PropertyRange={readonly position:number;readonly length:number};
function* propertySteps(size:number,format:ImageFormat):Generator<PropertyRange,Map<string,string|null>,Uint8Array>{
  const prefix = encoder.encode(format === "png" ? `${keyword}\0\0\0\0\0` : `${keyword}\0`);
  let offset = format === "png" ? 8 : 2;
  while ((format === "png" || format === "jpeg") && offset + 4 <= size) {
    const header=yield {position:offset,length:4};
    const view=new DataView(header.buffer,header.byteOffset,header.byteLength);
    let start:number,end:number,candidate:boolean;
    if(format==="png"){
      start=offset+8;end=start+view.getUint32(0);
      if(end+4>size)throw new Error("Invalid PNG metadata chunk");
      const type=yield {position:offset+4,length:4};
      candidate=new DataView(type.buffer,type.byteOffset,type.byteLength).getUint32(0)===0x69545874;
      offset=end+4;
    }else{
      if(header[0]!==0xff||header[1]===0xda||header[1]===0xd9)break;
      const length=view.getUint16(2);
      if(length<2||offset+2+length>size)throw new Error("Invalid JPEG metadata segment");
      start=offset+4;end=offset+2+length;candidate=header[1]===0xfe;offset=end;
    }
    if(candidate&&end-start>=prefix.length){
      const key=yield {position:start,length:prefix.length};
      if(prefix.every((byte,index)=>key[index]===byte)){
        const length=end-start-prefix.length;
        if(length>maxMetadataBytes)throw new Error("sips metadata byte limit exceeded");
        return payloadProperties(yield {position:start+prefix.length,length});
      }
    }
  }
  return new Map();
}

export function readProperties(bytes:Uint8Array,format:ImageFormat):Map<string,string|null>{
  const steps=propertySteps(bytes.length,format);let next=steps.next();
  while(!next.done){const {position,length}=next.value;next=steps.next(bytes.subarray(position,position+length));}
  return next.value;
}

/** Inspect only headers and the bounded namespaced payload; unrelated data is skipped. */
export async function readPropertiesFromSource(source:ImageByteSource,format:ImageFormat,signal:AbortSignal):Promise<Map<string,string|null>>{
  signal.throwIfAborted();
  if(!Number.isSafeInteger(source.size)||source.size<0)throw new RangeError("Invalid image source size");
  const steps=propertySteps(source.size,format);let next=steps.next(),work=63;
  while(!next.done){
    if(++work%64===0)await yieldTurn(signal);
    signal.throwIfAborted();const {position,length}=next.value,bytes=new Uint8Array(length);
    for(let offset=0;offset<length;){
      signal.throwIfAborted();const count=Math.min(16384,length-offset),chunk=await source.read(position+offset,count,{signal});signal.throwIfAborted();
      if(!(chunk instanceof Uint8Array)||chunk.length!==count)throw new Error("Truncated image metadata source");
      bytes.set(chunk,offset);offset+=count;
    }
    next=steps.next(bytes);
  }
  return next.value;
}

export function writeProperties(bytes: Uint8Array, format: ImageFormat, properties: ReadonlyMap<string, string | null>): Uint8Array {
  if (properties.size === 0) return bytes;
  if (format !== "png" && format !== "jpeg") throw new Error(`sips property persistence is not supported for ${format}; use PNG or JPEG output`);
  // Check before serialization/encoding as well as after UTF-8 expansion.
  let size = 0;
  for (const [key, value] of properties) {
    size += key.length + (value?.length ?? 4) + 8;
    if (size > maxMetadataBytes) throw new Error("sips metadata byte limit exceeded");
  }
  const payload = encoder.encode(JSON.stringify([...properties]));
  if (payload.length > maxMetadataBytes) throw new Error("sips metadata byte limit exceeded");
  const prefix = encoder.encode(format === "png" ? `${keyword}\0\0\0\0\0` : `${keyword}\0`);
  const dataLength = prefix.length + payload.length;
  const chunk = new Uint8Array(dataLength + (format === "png" ? 12 : 4));
  const view = new DataView(chunk.buffer);
  const dataOffset = format === "png" ? 8 : 4;
  chunk.set(prefix, dataOffset);
  chunk.set(payload, dataOffset + prefix.length);
  if (format === "png") {
    view.setUint32(0, dataLength);
    view.setUint32(4, 0x69545874);
    let crc = 0xffffffff;
    for (let index = 4; index < chunk.length - 4; index++) {
      crc ^= chunk[index]!;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  } else {
    view.setUint16(0, 0xfffe);
    view.setUint16(2, dataLength + 2);
  }
  // Freshly encoded images have no prior payload. PNG inserts after IHDR;
  // JPEG inserts after SOI, before the first image segment.
  const offset = format === "png" ? 33 : 2;
  const output = new Uint8Array(bytes.length + chunk.length);
  output.set(bytes.subarray(0, offset));
  output.set(chunk, offset);
  output.set(bytes.subarray(offset), offset + chunk.length);
  return output;
}
