import {expect,it,vi} from "vitest";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {PdfDocument,cosNumber,dictSet,readPdfDictionaryValue} from "@poe-code/pdf-ast";
import {decodeImage} from "./codecs/index.js";
import {tryPdfDecode,tryPdfMetadata} from "./image-pdf.js";
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

it.each(["F", "Font"])("backs inline font %s widths and encodings before decoding or inspecting PDF images",async fontName=>{
 const {cosArray,cosDict,cosName,cosStream,PdfRetainedDocument}=await import("@poe-code/pdf-ast");
 const {tryPdfMetadata}=await import("./image-pdf.js");
 const original=PdfDocument.create(),page=original.addPage([32,24]);
 dictSet(page.pageDict,"Resources",cosDict({Font:cosDict({[fontName]:cosDict({Subtype:cosName("Type1"),BaseFont:cosName("Helvetica"),FirstChar:cosNumber(0),Widths:cosArray(Array.from({length:2048},()=>cosNumber(500))),Encoding:cosDict({Differences:cosArray([cosNumber(65),...Array.from({length:1024},()=>cosName("B"))])})})})}));
 dictSet(page.pageDict,"Contents",original.cos.allocateObject(cosStream(new TextEncoder().encode(`BT /${fontName} 12 Tf 2 8 Td (A) Tj ET`))));
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

it.each(["inline", "indirect"])("backs %s XObject and property maps during PDF rasterization",async mode=>{
 const {cosArray,cosDict,cosName,cosStream}=await import("@poe-code/pdf-ast");
 const doc=PdfDocument.create(),page=doc.addPage([12,12]);
 const form=doc.cos.allocateObject(cosStream(new TextEncoder().encode("1 0 0 rg 1 1 8 8 re f"),{dict:cosDict({Type:cosName("XObject"),Subtype:cosName("Form"),BBox:cosArray([0,0,12,12].map(value=>cosNumber(value)))})}));
 const objects=cosDict([...Array.from({length:256},(_,i)=>["UnusedMap"+i,cosNumber(733)] as const),["XObject",cosNumber(0)],["XObject",form]]);
 const properties=cosDict([...Array.from({length:256},(_,i)=>["UnusedMap"+i,cosNumber(734)] as const),["Properties",cosDict({MCID:cosNumber(3)})]]);
 dictSet(page.pageDict,"Resources",cosDict({XObject:mode==="indirect"?doc.cos.allocateObject(objects):objects,Properties:mode==="indirect"?doc.cos.allocateObject(properties):properties}));
 page.setRawContentStream("/Span /Properties BDC /XObject Do EMC");
 const bytes=doc.save(),expected=decodeImage(bytes),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal},4);
 const push=Array.prototype.push;
 Array.prototype.push=function<T>(this:T[],...values:T[]):number{
  const length=push.apply(this,values);
  if(length>64&&values.some(value=>(value as {key?:{decoded?:string}})?.key?.decoded?.startsWith("UnusedMap")))throw Error("resident resource map");
  return length;
 };
 try{
  const source={size:bytes.length,async read(position:number,length:number){return bytes.subarray(position,position+length);}};
  expect(await tryPdfMetadata(source,fs,"/scratch",signal)).toMatchObject({width:12,height:12});
  const image=await tryPdfDecode(source,storage,fs,"/scratch",signal);
  expect(await storage.read(image!.position,image!.width*image!.height*4)).toEqual(expected.data);
 }finally{Array.prototype.push=push;await storage.close();}
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
   const resources=await readPdfDictionaryValue(result.value,"Resources");
   const states=resources?.kind==="dict"?await readPdfDictionaryValue(resources,"ExtGState"):undefined;
   const state=states?.kind==="dict"?await readPdfDictionaryValue(states,"Dashes"):await readPdfDictionaryValue(result.value,"Dashes");
   const dash=state?.kind==="dict"?dictGet(state,"D"):await readPdfDictionaryValue(result.value,"D");
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

it("backs page-tree child lists while preserving selected-page metadata and pixels",async()=>{
 const {PdfRetainedDocument}=await import("@poe-code/pdf-ast");
 const {tryPdfMetadata}=await import("./image-pdf.js");
 const original=PdfDocument.create();
 for(let i=0;i<64;i++){const page=original.addPage([16+i,12]);page.setRawContentStream(new TextEncoder().encode("0.2 0.7 0.4 rg 2 3 8 6 re f"));}
 const bytes=original.save(),options={page:63},expected=decodeImage(bytes,options),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal},2);
 const source={size:bytes.length,async read(at:number,n:number){return bytes.subarray(at,at+n);}};
 const lookup=vi.spyOn(PdfRetainedDocument.prototype,"lookup");
 try{
  expect(await tryPdfMetadata(source,fs,"/scratch",signal,options,storage)).toMatchObject({width:79,height:12,pages:64,pagePrimary:63});
  const image=await tryPdfDecode(source,storage,fs,"/scratch",signal,options);
  expect(await storage.read(image!.position,image!.width*image!.height*4)).toEqual(expected.data);
  let visited=0;
  for(let i=0;i<lookup.mock.calls.length;i++)if(lookup.mock.calls[i]![2]?.[0]==="Kids"){
   const result=await lookup.mock.results[i]!.value;
   if(result?.value.kind!=="array")continue;
   expect(result.value.items).toEqual([]);expect(result.value.storedItems?.length).toBe(64);visited++;
  }
  expect(visited).toBeGreaterThanOrEqual(2);
 }finally{lookup.mockRestore();await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});


it.each(["ExtGState","ColorSpace","Pattern","Shading"].flatMap(key=>["inline","indirect"].map(mode=>({key,mode}))))("backs $mode $key maps without changing PDF pixels",async ({key,mode})=>{
 const {cosArray,cosDict,cosName,cosBool}=await import("@poe-code/pdf-ast");
 const numbers=(values:number[])=>cosArray(values.map(value=>cosNumber(value)));
 const shading=cosDict({ShadingType:cosNumber(2),ColorSpace:cosName("DeviceRGB"),Coords:numbers([0,0,12,0]),Extend:cosArray([cosBool(true),cosBool(true)]),Function:cosDict({FunctionType:cosNumber(2),Domain:numbers([0,1]),C0:numbers([1,0,0]),C1:numbers([0,0,1]),N:cosNumber(1)})});
 const selected=key==="Shading"?shading:key==="Pattern"?cosDict({PatternType:cosNumber(2),Shading:shading,ExtGState:cosDict({ca:cosNumber(1)})}):key==="ColorSpace"?cosName("DeviceRGB"):cosDict({ca:cosNumber(0.5)});
 const doc=PdfDocument.create(),page=doc.addPage([12,12]);
 const map=cosDict([...Array.from({length:256},(_,i)=>["UnusedStateMap"+i,cosNumber(739)] as const),["Selected",selected]]);
 const resources=cosDict({[key]:mode==="indirect"?doc.cos.allocateObject(map):map});
 dictSet(page.pageDict,"Resources",mode==="indirect"?doc.cos.allocateObject(resources):resources);
 page.setRawContentStream(key==="Shading"?"/Selected sh":key==="Pattern"?"/Pattern cs /Selected scn 0 0 12 12 re f":key==="ColorSpace"?"/Selected cs 1 0 0 sc 0 0 12 12 re f":"/Selected gs 1 0 0 rg 0 0 12 12 re f");
 const bytes=doc.save(),expected=decodeImage(bytes),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal},4);
 const push=Array.prototype.push;Array.prototype.push=function<T>(this:T[],...values:T[]):number{const length=push.apply(this,values);if(length>64&&values.some(value=>(value as {key?:{decoded?:string}})?.key?.decoded?.startsWith("UnusedStateMap")))throw Error("resident rendering resource map");return length;};
 try{
  const source={size:bytes.length,async read(position:number,length:number){return bytes.subarray(position,position+length);}};
  expect(await tryPdfMetadata(source,fs,"/scratch",signal,{},storage)).toMatchObject({width:12,height:12});
  const image=await tryPdfDecode(source,storage,fs,"/scratch",signal);
  expect(await storage.read(image!.position,image!.width*image!.height*4)).toEqual(expected.data);
 }finally{Array.prototype.push=push;await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["Font","ExtGState"].flatMap(key=>[false,true].map(indirect=>({key,indirect}))))("keeps unused $key definitions backed (indirect=$indirect)", async ({key,indirect}) => {
 const {cosArray,cosDict,cosName,cosString}=await import("@poe-code/pdf-ast");
 const doc=PdfDocument.create(),page=doc.addPage([12,12]);
 const unused=cosDict({Large:cosArray(Array.from({length:256},()=>cosNumber(743))),Text:cosString("payload ".repeat(1024))});
 const selected=key==="Font"?cosDict({Subtype:cosName("Type1"),BaseFont:cosName("Helvetica")}):cosDict({ca:cosNumber(.5)});
 const map=cosDict({Unused:unused,Selected:selected});
 dictSet(page.pageDict,"Resources",cosDict({[key]:indirect?doc.cos.allocateObject(map):map}));
 page.setRawContentStream(key==="Font"?"BT /Selected 8 Tf 1 3 Td (x) Tj ET":"/Selected gs 1 0 0 rg 0 0 12 12 re f");
 const bytes=doc.save(),expected=decodeImage(bytes),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal},4);
 const push=Array.prototype.push;Array.prototype.push=function<T>(this:T[],...values:T[]):number{if(this.length>=64&&values.some(value=>(value as {kind?:string;value?:number})?.kind==="number"&&(value as {value:number}).value===743))throw Error("unused definition became resident");return push.apply(this,values);};
 try{
  const source={size:bytes.length,async read(position:number,length:number){return bytes.subarray(position,position+length);}};
  expect(await tryPdfMetadata(source,fs,"/scratch",signal,{},storage)).toMatchObject({width:12,height:12});
  const image=await tryPdfDecode(source,storage,fs,"/scratch",signal);
  expect(await storage.read(image!.position,image!.width*image!.height*4)).toEqual(expected.data);
 }finally{Array.prototype.push=push;await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["inline","map","state","both","stream","encrypted-stream"])("reads selected %s graphics-state fields without expanding unused values",async mode=>{
 const {cosArray,cosDict,cosName,cosStream}=await import("@poe-code/pdf-ast");
 const doc=PdfDocument.create(),page=doc.addPage([12,12]);
 const state=cosDict({Unused:cosArray(Array.from({length:256},()=>cosNumber(747))),ca:cosNumber(.5),CA:cosNumber(.75),SMask:cosName("None"),Font:cosArray([cosDict({Subtype:cosName("Type1"),BaseFont:cosName("Helvetica")}),cosNumber(5)]),LW:cosNumber(2),LC:cosNumber(1),LJ:cosNumber(2),ML:cosNumber(4),BM:cosArray([cosName("Multiply")]),D:cosArray([cosArray([cosNumber(2),cosNumber(1)]),cosNumber(0)])});
 const states=cosDict({Selected:mode==="stream"||mode==="encrypted-stream"?doc.cos.allocateObject(cosStream(state,new Uint8Array())):mode==="state"||mode==="both"?doc.cos.allocateObject(state):state});
 dictSet(page.pageDict,"Resources",cosDict({ExtGState:mode==="map"||mode==="both"?doc.cos.allocateObject(states):states}));
 page.setRawContentStream("/Selected gs 1 0 0 rg 0 0 12 12 re f 0 0 1 RG 1 2 m 10 9 l S BT 1 3 Td (x) Tj ET");
 const bytes=mode==="encrypted-stream"?doc.save({encrypt:{revision:3}}):doc.save(),expected=decodeImage(bytes),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal},4);
 const push=Array.prototype.push;Array.prototype.push=function<T>(this:T[],...values:T[]):number{if(this.length>=64&&values.some(value=>(value as {kind?:string;value?:number})?.kind==="number"&&(value as {value:number}).value===747))throw Error("unused selected-state field became resident");return push.apply(this,values);};
 try{
  const source={size:bytes.length,async read(position:number,length:number){return bytes.subarray(position,position+length);}};
  const image=await tryPdfDecode(source,storage,fs,"/scratch",signal);
  expect(await storage.read(image!.position,image!.width*image!.height*4)).toEqual(expected.data);
 }finally{Array.prototype.push=push;await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});


