import {expect,it} from "vitest";
import {decodeImage,decodeImageToStorage} from "@poe-code/image-ast/portable";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {bufferedImageBackend,performImage,runImageSteps} from "./image-backend.js";
import {StoredSipsImages} from "./stored-image-backend.js";

for(const alpha of [false,true])it(`pads converted CMYK pixels with alpha=${alpha}`,async()=>{
 const header=new TextEncoder().encode(`P7\nWIDTH 2\nHEIGHT 2\nDEPTH ${alpha?5:4}\nMAXVAL 255\nTUPLTYPE CMYK${alpha?"_ALPHA":""}\nENDHDR\n`);
 const samples=Uint8Array.from(Array.from({length:4},()=>alpha?[0,255,255,0,128]:[0,255,255,0]).flat());
 const bytes=new Uint8Array(header.length+samples.length);bytes.set(header);bytes.set(samples,header.length);
 const image=decodeImage(bytes),fs=new MemoryFileSystem(),signal=new AbortController().signal;
 const context={fs,cwd:"/",env:{},signal},pixels=new PagedStorage(context,2),payloads=new PagedStorage(context,2);
 try{
  const stored=await decodeImageToStorage({size:bytes.length,read:async(position,length)=>bytes.slice(position,position+length)},pixels,signal);
  expect(image.channels).toBe(alpha?5:4);
  expect([...image.data.slice(0,4)]).toEqual([255,0,0,alpha?128:255]);
  const backend=new StoredSipsImages(pixels,payloads,signal,fs,"/").backend;
  for(const result of [await runImageSteps(performImage(bufferedImageBackend.oddCanvas(image,2,2,3,3,"black")),signal),await runImageSteps(performImage(backend.oddCanvas(stored,2,2,3,3,"black")),signal)]){
   const data="data" in result?result.data:await pixels.read(result.position,36);
   expect(result.channels).toBe(alpha?4:3);
   expect([...data.slice(16,20)]).toEqual([255,0,0,alpha?128:255]);
   expect([...data.slice(0,4)]).toEqual([64,0,0,alpha?223:255]);
  }
 }finally{await pixels.close();await payloads.close();}
});
