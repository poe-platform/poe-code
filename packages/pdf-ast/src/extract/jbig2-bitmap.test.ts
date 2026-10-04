import {readFileSync} from "node:fs";
import {expect,it,vi} from "vitest";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {PdfFileSource} from "../source.js";
import {Jbig2Image} from "../vendor/pdfjs-image-decoders.mjs";
import {PdfRetainedJbig2} from "./retained-jbig2.js";

it.each([8193,32769].flatMap(height=>[false,true].map(fill=>({height,fill}))))("backs a growing packed JBIG2 page with $height rows and fill=$fill",async ({height,fill})=>{
 const bytes=new Uint8Array(readFileSync(new URL("../fixtures/jbig2-generic-stream.bin",import.meta.url)));
 expect(bytes[4]!&63).toBe(48);new DataView(bytes.buffer).setUint32(15,height);if(fill)bytes[27]=bytes[27]!|4;
 const expected=new Jbig2Image().parseChunks([{data:bytes,start:0,end:bytes.length}])!;
 const fs=createMemoryFileSystem();await fs.mkdir("/scratch");await fs.writeFile("/input",bytes);
 const source=await PdfFileSource.open(fs,"/input"),storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal:new AbortController().signal},2);
 const allocations:number[]=[];const Native=Uint8ClampedArray;
 vi.stubGlobal("Uint8ClampedArray",new Proxy(Native,{construct(target,args){if(typeof args[0]==="number"&&args[0]>65536)throw Error("resident JBIG2 bitmap");return Reflect.construct(target,args);}}));
 try{
  const image=await PdfRetainedJbig2.open(source,64,height,{bitmapStorage:{
   allocate(length){allocations.push(length);return storage.allocate(length);},read:storage.read.bind(storage),write:storage.write.bind(storage)
  }});
  try{let y=0;for await(const row of image.rows()){
   for(let x=0;x<64;x++){const value=expected[y*8+(x>>3)]!>>(7-(x&7))&1?0:255;
    if(row[x*4]!==value||row[x*4+1]!==value||row[x*4+2]!==value||row[x*4+3]!==255)throw Error("bitmap pixel mismatch");}
   y++;
  }expect(y).toBe(height);expect(allocations).toContain(height*8);}finally{image.close();}
 }finally{vi.unstubAllGlobals();await storage.close();await source.close();expect(await fs.readdir("/scratch")).toEqual([]);}
});

it("cancels a suspended backed bitmap read on close and keeps backing caller-owned",async()=>{
 const bytes=new Uint8Array(readFileSync(new URL("../fixtures/jbig2-generic-stream.bin",import.meta.url))),fs=createMemoryFileSystem();
 await fs.mkdir("/scratch");await fs.writeFile("/input",bytes);
 const source=await PdfFileSource.open(fs,"/input"),storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal:new AbortController().signal},2);
 let pause=false,entered!:()=>void,release!:()=>void;
 const waiting=new Promise<void>(resolve=>{entered=resolve;});
 try{
  const image=await PdfRetainedJbig2.open(source,64,32,{bitmapStorage:{
   allocate:storage.allocate.bind(storage),write:storage.write.bind(storage),async read(at,length,options){
    if(pause){entered();await new Promise<void>(resolve=>{release=resolve;});}
    options?.signal?.throwIfAborted();return storage.read(at,length);
   }
  }});
  pause=true;const row=image.rows().next();await waiting;image.close();release();await expect(row).rejects.toThrow("closed");
  const position=storage.allocate(1);await storage.write(position,new Uint8Array([7]));
  expect(await storage.read(position,1)).toEqual(new Uint8Array([7]));
 }finally{await storage.close();await source.close();expect(await fs.readdir("/scratch")).toEqual([]);}
});
