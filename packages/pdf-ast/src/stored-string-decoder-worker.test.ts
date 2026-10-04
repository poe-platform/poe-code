import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

it("decodes growing stored PDF strings in Workerd without retaining the payload",async()=>{
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../",import.meta.url)),sourcefile:"stored-string-worker.ts",contents:`
import {decodeStoredPdfString} from './packages/pdf-ast/src/ast.ts';
export default {async fetch(request,env){
 const count=Number(new URL(request.url).searchParams.get('count'));let reads=0,units=0,peak=0;
 const original=Array.prototype.push;Array.prototype.push=function(...items){if(this.length+items.length>64)throw Error('resident code units');return original.apply(this,items);};
 try{
 const storage={allocate(){throw Error('allocation');},async write(){throw Error('write');},async read(at,n){if(n>4096)throw Error('large read');reads++;return new Uint8Array(await(await env.BACKING.fetch('https://backing/?at='+at+'&length='+n)).arrayBuffer());}};
 for await(const text of decodeStoredPdfString({storage,position:0,byteLength:count*2+2})){peak=Math.max(peak,text.length);for(const char of text)if(char!=='A')throw Error('wrong text');units+=text.length;}
 return Response.json({units,reads,peak,node:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{Array.prototype.push=original;}
}};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 const runtime=new Miniflare({workers:[
  {name:"strings",modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{BACKING:"string-source"}},
  {name:"string-source",modules:true,compatibilityDate:"2026-07-01",cf:false,script:`export default {fetch(request){const url=new URL(request.url),at=Number(url.searchParams.get('at')),n=Number(url.searchParams.get('length'));const bytes=new Uint8Array(n);for(let i=0;i<n;i++){const p=at+i;bytes[i]=p===0?254:p===1?255:p%2?65:0;}return new Response(bytes);}};`}
 ]});
 try{
  for(const count of [65536,524288]){
   const response=await runtime.dispatchFetch("https://worker/?count="+count);if(response.status!==200)throw Error(await response.text());
   const result=await response.json() as {units:number;reads:number;peak:number;node:boolean};
   expect(result.units).toBe(count);expect(result.reads).toBe(Math.ceil((count*2+2)/4096));expect(result.peak).toBeLessThanOrEqual(4096);expect(result.node).toBe(false);
  }
 }finally{await runtime.dispose();}
});