it.each(["BM", "Font", "ca"].flatMap(key => [false, true].map(indirect => ({key, indirect}))))("keeps selected $key array tails backed (indirect=$indirect)", async ({key, indirect}) => {
 const {cosArray,cosDict,cosName}=await import("@poe-code/pdf-ast");
 const doc=PdfDocument.create(),page=doc.addPage([12,12]);
 const prefix=key==="BM"?[cosName("Multiply")]:key==="Font"?[cosDict({Subtype:cosName("Type1"),BaseFont:cosName("Helvetica"),FirstChar:cosNumber(0),LastChar:cosNumber(255),Widths:cosArray(Array.from({length:256},()=>cosNumber(751)))}),cosNumber(5)]:[];
 const value=cosArray([...prefix,...Array.from({length:256},()=>cosNumber(751))]);
 dictSet(page.pageDict,"Resources",cosDict({ExtGState:cosDict({Selected:cosDict({[key]:indirect?doc.cos.allocateObject(value):value})})}));
 page.setRawContentStream("0 1 0 rg 0 0 12 12 re f /Selected gs 1 0 0 rg 0 0 12 12 re f"+(key==="Font"?" 0 0 0 rg BT 1 3 Td (x) Tj ET":""));
 const bytes=doc.save(),expected=decodeImage(bytes),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal},4);
 const push=Array.prototype.push;Array.prototype.push=function<T>(this:T[],...values:T[]):number{if(this.length>=64&&values.some(value=>(value as {kind?:string;value?:number})?.kind==="number"&&(value as {value:number}).value===751))throw Error("unused selected field array tail became resident");return push.apply(this,values);};
 try{
  const image=await tryPdfDecode({size:bytes.length,async read(position:number,length:number){return bytes.subarray(position,position+length);}},storage,fs,"/scratch",signal);
  expect(await storage.read(image!.position,image!.width*image!.height*4)).toEqual(expected.data);
 }finally{Array.prototype.push=push;await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});


