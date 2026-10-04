import {expect,it} from "vitest";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";

it("uses bounded external backing for growing sampled color and shading tables in Workerd",async()=>{
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../../",import.meta.url)),sourcefile:"sampled-worker.ts",contents:`
 import {convertRetainedContentColor,resolveRetainedMaskParameters,renderRetainedShading} from './packages/pdf-ast/src/extract/retained-color.ts';
 import {PdfRetainedDecodedImage} from './packages/pdf-ast/src/extract/retained-decoded-image.ts';
 import {cosHexString,cosDict,cosNumber,cosName,cosArray,cosRef,cosStream} from './packages/pdf-ast/src/ast.ts';
 export default {async fetch(request,env){
 const {count,mode:requested}=await request.json();const postscript=requested.startsWith("ps:"),mode=postscript?requested.slice(3):requested;let handles=0,closed=0,writes=0,reads=0,peak=0,produced=0;
 let stageId=0,stageOpened=0,stageClosed=0;const scope={},files=new Map();
 const stat=(file,type='file')=>({type,size:file.size,mode:420,mtimeMs:1,ctimeMs:1,atimeMs:1,identityScope:scope,opaqueIdentity:file.id,opaqueVersion:'1'}),parent=stat({id:'root',size:0},'directory');
 const fs={capabilities:{retainedRead:true,retainedStagingWrite:true,retainedStagingCleanup:true},async stat(){return parent;},async capabilitiesFor(){return this.capabilities;},
 async openReadFile(path){const file=files.get(path);if(!file)throw Error('missing source');stageOpened++;return {async stat(){return stat(file);},async read(position,length){if(length>65536)throw Error('large staged read');return new Uint8Array(await(await env.BACKING.fetch('https://backing/'+file.id+'?at='+position+'&length='+length)).arrayBuffer());},async close(){stageClosed++;}};},
 async createStagedFile(path,name){const file={id:'stage-'+(++stageId),size:0},filePath=path+'/'+name;files.set(filePath,file);return {parent:{path:'/',stat:parent},directory:{path,stat:parent},file:{path:filePath,stat:stat(file)},writer:{async write(chunk){if(chunk.length>65536)throw Error('large staged write');await env.BACKING.fetch('https://backing/'+file.id+'?at='+file.size,{method:'PUT',body:chunk});file.size+=chunk.length;},async finish(){return stat(file);}},cleanup:{async remove(){files.delete(filePath);await env.BACKING.fetch('https://backing/'+file.id,{method:'DELETE'});},async close(){}}};},async removeFileConditional(){},async open(){const id=++handles;return {
 capabilities:{positionedRead:true,positionedWrite:true},async stat(){return {type:'file',size:0};},
 async write(bytes,position){if(bytes.length>16384)throw Error('large write');writes++;await env.BACKING.fetch('https://backing/'+id+'?at='+position,{method:'PUT',body:bytes});return bytes.length;},
 async read(bytes,position){if(bytes.length>16384)throw Error('large read');reads++;bytes.set(new Uint8Array(await(await env.BACKING.fetch('https://backing/'+id+'?at='+position+'&length='+bytes.length)).arrayBuffer()));return bytes.length;},
 async close(){closed++;await env.BACKING.fetch('https://backing/'+id,{method:'DELETE'});}};},readFile(){throw Error('whole read');},writeFile(){throw Error('whole write');}};
 const numbers=v=>cosArray(v.map(n=>cosNumber(n))),reference=cosRef(1),kind=Number(mode)||2,mesh=kind>=4;
 const table=cosDict({FunctionType:cosNumber(postscript?4:0),Size:numbers([count]),BitsPerSample:cosNumber(8),Domain:numbers([0,1]),Range:numbers([0,1,0,1,0,1])});
 const shading=cosDict({ShadingType:cosNumber(kind),Function:reference,ColorSpace:cosName('DeviceRGB'),Coords:numbers(kind===3?[0,0,0,0,0,5]:[0,0,4,0]),Domain:numbers(kind===1?[0,4,0,4]:[0,1]),BitsPerCoordinate:cosNumber(8),BitsPerComponent:cosNumber(8),BitsPerFlag:cosNumber(8),VerticesPerRow:cosNumber(2),Decode:numbers([0,4,0,4,0,1])});
 const points=[0,0,0,85,0,170,0,255,85,255,170,255,255,255,255,170,255,85,255,0,170,0,85,0,85,85,85,170,170,170,170,85];
 const payload=kind===4?new Uint8Array([0,0,0,128,0,255,0,128,0,0,255,128]):kind===5?new Uint8Array([0,0,128,255,0,128,0,255,128,255,255,128]):new Uint8Array([0,...points.slice(0,kind===6?24:32),128,128,128,128]);
 const document={depthLimit:100,async lookup(node){if(!node)return undefined;if(node?.kind==='ref')return {value:node.objectNumber===1?table:shading,stream:true,reference:node};return {value:node};},objects:{async *decodeStream(number){if(number===2){yield payload;return;}if(postscript){
 const encode=new TextEncoder(),start=encode.encode('{ pop '),end=encode.encode('0.5 dup dup }');produced+=start.length;yield start;
 const body='1 pop '.repeat(128)+'%'+'.'.repeat(4096-128*6-2)+'\\n',chunk=encode.encode(body);
 for(let at=0;at<count*3;at+=chunk.length){produced+=chunk.length;yield chunk;}produced+=end.length;yield end;return;}
 const chunk=new Uint8Array(4096).fill(128);for(let at=0;at<count*3;at+=chunk.length){const bytes=chunk.subarray(0,Math.min(chunk.length,count*3-at));produced+=bytes.length;yield bytes;}}}};
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const length=typeof args[0]==='number'?args[0]:args[0]?.byteLength??args[0]?.length??0;peak=Math.max(peak,length);if(length>65536)throw Error('unbounded sample allocation '+length);return Reflect.construct(target,args);}});
 try{
  const storage={fs,directory:'/'};let values;
  if(mode==='tint')values=await convertRetainedContentColor(document,cosArray([cosName('Separation'),cosName('Spot'),cosName('DeviceRGB'),reference]),'Spot',[0.5],undefined,storage);
  else if(mode==='mask'){const result=await resolveRetainedMaskParameters(document,cosDict({TR:reference}),cosStream(cosDict(),new Uint8Array()),undefined,storage);values=[result.transferMap[0],result.transferMap[128],result.transferMap[255]];}
  else if(mode==='image'||mode==='palette'){
   const tint=cosArray([cosName('Separation'),cosName('Spot'),cosName('DeviceRGB'),reference]);
   const color=mode==='palette'?cosArray([cosName('Indexed'),tint,cosNumber(1),cosHexString(new Uint8Array([0,255]))]):tint;
   const owner=await PdfRetainedDecodedImage.open(document,{dict:cosDict({Width:cosNumber(2),Height:cosNumber(1),BitsPerComponent:cosNumber(8),ColorSpace:color}),async *contents(){yield new Uint8Array([0,mode==='palette'?1:255]);}},storage);
   try{values=[];for await(const row of owner.rows())values.push(...row);}finally{await owner.close();}
  }
  else {const result=await renderRetainedShading(document,mesh?cosRef(2):shading,{matrix:[1,0,0,1,0,0],bounds:[0,0,4,4],alpha:1,name:'test'},storage);values=Array.from(result.decodedRgba);}
  return Response.json({values,stageOpened,stageClosed,files:files.size,handles,closed,writes,reads,peak,produced,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{globalThis.Uint8Array=Native;}
 }};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(o=>o.imports)).toEqual([]);
 const backing=new Map<string,Uint8Array>();
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{BACKING:async(request:Request)=>{
  const url=new URL(request.url),at=Number(url.searchParams.get("at")),key=url.pathname;
  if(request.method==="DELETE"){backing.delete(key);return new Response();}
  if(request.method==="PUT"){const chunk=new Uint8Array(await request.arrayBuffer()),old=backing.get(key)??new Uint8Array(),next=new Uint8Array(Math.max(old.length,at+chunk.length));next.set(old);next.set(chunk,at);backing.set(key,next);return new Response();}
  return new Response(backing.get(key)?.slice(at,at+Number(url.searchParams.get("length"))));
 }}});
 try{for(const count of [65536,131072])for(const mode of ["tint","mask","image","palette","ps:tint","ps:image","1","2","3","4","5","6","7"]){
  const response=await runtime.dispatchFetch("https://sample/",{method:"POST",body:JSON.stringify({count,mode})});if(response.status!==200)throw Error(mode+": "+await response.text());
  const result=await response.json() as {values:number[];stageOpened:number;stageClosed:number;files:number;handles:number;closed:number;writes:number;reads:number;peak:number;produced:number;nodeGlobals:boolean};
  if(mode==="ps:tint")expect(result.values).toEqual([0.5,0.5,0.5]);
  else if(mode==="tint")expect(result.values).toEqual([128/255,128/255,128/255]);
  else if(mode==="mask")expect(result.values).toEqual([128,128,128]);
  else {expect(result.values.some((value,i)=>i%4===3&&value>0)).toBe(true);for(let i=0;i<result.values.length;i+=4)if(result.values[i+3])expect(result.values.slice(i,i+3)).toEqual([128,128,128]);}
  expect(result.stageClosed).toBe(result.stageOpened);expect(result.files).toBe(0);expect(result.produced).toBe(count*3+(mode.startsWith("ps:")?19:0));expect(result.handles).toBe(1);expect(result.closed).toBe(result.handles);expect(result.writes).toBeGreaterThan(8);expect(result.reads).toBeGreaterThan(0);expect(result.peak).toBeLessThanOrEqual(65536);expect(result.nodeGlobals).toBe(false);expect(backing.size).toBe(0);
 }}finally{await runtime.dispose();}
},15000);
