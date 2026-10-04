import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {PdfFileSource} from "../source.js";
import {PdfRetainedJpx} from "./retained-jpx.js";
import {decodeJpxToRgba} from "./images.js";

function image(levels:number,order:number){
 const original=new Uint8Array(readFileSync(new URL("../fixtures/rgb-lossless.j2k",import.meta.url)));
 const parts:Uint8Array[]=[original.slice(0,2)];
 for(let at=2;at<original.length;){
  const marker=(original[at]!<<8)|original[at+1]!;
  if(marker===0xff90){const part=original.slice(at,at+14);const packets:number[]=[],emit=(r:number,l:number)=>packets.push(r?0:l?192:224);
   if(order===0)for(let l=0;l<2;l++)for(let r=0;r<=levels;r++)for(let c=0;c<3;c++)emit(r,l);
   else if(order===1)for(let r=0;r<=levels;r++)for(let l=0;l<2;l++)for(let c=0;c<3;c++)emit(r,l);
   else if(order===2)for(let r=0;r<=levels;r++)for(let c=0;c<3;c++)for(let l=0;l<2;l++)emit(r,l);
   else for(let c=0;c<3;c++)for(let r=0;r<=levels;r++)for(let l=0;l<2;l++)emit(r,l);
   new DataView(part.buffer).setUint32(6,14+packets.length);parts.push(part,new Uint8Array(packets),new Uint8Array([255,217]));break;}
  const size=new DataView(original.buffer).getUint16(at+2),part=original.slice(at,at+2+size),view=new DataView(part.buffer);
  if(marker===0xff51)for(const offset of [6,10,22,26])view.setUint32(offset,1);
  if(marker===0xff52){part[9]=levels;part[5]=order;view.setUint16(6,2);}
  if(marker===0xff5c){const qcd=new Uint8Array(5+levels*3+1);qcd.set([255,92]);new DataView(qcd.buffer).setUint16(2,qcd.length-2);qcd[4]=64;qcd.fill(64,5);parts.push(qcd);}
  else parts.push(part);
  at+=2+size;
 }
 const bytes=new Uint8Array(parts.reduce((n,part)=>n+part.length,0));let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;
}

it.each([8,16].flatMap(levels=>[0,1,2,3,4].map(order=>({levels,order}))))("backs resolution/subband metadata for $levels decomposition levels in order $order",async ({levels,order})=>{
 const bytes=image(levels,order),expected=decodeJpxToRgba(bytes),fs=createMemoryFileSystem();
 expect(expected.length).toBe(4);await fs.mkdir("/scratch");await fs.writeFile("/input",bytes);
 const source=await PdfFileSource.open(fs,"/input"),storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal:new AbortController().signal},2);
 try{const decoded=await PdfRetainedJpx.open(source,{coefficientStorage:storage,maxWorkingBytes:131072});
  try{const pixels=[];for await(const row of decoded.rows())pixels.push(...row);expect(pixels).toEqual([...expected]);}finally{decoded.close();}
 }finally{await source.close();await storage.close();expect(await fs.readdir("/scratch")).toEqual([]);}
});
