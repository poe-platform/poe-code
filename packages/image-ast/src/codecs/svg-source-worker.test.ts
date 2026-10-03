import {expect,test} from "vitest";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";

test('renders retained SVG syntax, points, text and nesting with external Worker storage',async()=>{
 const input=new TextEncoder().encode('<svg data-padding="'+'x'.repeat(262144)+'" width="4" height="4">'+'<g transform="translate(0)">'.repeat(64)+'<path fill="none" d="M0 0 '+'1 1 '.repeat(2048)+'"/><text fill="none">'+' '.repeat(4096)+'</text><rect width="4" height="4" fill="red"/>'+'</g>'.repeat(64)+'</svg>');
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL('../../../../',import.meta.url)),sourcefile:'svg-source-worker.ts',contents:`
 import {decodeImageToStorage} from './packages/image-ast/src/codecs/source-decode.ts';
 export default {async fetch(request,env){const size=Number(await request.text());let allocated=0,maxAllocation=0,sourceReads=0,writes=0;
 const source={size,async read(position,length){if(length>4096)throw Error('unbounded input read');sourceReads++;return new Uint8Array(await(await env.INPUT.fetch('https://input/?position='+position+'&length='+length)).arrayBuffer());}};
 const storage={allocate(length){const at=allocated;allocated+=length;return at;},async read(position,length){if(length>4096)throw Error('unbounded backing read');return new Uint8Array(await(await env.BACKING.fetch('https://backing/?position='+position+'&length='+length)).arrayBuffer());},async write(position,bytes){if(bytes.length>4096)throw Error('unbounded write');writes++;await env.BACKING.fetch('https://backing/?position='+position,{method:'PUT',body:bytes});}};
 const Native=Uint8Array,decode=TextDecoder.prototype.decode;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw Error('unbounded allocation '+length);return Reflect.construct(target,args);}});
 TextDecoder.prototype.decode=function(input,options){if(input?.byteLength>4096)throw Error('unbounded text decoding');return decode.call(this,input,options);};
 try{const image=await decodeImageToStorage(source,storage,new AbortController().signal);const pixels=Array.from(await storage.read(image.position,64));return Response.json({image,pixels,allocated,maxAllocation,sourceReads,writes,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});}finally{globalThis.Uint8Array=Native;TextDecoder.prototype.decode=decode;}
 }};`},bundle:true,write:false,platform:'browser',conditions:['workerd'],format:'esm',metafile:true,logLevel:'silent'});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 const pages=new Map<number,Uint8Array>();
 const runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{INPUT:async(request:Request)=>{const url=new URL(request.url),position=Number(url.searchParams.get('position')),length=Number(url.searchParams.get('length'));return new Response(input.slice(position,position+length));},BACKING:async(request:Request)=>{
  const url=new URL(request.url),position=Number(url.searchParams.get('position'));
  if(request.method==='PUT'){const bytes=new Uint8Array(await request.arrayBuffer());for(let i=0;i<bytes.length;i++){const at=position+i,key=Math.floor(at/4096);let page=pages.get(key);if(!page){page=new Uint8Array(4096);pages.set(key,page);}page[at%4096]=bytes[i]!;}return new Response();}
  const length=Number(url.searchParams.get('length')),bytes=new Uint8Array(length);for(let i=0;i<length;i++)bytes[i]=pages.get(Math.floor((position+i)/4096))?.[(position+i)%4096]??0;return new Response(bytes);
 }}});
 try{const response=await runtime.dispatchFetch('https://verify/',{method:'POST',body:String(input.length)});if(response.status!==200)throw new Error(await response.text());const result=await response.json() as {image:{width:number;height:number};pixels:number[];allocated:number;maxAllocation:number;sourceReads:number;writes:number;nodeGlobals:boolean};
 expect(result.image).toMatchObject({width:4,height:4});expect(result.pixels).toEqual(Array.from({length:16},()=>[255,0,0,255]).flat());expect(result.allocated).toBeGreaterThan(65536);expect(result.maxAllocation).toBeLessThanOrEqual(65536);expect(result.sourceReads).toBeGreaterThan(64);expect(result.writes).toBeGreaterThan(64);expect(result.nodeGlobals).toBe(false);
 }finally{await runtime.dispose();}
},15000);
