import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

it("parses growing source arrays in Workerd using external backing", async () => {
  const bundle = await build({stdin:{resolveDir:fileURLToPath(new URL("../../../../",import.meta.url)),sourcefile:"source-arrays.ts",contents:`
import {parseCosRangeValue} from './packages/pdf-ast/src/cos/range-parser.ts';
import {readStoredItems} from './packages/pdf-ast/src/content/stored-record.ts';
export default {async fetch(request,env){
 const count=Number(new URL(request.url).searchParams.get('count'));let end=0,reads=0,writes=0;
 const storage={allocate(n){const at=end;end+=n;return at;},async read(at,n){if(n>4096)throw Error('large read');reads++;return new Uint8Array(await(await env.BACKING.fetch('https://backing/?at='+at+'&length='+n)).arrayBuffer());},async write(at,bytes){if(bytes.length>4096)throw Error('large write');writes++;await env.BACKING.fetch('https://backing/?at='+at,{method:'PUT',body:bytes});}};
 const source={size:count*2+2,chunkBytes:128,async read(at,n){const bytes=new Uint8Array(n);for(let i=0;i<n;i++){const p=at+i;bytes[i]=p===0?91:p===count*2+1?93:p%2?55:32;}return bytes;}};
 const {value}=await parseCosRangeValue(source,0,{arrayStorage:storage,storeRootArray:true});
 if(value.items.length||value.storedItems.length!==count)throw Error('resident array');
 let seen=0;for await(const item of readStoredItems(value.storedItems)){if(item.kind!=='number'||item.value!==7)throw Error('wrong value');seen++;}
 return Response.json({seen,reads,writes,node:typeof process!=='undefined'||typeof Buffer!=='undefined'});
}};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
  expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
  const data = new Uint8Array(2_000_000);
  const runtime = new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{BACKING:async(request:Request)=>{
    const url=new URL(request.url),at=Number(url.searchParams.get("at"));
    if(request.method==="PUT"){data.set(new Uint8Array(await request.arrayBuffer()),at);return new Response();}
    return new Response(data.slice(at,at+Number(url.searchParams.get("length"))));
  }}});
  try {
    let previousReads=0,previousWrites=0;
    for(const count of [128,1024]) {
      const response=await runtime.dispatchFetch("https://worker/?count="+count);
      if(response.status!==200)throw Error(await response.text());
      const result=await response.json() as {seen:number;reads:number;writes:number;node:boolean};
      expect(result.seen).toBe(count);expect(result.node).toBe(false);
      expect(result.reads).toBeGreaterThan(previousReads);expect(result.writes).toBeGreaterThan(previousWrites);
      previousReads=result.reads;previousWrites=result.writes;
    }
  } finally {await runtime.dispose();}
});
