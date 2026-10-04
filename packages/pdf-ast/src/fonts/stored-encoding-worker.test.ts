import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

it("keeps encoding maps bounded in Workerd with external declaration storage", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../../../", import.meta.url)),
      sourcefile: "encoding-worker.ts",
      contents: `
 import {parseCosRangeValue} from './packages/pdf-ast/src/cos/range-parser.ts';
 import {readStoredItems} from './packages/pdf-ast/src/content/stored-record.ts';
 import {StoredFontEncoding} from './packages/pdf-ast/src/fonts/stored-encoding.ts';
 export default {async fetch(request,env){
 const count=Number(new URL(request.url).searchParams.get('count'));let end=0,reads=0,writes=0,admission=0,peakMap=0;
 const original=Map.prototype.set;Map.prototype.set=function(key,value){const result=original.call(this,key,value);peakMap=Math.max(peakMap,this.size);if(this.size>256)throw Error('resident declaration map');return result;};
 try{
 const storage={allocate(n){const at=end;end+=n;return at;},async read(at,n){if(n>4096)throw Error('large read');reads++;return new Uint8Array(await(await env.BACKING.fetch('https://backing/?at='+at+'&length='+n)).arrayBuffer());},async write(at,bytes){if(bytes.length>4096)throw Error('large write');writes++;await env.BACKING.fetch('https://backing/?at='+at,{method:'PUT',body:bytes});}};
 const prefix='[0 ',pattern='/A ',suffix=']';
 const source={size:prefix.length+count*pattern.length+suffix.length,chunkBytes:128,async read(at,n){const bytes=new Uint8Array(n);for(let i=0;i<n;i++){const p=at+i-prefix.length;bytes[i]=p<0?prefix.charCodeAt(at+i):p<count*pattern.length?pattern.charCodeAt(p%pattern.length):suffix.charCodeAt(p-count*pattern.length);}return bytes;}};
 const {value}=await parseCosRangeValue(source,0,{arrayStorage:storage,storeRootArray:true});if(value.items.length)throw Error('resident declarations');
 const encoding=await StoredFontEncoding.create(()=>readStoredItems(value.storedItems),storage,{onAllocation(n){admission+=n;}});
 for(const code of [0,count-1])if(await encoding.unicode(code)!=='A'||await encoding.glyphName(code)!=='A')throw Error('wrong label');
 if(await encoding.unicode(count)!==undefined)throw Error('unexpected label');
 return Response.json({admission,peakMap,reads,writes,node:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{Map.prototype.set=original;}
 }};`
    },
    bundle: true,
    write: false,
    platform: "browser",
    conditions: ["workerd"],
    format: "esm",
    metafile: true,
    logLevel: "silent"
  });
  expect(Object.values(bundle.metafile!.outputs).flatMap((output) => output.imports)).toEqual([]);
  const runtime = new Miniflare({
    workers: [
      {
        name: "encoding",
        modules: true,
        compatibilityDate: "2026-07-01",
        cf: false,
        script: bundle.outputFiles[0]!.text,
        serviceBindings: { BACKING: "encoding-store" }
      },
      {
        name: "encoding-store",
        modules: true,
        compatibilityDate: "2026-07-01",
        cf: false,
        script: `
   const data=new Uint8Array(4_000_000);
   export default {async fetch(request){
    const url=new URL(request.url),at=Number(url.searchParams.get('at'));
    if(request.method==='PUT'){data.set(new Uint8Array(await request.arrayBuffer()),at);return new Response();}
    return new Response(data.slice(at,at+Number(url.searchParams.get('length'))));
   }};`
      }
    ]
  });
  try {
    let reads = 0,
      writes = 0;
    for (const count of [128, 512]) {
      const response = await runtime.dispatchFetch("https://worker/?count=" + count);
      if (response.status !== 200) throw Error(await response.text());
      const result = (await response.json()) as {
        admission: number;
        peakMap: number;
        reads: number;
        writes: number;
        node: boolean;
      };
      expect(result.admission).toBe(65536);
      expect(result.peakMap).toBeLessThanOrEqual(129);
      expect(result.node).toBe(false);
      expect(result.reads).toBeGreaterThan(reads);
      expect(result.writes).toBeGreaterThan(writes);
      reads = result.reads;
      writes = result.writes;
    }
  } finally {
    await runtime.dispose();
  }
});
