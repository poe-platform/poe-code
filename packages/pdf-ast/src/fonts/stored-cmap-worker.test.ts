import {expect,it} from "vitest";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";

it("resolves growing CMap tables in Workerd with external resource backing",async()=>{
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../../",import.meta.url)),contents:`
 import {resolveRetainedFont} from './packages/pdf-ast/src/fonts/retained.ts';
 import {cosDict,cosArray,cosName,cosRef} from './packages/pdf-ast/src/ast.ts';
 export default {async fetch(request,env){const {size,mode}=await request.json();let id=0,opened=0,closed=0,removed=0,maxAllocation=0,reads=0;const scope={},files=new Map();
const stat=(file,type='file')=>({type,size:file.size,mode:420,mtimeMs:1,ctimeMs:1,atimeMs:1,identityScope:scope,opaqueIdentity:file.id,opaqueVersion:'1'}),parent=stat({id:'root',size:0},'directory');
 const fs={capabilities:{retainedRead:true,retainedStagingWrite:true,retainedStagingCleanup:true},async stat(){return parent;},async capabilitiesFor(){return this.capabilities;},
 async openReadFile(path){const file=files.get(path);if(!file)throw new Error('missing retained source');opened++;return {async stat(){return stat(file);},async read(position,length){if(length>65536)throw new Error('large request');reads++;const response=await env.BACKING.fetch('https://backing/'+file.id+'?position='+position+'&length='+length);return new Uint8Array(await response.arrayBuffer());},async close(){closed++;}};},
 async createStagedFile(path,name){const file={id:String(++id),size:0},filePath=path+'/'+name;files.set(filePath,file);return {parent:{path:'/',stat:parent},directory:{path,stat:parent},file:{path:filePath,stat:stat(file)},writer:{async write(chunk){if(chunk.length>65536)throw new Error('large write');await env.BACKING.fetch('https://backing/'+file.id+'?position='+file.size,{method:'PUT',body:chunk});file.size+=chunk.length;},async finish(){return stat(file);}},cleanup:{async remove(){files.delete(filePath);removed++;await env.BACKING.fetch('https://backing/'+file.id,{method:'DELETE'});},async close(){}}};},
 readFile(){throw new Error('whole input');},writeFile(){throw new Error('whole output');}};
 let end=0,resourceReads=0;
 const storage={allocate(length){const at=end;end+=length;return at;},async read(at,length){if(length>512)throw Error('whole CMap range');resourceReads++;return new Uint8Array(await(await env.BACKING.fetch('https://backing/resource?position='+at+'&length='+length)).arrayBuffer());},async write(at,bytes){if(bytes.length>512)throw Error('whole CMap write');await env.BACKING.fetch('https://backing/resource?position='+at,{method:'PUT',body:bytes});}};
 const doc={crossReference:{rootRef:cosRef(1)},async lookup(node){if(!node)return undefined;if(node.kind==='ref')return node.objectNumber===1?{value:cosDict()}:{value:cosDict(),stream:true,reference:node};return {value:node};},objects:{async *decodeStream(){yield new TextEncoder().encode(mode==='unicode'?'beginbfrange <00000000> <'+(size-1).toString(16).padStart(8,'0')+'> <0041> endbfrange':'begincidrange <00000000> <'+(size-1).toString(16).padStart(8,'0')+'> 123 endcidrange');}}};
 const fontDict=mode==='unicode'?cosDict({Subtype:cosName('Type3'),ToUnicode:cosRef(2)}):cosDict({Subtype:cosName('Type0'),BaseFont:cosName('Courier'),Encoding:cosRef(2)});
 const resources=cosDict({Font:cosDict({F:fontDict})});
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const length=typeof args[0]==='number'?args[0]:args[0]?.byteLength??args[0]?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw Error('unbounded CMap source allocation '+length);return Reflect.construct(target,args);}});
 try{
 const font=await resolveRetainedFont(doc,{fs,directory:'/'},resources,'F',{chunkBytes:4096,resourceStorage:storage});if(font.cmap||font.encodingCMap)throw Error("resident CMap");
 const map=mode==='unicode'?font.storedCMap:font.storedEncodingCMap;const value=await map.lookup(0),last=await map.lookup(size-1);
 await env.BACKING.fetch('https://backing/resource',{method:'DELETE'});
 return Response.json({value,last,end,resourceReads,opened,closed,removed,files:files.size,maxAllocation,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{globalThis.Uint8Array=Native;}
 }};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(o=>o.imports)).toEqual([]);
 const backing=new Map<string,Uint8Array>();
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{BACKING:async(request:Request)=>{
 const url=new URL(request.url),key=url.pathname,at=Number(url.searchParams.get("position"));
 if(request.method==="DELETE"){backing.delete(key);return new Response();}
 if(request.method==="PUT"){const bytes=new Uint8Array(await request.arrayBuffer()),old=backing.get(key)??new Uint8Array(),next=new Uint8Array(Math.max(old.length,at+bytes.length));next.set(old);next.set(bytes,at);backing.set(key,next);return new Response();}
 return new Response(backing.get(key)!.slice(at,at+Number(url.searchParams.get("length"))));
 }}});
 try{for(const size of [65536,1048576])for(const mode of ["unicode","encoding"]){
 const response=await runtime.dispatchFetch("https://verify/",{method:"POST",body:JSON.stringify({size,mode})});if(response.status!==200)throw Error(await response.text());
 const result=await response.json() as {value:string|number;last:string|number;end:number;resourceReads:number;opened:number;closed:number;removed:number;files:number;maxAllocation:number;nodeGlobals:boolean};
 expect(result.value).toBe(mode==="unicode"?"A":123);expect(result.last).toBe(mode==="unicode"?String.fromCharCode(((Math.floor((size-1+65)/256)<<8)|((size-1+65)%256))):size-1+123);expect(result.end).toBeLessThan(10000);expect(result.resourceReads).toBeGreaterThan(0);expect(result.opened).toBeGreaterThan(0);expect(result.closed).toBe(result.opened);expect(result.removed).toBeGreaterThan(0);expect(result.files).toBe(0);expect(result.maxAllocation).toBeLessThanOrEqual(65536);expect(result.nodeGlobals).toBe(false);expect(backing.size).toBe(0);
 }}finally{await runtime.dispose();}
},15000);
