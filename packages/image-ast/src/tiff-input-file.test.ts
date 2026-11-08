import {expect,it} from "vitest";
import {deflateSync} from "node:zlib";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
function fixture(compression:number):Uint8Array {
 const width=37,height=29,raw=Uint8Array.from({length:width*height*4},(_,i)=>i*43%256);
 let payload:Uint8Array=raw;
 if(compression===8||compression===32946) payload=deflateSync(raw);
 if(compression===32773) {const bytes:number[]=[];for(let i=0;i<raw.length;i+=128){const chunk=raw.subarray(i,i+128);bytes.push(chunk.length-1,...chunk);}payload=new Uint8Array(bytes);}
 if(compression===5) {
  // Independent literal-code TIFF LZW fixture; clear before width transitions.
  const codes:number[]=[];for(let i=0;i<raw.length;i+=200)codes.push(256,...raw.subarray(i,i+200));codes.push(257);
  payload=new Uint8Array(Math.ceil(codes.length*9/8));let bit=0;
  for(const code of codes)for(let j=8;j>=0;j--,bit++)payload[bit>>>3]!|=((code>>>j)&1)<<(7-(bit&7));
 }
 const entries=[[256,width],[257,height],[258,8],[259,compression],[262,2],[273,8],[277,4],[278,height],[279,payload.length]];
 const ifd=8+payload.length,bytes=new Uint8Array(ifd+2+entries.length*12+4),view=new DataView(bytes.buffer);
 bytes.set([73,73,42,0]);view.setUint32(4,ifd,true);bytes.set(payload,8);view.setUint16(ifd,entries.length,true);
 entries.forEach(([tag,value],i)=>{const at=ifd+2+i*12;view.setUint16(at,tag!,true);view.setUint16(at+2,4,true);view.setUint32(at+4,1,true);view.setUint32(at+8,value!,true);});return bytes;
}
it.each([1,8,32946,32773,5])("decodes TIFF compression %s through retained caller storage",async compression=>{
 const fs=new MemoryFileSystem(),bytes=fixture(compression);await fs.writeFile("/in",bytes);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const pipeline=(image:ReturnType<typeof sharp>)=>image.resize(19,13).flip().rotate(17).png();
 const expected=pipeline(sharp(bytes)).toBufferWithObjectSync(),info=await pipeline(sharp("/in",{filesystem:guarded})).toFile("/out");
 const actual=await fs.readFile("/out");expect(info).toEqual({...expected.info,size:actual.length});expect(Buffer.compare(sharp(actual).raw().toBufferSync(),sharp(expected.data).raw().toBufferSync())).toBe(0);expect(sharp(actual).metadataSync()).toEqual({...sharp(expected.data).metadataSync(),size:actual.length});
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in","out"]);
});

import {decodeTiffToStorage} from "./codecs/tiff-input-storage.js";
import {decodeTiffImage} from "./codecs/netpbm.js";
import {PagedStorage} from "@poe-code/safe-fs/storage";
it.each([1,8,32946,32773,5])("matches TIFF decoder pixels and metadata for %s",async compression=>{
 const bytes=fixture(compression),fs=new MemoryFileSystem(),signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/",env:{},signal});
 try {const image=await decodeTiffToStorage({size:bytes.length,async read(at,length){return bytes.subarray(at,at+length);}},storage,signal),{data,...metadata}=decodeTiffImage(bytes),{position,...actual}=image;
 expect(actual).toEqual(metadata);expect(Buffer.compare(await storage.read(position,data.length),data)).toBe(0);
 }finally{await storage.close();}
});
