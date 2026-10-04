import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {PdfFileSource} from "../source.js";
import {Jbig2Image} from "../vendor/pdfjs-image-decoders.mjs";
import {PdfRetainedJbig2} from "./retained-jbig2.js";

function halftone(mmr:boolean,template:number,clipped:boolean,fill:number){
 const payload=new Uint8Array(mmr?4:128);
 if(mmr){const bits="1111111"+"000000000001000000000001";for(let i=0;i<bits.length;i++)if(bits[i]==="1")payload[i>>3]!|=128>>(i&7);}
 else for(let i=0;i<payload.length;i++)payload[i]=(i*37+81)%255;
 const bytes=new Uint8Array(100+payload.length),view=new DataView(bytes.buffer);
 bytes.set(new Uint8Array(readFileSync(new URL("../fixtures/jbig2-generic-stream.bin",import.meta.url))).subarray(0,30));
 view.setUint32(11,20);view.setUint32(15,20);
 view.setUint32(30,1);bytes[34]=16;bytes[36]=1;view.setUint32(37,9);bytes.set([1,2,2],41);view.setUint32(44,1);
 // Collective MMR rows: white, black, white, white. Split into two 2x2 patterns.
 bytes.set([0x23,0xaf],48);
 view.setUint32(50,2);bytes[54]=22;bytes[55]=32;bytes[56]=1;bytes[57]=1;view.setUint32(58,38+payload.length);
 view.setUint32(62,10);view.setUint32(66,10);view.setUint32(70,3);view.setUint32(74,4);
 bytes[79]=(mmr?1:0)|(template<<1)|(fill<<7);view.setUint32(80,5);view.setUint32(84,7);
 view.setInt32(88,clipped?-256:256);view.setInt32(92,clipped?-256:256);view.setUint16(96,256);bytes.set(payload,100);
 return bytes;
}

it.each([false,true].flatMap(mmr=>[0,1,2,3].flatMap(template=>[false,true].flatMap(clipped=>[0,1].map(fill=>({mmr,template,clipped,fill}))))))(
 "backs halftone pixels mmr=$mmr template=$template clipped=$clipped fill=$fill",async ({mmr,template,clipped,fill})=>{
 const bytes=halftone(mmr,template,clipped,fill),expected=new Jbig2Image().parseChunks([{data:bytes,start:0,end:bytes.length}])!;
 expect(expected.some(byte=>byte!==0)).toBe(true);expect(expected.some(byte=>byte!==255)).toBe(true);
 const fs=createMemoryFileSystem();await fs.mkdir("/scratch");await fs.writeFile("/input",bytes);
 const source=await PdfFileSource.open(fs,"/input"),storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal:new AbortController().signal},2);
 try{const image=await PdfRetainedJbig2.open(source,20,20,{bitmapStorage:storage,maxWorkingBytes:262144});
  try{let y=0;for await(const row of image.rows()){
   for(let x=0;x<20;x++)expect(row[x*4]).toBe(expected[y*3+(x>>3)]!>>(7-(x&7))&1?0:255);
   y++;
  }expect(y).toBe(20);}finally{image.close();}
 }finally{await storage.close();await source.close();expect(await fs.readdir("/scratch")).toEqual([]);}
});