it.each(["font", "descriptor", "encoding", "descendant", "matrix", "glyphs"].flatMap(location => ["inline", "indirect", "stream", "encrypted"].map(mode => ({location, mode}))))("does not expand unused selected font $location fields ($mode)", async ({location, mode}) => {
 const indirect=mode!=="inline";
 const {cosArray,cosDict,cosName,cosStream}=await import("@poe-code/pdf-ast");
 const doc=PdfDocument.create(),page=doc.addPage([24,12]);
 const unused=cosArray(Array.from({length:256},()=>cosNumber(757)));
 const descriptor=cosDict({MissingWidth:cosNumber(600),...(location==="descriptor"?{Unused:unused}:{})});
 const encoding=cosDict({BaseEncoding:cosName("WinAnsiEncoding"),Differences:cosArray([cosNumber(120),cosName("A")]),...(location==="encoding"?{Unused:unused}:{})});
 const font=cosDict({Subtype:cosName("Type1"),BaseFont:cosName("Helvetica"),FirstChar:cosNumber(120),Widths:cosArray([cosNumber(600)]),FontDescriptor:indirect?doc.cos.allocateObject(descriptor):descriptor,Encoding:indirect?doc.cos.allocateObject(encoding):encoding,...(location==="font"?{Unused:unused}:{})});
 if(location==="descendant"){
  const cid=cosDict({Subtype:cosName("CIDFontType2"),BaseFont:cosName("Helvetica"),DW:cosNumber(600),Unused:unused});
  const descendants=cosArray([cid,...Array.from({length:256},()=>cosNumber(757))]);
  dictSet(font,"Subtype",cosName("Type0"));dictSet(font,"Encoding",cosName("Identity-H"));dictSet(font,"DescendantFonts",indirect?doc.cos.allocateObject(descendants):descendants);
 }
 if(location==="matrix"||location==="glyphs"){
  const {cosStream}=await import("@poe-code/pdf-ast");
  const matrix=cosArray([.001,0,0,.001,0,0].map(value=>cosNumber(value)).concat(location==="matrix"?Array.from({length:256},()=>cosNumber(757)):[]));
  const procs=cosDict({A:doc.cos.allocateObject(cosStream(new TextEncoder().encode("600 0 d0 0 0 500 700 re f"))),...(location==="glyphs"?{Unused:unused}:{})});
  dictSet(font,"Subtype",cosName("Type3"));dictSet(font,"FontMatrix",indirect?doc.cos.allocateObject(matrix):matrix);dictSet(font,"CharProcs",indirect?doc.cos.allocateObject(procs):procs);
 }
 dictSet(page.pageDict,"Resources",cosDict({Font:cosDict({Selected:mode==="stream"?doc.cos.allocateObject(cosStream(font,new Uint8Array())):indirect?doc.cos.allocateObject(font):font})}));
 page.setRawContentStream("BT /Selected 9 Tf 1 3 Td "+(location==="descendant"?"<00780078>":"(xx)")+" Tj ET");
 const bytes=mode==="encrypted"?doc.save({encrypt:{revision:3}}):doc.save(),expected=decodeImage(bytes),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal},4);
 const push=Array.prototype.push;Array.prototype.push=function<T>(this:T[],...values:T[]):number{if(this.length>=64&&values.some(value=>(value as {kind?:string;value?:number})?.kind==="number"&&(value as {value:number}).value===757))throw Error("unused selected font field became resident");return push.apply(this,values);};
 try{
  const image=await tryPdfDecode({size:bytes.length,async read(position:number,length:number){return bytes.subarray(position,position+length);}},storage,fs,"/scratch",signal);
  expect(await storage.read(image!.position,image!.width*image!.height*4)).toEqual(expected.data);
 }finally{Array.prototype.push=push;await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["Alpha","Luminosity"].flatMap(subtype=>["inline","indirect","encrypted"].map(mode=>({subtype,mode}))))("keeps unused $subtype soft-mask fields backed ($mode)",async({subtype,mode})=>{
 const {cosArray,cosDict,cosName,cosStream}=await import("@poe-code/pdf-ast");
 const doc=PdfDocument.create(),page=doc.addPage([12,12]);
 const form=doc.cos.allocateObject(cosStream(cosDict({Subtype:cosName("Form"),BBox:cosArray([0,0,12,12].map(value=>cosNumber(value))),Group:cosDict({S:cosName("Transparency"),CS:cosName("DeviceRGB")})}),new TextEncoder().encode(".5 g 0 0 6 12 re f")));
 const mask=cosDict({S:cosName(subtype),G:form,BC:cosArray([.2,.3,.4].map(value=>cosNumber(value))),TR:cosDict({FunctionType:cosNumber(2),Domain:cosArray([cosNumber(0),cosNumber(1)]),C0:cosArray([cosNumber(0)]),C1:cosArray([cosNumber(1)]),N:cosNumber(1)}),Unused:cosArray(Array.from({length:256},()=>cosNumber(761)))});
 dictSet(page.pageDict,"Resources",cosDict({ExtGState:cosDict({Selected:cosDict({SMask:mode==="inline"?mask:doc.cos.allocateObject(mask)})})}));
 page.setRawContentStream("/Selected gs 1 0 0 rg 0 0 12 12 re f");
 const bytes=mode==="encrypted"?doc.save({encrypt:{revision:3}}):doc.save(),expected=decodeImage(bytes),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 expect(expected.data.some((value,index)=>index%4===1&&value>0)).toBe(true);
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal},4);
 const push=Array.prototype.push;Array.prototype.push=function<T>(this:T[],...values:T[]):number{if(this.length>=64&&values.some(value=>(value as {kind?:string;value?:number})?.kind==="number"&&(value as {value:number}).value===761))throw Error("unused selected soft-mask field became resident");return push.apply(this,values);};
 try{
  const image=await tryPdfDecode({size:bytes.length,async read(position:number,length:number){return bytes.subarray(position,position+length);}},storage,fs,"/scratch",signal);
  expect(await storage.read(image!.position,image!.width*image!.height*4)).toEqual(expected.data);
 }finally{Array.prototype.push=push;await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["Alpha","Luminosity"].flatMap(subtype=>["inline","indirect","encrypted","sampled","postscript","encrypted-sampled","encrypted-postscript","stitched","encrypted-stitched","indirect-stitched","encrypted-indirect-stitched","numeric","indirect-numeric","encrypted-indirect-numeric","scalar","indirect-scalar"].map(mode=>({subtype,mode}))))("keeps unused $subtype soft-mask transfer fields backed ($mode)",async({subtype,mode})=>{
 const {cosArray,cosDict,cosName,cosStream}=await import("@poe-code/pdf-ast");
 const doc=PdfDocument.create(),page=doc.addPage([12,12]);
 const form=doc.cos.allocateObject(cosStream(cosDict({Subtype:cosName("Form"),BBox:cosArray([0,0,12,12].map(value=>cosNumber(value))),Group:cosDict({S:cosName("Transparency"),CS:cosName("DeviceRGB")})}),new TextEncoder().encode(".5 g 0 0 6 12 re f")));
 const transfer=cosDict({FunctionType:cosNumber(2),Domain:cosArray([cosNumber(0),cosNumber(1)]),C0:cosArray([cosNumber(0)]),C1:cosArray([cosNumber(1)]),N:cosNumber(1),Unused:cosArray(Array.from({length:256},()=>cosNumber(763)))});
 let functionValue: import("@poe-code/pdf-ast").PdfCosNode=transfer;
 if(mode.includes("sampled")){dictSet(transfer,"FunctionType",cosNumber(0));dictSet(transfer,"Size",cosArray([cosNumber(2)]));dictSet(transfer,"BitsPerSample",cosNumber(8));dictSet(transfer,"Range",cosArray([cosNumber(0),cosNumber(1)]));dictSet(transfer,"Filter",doc.cos.allocateObject(cosName("ASCIIHexDecode")));functionValue=cosStream(transfer,new TextEncoder().encode("00ff>"));}
 if(mode.includes("postscript")){dictSet(transfer,"FunctionType",cosNumber(4));dictSet(transfer,"Range",cosArray([cosNumber(0),cosNumber(1)]));functionValue=cosStream(transfer,new TextEncoder().encode("{ }"));}
 if(mode.includes("numeric")){const ignored=cosDict({Unused:cosArray(Array.from({length:256},()=>cosNumber(763)))}),numbers=cosArray([ignored]);dictSet(transfer,"C0",mode.includes("indirect")?doc.cos.allocateObject(numbers):numbers);}
 if(mode.includes("scalar")){const ignored=cosDict({Unused:cosArray(Array.from({length:256},()=>cosNumber(763)))});dictSet(transfer,"N",mode.includes("indirect")?doc.cos.allocateObject(ignored):ignored);}
 if(mode.includes("stitched"))functionValue=cosDict({FunctionType:cosNumber(3),Domain:cosArray([cosNumber(0),cosNumber(1)]),Functions:mode.includes("indirect")?doc.cos.allocateObject(cosArray([transfer])):cosArray([transfer]),Bounds:cosArray([]),Encode:cosArray([cosNumber(0),cosNumber(1)])});
 const mask=cosDict({S:cosName(subtype),G:form,BC:cosArray([.2,.3,.4].map(value=>cosNumber(value))),TR:mode==="inline"?functionValue:doc.cos.allocateObject(functionValue)});
 dictSet(page.pageDict,"Resources",cosDict({ExtGState:cosDict({Selected:cosDict({SMask:mode==="inline"?mask:doc.cos.allocateObject(mask)})})}));
 page.setRawContentStream("/Selected gs 1 0 0 rg 0 0 12 12 re f");
 const bytes=mode.startsWith("encrypted")?doc.save({encrypt:{revision:3}}):doc.save(),expected=decodeImage(bytes),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 expect(expected.data.some((value,index)=>index%4===1&&value>0)).toBe(true);
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal},4);
 const push=Array.prototype.push;Array.prototype.push=function<T>(this:T[],...values:T[]):number{if(this.length>=64&&values.some(value=>(value as {kind?:string;value?:number})?.kind==="number"&&(value as {value:number}).value===763))throw Error("unused selected transfer field became resident");return push.apply(this,values);};
 try{
  const image=await tryPdfDecode({size:bytes.length,async read(position:number,length:number){return bytes.subarray(position,position+length);}},storage,fs,"/scratch",signal);
  expect(await storage.read(image!.position,image!.width*image!.height*4)).toEqual(expected.data);
 }finally{Array.prototype.push=push;await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["form","group","matrix","bbox"].flatMap(location=>(location==="form"?["plain","encrypted"]:["plain","indirect","encrypted"]).flatMap(mode=>["xobject","mask"].map(use=>({location,mode,use})))))("keeps selected $use $location metadata backed ($mode)",async({location,mode,use})=>{
 const {cosArray,cosDict,cosName,cosStream}=await import("@poe-code/pdf-ast");
 const doc=PdfDocument.create(),page=doc.addPage([12,12]);
 const unused=()=>cosArray(Array.from({length:256},()=>cosNumber(773)));
 const group=cosDict({S:cosName("Transparency"),CS:cosName("DeviceRGB"),I:{kind:"boolean",value:true},...(location==="group"?{Unused:unused()}:{})});
 const matrix=cosArray([1,0,0,1,2,0].map(value=>cosNumber(value))),bbox=cosArray([0,0,6,12].map(value=>cosNumber(value)));
 if(location==="matrix")matrix.items.push(...unused().items);
 if(location==="bbox")bbox.items.push(...unused().items);
 const formDict=cosDict({Subtype:cosName("Form"),Group:mode==="indirect"?doc.cos.allocateObject(group):group,Matrix:mode==="indirect"?doc.cos.allocateObject(matrix):matrix,BBox:mode==="indirect"?doc.cos.allocateObject(bbox):bbox,...(location==="form"?{Unused:unused()}:{})});
 const form=doc.cos.allocateObject(cosStream(formDict,new TextEncoder().encode(".5 g 0 0 6 12 re f")));
 if(use==="xobject"){dictSet(page.pageDict,"Resources",cosDict({XObject:cosDict({Selected:form})}));page.setRawContentStream("/Selected Do");}
 else{dictSet(page.pageDict,"Resources",cosDict({ExtGState:cosDict({Selected:cosDict({SMask:cosDict({S:cosName("Luminosity"),G:form,BC:cosArray([.2,.3,.4].map(value=>cosNumber(value)))})})})}));page.setRawContentStream("/Selected gs 1 0 0 rg 0 0 12 12 re f");}
 const bytes=mode==="encrypted"?doc.save({encrypt:{revision:3}}):doc.save(),expected=decodeImage(bytes),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 expect(expected.data.some((value,index)=>index%4===1&&value<255)).toBe(true);
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal},4);
 const push=Array.prototype.push;Array.prototype.push=function<T>(this:T[],...values:T[]):number{if(this.length>=64&&values.some(value=>(value as {kind?:string;value?:number})?.kind==="number"&&(value as {value:number}).value===773))throw Error("unused Form metadata became resident");return push.apply(this,values);};
 try{const image=await tryPdfDecode({size:bytes.length,async read(position:number,length:number){return bytes.subarray(position,position+length);}},storage,fs,"/scratch",signal);expect(await storage.read(image!.position,image!.width*image!.height*4)).toEqual(expected.data);}
 finally{Array.prototype.push=push;await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});
