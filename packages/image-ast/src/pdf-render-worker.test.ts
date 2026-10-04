import {expect,it} from "vitest";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";
import {PdfDocument,cosArray,cosDict,cosName,cosString,cosStream,cosNumber,dictGet,dictSet,serializeCosDocument} from "@poe-code/pdf-ast";
import sharp,{decodeImage} from "./index.js";

it.each([32,128])("renders PDF pixels with %i backed page, content and annotation references in Workerd",async count=>{
 // Keep the complete RGBA plane above 64 KiB while requiring only five raster tiles.
 const pixels=new Uint8Array(257*64*4);let state=1234567;for(let i=0;i<pixels.length;i++){state^=state<<13;state^=state>>>17;state^=state<<5;pixels[i]=state&255;}
 const pdf=await sharp(pixels,{raw:{width:257,height:64,channels:4}}).toFormat("pdf").toBuffer();const document=PdfDocument.load(pdf),catalog=document.cos.resolveDict(document.cos.rootRef)!,pages=document.cos.resolveDict(dictGet(catalog,"Pages"))!,page=document.getPage(0).pageRef;
 const pageDict=document.getPage(0).pageDict,content=dictGet(pageDict,"Contents")!,empty=document.cos.allocateObject(cosStream(new TextEncoder().encode("q Q"))),hidden=document.cos.allocateObject(cosDict({F:cosNumber(2)}));
 dictSet(pageDict,"Contents",cosArray([...Array.from({length:count},()=>empty),content]));
 dictSet(pageDict,"Annots",cosArray(Array.from({length:count},()=>hidden)));
 let ancestor=dictGet(pageDict,"Parent")!;
 for(let i=0;i<count;i++)ancestor=document.cos.allocateObject(cosDict({Parent:ancestor}));
 dictSet(pageDict,"Parent",ancestor);
 let branch=page;
 for(let i=0;i<count;i++)branch=document.cos.allocateObject(cosDict({Type:cosName("Pages"),Kids:cosArray([branch,page]),Count:cosNumber(2)}));
 dictSet(pages,"Kids",cosArray([branch,...Array.from({length:count},()=>page)]));dictSet(pages,"Count",cosNumber(count));
 let namedRoot=document.cos.allocateObject(cosDict({Names:cosArray([cosString("target"),cosArray([page,cosName("Fit")])])}));
 for(let i=0;i<count;i++)namedRoot=document.cos.allocateObject(cosDict({Kids:cosArray([cosDict({}),namedRoot])}));
 dictSet(catalog,"Names",cosDict({Dests:namedRoot}));
 const saved=serializeCosDocument({rootRef:document.cos.rootRef,objects:[...document.cos.objects.values()]}),bytes=new Uint8Array(saved.length+200000).fill(32);bytes.set(saved);
 const expected=decodeImage(bytes);const expectedSum=expected.data.reduce((sum,value,index)=>(sum+value*(index%65521+1))%1000000007,0);
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../",import.meta.url)),sourcefile:"pdf-metadata-worker.ts",contents:`
 import {tryPdfDecode} from './packages/image-ast/src/index.ts';
 import {PdfFileSource,PdfRetainedDocument} from '@poe-code/pdf-ast';
 export default {async fetch(request,env){const {size,namedRoot}=await request.json();let id=0,opened=0,closed=0,removed=0,maxAllocation=0,reads=0;const scope={},files=new Map([['/input',{id:'input',size}]]);
 const stat=(file,type='file')=>({type,size:file.size,mode:420,mtimeMs:1,ctimeMs:1,atimeMs:1,identityScope:scope,opaqueIdentity:file.id,opaqueVersion:'1'}),parent=stat({id:'root',size:0},'directory');
 const fs={capabilities:{retainedRead:true,retainedStagingWrite:true,retainedStagingCleanup:true},async stat(){return parent;},async capabilitiesFor(){return this.capabilities;},
 async openReadFile(path){const file=files.get(path);if(!file)throw new Error('missing retained source');opened++;return {async stat(){return stat(file);},async read(position,length){if(length>65536)throw new Error('large request');reads++;const response=await env.BACKING.fetch('https://backing/'+file.id+'?position='+position+'&length='+length);return new Uint8Array(await response.arrayBuffer());},async close(){closed++;}};},
 async createStagedFile(path,name){const file={id:String(++id),size:0},filePath=path+'/'+name;files.set(filePath,file);return {parent:{path:'/',stat:parent},directory:{path,stat:parent},file:{path:filePath,stat:stat(file)},writer:{async write(chunk){if(chunk.length>65536)throw new Error('large write');await env.BACKING.fetch('https://backing/'+file.id+'?position='+file.size,{method:'PUT',body:chunk});file.size+=chunk.length;},async finish(){return stat(file);}},cleanup:{async remove(){files.delete(filePath);removed++;await env.BACKING.fetch('https://backing/'+file.id,{method:'DELETE'});},async close(){}}};},
 readFile(){throw new Error('whole input');},writeFile(){throw new Error('whole output');}};
 const add=Set.prototype.add;let maxSet=0;Set.prototype.add=function(value){const result=add.call(this,value);maxSet=Math.max(maxSet,this.size);return result;};
 const push=Array.prototype.push;Array.prototype.push=function(...values){const result=push.apply(this,values);if(this.length>64&&values.some(value=>value?.kind==='ref'))throw Error('resident page reference list');return result;};
 const generatorPrototype=Object.getPrototypeOf(Object.getPrototypeOf((async function*(){})())),next=generatorPrototype.next;let activePulls=0,maxPulls=0;
 generatorPrototype.next=function(...args){maxPulls=Math.max(maxPulls,++activePulls);return next.apply(this,args).finally(()=>{activePulls--;});};
 const syncPrototype=Object.getPrototypeOf(Object.getPrototypeOf((function*(){})())),syncNext=syncPrototype.next;let activeSync=0,maxSync=0;
 syncPrototype.next=function(...args){maxSync=Math.max(maxSync,++activeSync);try{return syncNext.apply(this,args);}finally{activeSync--;}};
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw new Error('unbounded PDF allocation '+length);return Reflect.construct(target,args);}});
 try{let pixelEnd=0;const storage={allocate(length){const start=pixelEnd;pixelEnd+=length;return start;},async read(position,length){if(length>4096)throw Error('large pixel read');return new Uint8Array(await(await env.BACKING.fetch('https://backing/pixels?position='+position+'&length='+length)).arrayBuffer());},async write(position,bytes){if(bytes.length>4096)throw Error('large pixel write');await env.BACKING.fetch('https://backing/pixels?position='+position,{method:'PUT',body:bytes});}};
 const source=await PdfFileSource.open(fs,'/input',{chunkBytes:4096,cacheBytes:8192});let doc;
 try{doc=await PdfRetainedDocument.open(source,{fs,directory:'/'},{chunkBytes:4096,cacheBytes:8192,maxPageTreeDepth:Infinity,valueArrays:{arrayStorage:storage,storedArrayKeys:['Kids','Contents','Annots']}});if(await doc.annotationPageNumber({kind:'ref',objectNumber:0,generationNumber:0})!==undefined)throw Error('unexpected destination');if((await doc.annotationNamedDestination(namedRoot,'target'))?.kind!=='array')throw Error('missing named destination');if(await doc.annotationNamedDestination(namedRoot,'absent')!==undefined)throw Error('unexpected named destination');}finally{try{await doc?.close();}finally{await source.close();}}
 const input=await fs.openReadFile('/input');let image;try{image=await tryPdfDecode({size,read:input.read},storage,fs,'/',new AbortController().signal);}finally{await input.close();}
 let sum=0;for(let offset=0;offset<image.width*image.height*4;offset+=4096){const bytes=await storage.read(image.position+offset,Math.min(4096,image.width*image.height*4-offset));for(let i=0;i<bytes.length;i++)sum=(sum+bytes[i]*((offset+i)%65521+1))%1000000007;}
 await env.BACKING.fetch('https://backing/pixels',{method:'DELETE'});
 return Response.json({metadata:{width:image.width,height:image.height,sum},opened,closed,removed,files:files.size,reads,maxAllocation,maxPulls,maxSet,maxSync,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});}finally{globalThis.Uint8Array=Native;Array.prototype.push=push;generatorPrototype.next=next;Set.prototype.add=add;syncPrototype.next=syncNext;}
 }};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 const runtime=new Miniflare({workers:[{name:"image",modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{BACKING:"backing"}},
 {name:"backing",modules:true,compatibilityDate:"2026-07-01",cf:false,script:`const backing=new Map();export default {async fetch(request){
  const url=new URL(request.url),key=url.pathname,position=Number(url.searchParams.get("position"));
  if(key==='/status')return Response.json([...backing.keys()]);
  if(request.method==="DELETE"){backing.delete(key);return new Response();}
  if(request.method==="PUT"){const chunk=new Uint8Array(await request.arrayBuffer()),end=position+chunk.length;let file=backing.get(key);if(!file||end>file.bytes.length){const next=new Uint8Array(Math.max(end,(file?.bytes.length??2048)*2));if(file)next.set(file.bytes);file={bytes:next,size:file?.size??0};backing.set(key,file);}file.bytes.set(chunk,position);file.size=Math.max(file.size,end);return new Response();}
  return new Response(backing.get(key).bytes.slice(position,Math.min(backing.get(key).size,position+Number(url.searchParams.get("length")))));
 }}`}]});
 try{const backing=await runtime.getWorker("backing");
 await backing.fetch("https://backing/input?position=0",{method:"PUT",body:bytes});
 const response=await runtime.dispatchFetch("https://image/",{method:"POST",body:JSON.stringify({size:bytes.length,namedRoot})});if(response.status!==200)throw new Error(await response.text());const result=await response.json() as {metadata:unknown;opened:number;closed:number;removed:number;files:number;reads:number;maxAllocation:number;maxPulls:number;maxSet:number;maxSync:number;nodeGlobals:boolean};
 expect(result.metadata).toEqual({width:expected.width,height:expected.height,sum:expectedSum});expect(result.opened).toBeGreaterThan(2);expect(result.closed).toBe(result.opened);expect(result.removed).toBeGreaterThan(0);expect(result.files).toBe(1);expect(result.reads).toBeGreaterThan(8);expect(result.maxAllocation).toBeLessThanOrEqual(65536);expect(result.maxPulls).toBeLessThan(64);expect(result.maxSet).toBeLessThanOrEqual(64);expect(result.maxSync).toBeLessThan(32);expect(result.nodeGlobals).toBe(false);expect(await(await backing.fetch("https://backing/status")).json()).toEqual(["/input"]);
 }finally{await runtime.dispose();}
},15000);
