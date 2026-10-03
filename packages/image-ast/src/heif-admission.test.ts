import {expect,it} from "vitest";
import sharp from "./index.js";
import {readImageMetadata} from "./codecs/index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {readImageMetadataFromSource} from "./codecs/metadata-source.js";

for(const offset of [64,1028,16384,65536])for(const brand of ["heic","heif","avif"])it(`retains ${brand} with a compatible brand at ${offset}`,async()=>{
 const original=sharp({create:{width:7,height:5,channels:4,background:"red"}}).heif().toBufferSync();
 const oldSize=new DataView(original.buffer,original.byteOffset,original.byteLength).getUint32(0),size=offset+4;
 const bytes=new Uint8Array(size+original.length-oldSize);bytes.set(original.subarray(oldSize),size);new DataView(bytes.buffer).setUint32(0,size);bytes.set(new TextEncoder().encode("ftypzzzz"),4);bytes.set(new TextEncoder().encode(brand),offset);
 const expected=sharp(bytes).metadataSync();expect(expected.format).toBe(brand);
 let largest=0;
 expect(await readImageMetadataFromSource({size:bytes.length,async read(position,length){largest=Math.max(largest,length);return bytes.slice(position,position+length);}},new AbortController().signal)).toEqual(readImageMetadata(bytes));
 expect(largest).toBeLessThanOrEqual(4096);
 const fs=new MemoryFileSystem();await fs.writeFile("/in",bytes);
 const filesystem=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 expect(await sharp("/in",{filesystem}).metadata()).toEqual(expected);
 await sharp("/in",{filesystem}).flip().png().toFile("/out");
 expect(sharp(await fs.readFile("/out")).raw().toBufferSync()).toEqual(sharp(bytes).flip().raw().toBufferSync());
});

import {detectHeifFormat,detectHeifFormatFromSource} from "./codecs/heif-format.js";
const brandFile=(major:string,brands:readonly string[],declared?:number)=>{
 const bytes=new Uint8Array(16+brands.length*4);new DataView(bytes.buffer).setUint32(0,declared??bytes.length);bytes.set(new TextEncoder().encode("ftyp"+major),4);
 brands.forEach((brand,index)=>bytes.set(new TextEncoder().encode(brand),16+index*4));return bytes;
};
for(const [major,brands,expected] of [
 ["avif",["heic"],"avif"],["heic",["avif"],"heic"],["heif",["avif"],"heif"],
 ["mif1",["avif"],"avif"],["msf1",["heic","avif"],"heic"],["mif1",["heif","heic","avif"],"heif"],
 ["mif1",["heif","avif"],"avif"],["mif1",[],"heif"],["zzzz",["heif","heic","avif"],"avif"],
 ["zzzz",["mif1","heic"],"heic"],["zzzz",["msf1"],"heif"],["zzzz",["none"],undefined]
] as const)it(`preserves HEIF brand precedence ${major}/${brands.join(",")}`,async()=>{
 const bytes=brandFile(major,brands);expect(detectHeifFormat(bytes)).toBe(expected);
 expect(await detectHeifFormatFromSource({size:bytes.length,async read(position,length){return bytes.subarray(position,position+length);}},new AbortController().signal)).toBe(expected);
});
for(const declared of [0,1,15,16,17,19,20,999999])it(`preserves HEIF declared box size ${declared}`,async()=>{
 const bytes=brandFile("zzzz",["heic"],declared),expected=declared===0||declared>=20?"heic":undefined;
 expect(detectHeifFormat(bytes)).toBe(expected);
 expect(await detectHeifFormatFromSource({size:bytes.length,async read(position,length){return bytes.slice(position,position+length);}},new AbortController().signal)).toBe(expected);
});
for(const mode of ["read","short","cancel"] as const)it(`propagates HEIF admission ${mode} failures`,async()=>{
 const bytes=brandFile("zzzz",["heic"]),controller=new AbortController(),failure=new Error(mode);let reads=0;
 const result=detectHeifFormatFromSource({size:bytes.length,async read(position,length){if(++reads===2){if(mode==="read")throw failure;if(mode==="cancel")controller.abort(failure);if(mode==="short")return new Uint8Array();}return bytes.slice(position,position+length);}},controller.signal);
 if(mode==="short")await expect(result).rejects.toThrow("Truncated HEIF source");else await expect(result).rejects.toBe(failure);
 expect(reads).toBe(2);
});
it("yields to cancellation while scanning a large unknown brand list",async()=>{
 const size=1024*1024,header=brandFile("zzzz",[],size),controller=new AbortController(),failure=new Error("abort scan");let reads=0;
 const timer=setTimeout(()=>controller.abort(failure),0);
 try{await expect(detectHeifFormatFromSource({size,async read(position,length){reads++;const bytes=new Uint8Array(length);if(position===0)bytes.set(header);return bytes;}},controller.signal)).rejects.toBe(failure);expect(reads).toBeLessThanOrEqual(64);}finally{clearTimeout(timer);}
});
