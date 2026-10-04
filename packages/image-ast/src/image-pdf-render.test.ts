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

it("backs inline font widths and encodings before decoding or inspecting PDF images",async()=>{
 const {cosArray,cosDict,cosName,cosStream,PdfRetainedDocument}=await import("@poe-code/pdf-ast");
 const {tryPdfMetadata}=await import("./image-pdf.js");
 const original=PdfDocument.create(),page=original.addPage([32,24]);
 dictSet(page.pageDict,"Resources",cosDict({Font:cosDict({F:cosDict({Subtype:cosName("Type1"),BaseFont:cosName("Helvetica"),FirstChar:cosNumber(0),Widths:cosArray(Array.from({length:2048},()=>cosNumber(500))),Encoding:cosDict({Differences:cosArray([cosNumber(65),...Array.from({length:1024},()=>cosName("B"))])})})})}));
 dictSet(page.pageDict,"Contents",original.cos.allocateObject(cosStream(new TextEncoder().encode("BT /F 12 Tf 2 8 Td (A) Tj ET"))));
 const bytes=original.save(),expected=decodeImage(bytes),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal},4);
 const source={size:bytes.length,async read(at:number,n:number){return bytes.subarray(at,at+n);}};
 const open=vi.spyOn(PdfRetainedDocument,"open");
 try{
  const metadata=await tryPdfMetadata(source,fs,"/scratch",signal,{},storage);
  expect(metadata).toMatchObject({width:32,height:24});
  const image=await tryPdfDecode(source,storage,fs,"/scratch",signal);
  const actual=await storage.read(image!.position,image!.width*image!.height*4);
  expect(actual).toEqual(expected.data);
  for(const call of open.mock.calls)expect(call[2]?.valueArrays?.arrayStorage).toBe(storage);
 }finally{open.mockRestore();await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["inline","map","state","both"])("backs %s graphics-state dashes before Sips PDF pixel traversal",async mode=>{
 const {cosArray,cosDict,dictGet,PdfRetainedDocument}=await import("@poe-code/pdf-ast");
 const {tryPdfMetadata}=await import("./image-pdf.js");
 const original=PdfDocument.create(),page=original.addPage([24,16]);
 const values=Array.from({length:1025},(_,i)=>cosNumber(i%2?3:2));
 const state=cosDict({D:cosArray([cosArray(values),cosNumber(2)])});
 const states=cosDict({Dashes:mode==="state"||mode==="both"?original.cos.allocateObject(state):state});
 dictSet(page.pageDict,"Resources",cosDict({ExtGState:mode==="map"||mode==="both"?original.cos.allocateObject(states):states}));
 page.setRawContentStream("/Dashes gs 1 w 1 8 m 23 8 l S");
 const bytes=original.save(),expected=decodeImage(bytes),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal},4);
 const source={size:bytes.length,async read(at:number,n:number){return bytes.subarray(at,at+n);}};
 let seen=0;
 const lookup=PdfRetainedDocument.prototype.lookup;
 const spy=vi.spyOn(PdfRetainedDocument.prototype,"lookup").mockImplementation(async function(node,arrays,prefix){
  const result=await lookup.call(this,node,arrays,prefix);
  if(result?.value.kind==="dict"){
   const resources=dictGet(result.value,"Resources");
   const states=resources?.kind==="dict"?dictGet(resources,"ExtGState"):undefined;
   const state=states?.kind==="dict"?dictGet(states,"Dashes"):dictGet(result.value,"Dashes");
   const dash=state?.kind==="dict"?dictGet(state,"D"):dictGet(result.value,"D");
   if(dash?.kind==="array"){
    expect(dash.items).toHaveLength(0);expect(dash.storedItems?.length).toBe(2);
    expect(dash.storedItems?.storage).toBe(storage);seen++;
   }
  }
  return result;
 });
 try{
  expect(await tryPdfMetadata(source,fs,"/scratch",signal,{},storage)).toMatchObject({width:24,height:16});
  const metadataReads=seen;if(mode==="inline")expect(metadataReads).toBeGreaterThan(0);
  const image=await tryPdfDecode(source,storage,fs,"/scratch",signal);
  expect(await storage.read(image!.position,image!.width*image!.height*4)).toEqual(expected.data);
  expect(seen).toBeGreaterThan(metadataReads);
 }finally{spy.mockRestore();await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["inline", "named", "map", "property", "value", "chain"])("keeps %s ActualText backed during Sips rasterization without changing pixels",async mode=>{
 const {cosDict,cosName,cosString,PdfRetainedPage}=await import("@poe-code/pdf-ast");
 const doc=PdfDocument.create(),page=doc.addPage([24,16]);
 dictSet(page.pageDict,"Resources",cosDict({Font:cosDict({F:cosDict({Subtype:cosName("Type1"),BaseFont:cosName("Helvetica")})})}));
 const replacement="replacement".repeat(8192),text=cosString(replacement);
 const value=mode==="value"||mode==="chain"?doc.cos.allocateObject(text):text;
 const property=cosDict({ActualText:mode==="chain"?doc.cos.allocateObject(value):value});
 const properties=cosDict({Replacement:mode==="property"?doc.cos.allocateObject(property):property});
 if(mode!=="inline"){
  const resources=page.pageDict.entries.find(entry=>entry.key.decoded==="Resources")!.value;
  if(resources.kind!=="dict")throw Error("Expected resources");
  dictSet(resources,"Properties",mode==="map"?doc.cos.allocateObject(properties):properties);
 }
 page.setRawContentStream(`/Span ${mode==="inline"?`<< /ActualText (${replacement}) >>`:"/Replacement"} BDC BT /F 10 Tf 1 5 Td (A) Tj ET EMC`);
 const bytes=doc.save(),expected=decodeImage(bytes),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal},4);
 const evaluate=PdfRetainedPage.prototype.evaluateSteps;let seen=0;
 const spy=vi.spyOn(PdfRetainedPage.prototype,"evaluateSteps").mockImplementation(async function*(...args){
  for await(const event of evaluate.apply(this,args)){
   if(event.operation.kind==="glyph"){seen++;expect(typeof event.operation.value.actualText).toBe("undefined");expect(event.operation.value.storedActualText?.storage).toBe(storage);}
   yield event;
  }
 });
 try{
  const image=await tryPdfDecode({size:bytes.length,async read(at,length){return bytes.subarray(at,at+length);}},storage,fs,"/scratch",signal);
  expect(await storage.read(image!.position,image!.width*image!.height*4)).toEqual(expected.data);expect(seen).toBeGreaterThan(0);
 }finally{spy.mockRestore();await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});


