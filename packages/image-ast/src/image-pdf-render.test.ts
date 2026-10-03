import {expect,it,vi} from "vitest";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {PdfDocument,cosNumber,dictSet} from "@poe-code/pdf-ast";
import {decodeImage} from "./codecs/index.js";
import {tryPdfDecode} from "./image-pdf.js";
import sharp from "./index.js";

function fixture(){
 const doc=PdfDocument.create(),page=doc.addPage([23,17]);
 dictSet(page.pageDict,"Rotate",cosNumber(90));
 page.setRawContentStream(new TextEncoder().encode("0.2 0.7 0.4 rg 2 3 13 11 re f"));
 const png=sharp({create:{width:3,height:2,channels:4,background:{r:32,g:64,b:128,alpha:.5}}}).png().toBufferSync();
 const image=doc.embedPng(png),second=doc.addPage([29,19]);second.drawImage(image,{x:1,y:2,width:19,height:13});
 return doc.save();
}

it.each([{page:0,density:72},{page:1,density:144},{page:99,density:72}])("decodes PDF ranges with buffered pixel parity (%j)",async options=>{
 const bytes=fixture(),expected=decodeImage(bytes,options),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal});
 const borrowed=new Uint8Array(16384),read=vi.fn(async(position:number,length:number)=>{if(length>borrowed.length)throw Error("whole input");borrowed.set(bytes.subarray(position,position+length));return borrowed.subarray(0,length);});
 try{
  const image=await tryPdfDecode({size:bytes.length,read},storage,fs,"/scratch",signal,options);
  expect(image).toBeDefined();const actual=new Uint8Array(image!.width*image!.height*4);
  for(let offset=0;offset<actual.length;offset+=4096)actual.set(await storage.read(image!.position+offset,Math.min(4096,actual.length-offset)),offset);
  expect({...image,position:undefined}).toEqual({...expected,data:undefined});expect(actual).toEqual(expected.data);
 }finally{await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});

it("uses the injected filesystem for PDF SDK conversion and composite resources",async()=>{
 const fs=createMemoryFileSystem(),bytes=fixture();await fs.writeFile("/input.pdf",bytes);
 const whole=vi.fn(()=>{throw Error("whole-file I/O");});
 const filesystem=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return whole;const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 await sharp("/input.pdf",{filesystem}).png().toFile("/output.png");
 expect(decodeImage(await fs.readFile("/output.png")).data).toEqual(decodeImage(bytes).data);
 await sharp({create:{width:17,height:23,channels:4,background:"white"},filesystem}).composite([{input:"/input.pdf"}]).png().toFile("/composite.png");
 expect(decodeImage(await fs.readFile("/composite.png")).data).toEqual(decodeImage(bytes).data);
 expect(whole).not.toHaveBeenCalled();expect((await fs.readdir("/")).map(entry=>entry.name).sort()).toEqual(["composite.png","input.pdf","output.png"]);
});

it.each(["write","cancel"])("cleans PDF scratch after pixel %s failure",async phase=>{
 const bytes=fixture(),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 const controller=new AbortController(),reason=new Error(phase),storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal:controller.signal});
 const backing={allocate:storage.allocate.bind(storage),read:storage.read.bind(storage),async write(){if(phase==="cancel"){controller.abort(reason);return;}throw reason;}};
 try{await expect(tryPdfDecode({size:bytes.length,async read(position,length){return bytes.subarray(position,position+length);}},backing,fs,"/scratch",controller.signal)).rejects.toBe(reason);}
 finally{await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});
