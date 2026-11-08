import {expect,it} from "vitest";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";
import {PdfDocument,cosArray,cosDict,cosName,cosString,cosStream,cosNumber,dictGet,dictSet,serializeCosDocument} from "@poe-code/pdf-ast";
import sharp,{decodeImage} from "./index.js";

// Exercise page traversal, structural depth, content-list length and resource
// width separately. Each axis still crosses the same storage bounds without
// multiplying repeated pages by growing per-page dictionaries and streams.
it.each([
 ...[32,128].flatMap(count=>["metadata","pixels"].map(mode=>({count,mode,traversalCount:1,contentCount:1,resourceCount:0,filterCount:0}))),
 ...[32,128].flatMap(traversalCount=>["metadata","pixels"].map(mode=>({count:1,mode,traversalCount,contentCount:1,resourceCount:0,filterCount:0}))),
 ...[32,128].map(contentCount=>({count:1,mode:"pixels",traversalCount:1,contentCount,resourceCount:0,filterCount:0})),
 ...[32,128].map(resourceCount=>({count:1,mode:"pixels",traversalCount:1,contentCount:1,resourceCount,filterCount:0})),
 ...[32,128].map(filterCount=>({count:1,mode:"pixels",traversalCount:1,contentCount:1,resourceCount:0,filterCount})),
])("validates $mode with $count backed PDF references, $traversalCount page branches, $contentCount content references, $resourceCount resources and $filterCount filter references in Workerd",async ({count,mode,traversalCount,contentCount,resourceCount,filterCount})=>{
 // Keep the complete RGBA plane above 64 KiB while requiring only five raster tiles.
 const pixels=new Uint8Array(257*64*4);let state=1234567;for(let i=0;i<pixels.length;i++){state^=state<<13;state^=state>>>17;state^=state<<5;pixels[i]=state&255;}
 const pdf=await sharp(pixels,{raw:{width:257,height:64,channels:4}}).toFormat("pdf").toBuffer();const document=PdfDocument.load(pdf),catalog=document.cos.resolveDict(document.cos.rootRef)!,pages=document.cos.resolveDict(dictGet(catalog,"Pages"))!,page=document.getPage(0).pageRef;
 dictSet(catalog,"Numeric",{...cosNumber(7),raw:"0".repeat(count*128)+"7"});
 const pageDict=document.getPage(0).pageDict,content=dictGet(pageDict,"Contents")!,empty=document.cos.allocateObject(cosStream(new TextEncoder().encode("q "+(resourceCount?"/SelectedState gs /SelectedForm Do BT /SelectedFont 8 Tf 3 Tr (x) Tj ET ":"")+"0".repeat(count*32)+"0 w "+"z".repeat(count*8)+" Q"))),hidden=document.cos.allocateObject(cosDict({F:cosNumber(2)}));
 const contentObject=document.cos.resolve(content);if(contentObject?.kind!=="stream")throw Error("content stream expected");
 dictSet(contentObject.dict,"Resources",cosDict({Font:cosDict({...Object.fromEntries(Array.from({length:count*4},(_,i)=>["UnusedFont"+i,cosNumber(732)])),Unused:cosDict({Widths:cosArray(Array.from({length:count*4},()=>cosNumber(731)))})})}));
 const pageResources=document.cos.resolveDict(dictGet(pageDict,"Resources"));if(!pageResources)throw Error("page resources expected");
 const xobjects=document.cos.resolveDict(dictGet(pageResources,"XObject"));if(!xobjects)throw Error("XObject resources expected");
 if(resourceCount)for(const entry of xobjects.entries){
  const image=document.cos.resolve(entry.value);if(image?.kind!=="stream"||dictGet(image.dict,"Subtype")?.kind!=="name"||(dictGet(image.dict,"Subtype") as {decoded:string}).decoded!=="Image")continue;
  dictSet(image.dict,"UnusedImageMetadata",cosArray(Array.from({length:resourceCount},()=>cosNumber(779))));
  for(const key of ["SMask","Mask"]){const mask=document.cos.resolve(dictGet(image.dict,key));if(mask?.kind==="stream")dictSet(mask.dict,"UnusedMaskMetadata",cosArray(Array.from({length:resourceCount},()=>cosNumber(779))));}
 }
 for(let i=0;i<resourceCount;i++)dictSet(xobjects,"UnusedResource"+i,cosNumber(734));
 dictSet(pageResources,"Properties",cosDict(Object.fromEntries(Array.from({length:resourceCount},(_,i)=>["UnusedResource"+i,cosNumber(735)]))));
 for(const category of ["ExtGState","ColorSpace","Pattern","Shading"])dictSet(pageResources,category,cosDict(Object.fromEntries(Array.from({length:resourceCount},(_,i)=>["UnusedResource"+i,cosNumber(736)]))));
 dictSet(pageResources,"Font",{kind:"dict",entries:Array.from({length:count},()=>({key:cosName("UnusedFont"),value:cosNumber(733)}))});
 if(resourceCount)for(const category of ["Font","XObject","Properties","ExtGState","ColorSpace","Pattern","Shading"]){const map=document.cos.resolveDict(dictGet(pageResources,category))!;dictSet(map,"UnusedResourceValue",cosDict({Payload:cosArray(Array.from({length:resourceCount},()=>cosNumber(743)))}));}
 if(resourceCount)dictSet(document.cos.resolveDict(dictGet(pageResources,"ExtGState"))!,"SelectedState",document.cos.allocateObject(cosDict({SMask:document.cos.allocateObject(cosDict({S:cosName("Alpha"),BC:document.cos.allocateObject(cosArray([cosNumber(0),cosNumber(0),cosNumber(0),...Array.from({length:resourceCount},()=>cosNumber(761))])),TR:document.cos.allocateObject(cosStream(cosDict({FunctionType:cosNumber(4),Domain:cosArray([cosNumber(0),cosNumber(1)]),Range:cosArray([cosNumber(0),cosNumber(1)]),Unused:cosArray(Array.from({length:resourceCount},()=>cosNumber(763)))}),new TextEncoder().encode("{ }"))),G:document.cos.allocateObject(cosStream(cosDict({Subtype:cosName("Form"),BBox:cosArray([0,0,1,1].map(value=>cosNumber(value)))}),new Uint8Array())),Unused:cosArray(Array.from({length:resourceCount},()=>cosNumber(761)))})),ca:cosNumber(1),BM:document.cos.allocateObject(cosArray([cosName("Normal"),...Array.from({length:resourceCount},()=>cosNumber(751))])),Unused:cosArray(Array.from({length:resourceCount},()=>cosNumber(747)))})));
 if(resourceCount){
  const state=document.cos.resolveDict(dictGet(document.cos.resolveDict(dictGet(pageResources,"ExtGState"))!,"SelectedState"))!,mask=document.cos.resolveDict(dictGet(state,"SMask"))!;
  const formReference=dictGet(mask,"G")!,form=document.cos.resolve(formReference);if(form?.kind!=="stream")throw Error("mask form expected");
  const ignoredForm=()=>cosArray(Array.from({length:resourceCount},()=>cosNumber(773)));
  dictSet(form.dict,"Unused",ignoredForm());dictSet(form.dict,"Group",document.cos.allocateObject(cosDict({S:cosName("Transparency"),CS:cosName("DeviceRGB"),Unused:ignoredForm()})));
  dictSet(form.dict,"Matrix",document.cos.allocateObject(cosArray([...([1,0,0,1,0,0].map(value=>cosNumber(value))),...ignoredForm().items])));
  dictSet(form.dict,"BBox",document.cos.allocateObject(cosArray([...([0,0,1,1].map(value=>cosNumber(value))),...ignoredForm().items])));
  dictSet(xobjects,"SelectedForm",formReference);
  const ignored=cosDict({Unused:cosArray(Array.from({length:resourceCount},()=>cosNumber(769)))});
  const child=cosDict({FunctionType:cosNumber(2),Domain:cosArray([cosNumber(0),cosNumber(1)]),C0:cosArray([ignored]),C1:cosArray([cosNumber(1)]),N:document.cos.allocateObject(ignored)});
  dictSet(mask,"TR",document.cos.allocateObject(cosDict({FunctionType:cosNumber(3),Domain:cosArray([cosNumber(0),cosNumber(1)]),Functions:document.cos.allocateObject(cosArray([dictGet(mask,"TR")!,child])),Bounds:cosArray([cosNumber(.5)]),Encode:cosArray([0,1,0,1].map(value=>cosNumber(value)))})));
 }
 if(resourceCount)dictSet(document.cos.resolveDict(dictGet(pageResources,"Font"))!,"SelectedFont",document.cos.allocateObject(cosDict({Subtype:cosName("Type1"),BaseFont:cosName("Helvetica"),Unused:cosArray(Array.from({length:resourceCount},()=>cosNumber(757)))})));
 dictSet(pageDict,"Contents",cosArray([...Array.from({length:contentCount},()=>empty),content]));
 dictSet(pageDict,"Annots",cosArray(Array.from({length:count},()=>hidden)));
 let ancestor=dictGet(pageDict,"Parent")!;
 for(let i=0;i<count;i++)ancestor=document.cos.allocateObject(cosDict({Parent:ancestor}));
 dictSet(pageDict,"Parent",ancestor);
 let branch=page;
 for(let i=0;i<traversalCount;i++)branch=document.cos.allocateObject(cosDict({Type:cosName("Pages"),Kids:cosArray([branch,page]),Count:cosNumber(2)}));
 dictSet(pages,"Kids",cosArray([branch,...Array.from({length:traversalCount},()=>page)]));dictSet(pages,"Count",cosNumber(traversalCount));
 let namedRoot=document.cos.allocateObject(cosDict({Names:cosArray([cosString("target"),cosArray([page,cosName("Fit")])])}));
 for(let i=0;i<count;i++)namedRoot=document.cos.allocateObject(cosDict({Kids:cosArray([cosDict({}),namedRoot])}));
 dictSet(catalog,"Names",cosDict({Dests:namedRoot}));
 let nested=cosArray([cosNumber(7)]);for(let i=0;i<count;i++)nested=cosArray([nested]);dictSet(pageDict,"Widths",nested);
 // Keep explicit Length slots before a same-width test key: serialization
 // normalizes stream lengths, so rename the extra keys after writing the xref.
 let lengthReference=document.cos.allocateObject(cosNumber(0));
 for(let i=0;i<count;i++){const stream=cosStream(new Uint8Array());dictSet(stream.dict,"Length",cosNumber(0));dictSet(stream.dict,"LengtH",lengthReference);lengthReference=document.cos.allocateObject(stream);}
 dictSet(contentObject.dict,"LengtH",lengthReference);
 // Type shares the indirect filter-dictionary resolver without changing the
 // generated content's encoding or its pixel oracle.
 if(filterCount){let type=document.cos.allocateObject(cosName("Content"));for(let i=1;i<filterCount;i++)type=document.cos.allocateObject(type);dictSet(contentObject.dict,"Type",type);}
 const saved=serializeCosDocument({rootRef:document.cos.rootRef,objects:[...document.cos.objects.values()]}),bytes=new Uint8Array(saved.length+200000).fill(32);bytes.set(saved);
 const lengthKey=new TextEncoder().encode("/LengtH");let renamed=0;
 for(let i=0;i<saved.length-lengthKey.length;i++){if(lengthKey.every((byte,j)=>bytes[i+j]===byte)){bytes[i+lengthKey.length-1]=104;renamed++;}}
 expect(renamed).toBe(count+1);
 const expected=decodeImage(bytes);const expectedSum=expected.data.reduce((sum,value,index)=>(sum+value*(index%65521+1))%1000000007,0);
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../",import.meta.url)),sourcefile:"pdf-metadata-worker.ts",contents:`
 import {tryPdfDecode} from './packages/image-ast/src/index.ts';
 import {PdfFileSource,PdfRetainedDocument,CosRangeLexer} from '@poe-code/pdf-ast';
 export default {async fetch(request,env){const {size,namedRoot,mode}=await request.json();let id=0,opened=0,closed=0,removed=0,maxAllocation=0,reads=0;const scope={},files=new Map([['/input',{id:'input',size}]]);
 const stat=(file,type='file')=>({type,size:file.size,mode:420,mtimeMs:1,ctimeMs:1,atimeMs:1,identityScope:scope,opaqueIdentity:file.id,opaqueVersion:'1'}),parent=stat({id:'root',size:0},'directory');
 const fs={capabilities:{retainedRead:true,retainedStagingWrite:true,retainedStagingCleanup:true},async stat(){return parent;},async capabilitiesFor(){return this.capabilities;},
 async openReadFile(path){const file=files.get(path);if(!file)throw new Error('missing retained source');opened++;return {async stat(){return stat(file);},async read(position,length){if(length>65536)throw new Error('large request');reads++;return new Uint8Array(await env.BACKING.read(file.id,position,length));},async close(){closed++;}};},
 async createStagedFile(path,name){const file={id:String(++id),size:0},filePath=path+'/'+name;files.set(filePath,file);return {parent:{path:'/',stat:parent},directory:{path,stat:parent},file:{path:filePath,stat:stat(file)},writer:{async write(chunk){if(chunk.length>65536)throw new Error('large write');await env.BACKING.write(file.id,file.size,chunk);file.size+=chunk.length;},async finish(){return stat(file);}},cleanup:{async remove(){files.delete(filePath);removed++;await env.BACKING.remove(file.id);},async close(){}}};},
 readFile(){throw new Error('whole input');},writeFile(){throw new Error('whole output');}};
 const tokenNext=CosRangeLexer.prototype.nextToken;CosRangeLexer.prototype.nextToken=async function(){const token=await tokenNext.call(this);if(token?.kind==='number'&&token.raw.length>2048)throw Error('unbounded numeric spelling');if(token?.kind==='keyword'&&token.value.length>65)throw Error('unbounded keyword spelling');return token;};
 const add=Set.prototype.add;let maxSet=0;Set.prototype.add=function(value){const result=add.call(this,value);maxSet=Math.max(maxSet,this.size);return result;};
 const push=Array.prototype.push;Array.prototype.push=function(...values){const result=push.apply(this,values);if(this.length>64&&values.some(value=>value?.key?.decoded?.startsWith('UnusedFont')||value?.key?.decoded?.startsWith('UnusedResource')))throw Error('resident font dictionary');if(this.length>64&&values.some(value=>value?.kind==='number'&&(value.value===731||value.value===743||value.value===747||value.value===751||value.value===757||value.value===761||value.value===763||value.value===769||value.value===773||value.value===779)))throw Error('resident stream resource widths');if(this.length>64&&values.some(value=>value?.kind==='ref'))throw Error('resident page reference list');if(this.length>64&&values.some(value=>value?.kind==='array'&&'tail' in value||value?.kind==='dict'&&'start' in value))throw Error('resident parser frame list');return result;};
 const generatorPrototype=Object.getPrototypeOf(Object.getPrototypeOf((async function*(){})())),next=generatorPrototype.next;let activePulls=0,maxPulls=0;
 generatorPrototype.next=function(...args){maxPulls=Math.max(maxPulls,++activePulls);return next.apply(this,args).finally(()=>{activePulls--;});};
 const syncPrototype=Object.getPrototypeOf(Object.getPrototypeOf((function*(){})())),syncNext=syncPrototype.next;let activeSync=0,maxSync=0;
 syncPrototype.next=function(...args){maxSync=Math.max(maxSync,++activeSync);try{return syncNext.apply(this,args);}finally{activeSync--;}};
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw new Error('unbounded PDF allocation '+length);return Reflect.construct(target,args);}});
 try{let pixelEnd=0;const storage={allocate(length){const start=pixelEnd;pixelEnd+=length;return start;},async read(position,length){if(length>4096)throw Error('large pixel read');return new Uint8Array(await env.BACKING.read('pixels',position,length));},async write(position,bytes){if(bytes.length>4096)throw Error('large pixel write');await env.BACKING.write('pixels',position,bytes);}};
 let metadata;if(mode==='metadata'){const source=await PdfFileSource.open(fs,'/input',{chunkBytes:4096,cacheBytes:8192});let doc;
 try{doc=await PdfRetainedDocument.open(source,{fs,directory:'/'},{chunkBytes:4096,cacheBytes:8192,maxPageTreeDepth:Infinity,maxRecursionDepth:Infinity,compactNumbers:true,compactKeywords:true,valueArrays:{dictionaryStorage:storage,deferDictionaryValues:true,stringStorage:storage,storedDictionaryKeys:['Font','XObject','Properties'],storedDictionaryPaths:[['Resources','*']],containerStorage:storage,arrayStorage:storage,storedArrayKeys:['Kids','Contents','Annots','Widths']}});if(await doc.annotationPageNumber({kind:'ref',objectNumber:0,generationNumber:0})!==undefined)throw Error('unexpected destination');if((await doc.annotationNamedDestination(namedRoot,'target'))?.kind!=='array')throw Error('missing named destination');if(await doc.annotationNamedDestination(namedRoot,'absent')!==undefined)throw Error('unexpected named destination');}finally{try{await doc?.close();}finally{await source.close();}}
 }else{const input=await fs.openReadFile('/input');let image;try{image=await tryPdfDecode({size,read:input.read},storage,fs,'/',new AbortController().signal);}finally{await input.close();}
 let sum=0;for(let offset=0;offset<image.width*image.height*4;offset+=4096){const bytes=await storage.read(image.position+offset,Math.min(4096,image.width*image.height*4-offset));for(let i=0;i<bytes.length;i++)sum=(sum+bytes[i]*((offset+i)%65521+1))%1000000007;}
 metadata={width:image.width,height:image.height,sum};}
 await env.BACKING.remove('pixels');
 return Response.json({metadata,opened,closed,removed,files:files.size,reads,maxAllocation,maxPulls,maxSet,maxSync,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});}finally{CosRangeLexer.prototype.nextToken=tokenNext;globalThis.Uint8Array=Native;Array.prototype.push=push;generatorPrototype.next=next;Set.prototype.add=add;syncPrototype.next=syncNext;}
 }};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 const runtime=new Miniflare({workers:[{name:"image",modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{BACKING:"backing"}},
 {name:"backing",modules:true,compatibilityDate:"2026-07-01",cf:false,script:`
 import {WorkerEntrypoint} from 'cloudflare:workers';
 const backing=new Map();
 export default class extends WorkerEntrypoint {
  read(id,position,length){const file=backing.get('/'+id);return file.bytes.slice(position,Math.min(file.size,position+length));}
  write(id,position,chunk){const key='/'+id,end=position+chunk.length;let file=backing.get(key);if(!file||end>file.bytes.length){const next=new Uint8Array(Math.max(end,(file?.bytes.length??2048)*2));if(file)next.set(file.bytes);file={bytes:next,size:file?.size??0};backing.set(key,file);}file.bytes.set(chunk,position);file.size=Math.max(file.size,end);}
  remove(id){backing.delete('/'+id);}
  async fetch(request){const url=new URL(request.url);
   if(url.pathname==='/status')return Response.json([...backing.keys()]);
   this.write(url.pathname.slice(1),Number(url.searchParams.get('position')),new Uint8Array(await request.arrayBuffer()));return new Response();
  }
 }`}]});
 try{const backing=await runtime.getWorker("backing");
 await backing.fetch("https://backing/input?position=0",{method:"PUT",body:bytes});
 const response=await runtime.dispatchFetch("https://image/",{method:"POST",body:JSON.stringify({size:bytes.length,namedRoot,mode})});if(response.status!==200)throw new Error(await response.text());const result=await response.json() as {metadata:unknown;opened:number;closed:number;removed:number;files:number;reads:number;maxAllocation:number;maxPulls:number;maxSet:number;maxSync:number;nodeGlobals:boolean};
 if(mode==="pixels")expect(result.metadata).toEqual({width:expected.width,height:expected.height,sum:expectedSum});else expect(result.metadata).toBeUndefined();expect(result.opened).toBeGreaterThan(2);expect(result.closed).toBe(result.opened);expect(result.removed).toBeGreaterThan(0);expect(result.files).toBe(1);expect(result.reads).toBeGreaterThan(8);expect(result.maxAllocation).toBeLessThanOrEqual(65536);expect(result.maxPulls).toBeLessThan(64);expect(result.maxSet).toBeLessThanOrEqual(64);expect(result.maxSync).toBeLessThan(32);expect(result.nodeGlobals).toBe(false);expect(await(await backing.fetch("https://backing/status")).json()).toEqual(["/input"]);
 }finally{await runtime.dispose();}
},30000);
