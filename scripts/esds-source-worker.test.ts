import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { afterAll,beforeAll,expect,it } from 'vitest';

const descriptors=20000,ascLength=100000,input=new Uint8Array(4+descriptors*2+4+ascLength);
for(let i=0;i<descriptors;i++)input[4+i*2]=6;
input.set([5,0x86,0x8d,0x20,0x12,0x10],4+descriptors*2);
let runtime:Miniflare;
beforeAll(async()=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),contents:"export {probeEsdsSource,MediaBudgetTracker} from '@poe-code/mp4-ast';"},bundle:true,platform:'browser',conditions:['workerd'],format:'cjs',write:false,metafile:true,logLevel:'silent'});
  for(const output of Object.values(bundle.metafile!.outputs))expect(output.imports).toEqual([]);
  expect(Object.keys(bundle.metafile!.inputs).some(path=>path.startsWith('node:'))).toBe(false);
  runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,r2Buckets:['PAGES'],script:`
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const mode=new URL(request.url).pathname.slice(1),controller=new AbortController();let reads=0,largestRead=0,largestAllocation=0,checkpoints=0,result,error;
      const budget=new api.MediaBudgetTracker({maxMemoryBytes:mode==='memory'?16383:16384});
      const source={size:${input.length},async read(offset,length){
        reads++;largestRead=Math.max(largestRead,length);
        if(length>16384)throw new Error('unbounded source read');
        if(reads===2&&mode==='source')throw new Error('source failed');
        if(reads===2&&mode==='cancel')controller.abort(new Error('cancelled descriptor'));
        if(reads===2&&mode==='short')return new Uint8Array();
        const object=await env.PAGES.get('input',{range:{offset,length}});return new Uint8Array(await object.arrayBuffer());
      }};
      const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const bytes=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,bytes.length);if(bytes.length>16384)throw new Error('unbounded allocation');return bytes;}});
      try{result=await api.probeEsdsSource(source,{payloadOffset:0,payloadSize:source.size},{signal:controller.signal,budget,checkpoint:async()=>{checkpoints++;}});}catch(cause){error=cause.message;}finally{globalThis.Uint8Array=Native;}
      return Response.json({result,error,reads,largestRead,largestAllocation,checkpoints,memory:budget.getStats().currentMemoryBytes});
    }}
  `});
  const bucket=await runtime.getR2Bucket('PAGES');await bucket.put('input',input);
});
afterAll(async()=>{await runtime?.dispose();});
for(const mode of ['ok','source','cancel','short','memory'])it(`ES descriptor metadata is bounded in a Node-free R2 Worker: ${mode}`,async()=>{
  const result=await(await runtime.dispatchFetch('https://example.test/'+mode)).json() as {result?:unknown;error?:string;reads:number;largestRead:number;largestAllocation:number;checkpoints:number;memory:number};
  expect(result.memory).toBe(0);expect(result.largestRead).toBeLessThanOrEqual(16384);expect(result.largestAllocation).toBeLessThanOrEqual(16384);
  if(mode==='ok'){
    expect(result.error).toBeUndefined();expect(result.result).toEqual({objectTypeIndication:64,audioObjectType:2,sampleRate:44100,channelCount:2,maxBitrate:128000,avgBitrate:128000});
    expect(result.reads).toBe(3);expect(result.checkpoints).toBeGreaterThan(100);
  }else{
    expect(result.result).toBeUndefined();expect(result.error).toContain(mode==='source'?'source failed':mode==='cancel'?'cancelled descriptor':mode==='short'?'Truncated MP4 sample source':'maxMemoryBytes');
  }
});
