import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";

const count = 350000;
function sync(value: number) { return [value >>> 21 & 127,value >>> 14 & 127,value >>> 7 & 127,value & 127]; }
const prefixes = [false,true].map(unsync => {
  const version = unsync ? 3 : 4, size = 1 + count * (unsync ? 3 : 2), logical = 1 + count * 2;
  return [73,68,51,version,0,unsync ? 128 : 0,...sync(10+size),84,73,84,50,...(unsync ? [logical>>>24,logical>>>16&255,logical>>>8&255,logical&255] : sync(size)),0,0,0];
});
let runtime: Miniflare;
beforeAll(async () => {
  const bundle = await build({ stdin: { resolveDir:process.cwd(),contents:"export {probeId3Source,readId3Text} from '@poe-code/audio-ast';" },bundle:true,platform:"browser",conditions:["workerd"],format:"cjs",write:false,metafile:true,logLevel:"silent" });
  for (const output of Object.values(bundle.metafile!.outputs)) expect(output.imports).toEqual([]);
  expect(Object.keys(bundle.metafile!.inputs).some(path=>path.startsWith("node:"))).toBe(false);
  runtime = new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:`
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request){
      const [kind,mode]=new URL(request.url).pathname.slice(1).split('/'),unsync=kind==='unsync',prefix=new Uint8Array(${JSON.stringify(prefixes)}[unsync?1:0]);
      const size=21+${count}*(unsync?3:2),controller=new AbortController();
      let reads=0,checkpoints=0,tags=0,textLength=0,hash=2166136261,largestRead=0,largestAllocation=0,error;
      const source={size,async read(offset,length){
        reads++;largestRead=Math.max(largestRead,length);if(length>16384)throw new Error('Unbounded read');
        if(reads===3&&mode==='source')throw new Error('source failure');
        if(reads===3&&mode==='cancel')controller.abort(new Error('cancelled read'));
        const bytes=new Uint8Array(length);for(let i=0;i<length;i++){const at=offset+i;bytes[i]=at<prefix.length?prefix[at]:unsync?[65,255,0][(at-21)%3]:[65,255][(at-21)%2];}return bytes;
      }};
      const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const bytes=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,bytes.length);if(bytes.length>16384)throw new Error('Unbounded allocation');return bytes;}});
      let result;try{result=await api.probeId3Source(source,{signal:controller.signal,checkpoint:async()=>{checkpoints++;if(mode==='checkpoint')controller.abort(new Error('cancelled checkpoint'));},onTag:async span=>{
        tags++;if(mode==='callback')throw new Error('callback failure');
        for await(const text of api.readId3Text(source,span,{signal:controller.signal})){textLength+=text.length;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619)>>>0;}
      }});}catch(cause){error=cause.message;}finally{globalThis.Uint8Array=Native;}
      return Response.json({result,error,reads,checkpoints,tags,textLength,hash,largestRead,largestAllocation,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
    }};`});
});
afterAll(async()=>{await runtime?.dispose();});
let expectedHash=2166136261;for(let i=0;i<count;i++)for(const code of [65,255])expectedHash=Math.imul(expectedHash^code,16777619)>>>0;
for(const kind of ["plain","unsync"])for(const mode of ["success","source","cancel","checkpoint","callback"])it(`bounds ID3 source parsing in a Node-free Worker: ${kind} ${mode}`,async()=>{
  const response=await runtime.dispatchFetch(`http://worker/${kind}/${mode}`);expect(response.status).toBe(200);
  const result=await response.json() as {result?:{size:number;tags:Record<string,string>};error?:string;reads:number;checkpoints:number;tags:number;textLength:number;hash:number;largestRead:number;largestAllocation:number;nodeFree:boolean};
  expect(result.nodeFree).toBe(true);expect(result.largestRead).toBeLessThanOrEqual(16384);expect(result.largestAllocation).toBeLessThanOrEqual(16384);
  if(mode==='success'){expect(result.error).toBeUndefined();expect(result.tags).toBe(1);expect(result.result?.tags).toEqual({});expect(result.textLength).toBe(count*2);expect(result.hash).toBe(expectedHash);expect(result.checkpoints).toBeGreaterThan(0);}
  else expect(result.error).toBe(({source:'source failure',cancel:'cancelled read',checkpoint:'cancelled checkpoint',callback:'callback failure'} as Record<string,string>)[mode]);
});