it.each(["AllOn","AnyOn","AllOff","AnyOff"])("preserves Sips PDF pixels with backed %s layer lists",async policy=>{
 const {cosArray,cosDict,cosName}=await import("@poe-code/pdf-ast");
 const doc=PdfDocument.create(),page=doc.addPage([24,16]);
 const on=doc.cos.allocateObject(cosDict({Type:cosName("OCG")})),off=doc.cos.allocateObject(cosDict({Type:cosName("OCG")}));
 const membership=doc.cos.allocateObject(cosDict({Type:cosName("OCMD"),P:cosName(policy),OCGs:cosArray([on,off])}));
 dictSet(doc.cos.resolveDict(doc.cos.rootRef)!,"OCProperties",cosDict({D:cosDict({BaseState:cosName("OFF"),ON:cosArray(Array.from({length:512},()=>on)),OFF:cosArray([off])})}));
 dictSet(page.pageDict,"Resources",cosDict({Properties:cosDict({Layer:membership})}));
 page.setRawContentStream("/OC /Layer BDC 1 0 0 rg 1 1 20 10 re f EMC");
 const bytes=doc.save(),expected=decodeImage(bytes),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal},4);
 try{
  const image=await tryPdfDecode({size:bytes.length,async read(at,n){return bytes.subarray(at,at+n);}},storage,fs,"/scratch",signal);
  expect(await storage.read(image!.position,image!.width*image!.height*4)).toEqual(expected.data);
 }finally{await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});

it("keeps compressed PDF xref ranges in caller backing during inspection and rendering",async()=>{
 const {PdfRetainedDocument,dictGet}=await import("@poe-code/pdf-ast");
 const {tryPdfMetadata}=await import("./image-pdf.js");
 const original=PdfDocument.create(),page=original.addPage([16,12]);
 page.setRawContentStream(new TextEncoder().encode("0.2 0.7 0.4 rg 2 3 8 6 re f"));
 const base=original.save(),revision=PdfDocument.load(base).cos.revisions[0]!,root=dictGet(revision.trailer,"Root"),size=dictGet(revision.trailer,"Size");
 if(root?.kind!=="ref"||size?.kind!=="number")throw Error("fixture trailer");
 const suffix=new TextEncoder().encode(`\n${size.value} 0 obj << /Type /XRef /Size ${size.value+1} /Root ${root.objectNumber} ${root.generationNumber} R /Prev ${revision.xrefOffset} /W [0 1 0] /Index [${Array.from({length:256},(_,i)=>`${i} 0`).join(" ")}] /Length 0 >> stream\n\nendstream endobj\nstartxref\n${base.length+1}\n%%EOF`);
 const bytes=new Uint8Array(base.length+suffix.length);bytes.set(base);bytes.set(suffix,base.length);
 const expected=decodeImage(bytes),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal},2);
 const source={size:bytes.length,async read(at:number,n:number){return bytes.subarray(at,at+n);}};
 const open=vi.spyOn(PdfRetainedDocument,"open");
 try{
  expect(await tryPdfMetadata(source,fs,"/scratch",signal,{},storage)).toMatchObject({width:16,height:12});
  const image=await tryPdfDecode(source,storage,fs,"/scratch",signal);
  expect(await storage.read(image!.position,image!.width*image!.height*4)).toEqual(expected.data);
  for(const result of open.mock.results){
   const document=await result.value;
   expect(dictGet(document.crossReference.trailer,"Index")).toMatchObject({kind:"array",items:[],storedItems:{length:512,storage}});
  }
 }finally{open.mockRestore();await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});
