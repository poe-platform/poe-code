import { beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
let script: string;
beforeAll(async () => {
  const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL("../../../../", import.meta.url)), sourcefile: "object-stream-worker.ts", contents: `
 import {saveRetainedDocumentChunks} from './packages/pdf-ast/src/edit/retained-save.ts';
 import {cosArray,cosDict,cosName,cosNumber,cosRef} from './packages/pdf-ast/src/ast.ts';
 export default {async fetch(request,env){
 const {count}=await request.json();let handles=0,closed=0,writes=0,reads=0,peak=0;
 let stageId=0,stageOpened=0,stageClosed=0;const scope={},files=new Map();
 const stat=(file,type='file')=>({type,size:file.size,mode:420,mtimeMs:1,ctimeMs:1,atimeMs:1,identityScope:scope,opaqueIdentity:file.id,opaqueVersion:'1'}),parent=stat({id:'root',size:0},'directory');
 const fs={capabilities:{retainedRead:true,retainedStagingWrite:true,retainedStagingCleanup:true},async stat(){return parent;},async capabilitiesFor(){return this.capabilities;},
 async openReadFile(path){const file=files.get(path);if(!file)throw Error('missing source');stageOpened++;return {async stat(){return stat(file);},async read(position,length){if(length>65536)throw Error('large staged read');return new Uint8Array(await(await env.BACKING.fetch('https://backing/'+file.id+'?at='+position+'&length='+length)).arrayBuffer());},async close(){stageClosed++;}};},
 async createStagedFile(path,name){const file={id:'stage-'+(++stageId),size:0},filePath=path+'/'+name;files.set(filePath,file);return {parent:{path:'/',stat:parent},directory:{path,stat:parent},file:{path:filePath,stat:stat(file)},writer:{async write(chunk){if(chunk.length>65536)throw Error('large staged write');await env.BACKING.fetch('https://backing/'+file.id+'?at='+file.size,{method:'PUT',body:chunk});file.size+=chunk.length;},async finish(){return stat(file);}},cleanup:{async remove(){files.delete(filePath);await env.BACKING.fetch('https://backing/'+file.id,{method:'DELETE'});},async close(){}}};},async removeFileConditional(){},async open(){const id=++handles;return {
 capabilities:{positionedRead:true,positionedWrite:true},async stat(){return {type:'file',size:0};},
 async write(bytes,position){if(bytes.length>16384)throw Error('large write');writes++;await env.BACKING.fetch('https://backing/'+id+'?at='+position,{method:'PUT',body:bytes});return bytes.length;},
 async read(bytes,position){if(bytes.length>16384)throw Error('large read');reads++;bytes.set(new Uint8Array(await(await env.BACKING.fetch('https://backing/'+id+'?at='+position+'&length='+bytes.length)).arrayBuffer()));return bytes.length;},
 async close(){closed++;await env.BACKING.fetch('https://backing/'+id,{method:'DELETE'});}};},readFile(){throw Error('whole read');},writeFile(){throw Error('whole write');}};

 const root=cosDict({Type:cosName('Catalog'),Pages:cosRef(2)});
 const page=()=>cosDict({Type:cosName('Page'),Parent:cosRef(2),MediaBox:cosArray([0,0,100,200].map(value=>cosNumber(value))),Resources:cosDict({})});
 const value=n=>n===1?root:n===2?cosDict({Type:cosName('Pages'),Count:cosNumber(count),Kids:cosArray([])}):page();
 const document={crossReference:{rootRef:cosRef(1),version:'1.3',index:{async *entries(){for(let n=1;n<=count+2;n++)yield {objectNumber:n,type:'uncompressed'};}}},objects:{async get(n){return {value:value(n)};}},async lookup(node){return node?{value:node.kind==='ref'?value(node.objectNumber):node}:undefined;},async *pages(){for(let i=0;i<count;i++)yield {index:i,reference:cosRef(i+3),dict:page()};}};
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const size=typeof args[0]==='number'?args[0]:args[0]?.byteLength??args[0]?.length??0;peak=Math.max(peak,size);if(size>65536)throw Error('unbounded allocation '+size);return Reflect.construct(target,args);}});
 try{let bytes=0;for await(const chunk of saveRetainedDocumentChunks(document,{fs,directory:'/'},{objectStreams:'generate',chunkBytes:4096})){if(chunk.length>4096)throw Error('large output');bytes+=chunk.length;await Promise.resolve();}
 return Response.json({bytes,handles,closed,writes,reads,peak,stageOpened,stageClosed,files:files.size,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{globalThis.Uint8Array=Native;}
 }};` }, bundle: true, write: false, platform: "browser", conditions: ["workerd"], format: "esm", metafile: true, logLevel: "silent" });
  expect(Object.values(bundle.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  script = bundle.outputFiles[0]!.text;
});
it("generates growing object streams in Workerd with external caller storage", async () => {
 const backing=new Map<string,Uint8Array>();
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script,serviceBindings:{BACKING:async(request:Request)=>{
  const url=new URL(request.url),at=Number(url.searchParams.get("at")),key=url.pathname;
  if(request.method==="DELETE"){backing.delete(key);return new Response();}
  if(request.method==="PUT"){const chunk=new Uint8Array(await request.arrayBuffer()),old=backing.get(key)??new Uint8Array(),next=new Uint8Array(Math.max(old.length,at+chunk.length));next.set(old);next.set(chunk,at);backing.set(key,next);return new Response();}
  return new Response(backing.get(key)?.slice(at,at+Number(url.searchParams.get("length"))));
 }}});

 try { for (const count of [256, 1024]) {
   const response = await runtime.dispatchFetch("https://objects/", { method: "POST", body: JSON.stringify({ count }) });
   if (response.status !== 200) throw new Error(await response.text());
   const result = await response.json() as { bytes: number; handles: number; closed: number; writes: number; reads: number; peak: number; stageOpened: number; stageClosed: number; files: number; nodeGlobals: boolean };
   expect(result.bytes).toBeGreaterThan(count); expect(result.peak).toBeLessThanOrEqual(65536);
   expect(result.handles).toBeGreaterThan(0); expect(result.closed).toBe(result.handles); expect(result.stageClosed).toBe(result.stageOpened);
   expect(result.writes).toBeGreaterThan(0); expect(result.reads).toBeGreaterThan(0); expect(result.files).toBe(0); expect(result.nodeGlobals).toBe(false); expect(backing.size).toBe(0);
 } } finally { await runtime.dispose(); }
}, 15000);
