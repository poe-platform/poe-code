import {expect,it,vi} from "vitest";
import {PdfDocument} from "@poe-code/pdf-ast";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import sharp from "./index.js";

for(const file of [false,true])for(const page of [0,1,99])for(const density of [72,144])it(`inspects PDF page ${page} at density ${density}, file=${file} through caller backing`,async()=>{
 const document=PdfDocument.create();document.addPage([17,11]);document.addPage([31,23]);const bytes=document.save(),fs=new MemoryFileSystem();await fs.writeFile("/input.pdf",bytes);
 const expected=await sharp(bytes,{page,density}).metadata();
 const filesystem=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file PDF I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 expect(await sharp(file?"/input.pdf":bytes,{filesystem,page,density}).metadata()).toEqual(expected);
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["input.pdf"]);
});

it("preserves PDF pixel admission and removes scratch on rejection",async()=>{
 const document=PdfDocument.create();document.addPage([100,100]);const bytes=document.save(),fs=new MemoryFileSystem();await fs.writeFile("/input.pdf",bytes);
 await expect(sharp("/input.pdf",{filesystem:fs,limitInputPixels:99}).metadata()).rejects.toThrow("Input image exceeds pixel limit");
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["input.pdf"]);
});

it("honors explicit raw layout even when samples begin with a PDF signature",async()=>{
 const bytes=new Uint8Array(400);bytes.set(new TextEncoder().encode("%PDF-1.7"));const raw={width:10,height:10,channels:4 as const},fs=new MemoryFileSystem();await fs.writeFile("/input",bytes);
 expect(await sharp("/input",{filesystem:fs,raw}).metadata()).toEqual(await sharp(bytes,{raw}).metadata());
});

