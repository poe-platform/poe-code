import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

it("renders growing dash declarations in Workerd with backing in a separate isolate", async () => {
  const bundle = await build({ stdin: {
    resolveDir: fileURLToPath(new URL("../../../../", import.meta.url)), sourcefile: "dash-worker.ts", contents: `
import {parseCosRangeValue} from './packages/pdf-ast/src/cos/range-parser.ts';
import {storeDashArray} from './packages/pdf-ast/src/content/stored-dash.ts';
import {storedStrokeDash} from './packages/pdf-ast/src/render/stored-dash.ts';
import {strokeOutlinePoints} from './packages/pdf-ast/src/render/stroke.ts';
export default {async fetch(request,env){
 const count=Number(new URL(request.url).searchParams.get('count'));let end=0,reads=0,writes=0,peak=0;
 const push=Array.prototype.push;Array.prototype.push=function(...items){const n=push.apply(this,items);peak=Math.max(peak,n);if(n>64)throw Error('resident dash array');return n;};
 try {
 const storage={allocate(n){const at=end;end+=n;return at;},async read(at,n){if(n>4096)throw Error('large read');reads++;return new Uint8Array(await(await env.BACKING.fetch('https://backing/?at='+at+'&length='+n)).arrayBuffer());},async write(at,bytes){if(bytes.length>4096)throw Error('large write');writes++;await env.BACKING.fetch('https://backing/?at='+at,{method:'PUT',body:bytes});}};
 const source={size:count*2+2,chunkBytes:128,async read(at,n){const bytes=new Uint8Array(n);for(let i=0;i<n;i++){const p=at+i;bytes[i]=p===0?91:p===count*2+1?93:p%2?51:32;}return bytes;}};
 const {value}=await parseCosRangeValue(source,0,{arrayStorage:storage,storeRootArray:true});
 if(value.items.length||value.storedItems.length!==count)throw Error('resident declaration');
 const dash=await storeDashArray(value,storage,async node=>node);
 if(dash.length!==count||dash.total!==count*3)throw Error('wrong pattern');
 let pending;const reader=storedStrokeDash(dash,1,function*(action){pending=action;yield null;});
 const outline=strokeOutlinePoints([{points:[[0,0],[20,0]],closed:false}],1,0,0,10,reader,count*3-2);
 let points=0;for(const point of outline){if(point===null){await pending();pending=undefined;}else if(point)points++;}
 return Response.json({points,reads,writes,peak,node:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{Array.prototype.push=push;}
}};` }, bundle: true, write: false, platform: "browser", conditions: ["workerd"], format: "esm", metafile: true, logLevel: "silent" });
  expect(Object.values(bundle.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  const runtime = new Miniflare({ workers: [
    { name: "dash", modules: true, compatibilityDate: "2026-07-01", cf: false, script: bundle.outputFiles[0]!.text, serviceBindings: { BACKING: "dash-store" } },
    { name: "dash-store", modules: true, compatibilityDate: "2026-07-01", cf: false, script: `
const data=new Uint8Array(4_000_000);
export default {async fetch(request){const url=new URL(request.url),at=Number(url.searchParams.get('at'));
if(request.method==='PUT'){data.set(new Uint8Array(await request.arrayBuffer()),at);return new Response();}
return new Response(data.slice(at,at+Number(url.searchParams.get('length'))));}};` }
  ] });
  try {
    let reads = 0, writes = 0, points = 0;
    for (const count of [513, 2049]) {
      const response = await runtime.dispatchFetch("https://worker/?count=" + count);
      if (response.status !== 200) throw Error(await response.text());
      const result = await response.json() as { points: number; reads: number; writes: number; peak: number; node: boolean };
      expect(result.node).toBe(false); expect(result.peak).toBeLessThanOrEqual(64);
      expect(result.points).toBeGreaterThan(0); if (points) expect(result.points).toBe(points);
      expect(result.reads).toBeGreaterThan(reads); expect(result.writes).toBeGreaterThan(writes);
      reads = result.reads; writes = result.writes; points = result.points;
    }
  } finally { await runtime.dispose(); }
});
