import {expect,it} from "vitest";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";

it("bounds Worker mesh allocations and keeps lattice/patch backing outside the isolate",async()=>{
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../../",import.meta.url)),sourcefile:"mesh-worker.ts",contents:`
 import {renderRetainedMesh} from './packages/pdf-ast/src/extract/retained-mesh.ts';
 import {renderShadingDictToImage} from './packages/pdf-ast/src/content/evaluator.ts';
 import {PdfDocument} from './packages/pdf-ast/src/document.ts';
 import {cosDict,cosNumber,cosArray,cosName,cosStream} from './packages/pdf-ast/src/ast.ts';
 export default {async fetch(request,env){const {type,repeats}=await request.json();let id=0,opened=0,closed=0,removed=0,maxAllocation=0,reads=0;const scope={},files=new Map();
const stat=(file,type='file')=>({type,size:file.size,mode:420,mtimeMs:1,ctimeMs:1,atimeMs:1,identityScope:scope,opaqueIdentity:file.id,opaqueVersion:'1'}),parent=stat({id:'root',size:0},'directory');
 const fs={capabilities:{retainedRead:true,retainedStagingWrite:true,retainedStagingCleanup:true},async stat(){return parent;},async capabilitiesFor(){return this.capabilities;},
 async openReadFile(path){const file=files.get(path);if(!file)throw new Error('missing retained source');opened++;return {async stat(){return stat(file);},async read(position,length){if(length>65536)throw new Error('large request');reads++;const response=await env.BACKING.fetch('https://backing/'+file.id+'?position='+position+'&length='+length);return new Uint8Array(await response.arrayBuffer());},async close(){closed++;}};},
 async createStagedFile(path,name){const file={id:String(++id),size:0},filePath=path+'/'+name;files.set(filePath,file);return {parent:{path:'/',stat:parent},directory:{path,stat:parent},file:{path:filePath,stat:stat(file)},writer:{async write(chunk){if(chunk.length>65536)throw new Error('large write');await env.BACKING.fetch('https://backing/'+file.id+'?position='+file.size,{method:'PUT',body:chunk});file.size+=chunk.length;},async finish(){return stat(file);}},cleanup:{async remove(){files.delete(filePath);removed++;await env.BACKING.fetch('https://backing/'+file.id,{method:'DELETE'});},async close(){}}};},
 readFile(){throw new Error('whole input');},writeFile(){throw new Error('whole output');}};

 const originals=new Map();
 for(const name of ['Uint8Array','Float32Array','Float64Array','Int32Array','Uint32Array','ArrayBuffer']){const Native=globalThis[name];originals.set(name,Native);globalThis[name]=new Proxy(Native,{construct(target,args){const length=typeof args[0]==='number'?args[0]*(target.BYTES_PER_ELEMENT??1):args[0]?.byteLength??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw Error('Unbounded mesh allocation: '+length);return Reflect.construct(target,args);}});}
 try{
 const numbers=values=>cosArray(values.map(value=>cosNumber(value)));
 const dict=cosDict({ShadingType:cosNumber(type),BitsPerCoordinate:cosNumber(8),BitsPerComponent:cosNumber(8),BitsPerFlag:cosNumber(8),VerticesPerRow:cosNumber(2),ColorSpace:cosName('DeviceRGB'),Decode:numbers([0,10,0,10,0,1,0,1,0,1])});
 const points=[0,0,0,85,0,170,0,255,85,255,170,255,255,255,255,170,255,85,255,0,170,0,85,0,85,85,85,170,170,170,170,85];
 const payload=type===4?new Uint8Array([0,0,0,255,0,0,0,255,0,0,255,0,0,0,255,0,0,255]):type===5?new Uint8Array([0,0,255,0,0,255,0,0,255,0,0,255,0,0,255,255,255,255,255,255]):new Uint8Array([0,...points.slice(0,type===6?24:32),255,0,0,0,255,0,0,0,255,255,255,255]);
 const context=PdfDocument.create().cos,settings={matrix:[1,0,0,1,0,0],bounds:[0,0,10,10],alpha:1,name:'mesh'};
 const expected=renderShadingDictToImage(context,dict,settings.matrix,settings.bounds,1,'mesh',undefined,cosStream(dict,payload));
 const input=async function*(){for(let i=0;i<repeats;i++)yield payload;};
 let admitted=0;const result=await renderRetainedMesh(context,dict,type,input(),settings,{fs,directory:'/'},{chunkBytes:1024},bytes=>{admitted+=bytes;if(admitted>262144)throw Error('mesh working admission');});
 if(type!==5&&JSON.stringify(Array.from(result.decodedRgba))!==JSON.stringify(Array.from(expected.decodedRgba)))throw Error('mesh pixel mismatch');
 return Response.json({opened,closed,removed,files:files.size,reads,maxAllocation,admitted,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{for(const [name,Native]of originals)globalThis[name]=Native;}
 }};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 const backing=new Map<string,Uint8Array>();let maximumWrite=0,maximumRead=0;
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{BACKING:async(request:Request)=>{
  const url=new URL(request.url),key=url.pathname,position=Number(url.searchParams.get("position"));
  if(request.method==="DELETE"){backing.delete(key);return new Response();}
  if(request.method==="PUT"){const chunk=new Uint8Array(await request.arrayBuffer());maximumWrite=Math.max(maximumWrite,chunk.length);const old=backing.get(key)??new Uint8Array(),next=new Uint8Array(Math.max(old.length,position+chunk.length));next.set(old);next.set(chunk,position);backing.set(key,next);return new Response();}
  const length=Number(url.searchParams.get("length"));maximumRead=Math.max(maximumRead,length);return new Response(backing.get(key)!.slice(position,position+length));
 }}});
 try{
  for(const type of [4,5,6,7])for(const repeats of [8,256]){
   const response=await runtime.dispatchFetch("https://mesh/",{method:"POST",body:JSON.stringify({type,repeats})});if(response.status!==200)throw Error(await response.text());
   const result=await response.json() as {opened:number;closed:number;removed:number;files:number;reads:number;maxAllocation:number;admitted:number;nodeGlobals:boolean};
   expect(result.closed).toBe(result.opened);expect(result.files).toBe(0);expect(result.maxAllocation).toBeLessThanOrEqual(65536);expect(result.admitted).toBeLessThanOrEqual(262144);expect(result.nodeGlobals).toBe(false);expect(backing.size).toBe(0);
   if(type!==4){expect(result.opened).toBeGreaterThan(0);expect(result.removed).toBeGreaterThan(0);expect(result.reads).toBeGreaterThan(0);}
  }
  expect(maximumWrite).toBeLessThanOrEqual(1024);expect(maximumRead).toBeLessThanOrEqual(1024);
 }finally{await runtime.dispose();}
},15000);