for(const cancel of [false,true])it(`cleans PDF staging on backing failure, cancel=${cancel}`,async()=>{
 const document=PdfDocument.create();document.addPage([100,100]);const bytes=document.save(),fs=new MemoryFileSystem(),controller=new AbortController(),reason=new Error("PDF backing failed");await fs.writeFile("/input.pdf",bytes);
 let cleaned=0,closed=0;
 const filesystem=new Proxy(fs,{get(target,key){
  if(key==="createStagedFile")return async(...args:Parameters<typeof fs.createStagedFile>)=>{const stage=await fs.createStagedFile(...args);return {...stage,writer:{...stage.writer,async write(){if(cancel)controller.abort(reason);throw reason;},finish:stage.writer!.finish.bind(stage.writer)},cleanup:{async remove(){cleaned++;await stage.cleanup!.remove();},async close(){closed++;await stage.cleanup!.close();}}};};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 await expect(sharp("/input.pdf",{filesystem,signal:controller.signal}).metadata()).rejects.toBe(reason);
 expect(cleaned).toBe(1);expect(closed).toBe(1);expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["input.pdf"]);
});

it("inspects a PDF larger than the working window with bounded input requests",async()=>{
 const data=new Uint8Array(257*257*4);let state=1234567;for(let i=0;i<data.length;i++){state^=state<<13;state^=state>>>17;state^=state<<5;data[i]=state&255;}
 const bytes=await sharp(data,{raw:{width:257,height:257,channels:4}}).toFormat("pdf").toBuffer();expect(bytes.length).toBeGreaterThan(131072);
 const fs=new MemoryFileSystem();await fs.writeFile("/input.pdf",bytes);let reads=0;
 const filesystem=new Proxy(fs,{get(target,key){
  if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file PDF I/O forbidden");};
  if(key==="openReadFile")return async(...args:Parameters<typeof fs.openReadFile>)=>{const handle=await fs.openReadFile(...args);return {...handle,stat:handle.stat.bind(handle),close:handle.close.bind(handle),async read(position:number,length:number,options?:{signal?:AbortSignal}){if(args[0]==="/input.pdf"){reads++;expect(length).toBeLessThanOrEqual(16384);}return handle.read(position,length,options);}};};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 expect(await sharp("/input.pdf",{filesystem}).metadata()).toEqual(await sharp(bytes).metadata());expect(reads).toBeGreaterThan(8);
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["input.pdf"]);
});

for(const cut of [10,150,350,12])it(`preserves truncated PDF metadata behavior at cut ${cut}`,async()=>{
 const document=PdfDocument.create();document.addPage([17,11]);const complete=document.save(),bytes=complete.slice(0,cut===12?complete.length-12:cut),fs=new MemoryFileSystem();await fs.writeFile("/input.pdf",bytes);
 const outcome=async(work:Promise<unknown>)=>{try{return {value:await work};}catch(error){return {error:(error as Error).message};}};
 expect(await outcome(sharp("/input.pdf",{filesystem:fs}).metadata())).toEqual(await outcome(sharp(bytes).metadata()));
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["input.pdf"]);
});

import {tryPdfMetadata} from "./image-pdf.js";
it("captures PDF inspection options before asynchronous source reads",async()=>{
 const document=PdfDocument.create();document.addPage([17,11]);document.addPage([31,23]);const bytes=document.save(),options={page:0,density:72},fs=new MemoryFileSystem();
 const metadata=await tryPdfMetadata({size:bytes.length,async read(position,length){options.page=1;options.density=144;return bytes.subarray(position,position+length);}},fs,"/",new AbortController().signal,options);
 expect(metadata).toMatchObject({width:17,height:11,pagePrimary:0,density:72});
});

it("rejects incomplete retained PDF source ranges",async()=>{
 const document=PdfDocument.create();document.addPage([17,11]);const bytes=document.save(),fs=new MemoryFileSystem();
 await expect(tryPdfMetadata({size:bytes.length,async read(position,length){return bytes.subarray(position,position+length-1);}},fs,"/",new AbortController().signal,{})).rejects.toThrow("Truncated PDF image source");
 expect(await fs.readdir("/")).toEqual([]);
});

it("preserves raster format priority over a PDF signature in pixel data",async()=>{
 const bytes=await sharp({create:{width:3,height:3,channels:4,background:"red"}}).toFormat("bmp").toBuffer();bytes.set(new TextEncoder().encode("%PDF-"),54);
 const fs=new MemoryFileSystem();await fs.writeFile("/input",bytes);
 expect(await sharp("/input",{filesystem:fs}).metadata()).toEqual(await sharp(bytes).metadata());
});

for(const nested of [false,true])it(`preserves existing PDF structural admission, nested value=${nested}`,async()=>{
 const depth=110,objects=['1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj'];
 if(nested){objects.push('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 17 11] /Unused ${'['.repeat(depth)}0${']'.repeat(depth)} >> endobj`);}
 else{for(let i=2;i<depth;i++)objects.push(`${i} 0 obj << /Type /Pages /Kids [${i+1} 0 R] /Count 1 >> endobj`);objects.push(`${depth} 0 obj << /Type /Page /MediaBox [0 0 17 11] >> endobj`);}
 const bytes=new TextEncoder().encode('%PDF-1.7\n'+objects.join('\n')+'\ntrailer << /Root 1 0 R >>\n%%EOF'),fs=new MemoryFileSystem();await fs.writeFile('/input.pdf',bytes);
 expect(await sharp('/input.pdf',{filesystem:fs}).metadata()).toEqual(await sharp(bytes).metadata());
});


it.each(["success","write","cancel"])("owns resource backing for metadata-only PDF inspection on %s",async phase=>{
 const {cosDict,cosString,dictSet,readPdfDictionaryValue,PdfRetainedReader}=await import("@poe-code/pdf-ast");
 const document=PdfDocument.create(),page=document.addPage([17,11]);
 dictSet(page.pageDict,"Resources",cosDict({Properties:cosDict({Replacement:cosDict({ActualText:cosString("replacement".repeat(8192))})})}));
 const bytes=document.save(),fs=new MemoryFileSystem();let seen=0,opened=0,closed=0;
 const controller=new AbortController(),failure=new Error("resource backing failed");
 const filesystem=new Proxy(fs,{get(target,key){
  if(key==="open")return async(...args:Parameters<typeof fs.open>)=>{
   const descriptor=await fs.open(...args);opened++;
   return new Proxy(descriptor,{get(handle,method){
    if(method==="close")return async()=>{closed++;await handle.close();};
    if(method==="write"&&phase!=="success")return async()=>{if(phase==="cancel")controller.abort(failure);throw failure;};
    const value=Reflect.get(handle,method,handle);return typeof value==="function"?value.bind(handle):value;
   }});
  };
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 const lookup=PdfRetainedReader.prototype.lookup;
 const spy=vi.spyOn(PdfRetainedReader.prototype,"lookup").mockImplementation(async function(...args){
  const result=await lookup.apply(this,args);
  if(result?.value.kind==="dict"){
   const resources=await readPdfDictionaryValue(result.value,"Resources",controller.signal);
   const properties=resources?.kind==="dict"?await readPdfDictionaryValue(resources,"Properties",controller.signal):undefined;
   const replacement=properties?.kind==="dict"?await readPdfDictionaryValue(properties,"Replacement",controller.signal):undefined;
   const text=replacement?.kind==="dict"?await readPdfDictionaryValue(replacement,"ActualText",controller.signal):undefined;
   if(text?.kind==="string"){seen++;expect(text.bytes.length).toBe(0);expect(text.storedBytes?.byteLength).toBeGreaterThan(65536);}
  }
  return result;
 });
 try{
  const result=tryPdfMetadata({size:bytes.length,async read(at,n){return bytes.subarray(at,at+n);}},filesystem,"/",controller.signal,{});
  if(phase==="success"){expect(await result).toMatchObject({width:17,height:11});expect(seen).toBeGreaterThan(0);}
  else await expect(result).rejects.toBe(failure);
  expect(opened).toBeGreaterThan(0);expect(closed).toBe(opened);
 }
 finally{spy.mockRestore();}
 expect(await fs.readdir("/")).toEqual([]);
});


it.each([false,true])("spills PDF metadata values without read/write authority, unsupported methods=%s",async methods=>{
 const {cosDict,cosString,dictSet}=await import("@poe-code/pdf-ast");
 const document=PdfDocument.create(),page=document.addPage([17,11]);
 dictSet(page.pageDict,"Resources",cosDict({Properties:cosDict({Replacement:cosDict({ActualText:cosString("replacement".repeat(16384))})})}));
 const bytes=document.save(),fs=new MemoryFileSystem();await fs.writeFile("/input.pdf",bytes);
 let staged=0,forbidden=0;
 const filesystem=new Proxy(fs,{get(target,key){
  if(key==="open"||key==="removeFileConditional")return methods?()=>{forbidden++;throw new Error("read/write authority forbidden");}:undefined;
  if(key==="capabilitiesFor")return async()=>({open:false,randomAccessWrite:false,retainedRead:true,retainedStagingWrite:true,retainedStagingCleanup:true});
  if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file access forbidden");};
  if(key==="createStagedFile")return async(...args:Parameters<typeof fs.createStagedFile>)=>{staged++;return fs.createStagedFile(...args);};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
 }});
 expect(await sharp("/input.pdf",{filesystem}).metadata()).toMatchObject({width:17,height:11});
 expect(forbidden).toBe(0);expect(staged).toBeGreaterThan(4);
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["input.pdf"]);
});
